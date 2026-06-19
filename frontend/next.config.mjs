/** @type {import('next').NextConfig} */
const isDesktop = process.env.NEXT_DESKTOP === "1";

// Security headers for the standalone (Docker / LAN) build. The Tauri desktop
// build serves a static export and gets its CSP from tauri.conf.json instead;
// Next's headers() is a no-op under `output: "export"`, so it's only wired up
// here for the non-desktop target. connect-src allows the loopback backend the
// browser talks to (NEXT_PUBLIC_API_URL defaults to http://localhost:8000) plus
// its WebSocket. 'unsafe-inline' on script-src mirrors the Tauri CSP (Next's
// inline bootstrap needs it; nonces would be the follow-up hardening).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(self)" },
];

const nextConfig = {
  // Desktop (Tauri) builds need a fully static export that Tauri can serve from
  // the filesystem. Set NEXT_DESKTOP=1 (via the "build:desktop" script) to
  // switch output mode. Docker / standalone mode is the default.
  output: isDesktop ? "export" : "standalone",
  assetPrefix: isDesktop ? "." : undefined,
  ...(isDesktop
    ? {}
    : {
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }),
};

export default nextConfig;
