import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { handle } from "@/lib/api-error";
import { guard } from "@/lib/auth/guard";
import { TRASH_DIR } from "@/lib/constants";
import { ensureTrashDir, parseTrashName, pathSize } from "@/lib/file-manager";

export const runtime = "nodejs";

interface TrashEntry {
  name: string;
  original: string;
  deletedAt: string | null;
  type: "file" | "dir" | "symlink";
  size: number;
}

/** GET /api/files/trash — soft-deleted entries with size + original name. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "files:read" });
  await ensureTrashDir();
  const names = await fsp.readdir(TRASH_DIR).catch(() => []);
  const entries: TrashEntry[] = [];
  for (const name of names) {
    const full = path.join(TRASH_DIR, name);
    const st = await fsp.lstat(full).catch(() => null);
    if (!st) continue;
    const { original, deletedAt } = parseTrashName(name);
    entries.push({
      name,
      original,
      deletedAt: (deletedAt ?? st.mtime).toISOString(),
      type: st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file",
      size: st.isDirectory() ? await pathSize(full) : st.size,
    });
  }
  entries.sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
  return NextResponse.json({ trashDir: TRASH_DIR, entries });
});
