import { execFile } from "child_process";

/**
 * Safe process execution: ALWAYS execFile with argument arrays — never
 * shell strings (spec §7). Commands that reach the OS are validated by
 * callers through src/lib/validation.ts.
 */

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; maxBuffer?: number } = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 15_000, cwd: opts.cwd, maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        const code =
          e && typeof e.code === "number" ? e.code : e ? 1 : 0;
        resolve({
          ok: !e,
          stdout: stdout?.toString() || "",
          stderr: stderr?.toString() || (e ? e.message : ""),
          code: e ? code : 0,
        });
      }
    );
  });
}

/** Check whether a binary exists in PATH. */
export async function binaryExists(cmd: string): Promise<boolean> {
  const res = await run("which", [cmd], { timeoutMs: 3000 });
  return res.ok && res.stdout.trim().length > 0;
}
