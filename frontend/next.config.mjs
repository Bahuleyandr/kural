/** @type {import('next').NextConfig} */
const nextConfig = {
  // Desktop (Tauri) builds need a fully static export that Tauri can serve from
  // the filesystem. Set NEXT_DESKTOP=1 (via the "build:desktop" script) to
  // switch output mode. Docker / standalone mode is the default.
  output: process.env.NEXT_DESKTOP === "1" ? "export" : "standalone",
};

export default nextConfig;
