import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** POST /api/terminal/sessions — records the start of a terminal session. */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "terminal:use" });
  const body = (await req.json().catch(() => ({}))) as { runAs?: string };
  const row = await db.terminalSession.create({
    data: {
      userId: ctx.userId,
      userName: ctx.email,
      runAs: body.runAs || "panel",
      ip: getClientIp(req),
    },
  });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "terminal.start",
    sourceIp: getClientIp(req),
    details: { runAs: body.runAs || "panel", sessionId: row.id },
  });
  return NextResponse.json({ id: row.id });
});

/** PATCH /api/terminal/sessions — records the end of a session. */
export const PATCH = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "terminal:use" });
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) throw new ApiError(400, "invalid_input", "Session id required");
  const row = await db.terminalSession.findUnique({ where: { id: body.id } });
  if (row && !row.endedAt) {
    const durationSec = Math.round((Date.now() - row.startedAt.getTime()) / 1000);
    await db.terminalSession.update({ where: { id: body.id }, data: { endedAt: new Date() } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "terminal.end",
      target: body.id,
      details: { durationSec },
    });
  }
  return NextResponse.json({ ok: true });
});

/** GET /api/terminal/sessions — local users eligible for the "run as" selector. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "terminal:use" });
  const users: string[] = [];
  try {
    const passwd = fs.readFileSync("/etc/passwd", "utf8");
    for (const line of passwd.split("\n")) {
      const [name, , uid, , , , shell] = line.split(":");
      const uidN = Number(uid);
      if (
        name &&
        uidN >= 1000 &&
        name !== "nobody" &&
        ["/bin/bash", "/bin/sh", "/bin/zsh"].includes(shell)
      ) {
        users.push(name);
      }
    }
  } catch {
    /* best effort */
  }
  return NextResponse.json({ users });
});
