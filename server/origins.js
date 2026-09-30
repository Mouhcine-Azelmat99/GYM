const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function allowedOrigins(
  appUrl,
  production = process.env.NODE_ENV === "production",
  tunnelUrl = process.env.DEV_TUNNEL_URL,
) {
  const configured = new URL(appUrl);
  const origins = new Set([configured.origin]);
  if (!production && tunnelUrl) {
    const tunnel = new URL(tunnelUrl);
    if (tunnel.protocol !== 'https:') throw new Error('DEV_TUNNEL_URL must use HTTPS.');
    origins.add(tunnel.origin);
  }

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
