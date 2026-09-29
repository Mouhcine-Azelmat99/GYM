import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { createPaymentService, paymentConfiguration } from '../server/payments.js';
import { purchase } from '../server/domain.js';

// Only signature verification uses the real SDK. Checkout API calls use a
// deterministic provider double; these tests never charge or contact Stripe.
const signingSecret = 'whsec_' + randomBytes(24).toString('hex');
process.env.STRIPE_WEBHOOK_SECRET = signingSecret;
const sdk = new Stripe('test-key-for-local-signatures');

function gateway() {
  const sessions = new Map(), keys = new Map(), calls = [];
  const fake = {
    webhooks: sdk.webhooks,
    checkout: { sessions: {
      async create(params, options) {
        calls.push({ params: structuredClone(params), options: { ...options } });
        if (!keys.has(options.idempotencyKey)) {
          const id = 'cs_test_' + randomBytes(12).toString('hex');
          const checkout = { id, metadata: params.metadata, mode: params.mode, livemode: false,
            amount_total: params.line_items[0].price_data.unit_amount, currency: params.line_items[0].price_data.currency,
            status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/c/pay/' + id };
          sessions.set(id, checkout);keys.set(options.idempotencyKey, id);
        }
        return structuredClone(sessions.get(keys.get(options.idempotencyKey)));
      },
      async retrieve(id) { if (!sessions.has(id)) throw new Error('Unknown test session');return structuredClone(sessions.get(id)); },
    } }, sessions, calls,
  };
  return fake;
}

async function fixture() {
  const store = await createStore({ memory: true });
  const stripe = gateway();
  const app = createApp({ store, stripeClient: stripe, paymentConfig: { enabled: true, mode: 'test', reason: null } });
  const owner = request.agent(app), member = request.agent(app);
  await owner.post('/api/auth/demo').send({ role: 'owner' });
  await member.post('/api/auth/demo').send({ role: 'member' });
  const payment = await store.mutate(s => purchase(s, 'member-1', 'plan-all', 'online'));
  const checkout = () => member.post(`/api/payments/${payment.id}/checkout`).set('Origin', 'http://localhost:5173').send({});
  const current = async () => (await store.read()).payments.find(p => p.id === payment.id);
  const event = async (type, session, { signature = true, tamper = false } = {}) => {
    const payload = JSON.stringify({ id: 'evt_' + randomBytes(12).toString('hex'), type, data: { object: session }, livemode: false });
    const header = sdk.webhooks.generateTestHeaderString({ payload, secret: signingSecret });
    let req = request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json');
    if (signature) req = req.set('Stripe-Signature', header);
    return req.send(tamper ? payload + ' ' : payload);
  };
  return { store, stripe, app, owner, member, payment, checkout, current, event };
}

test('online checkout requires both API key and a valid webhook configuration', () => {
  const key = 'rk_test_' + randomBytes(12).toString('hex');
  assert.equal(paymentConfiguration({ STRIPE_SECRET_KEY: key }, false).enabled, false);
  assert.equal(paymentConfiguration({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: signingSecret }, true).enabled, false);
  assert.deepEqual(paymentConfiguration({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: signingSecret }, false), { enabled: true, mode: 'test', reason: null });
});

test('server-owned price, metadata and trusted return origin create the checkout', async () => {
  const f = await fixture();
  const result = await f.checkout().expect(200);
  assert.match(result.body.url, /^https:\/\/checkout\.stripe\.com\//);
  const { params } = f.stripe.calls[0];
  assert.equal(params.line_items[0].price_data.unit_amount, 8900);
  assert.equal(params.line_items[0].price_data.currency, 'usd');
  assert.equal(params.metadata.paymentId, f.payment.id);
  assert.equal(params.metadata.app, 'forma');
  assert.ok(params.success_url.startsWith('http://localhost:5173/?payment='));
  assert.ok(params.success_url.endsWith('&checkout=success#payments'));
  assert.equal(params.adaptive_pricing.enabled, false);
  assert.equal(params.payment_method_types, undefined);
  assert.equal((await f.current()).status, 'pending');
});

test('parallel checkout requests and repeated purchases reuse one attempt', async () => {
  const f = await fixture();
  const results = await Promise.all([f.checkout(), f.checkout(), f.checkout()]);
  assert.ok(results.every(r => r.status === 200));
  assert.equal(new Set(results.map(r => r.body.url)).size, 1);
  assert.equal(f.stripe.sessions.size, 1);
  const duplicate = await f.member.post('/api/purchases').send({ memberId: 'member-1', planId: 'plan-all', method: 'online', amount: 1 }).expect(201);
  assert.equal(duplicate.body.id, f.payment.id);
  assert.equal(duplicate.body.amount, 8900);
});

test('a lost create response retries with exactly the same provider parameters', async () => {
  const f = await fixture();
  const create = f.stripe.checkout.sessions.create;
  let lost = true;
  f.stripe.checkout.sessions.create = async (...args) => {
    const session = await create(...args);
    if (lost) { lost = false; throw Object.assign(new Error('Connection lost'), { type: 'StripeConnectionError' }); }
    return session;
  };
  await f.checkout().expect(502);
  await f.checkout().expect(200);
  assert.equal(f.stripe.sessions.size, 1);
  assert.deepEqual(f.stripe.calls[0], f.stripe.calls[1]);
});

test('provider validation rejection permits a new attempt after configuration is corrected', async () => {
  const f = await fixture();const create = f.stripe.checkout.sessions.create;
  f.stripe.checkout.sessions.create = async () => { throw Object.assign(new Error('Invalid request'), { type: 'StripeInvalidRequestError', statusCode: 400 }); };
  await f.checkout().expect(502);assert.equal((await f.current()).status, 'failed');
  const previous = (await f.current()).checkout.id;
  f.stripe.checkout.sessions.create = create;
  await f.checkout().expect(200);assert.notEqual((await f.current()).checkout.id, previous);
});

test('signed successful checkout activates once, including duplicate event delivery', async () => {
  const f = await fixture();await f.checkout();
  const session = [...f.stripe.sessions.values()][0];
  session.status = 'complete';session.payment_status = 'paid';session.payment_intent = 'pi_test_fixture';
  assert.equal((await f.event('checkout.session.completed', session)).status, 200);
  const before = await f.current();
  assert.equal(before.status, 'paid');
  const expiry = (await f.store.read()).memberships.find(m => m.id === before.membershipId).endsAt;
  assert.equal((await f.event('checkout.session.completed', session)).status, 200);
  assert.equal((await f.current()).paidAt, before.paidAt);
  assert.equal((await f.store.read()).memberships.find(m => m.id === before.membershipId).endsAt, expiry);
});

test('unsigned or tampered webhooks cannot change payment state', async () => {
  const f = await fixture();await f.checkout();const session = [...f.stripe.sessions.values()][0];
  session.status = 'complete';session.payment_status = 'paid';
  assert.equal((await f.event('checkout.session.completed', session, { signature: false })).status, 400);
  assert.equal((await f.event('checkout.session.completed', session, { tamper: true })).status, 400);
  assert.equal((await f.current()).status, 'pending');
});

for (const [name, edit] of [
  ['amount', s => { s.amount_total = 1; }],
  ['currency', s => { s.currency = 'eur'; }],
  ['test/live environment', s => { s.livemode = true; }],
  ['session mode', s => { s.mode = 'subscription'; }],
]) test(`mismatched ${name} is rejected even with a valid signature`, async () => {
  const f = await fixture();await f.checkout();const session = [...f.stripe.sessions.values()][0];
  session.status = 'complete';session.payment_status = 'paid';edit(session);
  assert.equal((await f.event('checkout.session.completed', session)).status, 400);
  assert.equal((await f.current()).status, 'pending');
});

test('delayed payments remain inactive until async success', async () => {
  const f = await fixture();await f.checkout();const session = [...f.stripe.sessions.values()][0];
  session.status = 'complete';
  await f.event('checkout.session.completed', session);
  assert.equal((await f.current()).status, 'processing');
  const s = await f.store.read();assert.equal(s.memberships.find(m => m.id === f.payment.membershipId).status, 'pending');
  const checkout = await f.checkout().expect(200);assert.equal(checkout.body.status, 'processing');assert.equal(f.stripe.sessions.size, 1);
  session.payment_status = 'paid';
  await f.event('checkout.session.async_payment_succeeded', session);
  assert.equal((await f.current()).status, 'paid');
});

test('async failure can retry; an old attempt cannot overwrite the new one', async () => {
  const f = await fixture();await f.checkout();const old = [...f.stripe.sessions.values()][0];
  old.status = 'complete';await f.event('checkout.session.completed', old);
  await f.event('checkout.session.async_payment_failed', old);assert.equal((await f.current()).status, 'failed');
  await f.checkout().expect(200);assert.equal(f.stripe.sessions.size, 2);
  await f.event('checkout.session.async_payment_failed', old);assert.equal((await f.current()).status, 'pending');
});

test('expired checkout creates one new session and keeps the same purchase', async () => {
  const f = await fixture();await f.checkout();const old = [...f.stripe.sessions.values()][0];old.status = 'expired';
  await f.event('checkout.session.expired', old);assert.equal((await f.current()).status, 'expired');
  await Promise.all([f.checkout().expect(200), f.checkout().expect(200)]);
  assert.equal(f.stripe.sessions.size, 2);assert.equal((await f.current()).status, 'pending');
});

test('return-page reconciliation uses provider truth and rejects another member', async () => {
  const f = await fixture();await f.checkout();
  await f.member.post(`/api/payments/${f.payment.id}/reconcile`).send({ status: 'paid' }).expect(200);
  assert.equal((await f.current()).status, 'pending');
  const session = [...f.stripe.sessions.values()][0];session.payment_status = 'paid';session.status = 'complete';
  await f.member.post(`/api/payments/${f.payment.id}/reconcile`).send({}).expect(200);
  assert.equal((await f.current()).status, 'paid');
  await f.member.post('/api/payments/payment-2/reconcile').send({}).expect(403);
  await f.member.post('/api/payments/payment-2/checkout').send({}).expect(403);
  await request(f.app).post(`/api/payments/${f.payment.id}/checkout`).send({}).expect(401);
});

test('late failure cannot reverse a confirmed payment', async () => {
  const f = await fixture();await f.checkout();const session = [...f.stripe.sessions.values()][0];
  session.status = 'complete';session.payment_status = 'paid';await f.event('checkout.session.completed', session);
  await f.event('checkout.session.async_payment_failed', { ...session, payment_status: 'unpaid' });
  assert.equal((await f.current()).status, 'paid');await f.checkout().expect(409);
});

test('provider retrieval failure returns an error so Stripe retries delivery', async () => {
  const f = await fixture();await f.checkout();const session = [...f.stripe.sessions.values()][0];
  f.stripe.checkout.sessions.retrieve = async () => { throw Object.assign(new Error('Unavailable'), { type: 'StripeConnectionError' }); };
  assert.equal((await f.event('checkout.session.completed', session)).status, 502);
  assert.equal((await f.current()).status, 'pending');
});

test('webhook can bind an attempt before session ID has been persisted', async () => {
  const f = await fixture();const create = f.stripe.checkout.sessions.create;
  const service = createPaymentService({ store: f.store, stripe: f.stripe, mode: 'test' });
  f.stripe.checkout.sessions.create = async (...args) => {
    const session = await create(...args);const actual = f.stripe.sessions.get(session.id);
    actual.payment_status = 'paid';actual.status = 'complete';
    await service.webhook({ type: 'checkout.session.completed', data: { object: actual } });
    return session;
  };
  const result = await f.checkout().expect(200);
  assert.equal(result.body.status, 'paid');assert.equal((await f.current()).status, 'paid');
});

test('unrelated Stripe events are acknowledged without affecting a purchase', async () => {
  const f = await fixture();await f.checkout();const session = [...f.stripe.sessions.values()][0];
  assert.equal((await f.event('customer.created', {})).status, 200);
  assert.equal((await f.event('checkout.session.completed', { ...session, metadata: { app: 'another-app' } })).status, 200);
  assert.equal((await f.current()).status, 'pending');
});
