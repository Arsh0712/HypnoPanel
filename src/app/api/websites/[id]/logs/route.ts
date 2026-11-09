import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { SITES_DIR } from "@/lib/constants";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const MAX_LINES = 1000;
/** Read at most the last ~1MB of the file before tailing. */
const TAIL_BYTES = 1024 * 1024;

/**
 * GET /api/websites/[id]/logs?type=access|error&lines=200
 * Tails the site's log file. The web server writes access.log / error.log in
 * data/sites/<slug>/logs/ — until the site serves traffic the file may not
 * exist yet, in which case we return an empty array with a note.
 */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await guard(req, { permission: "websites:read" });
  const { id } = await ctx.params;
  const site = await db.website.findUnique({ where: { id } });
  if (!site) throw new ApiError(404, "not_found", "Website not found");

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "error" ? "error" : "access";
  const lines = Math.min(Math.max(parseInt(url.searchParams.get("lines") || "200", 10) || 200, 1), MAX_LINES);

  const logFile = path.join(SITES_DIR, site.slug, "logs", `${type}.log`);
  if (!fs.existsSync(logFile)) {
    return NextResponse.json({
      type,
      lines: [],
      note:
        type === "access"
          ? "No access log yet — the web server writes here once the site serves traffic."
          : "No error log yet — nothing has been logged for this site.",
    });
  }

  let content: string;
  const stat = fs.statSync(logFile);
  if (stat.size > TAIL_BYTES) {
    const fd = fs.openSync(logFile, "r");
    try {
      const buf = Buffer.alloc(TAIL_BYTES);
      fs.readSync(fd, buf, 0, TAIL_BYTES, stat.size - TAIL_BYTES);
      content = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    // drop the possibly-truncated first line
    const nl = content.indexOf("\n");
    if (nl >= 0) content = content.slice(nl + 1);
  } else {
    content = fs.readFileSync(logFile, "utf8");
  }

  const all = content.split("\n").filter((l) => l.length > 0);
  const truncated = all.length > lines;
  const tail = truncated ? all.slice(all.length - lines) : all;

  return NextResponse.json({ type, lines: tail, truncated, note: null });
});
