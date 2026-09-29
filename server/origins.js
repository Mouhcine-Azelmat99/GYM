const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function allowedOrigins(
  appUrl,
  production = process.env.NODE_ENV === "production",
) {
  const configured = new URL(appUrl);
  const origins = new Set([configured.origin]);

  // Local aliases share the configured protocol and port. Never trust arbitrary
  // Host/Origin headers or broaden a production deployment's allowlist.
  if (!production && loopbackHosts.has(configured.hostname)) {
    for (const hostname of loopbackHosts) {
      const alias = new URL(configured);
      alias.hostname = hostname;
      origins.add(alias.origin);
    }
  }
  return origins;
}
