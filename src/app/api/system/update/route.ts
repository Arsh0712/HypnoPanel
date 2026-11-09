import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { PANEL_VERSION, REPO_URL } from "@/lib/constants";
import { getSetting, setSetting } from "@/lib/settings";
import { handle } from "@/lib/api-error";

export const runtime = "nodejs";

/**
 * GET /api/system/update — current version + real check against GitHub Releases
 * (honest result: latest tag or the reason the check failed).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "settings:read" });
  const channel = await getSetting("update.channel", "stable");
  let latest: string | null = null;
  let checkError: string | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://api.github.com/repos/Arsh0712/HypnoPanel/releases/latest`,
      {
        headers: { "user-agent": "HipnoType-Panel" },
        signal: ctrl.signal,
      }
    );
    clearTimeout(t);
    if (res.status === 404) {
      checkError = "No published releases found in the repository yet";
    } else if (res.ok) {
      const data = (await res.json()) as { tag_name?: string };
      latest = data.tag_name || null;
    } else {
      checkError = `GitHub API HTTP ${res.status}`;
    }
  } catch (e) {
    checkError = e instanceof Error ? e.message : "network unreachable";
  }
  await setSetting("update.lastCheckAt", new Date().toISOString());
  const lastCheckAt = await getSetting("update.lastCheckAt", null);
  const upToDate = latest ? latest.replace(/^v/, "") <= PANEL_VERSION : null;
  return NextResponse.json({
    current: PANEL_VERSION,
    channel,
    latest,
    upToDate,
    checkError,
    lastCheckAt,
    repo: REPO_URL,
    note:
      "In this preview environment the updater reports status only — binary staging, atomic swap and automatic rollback apply to the VPS deployment (docs/UPDATES.md).",
  });
});
