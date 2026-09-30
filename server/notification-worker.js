import { randomUUID } from 'node:crypto';
import { createExpiryReminders, shouldEmail, pruneNotifications } from './notifications.js';

export function createNotificationWorker({ store, sender, clock = () => new Date() }) {
  let active;
  async function run() {
    let sent = 0;
    const created = await store.mutate(state => {
      const count = createExpiryReminders(state, clock());
      for (const n of state.notifications || []) {
        if (!['queued', 'retry', 'sending'].includes(n.email.status)) continue;
        if (n.email.status === 'sending' && new Date(n.email.leaseUntil) > clock()) continue;
        if (!shouldEmail(state, n, clock())) n.email.status = 'skipped';
        else if (!sender.config.enabled) n.email.status = 'not-configured';
      }
      pruneNotifications(state, clock());
      return count;
    });
    if (!sender.config.enabled) return { created, sent };
    for (let batch = 0; batch < 20; batch++) {
      const token = randomUUID();
      const claimed = await store.mutate(state => {
        const now = clock();
        const n = (state.notifications || []).find(n =>
          (['queued', 'retry'].includes(n.email.status) && new Date(n.email.nextAttemptAt) <= now)
          || (n.email.status === 'sending' && new Date(n.email.leaseUntil) <= now));
        if (!n) return null;
        if (!shouldEmail(state, n, now)) { n.email.status = 'skipped';return { skipped: true }; }
        if (n.email.attempts >= 5) { n.email.status = 'failed';return { skipped: true }; }
        n.email.status = 'sending';n.email.token = token;n.email.attempts++;
        n.email.leaseUntil = new Date(now.getTime() + 300000).toISOString();
        const recipient=n.type==='password-reset'?state.users.find(u=>u.id===n.accountUserId):state.members.find(m=>m.id===n.memberId);
        return { notification: structuredClone(n), member: {name:recipient.name,email:recipient.email}, settings: structuredClone(state.settings) };
      });
      if (!claimed) break;
      if (claimed.skipped) continue;
      let messageId, error;
      try { messageId = await sender.send(claimed); }
      catch (e) { error = e; }
      const saved = await store.mutate(state => {
        const n = state.notifications.find(n => n.id === claimed.notification.id);
        if (!n || n.email.token !== token) return;
        delete n.email.token;delete n.email.leaseUntil;
        if (!error) {
          n.email.status = 'sent';n.email.sentAt = clock().toISOString();n.email.messageId = messageId;
          delete n.email.errorCode;
        } else {
          // Never persist provider messages: they may contain recipient data.
          n.email.errorCode = ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ERECIPIENT', 'EENVELOPE', 'EMESSAGE'].includes(error.code) ? error.code : 'EMAIL_SEND_FAILED';
          const permanent = ['EAUTH', 'ERECIPIENT', 'EENVELOPE'].includes(error.code) || error.responseCode >= 500;
          n.email.status = permanent || n.email.attempts >= 5 ? 'failed' : 'retry';
          n.email.nextAttemptAt = new Date(clock().getTime() + Math.min(3600000, 60000 * 2 ** (n.email.attempts - 1))).toISOString();
        }
        return !error;
      });
      if (saved) sent++;
    }
    return { created, sent };
  }
  return { tick() { if (!active) active = run().finally(() => { active = null; });return active; } };
}

export function startNotificationWorker(options) {
  const worker = createNotificationWorker(options);
  const tick = () => worker.tick().catch(error => console.error('Notification worker failed', { name: error.name }));
  tick();
  const timer = setInterval(tick, 60000);timer.unref();
  return () => clearInterval(timer);
}
