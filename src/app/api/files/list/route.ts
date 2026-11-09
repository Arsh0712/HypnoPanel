import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { handle } from "@/lib/api-error";
import { guard } from "@/lib/auth/guard";
import { resolveExistingPath } from "@/lib/file-manager";

export const runtime = "nodejs";

interface Entry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mode: string;
  owner?: { uid: number; gid: number };
  mtime: string;
  target?: string;
}

const MAX_ENTRIES = 5000;
const SEARCH_DEPTH = 4;
const SEARCH_CAP = 200;

function sortEntries(entries: Entry[]): Entry[] {
  const rank = (e: Entry) => (e.type === "dir" ? 0 : e.type === "symlink" ? 1 : 2);
  return entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Build one entry (lstat so symlinks are reported as symlinks). */
async function buildEntry(dir: string, name: string): Promise<Entry | null> {
  const full = path.join(dir, name);
  const st = await fsp.lstat(full).catch(() => null);
  if (!st) return null;
  const isLink = st.isSymbolicLink();
  const type: Entry["type"] = isLink ? "symlink" : st.isDirectory() ? "dir" : "file";
  const target = isLink ? await fsp.readlink(full).catch(() => undefined) : undefined;
  return {
    name,
    path: full,
    type,
    size: isLink ? 0 : st.size,
    mode: (st.mode & 0o7777).toString(8).padStart(4, "0"),
    owner: { uid: st.uid, gid: st.gid },
    mtime: st.mtime.toISOString(),
    target,
  };
}

/** Recursive case-insensitive name search (depth ≤ 4, capped at 200). */
async function searchTree(root: string, needle: string): Promise<Entry[]> {
  const out: Entry[] = [];
  const lower = needle.toLowerCase();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= SEARCH_CAP || depth > SEARCH_DEPTH) return;
    const dirents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const d of dirents) {
      if (out.length >= SEARCH_CAP) return;
      if (d.name.toLowerCase().includes(lower)) {
        const e = await buildEntry(dir, d.name);
        if (e) out.push(e);
      }
      let realDir: string | null = null;
      if (d.isDirectory()) realDir = path.join(dir, d.name);
      else if (d.isSymbolicLink()) {
        // only descend when the link resolves to a directory
        const st = await fsp.stat(path.join(dir, d.name)).catch(() => null);
        realDir = st?.isDirectory() ? path.join(dir, d.name) : null;
      }
      if (realDir && depth < SEARCH_DEPTH) {
        const real = await fsp.realpath(realDir).catch(() => null);
        if (real) await walk(realDir, depth + 1);
      }
    }
  };
  await walk(root, 0);
  return sortEntries(out);
}

/** GET /api/files/list?path=<abs>[&search=<name>] */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "files:read" });
  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path") || "";
  const search = (url.searchParams.get("search") || "").trim();
  const dir = await resolveExistingPath(rawPath);
  const st = await fsp.stat(dir).catch(() => null);
  if (!st?.isDirectory()) {
    return NextResponse.json(
      { error: "Not a directory", code: "not_a_directory" },
      { status: 400 }
    );
  }

  if (search) {
    if (search.length > 256) {
      return NextResponse.json(
        { error: "Search term is too long", code: "invalid_search" },
        { status: 400 }
      );
    }
    const results = await searchTree(dir, search);
    return NextResponse.json({
      path: dir,
      parent: path.dirname(dir) === dir ? null : path.dirname(dir),
      search,
      truncated: results.length >= SEARCH_CAP,
      entries: sortEntries(results),
    });
  }

  const names = await fsp.readdir(dir).catch(() => []);
  const entries: Entry[] = [];
  let truncated = false;
  for (const name of names) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const e = await buildEntry(dir, name);
    if (e) entries.push(e);
  }
  return NextResponse.json({
    path: dir,
    parent: path.dirname(dir) === dir ? null : path.dirname(dir),
    truncated,
    entries: sortEntries(entries),
  });
});
