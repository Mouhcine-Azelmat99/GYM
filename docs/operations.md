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


## QR check-in

Members select **Check in** on their overview to open **My QR code**. The modal shows the current server-synchronized time in the gym timezone and the number of recorded gym visits in the current calendar month. Class attendance is not included in this count. It refreshes attendance and the QR every 15 seconds while open. Members already checked in today see confirmation instead of another QR; members without current gym access see the eligibility message.

Owners and receptionists select **Attendance ? Scan QR code**. The camera opens automatically; allow the browser camera permission when prompted. A recognized code immediately validates access and records the visit. Camera access requires HTTPS in deployment (localhost also works) and the browser's permission. The camera stops on a scan, on closing the modal, or when the tab becomes hidden. Camera frames are decoded locally and are not uploaded to the server. The scanner has no image upload, pasted-code input, or manual submit button.

QR tokens are signed with a check-in-specific HMAC using `SESSION_SECRET`, expire after 90 seconds, and contain a member ID and timestamps, not contact details. The scan endpoint requires an owner/receptionist session and rechecks membership validity at scan time. Concurrent/repeated scans cannot create duplicate attendance on the same gym-local date. Scan events include the staff actor in the audit log. Keep manual check-in available for camera or connectivity problems. A short-lived QR is not proof of identity: reception should still confirm the person presenting it.

Members can open **Attendance** to view only their own gym visits, filter by month, and see their current-month total in the gym timezone. The page also links to **My QR code**. Staff retain the separate manual check-in action.


## Reset a password

Select **Forgot password?** on the sign-in page. Existing password-based member and staff accounts receive a Brevo reset email when delivery is enabled. The response is identical for unknown accounts and when delivery is unavailable. No reset tokens or links are exposed through workspace state or public responses. Demo mode does not send reset email.

Links expire after 30 minutes, work once, and use the configured `APP_URL` (set this to your public HTTPS URL for mobile/email access). A new request after the one-minute cooldown invalidates earlier links. Successful reset requires at least 10 characters, invalidates all existing sessions, and returns the user to sign-in rather than automatically authenticating them. Changing an account email also invalidates pending reset requests. Tokens use a separate HMAC purpose from invitations and are stored only as SHA-256 digests. The signing key is `SESSION_SECRET`; keep it stable and private.

Reset requests are rate-limited and enter the durable email queue. They are excluded from notification inboxes and notification activity. Only the successful password change appears in the audit log; password values and reset tokens never do. This does not add email verification.

The member overview shows monthly gym attendance in the gym timezone. Owner/reception overview **Check in** opens the camera scanner. On phones, the menu button opens a side drawer; selecting a page closes it.
