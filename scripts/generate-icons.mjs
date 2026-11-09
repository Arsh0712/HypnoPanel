/**
 * HipnoType brand asset generator (spec §2 — favicon & branding).
 *
 * Regenerates every raster icon + the OG image + webmanifest from the
 * brand spiral (amber → orange → red). Run:  bun scripts/generate-icons.mjs
 *
 * Outputs (public/):
 *   favicon.svg            theme-adaptive (copied from logo.svg)
 *   favicon.ico            16 + 32 + 48 (PNG-in-ICO, modern format)
 *   favicon-16x16.png  favicon-32x32.png
 *   apple-touch-icon.png   180×180
 *   icon-192.png  icon-512.png  icon-maskable-512.png
 *   og.png                 1200×630 social card
 *   site.webmanifest
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";

const PUB = path.resolve(import.meta.dirname, "../public");

const AMBER = "#ffb020";
const ORANGE = "#ff6a3d";
const RED = "#e63c5c";
const TILE = "#1d1116"; // warm charcoal tile (matches panel dark surface)
const TILE_LIGHT = "#f6f1ea";

const grad = (id) => `
  <defs>
    <linearGradient id="${id}" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${AMBER}"/>
      <stop offset="0.52" stop-color="${ORANGE}"/>
      <stop offset="1" stop-color="${RED}"/>
    </linearGradient>
  </defs>`;

const spiral = (id) => `
  <path d="M32 9.5a22.5 22.5 0 1 1-15.9 6.6" stroke="url(#${id})" stroke-width="5.4" stroke-linecap="round"/>
  <path d="M32 18.5a13.5 13.5 0 1 0 9.5 4" stroke="url(#${id})" stroke-width="5.4" stroke-linecap="round" opacity="0.92"/>
  <circle cx="32" cy="32" r="4.2" fill="url(#${id})"/>`;

/** Dark tile + gradient mark (brand-forward, used for raster favicons/PWA). */
const iconSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none">
  ${grad("g")}
  <rect width="64" height="64" rx="15" fill="${TILE}"/>
  ${spiral("g")}
</svg>`;

/** Maskable: mark shrunk into the 80% safe zone on a full-bleed tile. */
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  ${grad("g")}
  <rect width="512" height="512" fill="${TILE}"/>
  <g transform="translate(256,256) scale(4.6) translate(-32,-32)">${spiral("g")}</g>
</svg>`;

/** Apple touch: light tile variant (iOS springboard is usually light). */
const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none">
  ${grad("g")}
  <rect width="180" height="180" fill="${TILE}"/>
  <g transform="translate(90,90) scale(1.72) translate(-32,-32)">${spiral("g")}</g>
</svg>`;

/** Social card 1200×630. */
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" fill="none">
  ${grad("g")}
  <rect width="1200" height="630" fill="#160e12"/>
  <rect width="1200" height="630" fill="url(#g)" opacity="0.06"/>
  <circle cx="1050" cy="-40" r="380" fill="url(#g)" opacity="0.10"/>
  <circle cx="120" cy="680" r="320" fill="url(#g)" opacity="0.07"/>
  <g transform="translate(96,175) scale(4.4)">
    <rect width="64" height="64" rx="15" fill="#22141a"/>
    ${spiral("g")}
  </g>
  <text x="440" y="288" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="76" font-weight="700" fill="#fbf3ea">HipnoType Panel</text>
  <text x="442" y="346" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="30" fill="#c9a8a0">Websites · Apps · Bots · DNS · Files · Terminal</text>
  <text x="442" y="392" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="30" fill="#c9a8a0">One dark, beautiful panel for your VPS.</text>
  <g transform="translate(442,436)">
    <rect width="640" height="58" rx="12" fill="#241820" stroke="#4d2e2a"/>
    <text x="24" y="38" font-family="DejaVu Sans Mono, monospace" font-size="24" fill="${ORANGE}">curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash</text>
  </g>
</svg>`;

/** Minimal ICO container wrapping PNG frames (valid ICO since Vista). */
function icoFromPngs(frames) {
  const count = frames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const bufs = [header, entries];
  frames.forEach(({ size, png }, i) => {
    const e = 16 * i;
    entries.writeUInt8(size >= 256 ? 0 : size, e + 0); // width
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    entries.writeUInt8(0, e + 2); // palette
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // planes
    entries.writeUInt16LE(32, e + 6); // bpp
    entries.writeUInt32LE(png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    bufs.push(png);
    offset += png.length;
  });
  return Buffer.concat(bufs);
}

async function pngFromSvg(svg, size, out) {
  const buf = await sharp(Buffer.from(svg)).resize(size, size, { fit: "contain" }).png().toBuffer();
  fs.writeFileSync(path.join(PUB, out), buf);
  return buf;
}

async function main() {
  fs.mkdirSync(PUB, { recursive: true });

  // favicon.svg — theme-adaptive variant (same as logo.svg)
  fs.copyFileSync(path.join(PUB, "logo.svg"), path.join(PUB, "favicon.svg"));

  const p16 = await pngFromSvg(iconSvg(64), 16, "favicon-16x16.png");
  const p32 = await pngFromSvg(iconSvg(64), 32, "favicon-32x32.png");
  const p48 = await sharp(Buffer.from(iconSvg(64))).resize(48, 48).png().toBuffer();
  fs.writeFileSync(path.join(PUB, "favicon.ico"), icoFromPngs([
    { size: 16, png: p16 },
    { size: 32, png: p32 },
    { size: 48, png: p48 },
  ]));

  await pngFromSvg(appleSvg, 180, "apple-touch-icon.png");
  await pngFromSvg(iconSvg(192), 192, "icon-192.png");
  await pngFromSvg(iconSvg(512), 512, "icon-512.png");
  await pngFromSvg(maskableSvg, 512, "icon-maskable-512.png");

  // OG image — verify text actually rasterised (fonts present) else fallback
  const og = await sharp(Buffer.from(ogSvg)).png().toBuffer();
  const { width, height } = await sharp(og).metadata();
  fs.writeFileSync(path.join(PUB, "og.png"), og);
  console.log(`og.png ${width}x${height}`);

  // PWA manifest
  fs.writeFileSync(
    path.join(PUB, "site.webmanifest"),
    JSON.stringify(
      {
        name: "HipnoType Panel",
        short_name: "HipnoType",
        description: "The all-in-one panel for your single VPS — websites, apps, bots, DNS, files, terminal.",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        theme_color: "#1d1116",
        background_color: "#160e12",
        display: "standalone",
        start_url: "/",
      },
      null,
      2
    ) + "\n"
  );

  console.log("✔ brand assets generated in public/");
}

main().catch((e) => {
  console.error("icon generation failed:", e);
  process.exit(1);
});
