import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { generateApiToken, sha256Hex } from "@/lib/crypto";
import { PERMISSIONS } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

function tokenRow(t: {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    id: t.id,
    userId: t.userId,
    name: t.name,
    prefix: t.prefix,
    scopes: JSON.parse(t.scopes || "[]") as string[],
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    revokedAt: t.revokedAt,
  };
}

/**
 * GET /api/tokens — all users' tokens (users:read), or ?mine=1 for the
 * caller's own tokens (any authenticated user).
 */
export const GET = handle(async (req: NextRequest) => {
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const ctx = await guard(req, mine ? {} : { permission: "users:read" });
  const rows = await db.apiToken.findMany({
    where: mine ? { userId: ctx.userId } : undefined,
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    mine,
    tokens: rows.map((t) => ({ ...tokenRow(t), email: t.user.email })),
  });
});

/**
 * POST /api/tokens — { name, scopes: string[], expiresInDays? }
 * The full token value is returned exactly once; only its SHA-256 hash is stored.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "users:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    scopes?: string[];
    expiresInDays?: number;
  };

  const name = (body.name || "").trim();
  if (!name || name.length > 64) {
    throw new ApiError(400, "invalid_name", "Token name is required (max 64 characters)");
  }
  const scopes = Array.isArray(body.scopes) ? [...new Set(body.scopes)] : [];
  if (scopes.length === 0) {
    throw new ApiError(400, "invalid_scopes", "Select at least one scope (or full access)");
  }
  const allowed = new Set<string>(["*", ...PERMISSIONS]);
  for (const s of scopes) {
    if (typeof s !== "string" || !allowed.has(s)) {
      throw new ApiError(400, "invalid_scope", `Unknown scope: ${String(s).slice(0, 64)}`);
    }
  }
  let expiresAt: Date | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    const days = Number(body.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new ApiError(400, "invalid_expiry", "Expiry must be 1-365 days (or omit for no expiry)");
    }
    expiresAt = new Date(Date.now() + days * 86_400_000);
  }

  const token = generateApiToken();
  const row = await db.apiToken.create({
    data: {
      userId: ctx.userId,
      name,
      prefix: token.slice(0, 10),
      tokenHash: sha256Hex(token),
      scopes: JSON.stringify(scopes),
      expiresAt,
    },
  });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "token.create",
    target: name,
    sourceIp: ip,
    details: { scopes, expiresInDays: body.expiresInDays ?? null, prefix: row.prefix },
  });
  return NextResponse.json({ token, prefix: row.prefix });
});
