import { NextRequest } from "next/server";
import { handle } from "@/lib/api-error";
import { serveSitePreview } from "@/lib/site-config";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/websites/[id]/preview — live preview of the site root (index.html).
 * Real static file serving from the docRoot, with path-traversal protection.
 * Public by design (panel-gated site content preview).
 */
export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  return serveSitePreview(id, []);
});
