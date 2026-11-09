import { dirname } from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * HipnoType website — Vercel config.
 *
 * /server/panel/:path*  → relay (HTTP panel traffic; Vercel rewrites forward
 *                         the original query string; WebSockets do NOT pass
 *                         through Vercel rewrites, which is why the terminal
 *                         connects directly to the relay origin — see
 *                         docs/DEPLOYMENT_ARCHITECTURE.md).
 * Static pages and /install.sh always win (afterFiles).
 *
 * outputFileTracingRoot: this folder works both standalone (site tarball)
 * and as a sub-directory of the panel monorepo (which ships its own
 * lockfile at the repo root).
 */
const RELAY_ORIGIN = process.env.RELAY_ORIGIN || "https://relay.hypnotype.mangocloud.cyou";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  outputFileTracingRoot: here,
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: "/server/panel/:path*",
          destination: `${RELAY_ORIGIN}/server/panel/:path*`,
        },
      ],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/install.sh",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/install.sh.sha256",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' " + RELAY_ORIGIN.replace(/^http/, "ws") + " " + RELAY_ORIGIN + "; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
