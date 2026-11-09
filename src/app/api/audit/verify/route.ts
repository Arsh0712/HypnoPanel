import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { verifyAuditChain } from "@/lib/audit";
import { handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** GET /api/audit/verify — SHA-256 hash-chain integrity check over every entry. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "audit:read" });
  const result = await verifyAuditChain();
  return NextResponse.json(result);
});
