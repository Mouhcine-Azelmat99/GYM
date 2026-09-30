# Invitations, reports, and audit history

## Invite an existing member

Owners and receptionists open **Invitations**, find a staff-created member, and select **Invite member**. The live app queues a Brevo message; it requires the existing SMTP configuration and a stable `SESSION_SECRET`. The worker normally processes it within one minute. The member follows the link and sets a password to access their existing records. Account creation does not create a second member or discard memberships.

Invitations expire after 48 hours and are single-use. Resending is allowed after one minute and invalidates the previous link. **Revoke** immediately blocks acceptance. A revoked link might still arrive if SMTP had already started, but it cannot create an account. Existing portal users cannot be invited again. Demo mode displays a test link to staff instead of sending mail.

Tokens are derived with HMAC from a random invitation ID and the session secret. Only their SHA-256 digest is stored; email rendering reconstructs the token. Never share `SESSION_SECRET`. Changing it prevents unsent invitations from producing valid links; resend affected invitations. Links use a URL fragment so the token is not sent in ordinary HTTP request URLs. Acceptance submits the token by POST, regenerates the login session, and removes the token from the current browser URL. The frontend/API never expose token hashes through workspace state.

## Read reports

**Reports** is owner-only. Select an inclusive date range of up to 367 days, ending today or earlier. Day boundaries follow the gym timezone, including daylight-saving transitions. Today's report ends at the current time.

- Revenue counts only paid payments, using `paidAt`, grouped by currency. Cash and online amounts are separate; different currencies are never summed. Figures are gross receipts before fees, not accounting profit.
- Monthly rows use the same selected date range, so first and last months may be partial. Months without receipts are omitted.
- Opening/closing active members are unique members with a paid membership valid at the respective instant. Class packs count; multiple memberships do not double-count a member.
- Retention is opening members still active at closing divided by opening members. New joiners are excluded from that cohort; an empty cohort displays no rate.
- Renewal eligibility counts unique members whose paid membership ends in the period. A renewal counts when another paid membership begins at or after that expiry within the period, across any plan. Future renewals count once they start.
- New members use `joinedAt`; gym visits use the attendance log. Historical refund/cancellation adjustments are not implemented.

## Review the audit log

**Audit log** is owner-only, searchable, and paginated in groups of 50. It records successful changes to members, user accounts, memberships, payments, bookings, attendance, plans, sessions, invitations, and settings. Each event includes the actor, timestamp, entity/record ID, action, and changed field names. It never stores field values, photo bytes, passwords, invitation tokens, or provider payloads. Public registration/acceptance is attributed to Public visitor, signed webhooks to Stripe, background work to System.

Audit entries are saved atomically with their corresponding changes. Failed writes and no-op updates create no entries. The newest 5,000 events are retained; tracking starts on installation. There is no edit/delete API for events, but this is an operational history rather than a tamper-proof or legally compliant archive. Existing single-document storage limits still apply. High-volume production deployments need a separate append-only collection and an explicit archival policy.
