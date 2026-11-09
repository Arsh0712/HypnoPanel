import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { encrypt } from "@/lib/crypto";
import { run } from "@/lib/exec";
import { isValidDomain } from "@/lib/validation";
import { parseCertificate } from "@/lib/cert-watch";

export const runtime = "nodejs";

/**
 * POST /api/ssl/self-signed { domain, days? }
 * Generates a REAL self-signed certificate with openssl:
 *   openssl req -x509 -newkey rsa:2048 -nodes -keyout <tmpKey> -out <tmpCert>
 *     -subj /CN=<domain> -days <days> -addext subjectAltName=DNS:<domain>
 * then parses + stores it like an upload (type 'self').
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "websites:write" });
  const body = (await req.json().catch(() => ({}))) as { domain?: string; days?: number };

  const domain = (body.domain || "").trim().toLowerCase();
  if (!isValidDomain(domain)) {
    throw new ApiError(400, "invalid_domain", "Enter a valid domain, e.g. example.com");
  }
  const days = Math.min(Math.max(Math.round(Number(body.days) || 365), 1), 3650);

  const rnd = crypto.randomBytes(8).toString("hex");
  const tmpCert = path.join(os.tmpdir(), `hipno-cert-${rnd}.pem`);
  const tmpKey = path.join(os.tmpdir(), `hipno-key-${rnd}.pem`);

  try {
    const res = await run(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        tmpKey,
        "-out",
        tmpCert,
        "-subj",
        `/CN=${domain}`,
        "-days",
        String(days),
        "-addext",
        `subjectAltName=DNS:${domain}`,
      ],
      { timeoutMs: 20_000 }
    );
    if (!res.ok || !fs.existsSync(tmpCert) || !fs.existsSync(tmpKey)) {
      throw new ApiError(
        500,
        "openssl_failed",
        `openssl failed to generate the certificate: ${res.stderr.trim().slice(0, 300) || `exit ${res.code}`}`
      );
    }

    const certPem = fs.readFileSync(tmpCert, "utf8");
    const keyPem = fs.readFileSync(tmpKey, "utf8");
    const parsed = parseCertificate(certPem, keyPem);

    const cert = await db.certificate.create({
      data: {
        name: `Self-signed · ${domain}`,
        type: "self",
        certPem,
        keyEnc: encrypt(keyPem),
        subject: parsed.subject,
        issuer: parsed.issuer,
        sans: parsed.sans,
        validFrom: parsed.validFrom,
        validTo: parsed.validTo,
      },
    });

    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "ssl.selfsigned",
      target: domain,
      sourceIp: getClientIp(req),
      details: { days, fingerprint256: parsed.fingerprint256 },
    });

    return NextResponse.json(
      {
        certificate: {
          id: cert.id,
          name: cert.name,
          type: cert.type,
          subject: cert.subject,
          issuer: cert.issuer,
          sans: cert.sans,
          validFrom: cert.validFrom,
          validTo: cert.validTo,
          createdAt: cert.createdAt,
        },
      },
      { status: 201 }
    );
  } finally {
    // never leave key material behind in tmp
    try {
      if (fs.existsSync(tmpCert)) fs.rmSync(tmpCert, { force: true });
      if (fs.existsSync(tmpKey)) fs.rmSync(tmpKey, { force: true });
    } catch {
      /* best effort */
    }
  }
});
