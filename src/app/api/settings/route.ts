import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getAllSettings, setSetting, SETTABLE_KEYS, validateSettingValue } from "@/lib/settings";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { getClientIp } from "@/lib/auth/session";

export const runtime = "nodejs";

/** GET /api/settings — all settings (secrets masked). Requires settings:read. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "settings:read" });
  const all = (await getAllSettings()) as Record<string, unknown>;
  // mask secrets: never expose the tunnel secret or SMTP password
  const { "access.tunnelSecretEnc": _hidden, ...rest } = all;
  const smtp = (all.smtp || {}) as Record<string, unknown>;
  return NextResponse.json({
    settings: {
      ...rest,
      smtp: {
        ...smtp,
        passEnc: smtp.passEnc ? "•••••• (set)" : "",
      },
    },
    settableKeys: SETTABLE_KEYS,
  });
});

/** POST /api/settings — { key, value } (allow-list + validation). */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "settings:write" });
  const body = (await req.json().catch(() => ({}))) as { key?: string; value?: unknown };
  const key = body.key || "";
  if (!(SETTABLE_KEYS as string[]).includes(key)) {
    throw new ApiError(400, "not_settable", `Setting "${key}" cannot be changed through this interface`);
  }
  const err = validateSettingValue(key, body.value);
  if (err) throw new ApiError(400, "invalid_value", err);
  await setSetting(key as never, body.value as never);
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "settings.set",
    target: key,
    sourceIp: getClientIp(req),
    details: { value: typeof body.value === "object" ? "[object]" : body.value },
  });
  return NextResponse.json({ ok: true });
});
