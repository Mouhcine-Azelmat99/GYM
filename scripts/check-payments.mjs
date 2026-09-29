import 'dotenv/config';
import mongoose from 'mongoose';
import { createStripeClient, paymentConfiguration } from '../server/payments.js';

const config = paymentConfiguration(process.env, process.env.DEMO_MODE !== 'false');
console.log(JSON.stringify({ demoMode: process.env.DEMO_MODE !== 'false', paymentMode: config.mode, checkoutEnabled: config.enabled, setupReason: config.reason, sessionSecretReady: (process.env.SESSION_SECRET?.length || 0) >= 32 }));
// Read-only diagnostics. Do not print connection URIs, keys, response bodies,
// customer data, or provider error messages that could contain credentials.
await Promise.all([
  (async () => {
    if (!process.env.MONGODB_URI) return console.log('MongoDB: missing URI');
    try {
      // This is a one-shot diagnostic, not production connection tuning.
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
      await mongoose.connection.db.command({ ping: 1 });
      console.log('MongoDB: ping successful');
    } catch (e) { console.log('MongoDB: connection failed (' + e.name + ')'); process.exitCode = 1; }
    finally { await mongoose.disconnect(); }
  })(),
  (async () => {
    if (config.mode !== 'test') return console.log('Stripe: sandbox diagnostic skipped (test key required)');
    try {
      await createStripeClient().checkout.sessions.list({ limit: 1 });
      console.log('Stripe: test key accepted; Checkout read access verified');
    } catch (e) { console.log('Stripe: access failed (' + (e.type || e.name) + ')'); process.exitCode = 1; }
  })(),
]);
