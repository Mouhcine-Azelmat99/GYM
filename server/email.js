import nodemailer from "nodemailer";
import { z } from "zod";

export function emailConfiguration(env = process.env, demo = false) {
  const host = env.SMTP_HOST || "smtp-relay.brevo.com";
  const port = Number(env.SMTP_PORT || 587);
  const reason = demo
    ? "Email delivery is disabled in demo mode."
    : env.EMAIL_ENABLED !== "true"
      ? "Email delivery is not enabled."
      : host !== "smtp-relay.brevo.com"
        ? "Use the Brevo SMTP relay host."
        : ![587, 465, 2525].includes(port)
          ? "Use Brevo port 587, 465 or 2525."
          : !env.SMTP_USER || !env.SMTP_PASS
            ? "Brevo SMTP login and SMTP key are required."
            : !z.string().email().safeParse(env.EMAIL_FROM).success
              ? "A verified sender email is required."
              : null;
  return { enabled: !reason, provider: "Brevo SMTP", reason, host, port };
}

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

export function emailContent({ notification, member, settings, appUrl }) {
  const url = new URL(appUrl);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Invalid application URL");
  const targets = {schedule: "View your schedule", memberships: "View memberships", payments: "View payments", profile: "View your profile"};
  const target = Object.hasOwn(targets, notification.target) ? notification.target : "memberships";
  url.hash = target;
  const name = member.name.split(" ")[0];
  const label = targets[target];
  return {
    subject: notification.title,
    text: `${settings.name}\n\nHi ${name},\n\n${notification.body}\n\n${label}: ${url.href}\n\nManage your email preferences on your profile page.`,
    html: `<div style="font-family:Arial,sans-serif;background:#f8fafc;padding:32px;color:#18181b"><div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:32px"><p style="font-weight:700;letter-spacing:1px">${escape(settings.name)}</p><h1 style="font-size:23px;line-height:1.3">${escape(notification.title)}</h1><p>Hi ${escape(name)},</p><p style="line-height:1.7;color:#475569">${escape(notification.body)}</p><p style="margin:28px 0"><a style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;padding:12px 18px" href="${escape(url.href)}">${label}</a></p><p style="font-size:12px;color:#64748b">Manage your email preferences on your profile page.</p></div></div>`,
  };
}

export function createEmailSender(env = process.env, demo = false) {
  const config = emailConfiguration(env, demo);
  if (!config.enabled) return { config, send: null, verify: null };
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    // Keep a failed send shorter than the worker's five-minute delivery lease.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    config,
    verify: () => transport.verify(),
    async send({ notification, member, settings }) {
      const content = emailContent({
        notification,
        member,
        settings,
        appUrl: env.APP_URL || "http://127.0.0.1:5173",
      });
      const result = await transport.sendMail({
        from: { name: settings.name, address: env.EMAIL_FROM },
        to: { name: member.name, address: member.email },
        messageId: `<forma-${notification.id}@${env.EMAIL_FROM.split("@")[1]}>`,
        ...content,
      });
      if (!result.accepted?.length)
        throw Object.assign(new Error("Recipient rejected"), {
          code: "ERECIPIENT",
        });
      return result.messageId;
    },
  };
}
