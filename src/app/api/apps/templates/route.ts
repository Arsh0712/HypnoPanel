import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { APP_TEMPLATES } from "@/lib/app-templates";

export const runtime = "nodejs";

/** GET /api/apps/templates — the full app catalogue (spec §5.5). */
export const GET = handle(async (req: Request) => {
  await guard(req, { permission: "apps:read" });
  return NextResponse.json({ templates: APP_TEMPLATES });
});
