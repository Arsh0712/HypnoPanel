import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { run, binaryExists } from "@/lib/exec";

export const runtime = "nodejs";

interface Fail2banJail {
  name: string;
  bannedIps: string[];
}

/**
 * GET /api/firewall/fail2ban — honest availability report. When the binary is
 * missing (this environment), jails/bans are reported as empty with a note;
 * on the VPS deployment fail2ban is installed and real data is returned.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "firewall:read" });
  const available = await binaryExists("fail2ban-client");
  if (!available) {
    return NextResponse.json({
      available: false,
      jails: [] as Fail2banJail[],
      note: "fail2ban is not installed in this environment (VPS deployment installs it) — jails/bans apply there.",
    });
  }

  const status = await run("fail2ban-client", ["status"], { timeoutMs: 10_000 });
  if (!status.ok) {
    return NextResponse.json({
      available: true,
      jails: [] as Fail2banJail[],
      note: `fail2ban is installed but did not respond: ${status.stderr.trim().slice(0, 200)}`,
    });
  }

  // Output looks like: "Status\n|- Number of jail:\t1\n`- Jail list:\tsshd"
  const jailList = (status.stdout.match(/Jail list:\s*(.+)$/m)?.[1] || "")
    .split(",")
    .map((j) => j.trim())
    .filter(Boolean);

  const jails: Fail2banJail[] = [];
  for (const jail of jailList) {
    const detail = await run("fail2ban-client", ["status", jail], { timeoutMs: 10_000 });
    const banned = (detail.stdout.match(/Banned IP list:\s*(.+)$/m)?.[1] || "")
      .trim()
      .split(/\s+/)
      .filter((ip) => ip.length > 0 && ip !== "");
    jails.push({ name: jail, bannedIps: banned });
  }

  return NextResponse.json({
    available: true,
    jails,
    note: "Live fail2ban jails and banned IPs on this server.",
  });
});
