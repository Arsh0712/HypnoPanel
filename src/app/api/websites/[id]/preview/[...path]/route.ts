import { NextRequest } from "next/server";
import { handle } from "@/lib/api-error";
import { serveSitePreview } from "@/lib/site-config";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; path: string[] }> };

/**
 * GET /api/websites/[id]/preview/<path...> — live preview of any static file
 * inside the site's docRoot (real file serving, traversal-protected).
 * Public by design (panel-gated site content preview).
 */
export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  const { id, path } = await ctx.params;
  return serveSitePreview(id, Array.isArray(path) ? path : []);
});
