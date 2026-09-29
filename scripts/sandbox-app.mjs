import 'dotenv/config';
import session from 'express-session';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';

// Isolated, disposable test harness. It never reads or mutates gym records.
if (process.env.NODE_ENV === 'production' || !/^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY || '')) {
  throw new Error('Sandbox verification requires a test key and a non-production environment.');
}
if (!/^whsec_[A-Za-z0-9]{10,}$/.test(process.env.STRIPE_WEBHOOK_SECRET || '')) {
  throw new Error('Start the test webhook listener first.');
}
process.env.APP_URL = 'http://127.0.0.1:4100';
const store = await createStore({ memory: true });
await store.mutate(s => { s.settings.name = 'Forma Stripe sandbox QA'; });
const app = createApp({ store, demo: false, sessionStore: new session.MemoryStore() });
app.listen(4100, '127.0.0.1', () => console.log('Disposable Stripe QA app: http://127.0.0.1:4100 (in-memory records, test payments only)'));
