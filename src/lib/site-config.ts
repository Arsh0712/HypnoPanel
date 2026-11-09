import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SITES_DIR } from "@/lib/constants";

/**
 * Site configuration + static preview serving for the Websites module.
 *
 * Everything the panel writes for a website is REAL on disk:
 *  - data/sites/<slug>/htdocs/index.html   — the site's actual content (editable via Files)
 *  - data/sites/<slug>/logs/               — access.log / error.log (populated by the web server)
 *  - data/sites/<slug>/ssl/                — cert.pem / key.pem when a certificate is attached
 *  - Website.config                         — generated vhost config in Caddyfile format
 *
 * On the VPS deployment the installer drops these vhosts into the real Caddy
 * server and reloads it; inside the panel sandbox the generated config is
 * served verbatim (Config tab) and the docRoot is served through the preview
 * API below.
 */

export type SiteType = "static" | "php" | "node" | "proxy";

export interface SiteRedirect {
  from: string;
  to: string;
}

export interface SiteSettings {
  redirects: SiteRedirect[];
  basicAuth: {
    enabled: boolean;
    user: string | null;
    /** AES-256-GCM encrypted password (never returned to the client). */
    passwordEnc?: string;
  };
  cacheHeaders: { enabled: boolean; maxAge: number };
  gzip: boolean;
  forceHttps: boolean;
  /** Generated PHP-FPM pool config (type=php only). */
  phpPool?: string;
}

export function defaultSettings(): SiteSettings {
  return {
    redirects: [],
    basicAuth: { enabled: false, user: null },
    cacheHeaders: { enabled: false, maxAge: 3600 },
    gzip: true,
    forceHttps: false,
  };
}

/** Parse + shallow-merge stored settings with defaults (defensive against junk rows). */
export function parseSettings(raw: string | null | undefined): SiteSettings {
  const base = defaultSettings();
  if (!raw) return base;
  try {
    const s = JSON.parse(raw) as Partial<SiteSettings>;
    return {
      redirects: Array.isArray(s.redirects)
        ? s.redirects
            .filter((r) => r && typeof r.from === "string" && typeof r.to === "string")
            .map((r) => ({ from: r.from, to: r.to }))
        : [],
      basicAuth: {
        enabled: !!(s.basicAuth && s.basicAuth.enabled),
        user: s.basicAuth && typeof s.basicAuth.user === "string" ? s.basicAuth.user : null,
        passwordEnc:
          s.basicAuth && typeof s.basicAuth.passwordEnc === "string" ? s.basicAuth.passwordEnc : undefined,
      },
      cacheHeaders: {
        enabled: !!(s.cacheHeaders && s.cacheHeaders.enabled),
        maxAge:
          s.cacheHeaders && Number.isFinite(s.cacheHeaders.maxAge)
            ? Math.min(Math.max(Math.round(s.cacheHeaders.maxAge), 0), 2_592_000)
            : 3600,
      },
      gzip: s.gzip !== false,
      forceHttps: !!s.forceHttps,
      phpPool: typeof s.phpPool === "string" ? s.phpPool : undefined,
    };
  } catch {
    return base;
  }
}

/** Settings shape sent to the browser (password replaced by a hasPassword flag). */
export interface SanitizedSettings extends Omit<SiteSettings, "basicAuth"> {
  basicAuth: { enabled: boolean; user: string | null; hasPassword: boolean };
}

/** Strip secrets before sending settings to the browser. */
export function sanitizeSettings(s: SiteSettings): SanitizedSettings {
  return {
    redirects: s.redirects,
    basicAuth: {
      enabled: s.basicAuth.enabled,
      user: s.basicAuth.user,
      hasPassword: !!s.basicAuth.passwordEnc,
    },
    cacheHeaders: s.cacheHeaders,
    gzip: s.gzip,
    forceHttps: s.forceHttps,
    phpPool: s.phpPool,
  };
}

/** Stable numeric hash (djb2) → used for deterministic per-site port allocation. */
function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic PHP-FPM port for a slug (9000–9799 range, unique per slug hash). */
export function phpFpmPort(slug: string): number {
  return 9000 + (stableHash(slug) % 800);
}

/** Deterministic app port for a node site (7000–7799 range). */
export function nodeAppPort(slug: string): number {
  return 7000 + (stableHash(slug) % 800);
}

export interface VhostInput {
  name: string;
  slug: string;
  domain: string;
  type: SiteType;
  upstreamUrl?: string | null;
  status: string;
  sslMode: string;
  settings: SiteSettings;
}

/**
 * Generate the per-site vhost config in Caddyfile format.
 *
 * NOTE on basic auth: Caddy requires bcrypt password hashes. The panel stores
 * the basic-auth user + the AES-256-GCM-encrypted password in the site
 * settings; on the VPS deployment the panel's proxy manager converts them with
 * `caddy hash-password` (equivalently `openssl passwd`/`htpasswd -B`) and
 * activates the real `basic_auth` block. Inside the sandbox we emit the config
 * template line with the username so operators can see exactly what will be
 * enforced.
 */
export function generateVhostConfig(site: VhostInput): string {
  const docRoot = path.join(SITES_DIR, site.slug, "htdocs");
  const lines: string[] = [];
  const sslActive = site.sslMode === "custom" || site.sslMode === "self";

  lines.push(`# Managed by HipnoType Panel — site: ${site.name}`);
  if (site.status === "disabled") {
    lines.push(`# status: disabled by panel operator`);
  }
  lines.push(`${site.domain} {`);
  lines.push(`    root * ${docRoot}`);
  if (site.settings.gzip) {
    lines.push(`    encode gzip`);
  }
  lines.push(`    @blocked path /.git/* /.env`);
  lines.push(`    respond @blocked 404`);

  for (const r of site.settings.redirects) {
    lines.push(`    redir ${r.from} ${r.to} 301`);
  }

  if (site.settings.basicAuth.enabled && site.settings.basicAuth.user) {
    lines.push(`    # basic_auth entries are applied by the panel's proxy manager on the VPS deployment`);
    lines.push(`    # basic_auth / { ${site.settings.basicAuth.user} <bcrypt-hash> }`);
  }

  if (site.settings.cacheHeaders.enabled) {
    lines.push(`    header Cache-Control "public, max-age=${site.settings.cacheHeaders.maxAge}"`);
  }

  if (site.type === "php") {
    lines.push(`    # PHP-FPM pool ${site.slug} listens on ${phpFpmPort(site.slug)} (pool config in site settings)`);
    lines.push(`    php_fastcgi 127.0.0.1:${phpFpmPort(site.slug)}`);
  } else if (site.type === "proxy") {
    lines.push(`    reverse_proxy ${site.upstreamUrl || "http://127.0.0.1:8080"}`);
  } else if (site.type === "node") {
    lines.push(`    # node app for ${site.slug} — managed entrypoint listens on ${nodeAppPort(site.slug)}`);
    lines.push(`    reverse_proxy 127.0.0.1:${nodeAppPort(site.slug)}`);
  }

  lines.push(`    header {`);
  lines.push(`        X-Content-Type-Options nosniff`);
  lines.push(`        X-Frame-Options SAMEORIGIN`);
  lines.push(`        -Server`);
  lines.push(`    }`);

  if (sslActive) {
    const certFile = path.join(SITES_DIR, site.slug, "ssl", "cert.pem");
    const keyFile = path.join(SITES_DIR, site.slug, "ssl", "key.pem");
    lines.push(`    tls ${certFile} ${keyFile}`);
  }

  if (site.status === "disabled") {
    lines.push(`    respond "Site disabled" 503`);
  }

  lines.push(`}`);
  lines.push(``);

  if (site.settings.forceHttps && sslActive) {
    lines.push(`# force-https: enabled — redirect all plain-HTTP traffic`);
    lines.push(`http://${site.domain} {`);
    lines.push(`    redir https://${site.domain}{uri} permanent`);
    lines.push(`}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * PHP-FPM pool config for a site (type=php). Generated when the site is
 * created / its PHP version changes and stored in site settings.
 *
 * NOTE: the pool file install (drop-in under the php<fpm> pool.d directory) and
 * the PHP-FPM installation itself (Ondrej/Sury/Remi repos) apply on the VPS
 * deployment — the installer ships these pool configs. Inside the panel the
 * config text is displayed in the site's Config tab.
 */
export function generatePhpFpmPoolConfig(slug: string, phpVersion: string): string {
  const user = `site-${slug}`;
  const port = phpFpmPort(slug);
  return [
    `; Managed by HipnoType Panel — PHP-FPM pool for ${slug}`,
    `; listen socket matches the vhost: php_fastcgi 127.0.0.1:${port}`,
    `[${user}]`,
    `user = ${user}`,
    `group = ${user}`,
    `listen = 127.0.0.1:${port}`,
    `pm = dynamic`,
    `pm.max_children = 16`,
    `pm.start_servers = 4`,
    `pm.min_spare_servers = 4`,
    `pm.max_spare_servers = 16`,
    `php_admin_value[error_log] = ${path.join(SITES_DIR, slug, "logs", "error.log")}`,
    `php_admin_flag[log_errors] = on`,
    `php_admin_value[upload_max_filesize] = 32M`,
    `php_admin_value[post_max_size] = 32M`,
    ``,
  ].join("\n");
}

/** Real scaffold index.html — this is the site's actual content (editable via Files). */
export function buildIndexHtml(siteName: string, domain: string): string {
  const created = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(siteName)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0c1512; color: #e7f2ec;
  }
  main { text-align: center; padding: 2rem; }
  h1 { font-size: 2.25rem; margin: 0 0 .5rem; letter-spacing: -.02em; }
  p { color: #9db8aa; margin: .35rem 0; }
  .badge {
    display: inline-block; margin-top: 1.25rem; padding: .45rem .9rem;
    border: 1px solid #1f4a37; border-radius: 999px; color: #62d2a2;
    font-size: .8rem; letter-spacing: .04em; text-transform: uppercase;
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(siteName)}</h1>
  <p>powered by HipnoType Panel</p>
  <p>${escapeHtml(domain)} · created ${created}</p>
  <span class="badge">It works!</span>
</main>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Client-facing website shape (no secrets — no passwordEnc, no cert PEM/key)
// ---------------------------------------------------------------------------

export interface WebsiteWithCert {
  id: string;
  name: string;
  slug: string;
  domain: string;
  type: string;
  docRoot: string;
  linuxUser: string;
  phpVersion: string | null;
  upstreamUrl: string | null;
  status: string;
  sslMode: string;
  certId: string | null;
  config: string | null;
  dnsStatus: string; // pending_dns | dns_verified | error
  dnsToken: string | null; // public TXT challenge value (not a secret — it is published in DNS)
  dnsCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  certificate: {
    id: string;
    name: string;
    type: string;
    subject: string | null;
    issuer: string | null;
    sans: string | null;
    validFrom: Date | null;
    validTo: Date | null;
    createdAt: Date;
  } | null;
}

export function toClientWebsite(w: {
  id: string;
  name: string;
  slug: string;
  domain: string;
  type: string;
  docRoot: string;
  linuxUser: string;
  phpVersion: string | null;
  upstreamUrl: string | null;
  status: string;
  sslMode: string;
  certId: string | null;
  config: string | null;
  settings: string | null;
  dnsStatus?: string;
  dnsToken?: string | null;
  dnsCheckedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  certificate: {
    id: string;
    name: string;
    type: string;
    subject: string | null;
    issuer: string | null;
    sans: string | null;
    validFrom: Date | null;
    validTo: Date | null;
    createdAt: Date;
    certPem: string;
    keyEnc: string;
  } | null;
}): WebsiteWithCert & { settings: ReturnType<typeof sanitizeSettings> } {
  const cert = w.certificate
    ? {
        id: w.certificate.id,
        name: w.certificate.name,
        type: w.certificate.type,
        subject: w.certificate.subject,
        issuer: w.certificate.issuer,
        sans: w.certificate.sans,
        validFrom: w.certificate.validFrom,
        validTo: w.certificate.validTo,
        createdAt: w.certificate.createdAt,
      }
    : null;
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    domain: w.domain,
    type: w.type,
    docRoot: w.docRoot,
    linuxUser: w.linuxUser,
    phpVersion: w.phpVersion,
    upstreamUrl: w.upstreamUrl,
    status: w.status,
    sslMode: w.sslMode,
    certId: w.certId,
    config: w.config,
    dnsStatus: w.dnsStatus || "pending_dns",
    dnsToken: w.dnsToken ?? null,
    dnsCheckedAt: w.dnsCheckedAt ?? null,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    certificate: cert,
    settings: sanitizeSettings(parseSettings(w.settings)),
  };
}

// ---------------------------------------------------------------------------
// Slug derivation (IDENT_RE-compliant, unique)
// ---------------------------------------------------------------------------

/** Normalize a display name into a valid slug (IDENT_RE: ^[a-z][a-z0-9-]{1,30}[a-z0-9]$). */
export function slugifyName(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (!s) s = "site";
  if (!/^[a-z]/.test(s)) s = `s${s}`;
  s = s.slice(0, 32);
  if (!/[a-z0-9]$/.test(s)) s = `${s.slice(0, 31)}x`;
  while (s.length < 3) s = `${s}x`;
  return s;
}

/** Normalize any candidate into an IDENT_RE-safe slug (3–32 chars). */
function ensureSlugShape(s: string): string {
  if (!/^[a-z]/.test(s)) s = `s${s}`;
  s = s.slice(0, 32);
  if (!/[a-z0-9]$/.test(s)) s = `${s.slice(0, 31)}x`;
  while (s.length < 3) s = `${s}x`;
  return s;
}

/** Derive a UNIQUE slug from a base (appends -2, -3, … while staying IDENT_RE-safe). */
export async function uniqueSlug(
  base: string,
  taken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const first = ensureSlugShape(base);
  if (!(await taken(first))) return first;
  for (let n = 2; n < 200; n++) {
    const candidate = ensureSlugShape(`${base}-${n}`);
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error("Could not derive a unique slug");
}

// ---------------------------------------------------------------------------
// Static preview serving (real file serving from the site docRoot)
// ---------------------------------------------------------------------------

const PREVIEW_MAX_BYTES = 50 * 1024 * 1024; // 50MB

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".map": "application/json; charset=utf-8",
};

function preview404(what: string): NextResponse {
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 — Not Found</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f8f7;color:#1a2c24">
<main style="text-align:center">
  <h1 style="font-size:3rem;margin:0">404</h1>
  <p>${escapeHtml(what)} was not found on this site.</p>
  <p style="color:#6b7f74;font-size:.85rem">HipnoType Panel · site preview</p>
</main>
</body></html>`;
  return new NextResponse(body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Serve a real static file from the site's docRoot with path-traversal
 * protection (resolve + startsWith AND realpath + startsWith) and the same
 * blocked paths the generated vhost enforces (/.git/*, /.env).
 *
 * This endpoint is intentionally PUBLIC (no guard): it only serves site
 * content from the docRoot and is the panel's live preview of the website —
 * the panel itself is what gates access to the deployment.
 */
export async function serveSitePreview(
  siteId: string,
  segments: string[]
): Promise<NextResponse> {
  const site = await db.website.findUnique({ where: { id: siteId } });
  if (!site) return preview404("This website");

  const parts = segments.filter((s) => s.length > 0 && s !== "." && s !== "..");
  if (parts.some((p) => p === ".git" || p === ".env" || p.startsWith(".git/") || p === ".env")) {
    return preview404("This path");
  }
  // blocked-path parity with the generated vhost
  const joined = parts.join("/");
  if (/(^|\/)\.git(\/|$)/.test(joined) || /(^|\/)\.env$/.test(joined)) {
    return preview404("This path");
  }

  const docRoot = site.docRoot;
  let target = path.resolve(docRoot, ...parts);
  if (target === path.resolve(docRoot) || parts.length === 0) {
    target = path.join(docRoot, "index.html");
  }

  // Path-traversal protection #1: lexical containment
  const rootResolved = path.resolve(docRoot);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    return preview404("This path");
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return preview404(parts.length ? `"/${joined}"` : "index.html");
  }
  if (stat.isDirectory()) {
    target = path.join(target, "index.html");
    try {
      stat = fs.statSync(target);
    } catch {
      return preview404(`"/${joined}" (no index.html)`);
    }
  }

  // Path-traversal protection #2: symlink escape (realpath containment)
  try {
    const realRoot = fs.realpathSync(rootResolved);
    const realTarget = fs.realpathSync(target);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      return preview404("This path");
    }
  } catch {
    return preview404("This file");
  }

  if (stat.size > PREVIEW_MAX_BYTES) {
    return NextResponse.json(
      { error: "File is larger than the 50MB preview limit", code: "too_large" },
      { status: 413 }
    );
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(target);
  } catch {
    return preview404("This file");
  }

  const type = CONTENT_TYPES[path.extname(target).toLowerCase()] || "application/octet-stream";
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": type,
      "content-length": String(buf.length),
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
