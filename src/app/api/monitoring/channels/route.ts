import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { encrypt } from "@/lib/crypto";
import { validateChannelInput } from "../_lib";

export const runtime = "nodejs";

/**
 * GET /api/monitoring/channels — channel list. Masked: never exposes the
 * stored configuration (only name/type/lastTest).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "monitoring:read" });
  const channels = await db.notificationChannel.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      lastTestAt: c.lastTestAt,
      lastTestOk: c.lastTestOk,
      createdAt: c.createdAt,
    })),
  });
});

/**
 * POST /api/monitoring/channels — create a channel.
 * { name, type: webhook|telegram|discord|smtp, config: {...} }
 * The full config (including SMTP credentials) is encrypted at rest.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "monitoring:write" });
  const ip = getClientIp(req);
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = validateChannelInput(raw);

  const channel = await db.notificationChannel.create({
    data: {
      name: input.name,
      type: input.type,
      configEnc: encrypt(JSON.stringify(input.config)),
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "monitor.channel.create",
    target: input.name,
    sourceIp: ip,
    details: { type: input.type, configKeys: Object.keys(input.config) },
  });

  return NextResponse.json(
    {
      channel: {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        lastTestAt: null,
        lastTestOk: null,
        createdAt: channel.createdAt,
      },
    },
    { status: 201 }
  );
});
