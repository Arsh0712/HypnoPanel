import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { encrypt, randomBase62 } from "@/lib/crypto";
import {
  GIT_TEMPLATE_ID,
  GIT_TEMPLATE_NAME,
  gitComposeTemplate,
  gitNote,
  isValidSlug,
  renderCompose,
  slugFromName,
  validateGitInputs,
  composeFileFor,
} from "../_lib";
import fs from "fs";

export const runtime = "nodejs";

/**
 * POST /api/apps/git — stage an app built from a Git repository
 * (spec §5.6). The Compose file uses a build stanza; a webhook secret is
 * generated and stored encrypted. Honest about needing the Docker backend
 * for the actual build.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "apps:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    repoUrl?: unknown;
    branch?: unknown;
    dockerfilePath?: unknown;
    hostPort?: unknown;
    containerPort?: unknown;
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
      "Name must resolve to a valid slug: 3–32 chars, lowercase letters, digits and dashes (e.g. my-git-app)"
    );
  }

  const existing = await db.app.findUnique({ where: { slug } });
  if (existing) {
    throw new ApiError(409, "slug_taken", `An app with the slug "${slug}" already exists`);
  }

  const { repoUrl, branch, dockerfilePath } = validateGitInputs(body);

  const hostPort = Number(body.hostPort ?? 3000);
  const containerPort = Number(body.containerPort ?? 3000);
  if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
    throw new ApiError(400, "invalid_env", "Host port must be between 1 and 65535");
  }
  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
    throw new ApiError(400, "invalid_env", "Container port must be between 1 and 65535");
  }

  const webhookSecret = randomBase62(40);
  const plain = {
    GIT_REPO: repoUrl,
    GIT_BRANCH: branch,
    GIT_DOCKERFILE: dockerfilePath,
    PORT: String(hostPort),
    APP_PORT: String(containerPort),
  };
  const composeYaml = renderCompose(gitComposeTemplate(slug), plain);
  const note = gitNote(repoUrl, branch);

  const app = await db.app.create({
    data: {
      name,
      slug,
      templateId: GIT_TEMPLATE_ID,
      templateName: GIT_TEMPLATE_NAME,
      status: "configured",
      envJson: JSON.stringify(plain),
      secretsEnc: encrypt(JSON.stringify({ WEBHOOK_SECRET: webhookSecret })),
      composeYaml,
      note,
      releases: {
        create: {
          version: 1,
          composeYaml,
          status: "configured",
          note: `Initial configuration (git build ${repoUrl}#${branch})`,
        },
      },
    },
  });

  // Persist the compose file so it is ready for the VPS deployment.
  try {
    const file = composeFileFor(slug);
    fs.writeFileSync(file, composeYaml, { mode: 0o600 });
  } catch {
    /* best effort — the compose is stored in the DB regardless */
  }

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "app.git.create",
    target: slug,
    sourceIp: ip,
    details: { repoUrl, branch, dockerfilePath, hostPort, containerPort },
  });

  return NextResponse.json(
    {
      app: { id: app.id, name: app.name, slug: app.slug, status: app.status },
      webhookSecret,
      message:
        "Git builds require the Docker backend (VPS deployment); the configuration and webhook secret are stored and ready.",
    },
    { status: 201 }
  );
});
