# Forma gym management

A first working MERN release for a single gym. React 19 + Vite, Express 5, Node.js, MongoDB/Mongoose, and Stripe-hosted Checkout. Inter is bundled locally. Light surfaces, dark primary actions, and red danger actions.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:5173 and select **Owner** under **Explore the demo**. Demo role buttons also support receptionists, trainers, and members. The API runs at http://127.0.0.1:4000. Both localhost and 127.0.0.1 are accepted on the configured development port. Vite uses a strict port to avoid silently moving to a URL the API does not trust.

Demo records persist in ignored `data/demo.json`. Seed accounts initially have no passwords: use the role buttons. To enable owner email/password login, set OWNER_EMAIL and OWNER_PASSWORD (12–128 characters) in `.env` and restart the API. Startup initializes the passwordless demo owner without deleting sample data. Existing password-protected accounts are never overwritten by environment changes. Newly registered accounts can also use email/password sign-in. Demo sessions reset when the API process restarts. Demo mode is restricted to loopback and refuses to run with NODE_ENV=production.

## Configuration and login

`.env.example` is a reference template, not a loaded configuration file. Copy it to `.env`, then enter private configuration in `.env`. Do not commit credentials to `.env.example`.

In live mode set DEMO_MODE=false, MONGODB_URI, SESSION_SECRET (at least 32 characters), OWNER_EMAIL and OWNER_PASSWORD (at least 12 characters). The owner is created on the first startup when no owner exists. Changing these variables later does not change an existing account's password. Live mode starts without sample members. Create staff accounts from Team.

APP_URL is the browser-facing origin. Production allows only its exact origin. Local development accepts localhost, 127.0.0.1 and ::1 aliases using the same protocol and port. Cookies are host-specific, so sign in again when switching aliases.

## Working flows

- Role-based sessions, member registration, staff account creation and sign-out.
- Dashboard computed from records, member search/status filters and profile history.
- Time-based, session-pack and combined plans; pending purchase and manual renewal.
- Staff cash confirmation, idempotent activation, payment CSV export and printable payment acknowledgements.
- Session scheduling with room/trainer collision checks, capacity checks and member bookings.
- Credit reservation at booking, eligible credit return on cancellation, trainer attendance marking.
- Gym check-in validates current access and blocks duplicate check-ins on the same gym-local date.
- Member portal limits data to the signed-in member. Trainer access limits data to assigned sessions.
- Gym name, contact email, currency, timezone and cancellation policy settings.

## Online payments

Online checkout is intentionally disabled in demo mode. In MongoDB mode configure a server-only Stripe restricted API key with the required Checkout permissions using STRIPE_SECRET_KEY, plus STRIPE_WEBHOOK_SECRET. Both are required to enable online purchases. Store deployed keys in your host's secrets vault. No card details pass through this app.

Run `npm run stripe:listen` before starting the API to configure local test webhook forwarding. The signing secret is written directly to ignored `.env`. Keep the listener running and start/restart `npm run dev` in a separate terminal. Use `npm run payments:check` for read-only connectivity diagnostics.

The required webhook endpoint is `/api/webhooks/stripe`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`. A signed webhook or an authenticated server-side Stripe lookup activates paid purchases after matching amount, currency, attempt and session. Browser return parameters never prove payment. Expired and failed attempts support retries, and delayed payments remain processing until confirmed. See [online payment setup and testing](docs/payments.md).

Reference: [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment) and [Stripe key management](https://docs.stripe.com/keys).

## Checks

```powershell
npm run test
npm run build
```

Tests exercise allowed origins, authentication/session persistence, role boundaries, cash activation retries, booking concurrency, cancellation credits, check-in restrictions and renewal dates. Build output goes to `dist`. `npm start` serves the API and built client.

## Current release boundaries

This is a functional starting release, not the entire product roadmap. Membership freezes/cancellation workflows, refunds, password recovery, email verification, staff-created member portal invitations, automated reminders, translations, tax invoices, advanced reports and a full public marketing website remain to be built. Prices use integer minor units and currently support USD, EUR, GBP, MAD, CAD and AUD. Currency is locked after payment records exist. Only one gym timezone and currency are configured at a time. Training session eligibility currently uses generic class credits.

The initial MongoDB adapter stores the gym as one atomic aggregate with optimistic concurrency, suitable only for a small evaluation dataset. Split growing histories into indexed collections and paginate the state API before operational use; the MongoDB document limit makes unlimited history unsuitable for this adapter. A live MongoDB connection and real Stripe test checkout have not been verified in this environment.
