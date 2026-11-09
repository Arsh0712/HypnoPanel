import crypto from "crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-error";

/**
 * SSL module helpers + certificate expiry watcher.
 *
 * checkCertExpiries() is called from the panel's background loop
 * (src/lib/background.ts — wired by the orchestrator). For every stored
 * certificate:
 *   - validTo within 30 days  → upsert firing Alert, severity "warning"
 *   - validTo within 7 days or already expired → severity "critical"
 *   - renewed / > 30 days left → resolve a previously firing alert
 * Alert ruleName convention: `ssl.expiry:<certId>` (one firing alert per cert).
 */

const WARN_DAYS = 30;
const CRIT_DAYS = 7;
const DAY_MS = 86_400_000;

/** Fields extracted from a PEM certificate (X509Certificate, node:crypto). */
export interface ParsedCertificate {
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  /** JSON-encoded array of DNS SANs (null when the cert has none). */
  sans: string | null;
  fingerprint256: string;
}

/**
 * Parse a certificate + private key pair and verify the key actually belongs
 * to the certificate (public key comparison in SPKI/DER form).
 * Throws ApiError(400) on any parse/mismatch problem.
 */
export function parseCertificate(certPem: string, keyPem: string): ParsedCertificate {
  if (!certPem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new ApiError(400, "invalid_cert", "Certificate PEM must contain a BEGIN CERTIFICATE block");
  }
  if (!/-----BEGIN (?:RSA |EC |ECDSA )?PRIVATE KEY-----/.test(keyPem)) {
    throw new ApiError(400, "invalid_key", "Key PEM must contain a BEGIN PRIVATE KEY block");
  }

  let cert: crypto.X509Certificate;
  try {
    cert = new crypto.X509Certificate(certPem);
  } catch {
    throw new ApiError(400, "invalid_cert", "Could not parse the certificate PEM");
  }

  let keyObj: crypto.KeyObject;
  try {
    keyObj = crypto.createPublicKey(keyPem);
  } catch {
    throw new ApiError(400, "invalid_key", "Could not parse the private key PEM");
  }

  let certPub: Buffer;
  let keyPub: Buffer;
  try {
    certPub = cert.publicKey.export({ type: "spki", format: "der" }) as Buffer;
    keyPub = keyObj.export({ type: "spki", format: "der" }) as Buffer;
  } catch {
    throw new ApiError(400, "invalid_key", "Unsupported key type");
  }
  if (!certPub.equals(keyPub)) {
    throw new ApiError(400, "key_mismatch", "The private key does not match this certificate");
  }

  let sans: string | null = null;
  if (cert.subjectAltName) {
    const dns = cert.subjectAltName
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.toUpperCase().startsWith("DNS:"))
      .map((s) => s.slice(4));
    if (dns.length > 0) sans = JSON.stringify(dns);
  }

  const validFrom = new Date(cert.validFrom);
  const validTo = new Date(cert.validTo);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    throw new ApiError(400, "invalid_cert", "Certificate has invalid validity dates");
  }

  return {
    subject: cert.subject,
    issuer: cert.issuer,
    validFrom,
    validTo,
    sans,
    fingerprint256: cert.fingerprint256,
  };
}

export async function checkCertExpiries(): Promise<void> {
  const certs = await db.certificate.findMany();
  const now = Date.now();

  for (const cert of certs) {
    if (!cert.validTo) continue;
    const ruleName = `ssl.expiry:${cert.id}`;
    const daysLeft = (cert.validTo.getTime() - now) / DAY_MS;
    const existing = await db.alert.findFirst({
      where: { ruleName, state: "firing" },
      orderBy: { startedAt: "desc" },
    });

    if (daysLeft <= WARN_DAYS) {
      const expired = daysLeft <= 0;
      const severity = expired || daysLeft <= CRIT_DAYS ? "critical" : "warning";
      const message = expired
        ? `Certificate "${cert.name}"${cert.subject ? ` (${cert.subject})` : ""} expired ${Math.abs(
            Math.round(daysLeft)
          )} day(s) ago`
        : `Certificate "${cert.name}"${
            cert.subject ? ` (${cert.subject})` : ""
          } expires in ${Math.ceil(daysLeft)} day(s)`;

      if (!existing) {
        await db.alert.create({
          data: {
            ruleName,
            severity,
            message,
            state: "firing",
            startedAt: new Date(),
          },
        });
      } else if (existing.severity !== severity || existing.message !== message) {
        await db.alert.update({
          where: { id: existing.id },
          data: { severity, message },
        });
      }
    } else if (existing) {
      // Renewed (or replaced) with more than WARN_DAYS of validity left.
      await db.alert.update({
        where: { id: existing.id },
        data: { state: "resolved", resolvedAt: new Date() },
      });
    }
  }
}
