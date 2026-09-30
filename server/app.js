import {requestPasswordReset,finishPasswordReset} from './password-reset.js';
import {memberCheckIn,scanCheckIn} from './qr-checkin.js';
import {auditContext} from './audit.js';
import {issueInvitation,acceptInvitation} from './invitations.js';
import {report} from './reports.js';
import {updateProfile,normalizePhoto} from './profile.js';
import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { resolve } from "node:path";
import { allowedOrigins } from "./origins.js";
import { paymentConfiguration, createStripeClient, createPaymentService } from "./payments.js";
import { notificationsFor, notifyMemberCreated, defaultPreferences, createExpiryReminders, shouldEmail } from "./notifications.js";
import { emailConfiguration } from "./email.js";
import {
  id,
  fail,
  find,
  hash,
  verify,
  purchase,
  activate,
  book,
  cancelBooking,
  checkIn,
  statusOf,
} from "./domain.js";

const text = z.string().trim().min(1).max(120);
const memberSchema = z.object({
  name: text,
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase()),
  phone: z.string().max(40).default(""),
});
const planSchema = z
  .object({
    name: text,
    description: z.string().max(250),
    kind: z.enum(["time", "sessions", "combined"]),
    price: z.number().int().min(100).max(10000000),
    days: z.number().int().min(1).max(730),
    credits: z.number().int().min(0).max(1000),
    gymAccess: z.boolean(),
    classes: z.boolean(),
  })
  .refine(
    (p) => (p.gymAccess || p.classes) && (!p.classes || p.credits > 0),
    "Choose gym access or class credits.",
  );
const staffRoles = ["owner", "receptionist"];
export function createApp({ store, demo = true, sessionStore, stripeClient, paymentConfig, emailConfig: emailOverride } = {}) {
  const app = express();
  const invitationSecret=process.env.SESSION_SECRET || "local-demo-only-not-for-production";
  app.use((req,res,next)=>auditContext.run({actor:()=>req.user||{id:"public",name:req.path==="/api/webhooks/stripe"?"Stripe":"Public visitor",role:req.path==="/api/webhooks/stripe"?"system":"guest"}},next));
  const appUrl = process.env.APP_URL || "http://127.0.0.1:5173";
  const origins = allowedOrigins(appUrl);
  const emailConfig = emailOverride || emailConfiguration(process.env, demo);
  const paymentsConfig = paymentConfig || paymentConfiguration(process.env, demo);
  const stripe = stripeClient || (paymentsConfig.enabled ? createStripeClient() : null);
  const onlineEnabled = Boolean(stripe && paymentsConfig.enabled);
  const payments = onlineEnabled ? createPaymentService({ store, stripe, mode: paymentsConfig.mode }) : null;
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "upgrade-insecure-requests":
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      if (!payments || !process.env.STRIPE_WEBHOOK_SECRET)
        return res.status(503).json({ message: "Stripe is not configured." });
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          req.headers["stripe-signature"],
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch {
        return res.status(400).json({ message: "Invalid signature." });
      }
      await payments.webhook(event);
      res.json({ received: true });
    },
  );
  app.use("/api/profile/photo", express.json({ limit: "3mb" }));
  app.use(express.json({ limit: "32kb" }));
  app.use(
    session({
      name: "forma.sid",
      secret:
        process.env.SESSION_SECRET || "local-demo-only-not-for-production",
      resave: false,
      saveUninitialized: false,
      store:
        sessionStore ||
        (!demo
          ? MongoStore.create(store.client ? { client: store.client } : { mongoUrl: process.env.MONGODB_URI })
          : undefined),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 86400000,
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      !origins.has(req.headers.origin)
    )
      return res.status(403).json({ message: "Origin not allowed." });
    next();
  });
  app.get("/api/config", async (req, res) => {
    const s = await store.read();
    res.json({
      demo,
      onlineEnabled,
      payments: paymentsConfig,
      settings: s.settings,
      plans: s.plans,
    });
  });
  const authLimit = rateLimit({
    windowMs: 900000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const loginSession = (req, user) =>
    new Promise((resolve, reject) =>
      req.session.regenerate((e) => {
        if (e) return reject(e);
        req.session.userId = user.id;
        req.session.authVersion = user.sessionVersion || 0;
        req.session.save((e) => (e ? reject(e) : resolve()));
      }),
    );
  const resetLimit=rateLimit({windowMs:900000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
  app.post('/api/auth/forgot-password',resetLimit,async(req,res)=>{
    const {email}=z.object({email:z.string().trim().email().max(254).transform(v=>v.toLowerCase())}).parse(req.body);
    if(emailConfig.enabled)await store.mutate(s=>requestPasswordReset(s,email,invitationSecret));
    res.json({message:'If an account matches this email, a password reset link will be sent shortly.'});
  });
  app.post('/api/auth/reset-password',authLimit,async(req,res)=>{
    const {token,password}=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(10).max(128)}).parse(req.body);
    await store.mutate(s=>finishPasswordReset(s,token,password));
    await new Promise((resolve,reject)=>req.session.destroy(e=>e?reject(e):resolve()));
    res.clearCookie('forma.sid');res.json({ok:true});
  });
  app.post("/api/auth/demo", authLimit, async (req, res) => {
    if (!demo) fail("Demo login is disabled.", 404);
    const role = z
      .enum(["owner", "receptionist", "trainer", "member"])
      .parse(req.body.role);
    const s = await store.read();
    const user = s.users.find((u) => u.role === role);
    if (!user) fail("Demo account is unavailable.", 404);
    await loginSession(req, user);
    res.json({ ok: true });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const input = z
      .object({
        email: z.string().email(),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const s = await store.read();
    const user = s.users.find((u) => u.email === input.email.toLowerCase());
    if (!user || !verify(input.password, user.passwordHash))
      fail("Email or password is incorrect.", 401);
    await loginSession(req, user);
    res.json({ ok: true });
  });
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const input = memberSchema
      .extend({ password: z.string().min(10).max(128) })
      .parse(req.body);
    const passwordHash = hash(input.password);
    const user = await store.mutate((s) => {
      if (
        s.users.some((u) => u.email === input.email) ||
        s.members.some((m) => m.email === input.email)
      )
        fail("An account with this email already exists.");
      const member = {
        id: id(),
        name: input.name,
        email: input.email,
        phone: input.phone,
        joinedAt: new Date().toISOString(),
      };
      s.members.push(member);
      const user = {
        id: id(),
        memberId: member.id,
        name: member.name,
        email: member.email,
        passwordHash,
        role: "member",
      };
      s.users.push(user);
      notifyMemberCreated(s, member);
      return user;
    });
    await loginSession(req, user);
    res.status(201).json({ ok: true });
  });
  app.post('/api/auth/invitation', authLimit, async (req,res)=>{
    const input=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(10).max(128)}).parse(req.body);
    const user=await store.mutate(s=>acceptInvitation(s,input.token,input.password));
    await loginSession(req,user);res.json({ok:true});
  });
  app.post("/api/auth/logout", (req, res) =>
    req.session.destroy(() => {
      res.clearCookie("forma.sid");
      res.json({ ok: true });
    }),
  );
  app.use("/api", async (req, res, next) => {
    const s = await store.read();
    req.user = s.users.find((u) => u.id === req.session.userId);
    if (!req.user || (req.session.authVersion||0)!==(req.user.sessionVersion||0)) fail("Please sign in to continue.", 401);
    next();
  });
  const roles =
    (...allowed) =>
    (req, res, next) => {
      if (!allowed.includes(req.user.role))
        fail("You do not have access to this action.", 403);
      next();
    };
  app.get('/api/attendance/qr',roles('member'),async(req,res)=>{
    res.set('Cache-Control','no-store');res.json(memberCheckIn(await store.read(),req.user.memberId,invitationSecret));
  });
  app.post('/api/attendance/scan',roles(...staffRoles),async(req,res)=>{
    const {token}=z.object({token:z.string().min(1).max(1024)}).parse(req.body);
    res.json(await store.mutate(s=>scanCheckIn(s,token,invitationSecret,req.user.id)));
  });
  app.get('/api/reports',roles('owner'),async(req,res)=>res.json(report(await store.read(),String(req.query.from||''),String(req.query.to||''))));
  app.get('/api/audit',roles('owner'),async(req,res)=>{
    const {page,search}=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),search:z.string().max(120).default('')}).parse(req.query);
    const rows=[...((await store.read()).auditLogs||[])].reverse().filter(row=>[row.actorName,row.entity,row.action,row.recordId,...row.fields].join(' ').toLowerCase().includes(search.toLowerCase()));
    res.json({rows:rows.slice((page-1)*50,page*50),total:rows.length,page});
  });
  app.post('/api/members/:id/invitation',roles(...staffRoles),authLimit,async(req,res)=>{
    if(!demo&&!emailConfig.enabled)fail(emailConfig.reason,503);
    const result=await store.mutate(s=>issueInvitation(s,req.params.id,invitationSecret));
    res.json({expiresAt:result.expiresAt,...(demo?{demoUrl:appUrl.split('#')[0]+'#invite='+result.token}:{})});
  });
  app.post('/api/members/:id/invitation/revoke',roles(...staffRoles),async(req,res)=>{
    await store.mutate(s=>{find(s.members,req.params.id);const invitation=(s.invitations||[]).find(i=>i.memberId===req.params.id&&i.status==='pending');if(!invitation)fail('No pending invitation.');invitation.status='revoked';});res.json({ok:true});
  });
  app.patch('/api/profile', roles('member'), authLimit, async (req,res)=>{
    res.json(await store.mutate(s=>updateProfile(s,req.user.id,req.body)));
  });
  app.put('/api/profile/photo', roles('member'), async (req,res)=>{
    const photo=await normalizePhoto(req.body.photo);
    await store.mutate(s=>{find(s.members,req.user.memberId).photo=photo;});
    res.json({ok:true});
  });
  app.get("/api/state", async (req, res) => {
    const s = await store.read();
    delete s._id;
    delete s.__v;
    const invitationRows=s.invitations||[];
    delete s.invitations;delete s.auditLogs;delete s.passwordResets;
    if(staffRoles.includes(req.user.role))s.members=s.members.map(m=>{
      const invitation=invitationRows.find(i=>i.memberId===m.id);
      const notification=(s.notifications||[]).find(n=>n.type==='member-invitation'&&n.referenceId===invitation?.id);
      return {...m,portalStatus:s.users.some(u=>u.memberId===m.id)?'active':invitation?.status==='pending'?(new Date(invitation.expiresAt)>new Date()?'invited':'expired'):invitation?.status==='revoked'?'revoked':'not invited',invitationExpiresAt:invitation?.expiresAt,invitationEmailStatus:notification?.email.status};
    });
    const user = { ...req.user };
    delete user.passwordHash;
    s.notifications = notificationsFor(s, user);
    s.notificationPreferences = { ...defaultPreferences, ...s.members.find(m => m.id === user.memberId)?.notificationPreferences };
    s.notificationEmail = { enabled: emailConfig.enabled, provider: emailConfig.provider, reason: emailConfig.reason };
    s.users = s.users
      .filter((u) => u.role !== "member")
      .map(({ passwordHash, ...u }) => u);
    if (user.role === "member") {
      s.members = s.members.filter((m) => m.id === user.memberId);
      for (const key of ["memberships", "payments", "bookings", "attendance"])
        s[key] = s[key].filter((r) => r.memberId === user.memberId);
      s.users = s.users
        .filter((u) => u.role === "trainer")
        .map(({ id, name, role }) => ({ id, name, role }));
    }
    if (user.role === "trainer") {
      const classIds = s.schedule
        .filter((c) => c.trainerId === user.id)
        .map((c) => c.id);
      s.schedule = s.schedule.filter((c) => classIds.includes(c.id));
      s.bookings = s.bookings.filter((b) => classIds.includes(b.classId));
      s.members = s.members
        .filter((m) => s.bookings.some((b) => b.memberId === m.id))
        .map(({ id, name }) => ({ id, name }));
      s.payments = [];
      s.memberships = [];
      s.attendance = [];
      s.users = s.users.filter((u) => u.id === user.id);
    }
    const all = await store.read();
    s.schedule = s.schedule.map((c) => ({
      ...c,
      booked: all.bookings.filter(
        (b) => b.classId === c.id && b.status !== "cancelled",
      ).length,
    }));
    s.memberships = s.memberships.map((m) => ({ ...m, status: statusOf(m) }));
    // Internal checkout parameters and provider identifiers stay server-side.
    s.payments = s.payments.map(({ checkout, sessionId, paymentIntentId, ...p }) => p);
    res.json({ ...s, user, demo, onlineEnabled, paymentMode: paymentsConfig.mode, paymentSetupReason: paymentsConfig.reason });
  });
  app.get('/api/notifications', roles(...staffRoles, 'member'), async (req, res) => {
    const s = await store.read();
    const notifications = notificationsFor(s, req.user);
    res.json({ notifications,
      preferences: { ...defaultPreferences, ...s.members.find(m => m.id === req.user.memberId)?.notificationPreferences },
      email: { enabled: emailConfig.enabled, provider: emailConfig.provider, reason: emailConfig.reason },
    });
  });
  app.post('/api/notifications/read-all', roles('member'), async (req, res) => {
    await store.mutate(s => { for (const n of s.notifications || []) if (n.memberId === req.user.memberId && !n.readAt) n.readAt = new Date().toISOString(); });
    res.json({ ok: true });
  });
  app.post('/api/notifications/:id/read', roles('member'), async (req, res) => {
    await store.mutate(s => {
      const n = (s.notifications || []).find(n => n.id === req.params.id && n.memberId === req.user.memberId);
      if (!n) fail('Notification not found.', 404);
      n.readAt ??= new Date().toISOString();
    });res.json({ ok: true });
  });
  app.patch('/api/notifications/preferences', roles('member'), async (req, res) => {
    const input = z.object({ bookingEmails: z.boolean(), expiryEmails: z.boolean() }).parse(req.body);
    await store.mutate(s => { find(s.members, req.user.memberId).notificationPreferences = input; });
    res.json(input);
  });
  app.post('/api/notifications/reminders', roles('owner'), async (req, res) => {
    const created = await store.mutate(s => createExpiryReminders(s));
    res.json({ created });
  });
  app.post('/api/notifications/:id/retry', roles('owner'), async (req, res) => {
    if (!emailConfig.enabled) fail(emailConfig.reason, 503);
    await store.mutate(s => {
      const n = find(s.notifications || [], req.params.id);
      if (!['failed', 'not-configured'].includes(n.email.status)) fail('This email cannot be retried.');
      if (!shouldEmail(s, n)) fail('This notification is no longer relevant or the member has opted out.');
      n.email = { status: 'queued', attempts: 0, nextAttemptAt: new Date().toISOString() };
    });res.json({ ok: true });
  });
  app.post("/api/members", roles(...staffRoles), async (req, res) => {
    const input = memberSchema.parse(req.body);
    const result = await store.mutate((s) => {
      if (s.members.some((m) => m.email === input.email))
        fail("A member with this email already exists.");
      const m = { ...input, id: id(), joinedAt: new Date().toISOString() };
      s.members.unshift(m);
      notifyMemberCreated(s, m, false);
      return m;
    });
    res.status(201).json(result);
  });
  app.post("/api/plans", roles("owner"), async (req, res) => {
    const input = planSchema.parse(req.body);
    res.status(201).json(
      await store.mutate((s) => {
        const p = { ...input, id: id() };
        s.plans.push(p);
        return p;
      }),
    );
  });
  app.post(
    "/api/purchases",
    roles(...staffRoles, "member"),
    async (req, res) => {
      const input = z
        .object({
          memberId: text,
          planId: text,
          method: z.enum(["cash", "online"]),
        })
        .parse(req.body);
      if (req.user.role === "member" && input.memberId !== req.user.memberId)
        fail("Access denied.", 403);
      if (input.method === "online" && !onlineEnabled)
        fail(
          demo
            ? "Online checkout is disabled in the demo. Choose cash to explore the purchase flow."
            : paymentsConfig.reason || "Online payments are not configured.",
          503,
        );
      res
        .status(201)
        .json(
          await store.mutate((s) =>
            purchase(s, input.memberId, input.planId, input.method),
          ),
        );
    },
  );
  app.post(
    "/api/payments/:id/confirm",
    roles(...staffRoles),
    async (req, res) => {
      res.json(
        await store.mutate((s) => {
          const p = find(s.payments, req.params.id);
          if (p.method !== "cash")
            fail("Online payments must be confirmed by the payment provider.");
          if(p.status==="paid")return p;
          p.confirmedBy = req.user.id;
          return activate(s, p.id);
        }),
      );
    },
  );
  app.post(
    "/api/payments/:id/checkout",
    roles(...staffRoles, "member"),
    async (req, res) => {
      if (!payments) fail(paymentsConfig.reason || "Online payments are not configured.", 503);
      const s = await store.read();
      const p = find(s.payments, req.params.id);
      if (req.user.role === "member" && p.memberId !== req.user.memberId)
        fail("Access denied.", 403);
      const returnOrigin = origins.has(req.headers.origin) ? req.headers.origin : new URL(appUrl).origin;
      res.json(await payments.checkout(p.id, returnOrigin));
    },
  );
  app.post('/api/payments/:id/reconcile', roles(...staffRoles, 'member'), async (req, res) => {
    if (!payments) fail(paymentsConfig.reason || 'Online payments are not configured.', 503);
    const p = find((await store.read()).payments, req.params.id);
    if (req.user.role === 'member' && p.memberId !== req.user.memberId) fail('Access denied.', 403);
    if (p.method !== 'online') fail('This purchase uses cash payment.');
    const result = await payments.reconcile(p.id);
    res.json({ id: p.id, status: result.status });
  });
  app.post("/api/schedule", roles(...staffRoles), async (req, res) => {
    const input = z
      .object({
        title: text,
        trainerId: text,
        startsAt: z.string().datetime(),
        duration: z.number().int().min(15).max(240),
        capacity: z.number().int().min(1).max(200),
        room: text,
        type: z.enum(["Group class", "Personal training"]),
      })
      .parse(req.body);
    if (new Date(input.startsAt) <= new Date()) fail("Choose a future date.");
    res.status(201).json(
      await store.mutate((s) => {
        if (find(s.users, input.trainerId).role !== "trainer")
          fail("Select a trainer.");
        const start = new Date(input.startsAt).getTime(),
          end = start + input.duration * 60000;
        if (
          s.schedule.some(
            (c) =>
              (c.trainerId === input.trainerId || c.room === input.room) &&
              new Date(c.startsAt).getTime() < end &&
              new Date(c.startsAt).getTime() + c.duration * 60000 > start,
          )
        )
          fail("This trainer or room is already booked at this time.");
        const c = {
          ...input,
          capacity: input.type === "Personal training" ? 1 : input.capacity,
          id: id(),
        };
        s.schedule.push(c);
        return c;
      }),
    );
  });
  app.post(
    "/api/bookings",
    roles(...staffRoles, "member"),
    async (req, res) => {
      const input = z.object({ memberId: text, classId: text }).parse(req.body);
      if (req.user.role === "member" && input.memberId !== req.user.memberId)
        fail("Access denied.", 403);
      res
        .status(201)
        .json(
          await store.mutate((s) => book(s, input.memberId, input.classId)),
        );
    },
  );
  app.post(
    "/api/bookings/:id/cancel",
    roles(...staffRoles, "member"),
    async (req, res) => {
      res.json(
        await store.mutate((s) => {
          const b = find(s.bookings, req.params.id);
          if (req.user.role === "member" && b.memberId !== req.user.memberId)
            fail("Access denied.", 403);
          return cancelBooking(s, b.id);
        }),
      );
    },
  );
  app.post(
    "/api/bookings/:id/attendance",
    roles(...staffRoles, "trainer"),
    async (req, res) => {
      const input = z
        .object({ status: z.enum(["attended", "no-show"]) })
        .parse(req.body);
      res.json(
        await store.mutate((s) => {
          const b = find(s.bookings, req.params.id);
          const c = find(s.schedule, b.classId);
          if (req.user.role === "trainer" && c.trainerId !== req.user.id)
            fail("Access denied.", 403);
          if (b.status !== "booked")
            fail("Attendance has already been recorded.");
          if (new Date(c.startsAt) > new Date())
            fail("Attendance can be marked after the session starts.");
          b.status = input.status;
          return b;
        }),
      );
    },
  );
  app.post("/api/attendance", roles(...staffRoles), async (req, res) => {
    const { memberId } = z.object({ memberId: text }).parse(req.body);
    res.status(201).json(await store.mutate((s) => checkIn(s, memberId)));
  });
  app.post("/api/team", roles("owner"), async (req, res) => {
    const input = memberSchema
      .extend({
        role: z.enum(["trainer", "receptionist"]),
        password: z.string().min(10).max(128),
      })
      .parse(req.body);
    const passwordHash = hash(input.password);
    res.status(201).json(
      await store.mutate((s) => {
        if (s.users.some((u) => u.email === input.email))
          fail("An account with this email already exists.");
        const { password, ...fields } = input;
        const u = { ...fields, id: id(), passwordHash };
        s.users.push(u);
        const { passwordHash: _, ...safe } = u;
        return safe;
      }),
    );
  });
  app.patch("/api/settings", roles("owner"), async (req, res) => {
    const input = z
      .object({
        name: text,
        email: z.string().email(),
        currency: z.enum(["USD", "EUR", "GBP", "MAD", "CAD", "AUD"]),
        timezone: text,
        cancellationHours: z.number().int().min(0).max(72),
      })
      .parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      fail("Choose a valid IANA timezone.");
    }
    res.json(
      await store.mutate((s) => {
        if (input.currency !== s.settings.currency && s.payments.length)
          fail("Currency cannot change after payments have been recorded.");
        s.settings = input;
        return input;
      }),
    );
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ message: "Endpoint not found." }),
  );
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({message:'The upload is too large. Choose a photo up to 2 MB.'});
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ message: err.issues.map((i) => i.message).join(" ") });
    if (err.type?.startsWith('Stripe')) {
      // Provider errors can contain request parameters or personal data.
      console.error('Stripe request failed', { type: err.type, code: err.code, requestId: err.requestId });
      return res.status(502).json({ message: 'The payment provider is unavailable. Your purchase is saved; please retry from Payments.' });
    }
    if (!err.status) console.error('Request failed', { name: err.name });
    res
      .status(err.status || 500)
      .json({
        message: err.status
          ? err.message
          : "Something went wrong. Please try again.",
      });
  });
  return app;
}
