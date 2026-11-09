import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import {
  runAllChecks,
  computeScore,
  detectWaf,
  siteIsolation,
  type SecurityCheckResult,
} from "../_lib";

export const runtime = "nodejs";

/**
 * GET /api/security/checks — recompute every check live (DB, /proc, /etc,
 * apt simulation, audit chain), upsert the SecurityCheck rows as a cache and
 * return { score, checks, hardening, computedAt }.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "security:read" });

  const [checks, waf, isolation] = await Promise.all([
    runAllChecks(),
    detectWaf(),
    siteIsolation(),
  ]);

  // Cache the live results in SecurityCheck rows (idempotent upsert per key).
  for (const c of checks) {
    await db.securityCheck.upsert({
      where: { key: c.key },
      create: {
        key: c.key,
        title: c.title,
        severity: c.severity,
        status: c.status,
        detail: c.detail,
        fixAction: c.fixAction,
      },
      update: {
        title: c.title,
        severity: c.severity,
        status: c.status,
        detail: c.detail,
        fixAction: c.fixAction,
      },
    });
  }

  const score = computeScore(checks);
  const issues = checks.filter((c) => c.status === "warn" || c.status === "fail").length;
  const passed = checks.filter((c) => c.status === "pass").length;

  return NextResponse.json({
    score,
    summary: { issues, passed, notApplicable: checks.filter((c) => c.status === "na").length, total: checks.length },
    checks: checks.map((c: SecurityCheckResult) => ({
      key: c.key,
      title: c.title,
      category: c.category,
      severity: c.severity,
      status: c.status,
      detail: c.detail,
      fixAction: c.fixAction,
      ...(c.meta ? { meta: c.meta } : {}),
    })),
    hardening: { waf, isolation },
    computedAt: new Date().toISOString(),
  });
});
