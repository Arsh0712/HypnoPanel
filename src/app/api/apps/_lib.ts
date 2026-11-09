import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { run, binaryExists } from "@/lib/exec";
import { decrypt, randomBase62 } from "@/lib/crypto";
import { isValidPort, IDENT_RE } from "@/lib/validation";
import { DATA_DIR } from "@/lib/constants";
import { findTemplate, type EnvVarSpec } from "@/lib/app-templates";
import { ApiError } from "@/lib/api-error";
import { audit } from "@/lib/audit";

/**
 * Shared server-side helpers for the /api/apps routes.
 * (Colocated private module — NOT a route file.)
 */

export const APPS_DATA_DIR = path.join(DATA_DIR, "apps");

export interface DockerStatus {
  available: boolean;
  version: string | null;
  error: string | null;
}

export const DOCKER_UNAVAILABLE_MESSAGE =
  "Docker Engine is not installed or not running on this server — nothing was deployed. Install Docker (see docs → Apps), then press Deploy; the generated Compose file is ready.";

/** Live Docker Engine probe (spec §5.5 honest backend detection). */
export async function probeDocker(): Promise<DockerStatus> {
  if (!(await binaryExists("docker"))) {
    return { available: false, version: null, error: "docker binary not found in PATH" };
  }
  const res = await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 5000 });
  const version = res.stdout.trim();
  if (!res.ok || !version) {
    return {
      available: false,
      version: null,
      error: (res.stderr || res.stdout || "docker info failed").trim().slice(0, 200),
    };
  }
  return { available: true, version, error: null };
}

/** Derive a slug from a display name (lowercase, dashes, [a-z0-9-]). */
export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return IDENT_RE.test(slug);
}

/** Quote a value for inline use inside a YAML scalar when needed. */
function yamlScalar(v: string): string {
  if (v === "") return '""';
  if (
    /[\r\n\t]/.test(v) ||
    v !== v.trim() ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(v) ||
    v.includes(": ") ||
    v.endsWith(":") ||
    v.includes(" #") ||
    v.includes('"')
  ) {
    return JSON.stringify(v);
  }
  return v;
}

/** Replace {{KEY}} placeholders with rendered values. */
export function renderCompose(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, key: string) => {
    const v = values[key];
    return v === undefined ? "" : yamlScalar(v);
  });
}

/** Compose file path for an app slug (creates the directory). */
export function composeFileFor(slug: string): string {
  const dir = path.join(APPS_DATA_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "compose.yaml");
}

function secretLengthFor(key: string): number {
  if (/KEY_BASE|INTERNAL_TOKEN|SECRET_KEY|ENCRYPTION_KEY/.test(key)) return 48;
  return 24;
}

export interface EnvBuild {
  /** full render values (plain env + secrets) */
  values: Record<string, string>;
  /** non-secret env (stored as envJson) */
  plain: Record<string, string>;
  /** generated or provided secrets (stored encrypted) */
  secrets: Record<string, string>;
}

/**
 * Build render values from an env spec. Secrets that are not provided are
 * generated with randomBase62; on update, an omitted/empty secret keeps its
 * existing value.
 */
export function buildEnvFromSpec(
  spec: EnvVarSpec[],
  input: Record<string, unknown>,
  existing?: { plain: Record<string, string>; secrets: Record<string, string> }
): EnvBuild {
  const plain: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const errors: string[] = [];

  for (const s of spec) {
    const raw = input[s.key];
    let v = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : String(raw);

    if (s.type === "secret") {
      if (v) {
        secrets[s.key] = v;
      } else if (existing?.secrets[s.key]) {
        secrets[s.key] = existing.secrets[s.key];
      } else {
        secrets[s.key] = randomBase62(secretLengthFor(s.key));
      }
      if (secrets[s.key].length > 500) {
        errors.push(`${s.label || s.key} is too long`);
        delete secrets[s.key];
      }
      continue;
    }

    if (!v) {
      if (s.default !== undefined && s.default !== "") {
        v = s.default;
      } else if (existing?.plain[s.key] !== undefined) {
        v = existing.plain[s.key];
      } else if (s.required) {
        errors.push(`${s.label || s.key} is required`);
        continue;
      } else {
        v = "";
      }
    }
    if (s.type === "port" && !isValidPort(Number(v))) {
      errors.push(`${s.label || s.key} must be a port between 1 and 65535`);
      continue;
    }
    if (s.type === "number" && Number.isNaN(Number(v))) {
      errors.push(`${s.label || s.key} must be a number`);
      continue;
    }
    if (v.length > 500) {
      errors.push(`${s.label || s.key} is too long`);
      continue;
    }
    plain[s.key] = v;
  }

  if (errors.length) {
    throw new ApiError(400, "invalid_env", errors.join("; "));
  }
  return { values: { ...plain, ...secrets }, plain, secrets };
}

/** Parse the stored envJson/secretsEnc of an app (empty on corruption). */
export function parseAppEnv(
  envJson: string | null,
  secretsEnc: string | null
): { plain: Record<string, string>; secrets: Record<string, string> } {
  let plain: Record<string, string> = {};
  let secrets: Record<string, string> = {};
  try {
    plain = envJson ? (JSON.parse(envJson) as Record<string, string>) : {};
  } catch {
    plain = {};
  }
  try {
    secrets = secretsEnc ? (JSON.parse(decrypt(secretsEnc)) as Record<string, string>) : {};
  } catch {
    secrets = {};
  }
  return { plain, secrets };
}

/** Env spec for an app (catalogue template or git-custom). */
export function envSpecFor(templateId: string | null): EnvVarSpec[] {
  if (templateId === GIT_TEMPLATE_ID) return GIT_ENV_SPEC;
  const t = templateId ? findTemplate(templateId) : undefined;
  return t ? t.env : [];
}

// ------------------------------------------------------------------ git apps

export const GIT_TEMPLATE_ID = "git-custom";
export const GIT_TEMPLATE_NAME = "Git (custom build)";

export const GIT_ENV_SPEC: EnvVarSpec[] = [
  {
    key: "GIT_REPO",
    label: "Repository URL",
    type: "string",
    required: true,
    hint: "HTTPS Git URL, e.g. https://github.com/owner/repo.git",
  },
  { key: "GIT_BRANCH", label: "Branch", type: "string", default: "main", required: true },
  {
    key: "GIT_DOCKERFILE",
    label: "Dockerfile path",
    type: "string",
    default: "Dockerfile",
    required: true,
    hint: "Relative to the repository root",
  },
  { key: "PORT", label: "Host port", type: "port", default: "3000", required: true },
  {
    key: "APP_PORT",
    label: "Container port",
    type: "port",
    default: "3000",
    required: true,
    hint: "The port your application listens on inside the container",
  },
];

export function gitComposeTemplate(slug: string): string {
  return `services:
  ${slug}:
    build:
      context: {{GIT_REPO}}#{{GIT_BRANCH}}
      dockerfile: {{GIT_DOCKERFILE}}
    image: hipno-${slug}:latest
    restart: unless-stopped
    ports:
      - "{{PORT}}:{{APP_PORT}}"
`;
}

export function validateGitInputs(body: {
  repoUrl?: unknown;
  branch?: unknown;
  dockerfilePath?: unknown;
}): { repoUrl: string; branch: string; dockerfilePath: string } {
  const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : "";
  const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : "main";
  const dockerfilePath =
    typeof body.dockerfilePath === "string" && body.dockerfilePath.trim()
      ? body.dockerfilePath.trim()
      : "Dockerfile";

  if (!/^https:\/\/[^\s#]{4,500}$/.test(repoUrl)) {
    throw new ApiError(
      400,
      "invalid_repo",
      "Repository URL must be an HTTPS Git URL (e.g. https://github.com/owner/repo.git)"
    );
  }
  if (!/^[A-Za-z0-9._/-]{1,150}$/.test(branch) || branch.includes("..")) {
    throw new ApiError(400, "invalid_branch", "Branch contains invalid characters");
  }
  if (
    !/^[A-Za-z0-9._/-]{1,200}$/.test(dockerfilePath) ||
    dockerfilePath.includes("..") ||
    dockerfilePath.startsWith("/")
  ) {
    throw new ApiError(
      400,
      "invalid_dockerfile",
      "Dockerfile path must be a relative path inside the repository"
    );
  }
  return { repoUrl, branch, dockerfilePath };
}

/** Webhook flow note stored on git apps (spec §5.6). */
export function gitNote(repoUrl: string, branch: string): string {
  return (
    `Git build from ${repoUrl}#${branch}. Webhook flow: configure your Git provider to POST the push event ` +
    `to the HipnoType webhook endpoint with header X-Hipno-Signature = HMAC-SHA256(raw body, webhook secret). ` +
    `A valid signature triggers a rebuild and redeploy of this app.`
  );
}

// ------------------------------------------------------------------ deploying

export interface DeployActor {
  actorId: string;
  actorEmail: string;
  sourceIp?: string | null;
}

/**
 * Perform a live deployment: docker-gated, writes the compose file, runs
 * `docker compose up -d --pull=always`, records the next release and audits
 * honestly (failures included).
 */
export async function performDeploy(
  app: { id: string; slug: string; composeYaml: string | null },
  actor: DeployActor,
  via: "deploy" | "redeploy"
): Promise<{ version: number }> {
  const failAudit = (details: Record<string, unknown>) =>
    audit({
      actorId: actor.actorId,
      actorEmail: actor.actorEmail,
      sourceIp: actor.sourceIp,
      action: "app.deploy",
      target: app.slug,
      result: "failure",
      details: { via, ...details },
    });

  if (!app.composeYaml) {
    await failAudit({ reason: "no_compose" });
    throw new ApiError(409, "no_compose", "This app has no Compose file to deploy");
  }

  const docker = await probeDocker();
  if (!docker.available) {
    await failAudit({ reason: "docker_unavailable" });
    throw new ApiError(409, "docker_unavailable", DOCKER_UNAVAILABLE_MESSAGE);
  }

  const file = composeFileFor(app.slug);
  fs.writeFileSync(file, app.composeYaml, { mode: 0o600 });
  const res = await run("docker", ["compose", "-f", file, "up", "-d", "--pull=always"], {
    timeoutMs: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!res.ok) {
    const excerpt = (res.stderr || res.stdout || `exit code ${res.code}`).trim().slice(0, 500);
    await db.app.update({ where: { id: app.id }, data: { status: "error" } });
    await failAudit({ reason: "compose_failed", error: excerpt.slice(0, 200) });
    throw new ApiError(500, "deploy_failed", `docker compose failed: ${excerpt}`);
  }

  const last = await db.appRelease.findFirst({
    where: { appId: app.id },
    orderBy: { version: "desc" },
  });
  const version = (last?.version ?? 0) + 1;
  await db.appRelease.create({
    data: {
      appId: app.id,
      version,
      composeYaml: app.composeYaml,
      status: "running",
      note: via === "redeploy" ? "Redeployed via panel" : "Deployed via panel",
    },
  });
  await db.app.update({
    where: { id: app.id },
    data: { status: "running", lastDeployAt: new Date() },
  });
  await audit({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    sourceIp: actor.sourceIp,
    action: "app.deploy",
    target: app.slug,
    details: { via, version },
  });
  return { version };
}

/** Run a lifecycle compose command against the app's compose file. */
export async function composeAction(
  app: { id: string; slug: string; composeYaml: string | null },
  action: "start" | "stop" | "restart"
): Promise<{ ok: boolean; error: string }> {
  if (!app.composeYaml) {
    return { ok: false, error: "This app has no Compose file" };
  }
  const file = composeFileFor(app.slug);
  fs.writeFileSync(file, app.composeYaml, { mode: 0o600 });
  const res = await run("docker", ["compose", "-f", file, action], {
    timeoutMs: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: (res.stderr || res.stdout || `exit code ${res.code}`).trim().slice(0, 400),
    };
  }
  return { ok: true, error: "" };
}

/** Next release version for an app. */
export async function nextReleaseVersion(appId: string): Promise<number> {
  const last = await db.appRelease.findFirst({ where: { appId }, orderBy: { version: "desc" } });
  return (last?.version ?? 0) + 1;
}
