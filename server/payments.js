import Stripe from 'stripe';
import { activate, fail, find, id } from './domain.js';

export function paymentConfiguration(env = process.env, demo = false) {
  const key = env.STRIPE_SECRET_KEY || '';
  const mode = /^[sr]k_test_/.test(key) ? 'test' : /^[sr]k_live_/.test(key) ? 'live' : null;
  const reason = demo ? 'Online checkout is unavailable in the demo workspace.'
    : !mode ? 'A Stripe server key is required.'
    : !/^whsec_[A-Za-z0-9]{10,}$/.test(env.STRIPE_WEBHOOK_SECRET || '') ? 'A Stripe webhook signing secret is required.'
    : null;
  return { enabled: !reason, mode, reason };
}

export function createStripeClient(env = process.env) {
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20000 });
}

export const checkoutEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

// This function runs inside the store's atomic mutation, shared by webhooks and
// server-side reconciliation. A browser's return URL never proves payment.
export function applyCheckout(state, checkout, { mode, eventType } = {}) {
  if (checkout.metadata?.app !== 'forma') return { ignored: true };
  const payment = state.payments.find(p => p.id === checkout.metadata.paymentId);
  if (!payment) return { ignored: true };
  const attempt = payment.checkout;
  if (!attempt || attempt.id !== checkout.metadata.attemptId) return { ignored: true };
  if (payment.method !== 'online' || checkout.mode !== 'payment'
    || checkout.livemode !== (mode === 'live')
    || checkout.amount_total !== payment.amount
    || checkout.currency !== payment.currency.toLowerCase()
    || (attempt.sessionId && attempt.sessionId !== checkout.id)) {
    fail('Checkout details do not match the purchase.', 400);
  }
  // A signed event may arrive before the create-session response is persisted.
  attempt.sessionId = checkout.id;
  payment.sessionId = checkout.id;
  if (payment.status === 'paid') return payment;
  if (checkout.payment_status === 'paid') {
    activate(state, payment.id);
    attempt.status = 'paid';
    payment.paymentIntentId = typeof checkout.payment_intent === 'string'
      ? checkout.payment_intent : checkout.payment_intent?.id;
  } else if (checkout.status === 'expired') {
    attempt.status = 'expired';
    payment.status = 'expired';
  } else if (eventType === 'checkout.session.async_payment_failed') {
    attempt.status = 'failed';
    payment.status = 'failed';
  } else if (checkout.status === 'complete' && !['failed', 'expired'].includes(payment.status)) {
    attempt.status = 'processing';
    payment.status = 'processing';
  } else if (checkout.status === 'open' && !['failed', 'expired', 'processing'].includes(payment.status)) {
    attempt.status = 'open';
    payment.status = 'pending';
  }
  payment.updatedAt = new Date().toISOString();
  return payment;
}

export function createPaymentService({ store, stripe, mode }) {
  async function reconcile(paymentId, eventType) {
    const state = await store.read();
    const payment = find(state.payments, paymentId);
    if (!payment.checkout?.sessionId || payment.status === 'paid') return payment;
    const checkout = await stripe.checkout.sessions.retrieve(payment.checkout.sessionId);
    return store.mutate(s => applyCheckout(s, checkout, { mode, eventType }));
  }

  async function checkout(paymentId, returnOrigin) {
    let payment = find((await store.read()).payments, paymentId);
    if (payment.method !== 'online') fail('This purchase uses cash payment.');
    if (payment.status === 'paid') fail('This purchase is already paid.', 409);
    if (payment.sessionId && !payment.checkout) {
      // Do not accidentally create a second charge for an older integration's
      // session. It must be reconciled/migrated before opening another one.
      fail('This purchase has an older checkout session. Contact the gym to reconcile it before retrying.', 409);
    }
    if (payment.checkout?.sessionId) {
      const existing = await stripe.checkout.sessions.retrieve(payment.checkout.sessionId);
      const updated = await store.mutate(s => applyCheckout(s, existing, { mode }));
      if (updated.status === 'paid') return { status: 'paid' };
      if (updated.status === 'processing') return { status: 'processing' };
      if (existing.status === 'open' && updated.status === 'pending') {
        return { url: existing.url, status: 'pending' };
      }
    }

    // Persist stable parameters before talking to Stripe. Concurrent requests
    // share this attempt and Stripe idempotency key, even across API processes.
    payment = await store.mutate(s => {
      const current = find(s.payments, paymentId);
      if (current.status === 'paid' || current.status === 'processing') return current;
      if (!current.checkout || ['expired', 'failed'].includes(current.checkout.status)) {
        const attemptId = id();
        current.checkout = {
          id: attemptId,
          status: 'creating',
          email: find(s.members, current.memberId).email,
          returnOrigin,
          // Persist this value so retries send exactly the same parameters.
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          integrationIdentifier: 'forma_membership_' + attemptId.replace(/[^a-f]/g, '').padEnd(8, 'a').slice(0, 8),
        };
        current.status = 'pending';
        delete current.sessionId;
      }
      return current;
    });
    if (['paid', 'processing'].includes(payment.status)) return { status: payment.status };
    const attempt = payment.checkout;
    const returnBase = `${attempt.returnOrigin}/?payment=${encodeURIComponent(payment.id)}`;
    let session;
    try {
      session = await stripe.checkout.sessions.create({
      mode: 'payment',
      integration_identifier: attempt.integrationIdentifier,
      client_reference_id: payment.id,
      customer_email: attempt.email,
      metadata: { app: 'forma', paymentId: payment.id, attemptId: attempt.id },
      // A fixed currency/amount is used for local ledger reconciliation.
      adaptive_pricing: { enabled: false },
      line_items: [{ price_data: {
        currency: payment.currency.toLowerCase(),
        unit_amount: payment.amount,
        product_data: { name: payment.description },
      }, quantity: 1 }],
      expires_at: attempt.expiresAt,
      success_url: `${returnBase}&checkout=success#payments`,
      cancel_url: `${returnBase}&checkout=cancelled#payments`,
      }, { idempotencyKey: `forma-checkout-${attempt.id}` });
    } catch (error) {
      // Validation rejection means Stripe did not create a session. A network
      // timeout is ambiguous and must retain the same idempotency key instead.
      if (error.type === 'StripeInvalidRequestError' && error.statusCode === 400 && error.code !== 'idempotency_key_in_use') {
        await store.mutate(s => {
          const current = find(s.payments, paymentId);
          if (current.checkout?.id === attempt.id && !current.checkout.sessionId && current.status === 'pending') {
            current.checkout.status = 'failed';
            current.status = 'failed';
          }
        });
      }
      throw error;
    }

    const updated = await store.mutate(s => applyCheckout(s, session, { mode }));
    if (updated.ignored) fail('The checkout changed. Refresh and try again.', 409);
    if (['paid', 'processing'].includes(updated.status)) return { status: updated.status };
    if (session.status !== 'open' || !session.url) fail('Checkout expired. Try again to open a new checkout.', 409);
    return { url: session.url, status: 'pending' };
  }

  async function webhook(event) {
    if (!checkoutEvents.has(event.type)) return { ignored: true };
    const delivered = event.data.object;
    if (delivered.metadata?.app !== 'forma') return { ignored: true };
    const state = await store.read();
    const payment = state.payments.find(p => p.id === delivered.metadata.paymentId);
    if (!payment?.checkout || payment.checkout.id !== delivered.metadata.attemptId) return { ignored: true };
    // Read the latest provider state so a late/reordered event cannot regress it.
    const latest = await stripe.checkout.sessions.retrieve(delivered.id);
    return store.mutate(s => applyCheckout(s, latest, { mode, eventType: event.type }));
  }
  return { checkout, reconcile, webhook };
}
