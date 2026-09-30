# Notifications and Brevo SMTP

Members receive an in-app inbox for account creation, confirmed memberships, completed payments, booking confirmations, cancellations, and membership expiry reminders. They can mark messages as read and independently disable booking or expiry emails from My profile. Account creation, membership confirmations, and payment receipts remain transactional emails. Owners and receptionists see activity; owners can check expiry reminders and retry failed emails.

## Configure Brevo

Create a verified sender in Brevo. In SMTP & API settings, obtain the SMTP login and generate an **SMTP key**, not an API key. Set these locally in `.env`:

```dotenv
EMAIL_ENABLED=true
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-login
SMTP_PASS=your-brevo-smtp-key
EMAIL_FROM=verified-sender@example.com
APP_URL=https://your-gym.example
DEMO_MODE=false
```

Restart the server, then run `npm run email:check` to verify connection and authentication without sending a message. This does not verify recipient delivery. Never commit credentials. Port 587 uses required STARTTLS; 465 uses TLS from connection start. Demo mode never sends email.

Official setup: [Brevo SMTP](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).

## Scheduling and delivery

The running API checks reminders and its durable email outbox every minute. Deploy an always-on API process; reminders do not run while it is stopped. Reminders are created at seven and one calendar days before expiry in the gym timezone. After downtime, only the most relevant threshold is created. An overlapping renewal of the same plan suppresses the old expiry reminder. In-app reminders remain visible if a member subsequently renews.

Email attempts recheck membership/booking validity and member preferences. Temporary SMTP failures retry with exponential delays, up to five attempts. Claims expire after five minutes so another worker can recover after a crash. Delivery is at least once: a crash after SMTP acceptance but before saving can produce a duplicate despite a stable Message-ID. “Accepted by Brevo” is SMTP acceptance, not proof of inbox delivery; use Brevo logs for bounces and delivery status.

When email is disabled or unconfigured, in-app messages still work and emails are marked unavailable. Enabling email does not automatically send that backlog; owners may retry messages that are still relevant. Booking emails expire after 24 hours. Terminal notifications are retained up to 90 days and 100 per member; pending email jobs are retained until resolved. Staff activity shows the latest 200 records.

Notifications share the existing gym aggregate and its documented size limits. Larger deployments need a separate indexed outbox/notification collection before growing beyond this app’s evaluation scale.

Account notifications are created for self-registration and staff-created member records. A staff-created record does not grant portal login credentials. Payment and membership notifications are created together only after confirmed cash payment or verified Stripe success, including future renewals. Repeated confirmation does not create duplicate messages. Emails link to the relevant profile, payments, memberships, or schedule page.
