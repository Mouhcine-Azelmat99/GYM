import { randomUUID } from 'node:crypto';

export const defaultPreferences = { bookingEmails: true, expiryEmails: true };
const terminalEmailStates = new Set(['sent', 'failed', 'skipped', 'not-configured']);

export function addNotification(state, { key, memberId, type, title, body, target, referenceId, expiresAt }, now = new Date()) {
  state.notifications ??= [];
  const existing = state.notifications.find(n => n.key === key);
  if (existing) return existing;
  const notification = {
    id: randomUUID(), key, memberId, type, title, body, target, referenceId,
    expiresAt: expiresAt || null, createdAt: now.toISOString(), readAt: null,
    email: { status: 'queued', attempts: 0, nextAttemptAt: now.toISOString() },
  };
  state.notifications.push(notification);
  return notification;
}

export function notifyMemberCreated(state, member, portalAccount = true, now = new Date()) {
  return addNotification(state, {key: `account:${member.id}`, memberId: member.id,
    type: 'account-created', title: 'Welcome to ' + state.settings.name,
    body: portalAccount ? 'Your member account is ready. You can explore memberships and book eligible classes.' : 'Your member record has been created. Contact reception to arrange access to the member portal.',
    target: 'profile', referenceId: member.id}, now);
}

export function notifyPaymentConfirmed(state, payment, membership, now = new Date()) {
  const amount = new Intl.NumberFormat('en', {style:'currency', currency:payment.currency}).format(payment.amount / 100);
  addNotification(state, {key:`payment:${payment.id}:paid`, memberId:payment.memberId,
    type:'payment-completed', title:'Payment received', body:`We received ${amount} for ${payment.description} by ${payment.method === 'cash' ? 'cash' : 'online payment'}.`,
    target:'payments', referenceId:payment.id}, now);
  const date = value => new Intl.DateTimeFormat('en', {dateStyle:'long', timeZone:state.settings.timezone}).format(new Date(value));
  addNotification(state, {key:`membership:${membership.id}:confirmed`, memberId:membership.memberId,
    type:'membership-confirmed', title:'Your membership is confirmed', body:`${membership.planName} is confirmed, from ${date(membership.startsAt)} to ${date(membership.endsAt)}.`,
    target:'memberships', referenceId:membership.id}, now);
}

export function notifyBooking(state, booking, cancelled = false, now = new Date()) {
  const session = state.schedule.find(c => c.id === booking.classId);
  if (!session) return;
  const when = new Intl.DateTimeFormat('en', {
    dateStyle: 'full', timeStyle: 'short', timeZone: state.settings.timezone,
  }).format(new Date(session.startsAt));
  return addNotification(state, {
    key: `booking:${booking.id}:${cancelled ? 'cancelled' : 'confirmed'}`,
    memberId: booking.memberId,
    type: cancelled ? 'booking-cancelled' : 'booking-confirmed',
    title: cancelled ? 'Your booking was cancelled' : 'Your booking is confirmed',
    body: cancelled
      ? `${session.title} on ${when} (${state.settings.timezone}). ${booking.creditReturned ? 'Your session credit was returned.' : 'The cancellation deadline has passed, so your credit was used.'}`
      : `${session.title} on ${when} (${state.settings.timezone}), ${session.room}. Your place is reserved.`,
    target: 'schedule', referenceId: booking.id,
  }, now);
}

export function calendarDay(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).formatToParts(new Date(value));
  const number = type => Number(parts.find(p => p.type === type).value);
  return Date.UTC(number('year'), number('month') - 1, number('day')) / 86400000;
}

export function hasRenewal(state, membership) {
  return state.memberships.some(other => other.id !== membership.id && other.memberId === membership.memberId
    && other.planId === membership.planId && other.status === 'active'
    && new Date(other.startsAt) <= new Date(membership.endsAt)
    && new Date(other.endsAt) > new Date(membership.endsAt));
}

export function createExpiryReminders(state, now = new Date()) {
  let created = 0;
  for (const membership of state.memberships) {
    if (membership.status !== 'active' || !membership.endsAt || new Date(membership.endsAt) <= now
      || new Date(membership.startsAt) > now || hasRenewal(state, membership)) continue;
    const days = calendarDay(membership.endsAt, state.settings.timezone) - calendarDay(now, state.settings.timezone);
    if (days > 7 || days < 0) continue;
    // If the worker was offline, send only the most relevant current reminder.
    const threshold = days <= 1 ? 1 : 7;
    const key = `${membership.endsAt}:${threshold}`;
    if (membership.reminderCycle !== membership.endsAt) {
      membership.reminderCycle = membership.endsAt;
      membership.sentReminderThresholds = [];
    }
    if (membership.sentReminderThresholds?.includes(threshold)) continue;
    const when = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: state.settings.timezone }).format(new Date(membership.endsAt));
    addNotification(state, {
      key: `expiry:${membership.id}:${key}`, memberId: membership.memberId,
      type: 'membership-expiring', title: days === 0 ? 'Your membership expires today' : `Your membership expires in ${days} ${days === 1 ? 'day' : 'days'}`,
      body: `${membership.planName} expires on ${when}. Renew your membership to keep your access.`,
      target: 'memberships', referenceId: membership.id, expiresAt: membership.endsAt,
    }, now);
    membership.sentReminderThresholds ??= [];
    membership.sentReminderThresholds.push(threshold);
    created++;
  }
  return created;
}

export function shouldEmail(state, notification, now = new Date()) {
  const member = state.members.find(m => m.id === notification.memberId);
  if (!member?.email) return false;
  const preferences = { ...defaultPreferences, ...member.notificationPreferences };
  if(notification.type==='member-invitation')return (state.invitations||[]).some(i=>i.id===notification.referenceId&&i.memberId===member.id&&i.email===member.email&&i.status==='pending'&&new Date(i.expiresAt)>now)&&!state.users.some(u=>u.memberId===member.id||u.email===member.email);
  if (notification.type === 'account-created') return notification.referenceId === member.id;
  if (notification.type === 'payment-completed') return state.payments.some(p => p.id === notification.referenceId && p.memberId === member.id && p.status === 'paid');
  if (notification.type === 'membership-confirmed') return state.memberships.some(m => m.id === notification.referenceId && m.memberId === member.id && m.status === 'active');
  if (notification.type === 'membership-expiring') {
    const m = state.memberships.find(m => m.id === notification.referenceId);
    return preferences.expiryEmails && Boolean(m && m.status === 'active' && m.endsAt === notification.expiresAt
      && new Date(m.endsAt) > now && !hasRenewal(state, m));
  }
  if (!preferences.bookingEmails || now - new Date(notification.createdAt) > 86400000) return false;
  const booking = state.bookings.find(b => b.id === notification.referenceId);
  if (!booking) return false;
  if (notification.type === 'booking-cancelled') return booking.status === 'cancelled';
  const session = state.schedule.find(c => c.id === booking.classId);
  return booking.status === 'booked' && Boolean(session && new Date(session.startsAt) > now);
}

export function pruneNotifications(state, now = new Date()) {
  const counts = new Map();
  state.notifications = [...(state.notifications || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).filter(n => {
    const count = (counts.get(n.memberId) || 0) + 1;counts.set(n.memberId, count);
    // Never discard an email that is queued or leased by a worker.
    return !terminalEmailStates.has(n.email.status) || (count <= 100 && now - new Date(n.createdAt) < 90 * 86400000);
  });
}

export function notificationsFor(state, user) {
  const rows = (state.notifications || []).filter(n => user.role === 'owner' || user.role === 'receptionist' || (user.role === 'member' && n.memberId === user.memberId));
  return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 200).map(({ key, email, ...n }) => ({
    ...n, emailStatus: email.status,
    ...(user.role === 'owner' || user.role === 'receptionist' ? { emailAttempts: email.attempts, emailError: email.errorCode, recipientName: state.members.find(m => m.id === n.memberId)?.name } : {}),
  }));
}
