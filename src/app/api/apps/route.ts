import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { findTemplate } from "@/lib/app-templates";
import { encrypt } from "@/lib/crypto";
import { buildEnvFromSpec, renderCompose, slugFromName, isValidSlug, performDeploy, probeDocker } from "./_lib";

export const runtime = "nodejs";

function parseDomains(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, "invalid_domains", "domains must be an array");
  const out: string[] = [];
  for (const d of raw) {
    if (typeof d !== "string") {
      throw new ApiError(400, "invalid_domains", "domains must be strings");
    }
    const t = d.trim().toLowerCase();
    if (!t) continue;
    if (t.length > 253) throw new ApiError(400, "invalid_domains", "Domain too long");
    out.push(t);
    if (out.length > 10) throw new ApiError(400, "invalid_domains", "At most 10 domains per app");
  }
  return out;
}

/** GET /api/apps — list apps with release count + latest release. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "apps:read" });
  const apps = await db.app.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      releases: { orderBy: { version: "desc" }, take: 1 },
      _count: { select: { releases: true } },
    },
  });
  return NextResponse.json({
    apps: apps.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      templateId: a.templateId,
      templateName: a.templateName,
      status: a.status,
      domains: a.domains ? safeParseArray(a.domains) : [],
      note: a.note,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      lastDeployAt: a.lastDeployAt,
      releaseCount: a._count.releases,
      latestRelease: a.releases[0]
        ? {
            id: a.releases[0].id,
            version: a.releases[0].version,
            status: a.releases[0].status,
            note: a.releases[0].note,
            createdAt: a.releases[0].createdAt,
          }
        : null,
    })),
  });
});

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * POST /api/apps — stage a new app from a catalogue template.
 * { name, templateId, env: Record<string,string>, domains?: string[] }
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "apps:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    templateId?: unknown;
    env?: unknown;
    domains?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64) {
    throw new ApiError(400, "invalid_name", "Name is required (max 64 characters)");
  }
  const slug = slugFromName(name);
  if (!isValidSlug(slug)) {
    throw new ApiError(
      400,
      "invalid_name",
      "Name must resolve to a valid slug: 3–32 chars, lowercase letters, digits and dashes (e.g. my-blog)"
    );
  }

  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  const template = findTemplate(templateId);
  if (!template) {
    throw new ApiError(404, "template_not_found", `Unknown template "${templateId}"`);
  }

  const envInput =
    body.env && typeof body.env === "object" && !Array.isArray(body.env)
      ? (body.env as Record<string, unknown>)
      : {};

  const domains = parseDomains(body.domains);

  const existing = await db.app.findUnique({ where: { slug } });
  if (existing) {
    throw new ApiError(409, "slug_taken", `An app with the slug "${slug}" already exists`);
  }

  // Build env values: generate secrets that were not provided.
  const { values, plain, secrets } = buildEnvFromSpec(template.env, envInput);
  const composeYaml = renderCompose(template.compose, values);

  const app = await db.app.create({
    data: {
      name,
      slug,
      templateId: template.id,
      templateName: template.name,
      status: "configured",
      envJson: JSON.stringify(plain),
      secretsEnc: Object.keys(secrets).length
        ? encrypt(JSON.stringify(secrets))
        : null,
      composeYaml,
      domains: domains.length ? JSON.stringify(domains) : null,
      releases: {
        create: { version: 1, composeYaml, status: "configured", note: "Initial configuration" },
      },
    },
    include: { releases: { orderBy: { version: "desc" } } },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "app.create",
    target: slug,
    sourceIp: ip,
    details: {
      templateId: template.id,
      version: 1,
      generatedSecrets: Object.keys(secrets).length,
      domains,
    },
  });

  // FIX#2 §4.1 — a created app is DEPLOYED immediately when Docker is
  // available. When it is not, the response says so explicitly: the app is
  // saved as "configured" and is NOT running (no staged success).
  let deployment: { attempted: boolean; ok: boolean; dockerAvailable: boolean; version?: number; error?: string };
  const docker = await probeDocker();
  if (docker.available) {
    try {
      const { version } = await performDeploy(
        { id: app.id, slug: app.slug, composeYaml },
        { actorId: ctx.userId, actorEmail: ctx.email, sourceIp: ip },
        "deploy"
      );
      deployment = { attempted: true, ok: true, dockerAvailable: true, version };
    } catch (e) {
      // deployment failed honestly (compose error) — the configured app stays
      deployment = {
        attempted: true,
        ok: false,
        dockerAvailable: true,
        error: e instanceof ApiError ? e.message : "docker compose failed",
      };
    }
  } else {
    deployment = {
      attempted: false,
      ok: false,
      dockerAvailable: false,
      error:
        "NOT DEPLOYED: Docker Engine is not installed/running on this server. The app configuration + Compose file are saved — install Docker (docs → Apps), then press Deploy.",
    };
  }

  const fresh = await db.app.findUnique({
    where: { id: app.id },
    include: { releases: { orderBy: { version: "desc" } } },
  });
  const current = fresh ?? app;

  return NextResponse.json(
    {
      app: {
        id: current.id,
        name: current.name,
        slug: current.slug,
        templateId: current.templateId,
        templateName: current.templateName,
        status: current.status,
        domains,
        note: current.note,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        lastDeployAt: current.lastDeployAt,
        releaseCount: current.releases.length,
        latestRelease: current.releases[0]
          ? {
              id: current.releases[0].id,
              version: current.releases[0].version,
              status: current.releases[0].status,
              note: current.releases[0].note,
              createdAt: current.releases[0].createdAt,
            }
          : null,
      },
      deployment,
    },
    { status: 201 }
  );
});
