# Online membership payments

Forma uses one-time Stripe-hosted Checkout. Plans renew through a new purchase; recurring subscriptions and refunds are separate future features.

## Local setup

Keep credentials in ignored `.env`. Set `DEMO_MODE=false`, a working `MONGODB_URI`, `SESSION_SECRET`, owner credentials and a Stripe **test** key in `STRIPE_SECRET_KEY`. Prefer a restricted key with the Checkout permissions required by your integration. Never put secret keys in the frontend or Git.

Start the webhook listener in one terminal:

```powershell
npm run stripe:listen
```

This authenticates using the test key from `.env`, subscribes to four Checkout event types, and writes the listener's signing secret directly into `.env`. The secret is never printed. It forwards to `http://127.0.0.1:4000/api/webhooks/stripe` (or the configured PORT). Keep the listener running throughout testing.

Then start or restart the app in another terminal:

```powershell
npm run dev
```

Use the APP_URL configured in `.env`. In development localhost and 127.0.0.1 aliases on that same port are accepted. Checkout returns to the origin where the purchase started so your session cookie remains available. Production accepts only APP_URL.

Run read-only connection checks:

```powershell
npm run payments:check
```

## Member and staff workflows

1. Select a membership and choose **Online payment**.
2. Submit the purchase; Stripe Checkout opens with the server-stored plan price and currency.
3. In test mode, use Stripe's test card `4242 4242 4242 4242`, any future expiry and any three-digit CVC. Use synthetic billing details.
4. Return to Payments. Forma checks Stripe on the server, updates the membership and shows a receipt once paid.
5. Closing or returning from checkout leaves the purchase available to resume. Expired or definitively failed checkouts support **Retry payment**. A processing payment cannot start another checkout.

Decline testing: Stripe's `4000 0000 0000 0002` card is declined; the checkout remains unpaid and no membership activates. Additional scenarios are listed in [Stripe's testing guide](https://docs.stripe.com/testing).

## Payment integrity

- Prices, currency and membership details come from the server, never submitted browser amounts.
- A purchase reserves a persisted checkout attempt before making the provider request. Stable parameters and a Stripe idempotency key prevent concurrent requests and network retries from producing multiple sessions.
- Only a signed webhook or an authenticated server-to-Stripe status check can activate a membership. URL parameters are display hints and never payment evidence.
- Both completed and asynchronous success events verify session ID, attempt, amount, currency, payment mode and test/live environment. The latest session is retrieved from Stripe to handle reordered events.
- Duplicate deliveries do not extend the membership twice. Failed and expired attempts can be retried; old attempts cannot overwrite the current one. A paid state cannot be downgraded.
- Delayed methods remain processing until confirmed. Cash confirmation cannot mark an online purchase as paid.
- Checkout parameters and provider references are kept out of the state API; customers can only reconcile or open their own purchases.
- Ambiguous network errors retain their attempt. A known request-validation failure permits a fresh attempt. An older checkout created before this integration is blocked from retry until reconciled, to avoid a second charge.

## Required deployed webhook

Register `https://your-gym-domain/api/webhooks/stripe` in the matching Stripe environment. Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Store that endpoint's signing secret in the host's secrets vault as STRIPE_WEBHOOK_SECRET. The CLI signing secret is for local forwarding and is not the deployed endpoint's secret. Use HTTPS, the correct APP_URL, a durable MongoDB database and secure production session configuration. Verify actual webhook delivery and a test payment before switching keys to live mode. Automatic tax, refunds and recurring billing are not enabled.

## Verification

`npm run test` covers the payment state machine, real SDK signature verification with synthetic events, authorization, retries, concurrency and provider failure handling through an injected Stripe test double. These automated tests do not contact Stripe. External sandbox verification is recorded separately in the task handoff.

Implementation follows [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), and [Stripe CLI webhook forwarding](https://docs.stripe.com/cli/listen).
