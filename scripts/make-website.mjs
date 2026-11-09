/**
 * Assemble the standalone Vercel website app (spec §13.3–13.5) from the
 * single-source-of-truth files in the panel workspace.
 *
 *   bun scripts/make-website.mjs [--out build/website]
 *
 * What it does:
 *  - copies the (site) route group, site components, docs/changelog content,
 *    globals.css, sitemap, 404 and the cn() util into a clean Next.js app
 *  - generates the app root layout (fonts + metadata), package.json,
 *    next.config.ts (relay rewrite), vercel.json, .env.example, README
 *  - copies installer/install.sh → public/install.sh (+ .sha256)
 *  - copies the brand icon set + robots.txt
 *
 * The output builds standalone:  cd build/website && bun install && bun run build
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(ROOT, process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "build/website");

// ---------------------------------------------------------------- helpers
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function cpFile(src, dest) { mkdirp(path.dirname(dest)); fs.copyFileSync(src, dest); }
function cpDir(srcDir, destDir, filter) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (filter && !filter(entry.name, src)) continue;
    if (entry.isDirectory()) cpDir(src, dest, filter);
    else cpFile(src, dest);
  }
}
function write(rel, content) {
  const p = path.join(OUT, rel);
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, content);
}

const V = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const dep = (name, fallback) => (V.dependencies?.[name] ? `^${V.dependencies[name].replace(/^[^]/, "")}` : fallback);

// ---------------------------------------------------------------- start
rm(OUT);
mkdirp(OUT);
console.log(`[make-website] assembling → ${path.relative(ROOT, OUT)}`);

// 1 · site pages (route group preserved) + components + content + shared bits
cpDir(path.join(ROOT, "src/app/(site)"), path.join(OUT, "src/app/(site)"));
cpDir(path.join(ROOT, "src/components/site"), path.join(OUT, "src/components/site"));
cpDir(path.join(ROOT, "src/content/site"), path.join(OUT, "src/content/site"));
cpFile(path.join(ROOT, "src/lib/utils.ts"), path.join(OUT, "src/lib/utils.ts"));
cpFile(path.join(ROOT, "src/app/globals.css"), path.join(OUT, "src/app/globals.css"));
cpFile(path.join(ROOT, "src/app/sitemap.ts"), path.join(OUT, "src/app/sitemap.ts"));
cpFile(path.join(ROOT, "src/app/not-found.tsx"), path.join(OUT, "src/app/not-found.tsx"));

// 2 · generated root layout (html + fonts + metadata — the site group layout adds chrome)
write(
  "src/app/layout.tsx",
  `import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://hypnotype.mangocloud.cyou"),
  title: {
    default: "HipnoType Panel",
    template: "%s · HipnoType Panel",
  },
  description:
    "The all-in-one panel for your single VPS — websites, apps, bots, DNS, files and a real terminal, behind one rotating secret URL.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "HipnoType Panel",
    description: "One VPS. Everything under control — in one dark, beautiful panel.",
    siteName: "HipnoType Panel",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1b1316" },
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={\`\${geistSans.variable} \${geistMono.variable} \${instrumentSerif.variable} antialiased\`}>
        {children}
      </body>
    </html>
  );
}
`
);

// 3 · configs
const next = V.dependencies.next.replace(/[^0-9.]/g, "");
const pkg = {
  name: "hypnotype-website",
  version: V.version,
  private: true,
  scripts: {
    dev: "next dev -p 3210",
    build: "next build",
    start: "next start",
  },
  dependencies: {
    next: V.dependencies.next,
    react: V.dependencies.react,
    "react-dom": V.dependencies["react-dom"],
    "next-themes": V.dependencies["next-themes"],
    "lucide-react": V.dependencies["lucide-react"],
    clsx: V.dependencies.clsx,
    "tailwind-merge": V.dependencies["tailwind-merge"],
  },
  devDependencies: {
    typescript: V.devDependencies.typescript,
    "@types/react": V.devDependencies["@types/react"],
    "@types/react-dom": V.devDependencies["@types/react-dom"],
    tailwindcss: V.devDependencies.tailwindcss,
    "@tailwindcss/postcss": V.devDependencies["@tailwindcss/postcss"],
    "tw-animate-css": V.devDependencies["tw-animate-css"],
  },
};
write("package.json", JSON.stringify(pkg, null, 2) + "\n");

cpFile(path.join(ROOT, "tsconfig.json"), path.join(OUT, "tsconfig.json"));
cpFile(path.join(ROOT, "postcss.config.mjs"), path.join(OUT, "postcss.config.mjs"));
cpFile(path.join(ROOT, "eslint.config.mjs"), path.join(OUT, "eslint.config.mjs"));

write(
  "next.config.ts",
  `import { dirname } from "path";
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
          destination: \`\${RELAY_ORIGIN}/server/panel/:path*\`,
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
`
);

write(
  "vercel.json",
  JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      // Framework, build command and output are auto-detected for Next.js.
      // Security headers + /install.sh content-type live in next.config.ts
      // (headers()) so local `next start` behaves identically to Vercel.
      cleanUrls: false,
    },
    null,
    2
  ) + "\n"
);

write(
  ".env.example",
  `# ──────────────────────────────────────────────────────────────────────
# HipnoType website — environment variables (Vercel → Settings →
# Environment Variables). Add these BEFORE the first deploy (or redeploy
# after changing them) — NEXT_PUBLIC_* and the rewrite target are baked
# at BUILD time.
# ──────────────────────────────────────────────────────────────────────

# Canonical public URL of the site (metadata, Open Graph, sitemap).
NEXT_PUBLIC_SITE_URL=https://hypnotype.mangocloud.cyou

# Origin of the HipnoType relay. The /server/panel/* rewrite targets this
# origin. Must be the relay VPS hostname — NOT the Vercel domain.
RELAY_ORIGIN=https://relay.hypnotype.mangocloud.cyou

# GitHub repository (header/footer links + "Edit on GitHub" in the docs).
NEXT_PUBLIC_GITHUB_REPO=https://github.com/Arsh0712/HypnoPanel

# Internal — direct-download Release Center section. Leave UNSET (or 0) for
# the public site; the evergreen "Get the code" section renders regardless.
# NEXT_PUBLIC_RELEASE_CENTER=0

# Optional — override for preview deployments (rarely needed).
# NEXT_PUBLIC_RELAY_WS_BASE=wss://relay.hypnotype.mangocloud.cyou
`
);

write(
  ".gitignore",
  `node_modules/
.next/
out/
.vercel/
.env*.local
*.tsbuildinfo
next-env.d.ts
`
);

write(
  "README.md",
  `# HipnoType website (deploy on Vercel)

This folder is **generated** from the panel workspace — do not edit by hand.

    bun scripts/make-website.mjs        # regenerate (from the repo root)

It is a standalone Next.js app: marketing site + docs + \`/install.sh\` + the
\`/server/panel/*\` rewrite to the HipnoType relay.

## Deploy on Vercel

1. Push the repository to GitHub (\`Arsh0712/HypnoPanel\`).
2. In Vercel: **Add New → Project → Import** the repo. Set the **Root
   Directory** to \`website\` (Vercel detects Next.js automatically).
3. Before the first build, add the environment variables from
   \`.env.example\` (Project → Settings → Environment Variables):

   | Variable | Value | Notes |
   |---|---|---|
   | \`NEXT_PUBLIC_SITE_URL\` | \`https://hypnotype.mangocloud.cyou\` | canonical URL |
   | \`RELAY_ORIGIN\` | \`https://relay.hypnotype.mangocloud.cyou\` | rewrite target (baked at build) |
   | \`NEXT_PUBLIC_GITHUB_REPO\` | \`https://github.com/Arsh0712/HypnoPanel\` | links |

4. Attach the custom domain: **Settings → Domains → Add** →
   \`hypnotype.mangocloud.cyou\`. At your Cloudflare zone add the DNS record
   Vercel shows (CNAME to \`cname.vercel-dns.com\`), **proxy OFF** (grey
   cloud) — Vercel needs to issue its own certificate.
5. Deploy. Then verify (see the checklist below).

## Verification checklist

    # 1 · install.sh is served as plain text (never HTML!)
    curl -fsSL -D - https://hypnotype.mangocloud.cyou/install.sh | head -5
    #    → 200, content-type: text/plain; charset=utf-8

    # 2 · checksum matches the shipped one
    curl -fsSL https://hypnotype.mangocloud.cyou/install.sh -o install.sh
    curl -fsSL https://hypnotype.mangocloud.cyou/install.sh.sha256
    sha256sum -c install.sh.sha256

    # 3 · the rewrite proxies to the relay (byte-identical 404 for a bogus token)
    curl -s -o /dev/null -w "%{http_code}\\n" \\
      https://hypnotype.mangocloud.cyou/server/panel/doesnotexist000000000000000/

    # 4 · a real panel URL loads its unlock screen (after the panel is installed)

## The /downloads mirror

\`public/downloads/\` ships the installer asset the one-liner falls back to
when no GitHub release exists yet (keep it in sync after every release):

    bun scripts/make-release.sh        # from the panel repo root — rebuilds
                                       # panel-source.tar.gz + checksums and
                                       # refreshes public/downloads/ here

Files: \`panel-source.tar.gz\`, \`panel-source.tar.gz.sha256\`,
\`checksums.txt\` (and the versioned release tarballs when built from the
panel workspace).

## Local run

    cd website
    bun install
    bun run dev        # http://localhost:3210
`
);

// 4 · public assets
const PUBLIC_ASSETS = [
  "logo.svg", "favicon.svg", "favicon.ico",
  "favicon-16x16.png", "favicon-32x32.png",
  "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
  "og.png", "site.webmanifest", "robots.txt",
];
mkdirp(path.join(OUT, "public"));
for (const f of PUBLIC_ASSETS) {
  const src = path.join(ROOT, "public", f);
  if (fs.existsSync(src)) cpFile(src, path.join(OUT, "public", f));
  else console.warn(`[make-website] WARN: public/${f} missing (run scripts/generate-icons.mjs)`);
}

// 5 · installer → public/install.sh (+ sha256), single source of truth
const installer = fs.readFileSync(path.join(ROOT, "installer/install.sh"));
fs.writeFileSync(path.join(OUT, "public/install.sh"), installer);
fs.chmodSync(path.join(OUT, "public/install.sh"), 0o755);
const sha = crypto.createHash("sha256").update(installer).digest("hex");
fs.writeFileSync(path.join(OUT, "public/install.sh.sha256"), `${sha}  install.sh\n`);

// 6 · next-env.d.ts so \`bun run build\` works without a prior dev run
write(
  "next-env.d.ts",
  `/// <reference types="next" />
/// <reference types="next/image-types/global" />\n`
);

// ---------------------------------------------------------------- summary
const count = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
console.log(`[make-website] ✔ ${count(path.join(OUT, "src"))} source files, ${count(path.join(OUT, "public"))} public assets`);
console.log(`[make-website] ✔ install.sh (${installer.length} bytes, sha256 ${sha.slice(0, 16)}…)`);
console.log(`[make-website] next: cd ${path.relative(ROOT, OUT)} && bun install && bun run build`);
