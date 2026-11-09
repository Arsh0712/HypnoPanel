import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { isValidEmail, isValidPort } from "@/lib/validation";
import { decrypt, encrypt } from "@/lib/crypto";
import { relayToInfo } from "../_lib/serialize";

export const runtime = "nodejs";

function isHostname(v: string): boolean {
  const s = v.toLowerCase().replace(/\.$/, "");
  return !!s && s.length <= 253 && s.split(".").every((l) => /^[a-z0-9_-]{1,63}$/.test(l) && !l.startsWith("-") && !l.endsWith("-"));
}

/** GET /api/mail/relay — the configured SMTP relay (credentials masked). */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "mail:read" });
  const relay = await db.smtpRelay.findFirst();
  return NextResponse.json({ relay: relay ? relayToInfo(relay) : null });
});

/**
 * PUT /api/mail/relay — create or update the single SMTP relay (the §5.17.7
 * port-25 workaround). The password is only replaced when a new one is given;
 * it is stored AES-256-GCM encrypted and never returned.
 */
export const PUT = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    host?: string;
    port?: number;
    username?: string | null;
    password?: string;
    fromEmail?: string | null;
    enabled?: boolean;
  };

  const name = (body.name || "").trim();
  if (!name || name.length > 100) throw new ApiError(400, "invalid_name", "Relay name is required (1–100 characters).");

  const host = (body.host || "").trim().toLowerCase();
  if (!isHostname(host)) throw new ApiError(400, "invalid_host", "Relay host must be a hostname (e.g. smtp.relay.provider.com).");

  const port = Number(body.port);
  if (!isValidPort(port)) throw new ApiError(400, "invalid_port", "Port must be an integer between 1 and 65535.");

  let username: string | null = null;
  if (body.username !== undefined && body.username !== null && String(body.username).trim() !== "") {
    username = String(body.username).trim();
    if (username.length > 255) throw new ApiError(400, "invalid_username", "Username is limited to 255 characters.");
  }

  let fromEmail: string | null = null;
  if (body.fromEmail !== undefined && body.fromEmail !== null && String(body.fromEmail).trim() !== "") {
    fromEmail = String(body.fromEmail).trim().toLowerCase();
    if (!isValidEmail(fromEmail)) throw new ApiError(400, "invalid_from", "Envelope from must be a valid email address.");
  }

  const enabled = !!body.enabled;
  const newPassword = body.password && body.password.trim() ? body.password.trim() : null;
  if (enabled && !newPassword) {
    const existing = await db.smtpRelay.findFirst();
    if (!existing?.passwordEnc) {
      throw new ApiError(400, "missing_password", "Enter the relay password before enabling it — it is stored encrypted.");
    }
  }

  const existing = await db.smtpRelay.findFirst();
  const data = {
    name,
    host,
    port,
    username,
    fromEmail,
    enabled,
    ...(newPassword ? { passwordEnc: encrypt(newPassword) } : {}),
  };

  const saved = existing
    ? await db.smtpRelay.update({ where: { id: existing.id }, data })
    : await db.smtpRelay.create({ data });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.relay.save",
    target: `${saved.host}:${saved.port}`,
    sourceIp: getClientIp(req),
    details: { enabled: saved.enabled, passwordReplaced: !!newPassword },
  });

  return NextResponse.json({ relay: relayToInfo(saved) });
});

/**
 * POST /api/mail/relay { to } — send a REAL test email through the configured
 * relay via SMTP (nodemailer). Relay errors are surfaced as-is, never faked.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const body = (await req.json().catch(() => ({}))) as { to?: string };

  const to = (body.to || "").trim().toLowerCase();
  if (!isValidEmail(to)) throw new ApiError(400, "invalid_to", "Enter a valid recipient email address.");

  const relay = await db.smtpRelay.findFirst();
  if (!relay || !relay.enabled) {
    throw new ApiError(409, "relay_not_configured", "Save and enable an SMTP relay first — there is nothing to send through otherwise.");
  }
  if (!relay.passwordEnc) {
    throw new ApiError(409, "relay_no_password", "The relay has no stored password — save it with its credentials first.");
  }
  let password: string;
  try {
    password = decrypt(relay.passwordEnc);
  } catch {
    throw new ApiError(500, "relay_decrypt_failed", "The stored relay password could not be decrypted — save it again.");
  }

  const from = relay.fromEmail || `hipnopanel@${relay.host}`;
  const transporter = nodemailer.createTransport({
    host: relay.host,
    port: relay.port,
    secure: relay.port === 465,
    auth: relay.username ? { user: relay.username, pass: password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: "HipnoType Panel — SMTP relay test",
      text: `This is a real test send from HipnoType Panel through ${relay.host}:${relay.port}.\nDelivered at ${new Date().toISOString()}.`,
    });
    await db.smtpRelay.update({ where: { id: relay.id }, data: { lastTestAt: new Date(), lastTestOk: true } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "mail.relay.test",
      target: `${relay.host}:${relay.port} → ${to}`,
      sourceIp: getClientIp(req),
      details: { ok: true, messageId: info.messageId },
    });
    return NextResponse.json({
      ok: true,
      messageId: info.messageId || "",
      accepted: info.accepted || [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "relay send failed";
    await db.smtpRelay.update({ where: { id: relay.id }, data: { lastTestAt: new Date(), lastTestOk: false } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "mail.relay.test",
      target: `${relay.host}:${relay.port} → ${to}`,
      sourceIp: getClientIp(req),
      result: "failure",
      details: { ok: false, error: message.slice(0, 300) },
    });
    throw new ApiError(502, "relay_send_failed", `The relay rejected the send: ${message}`);
  } finally {
    transporter.close();
  }
});
