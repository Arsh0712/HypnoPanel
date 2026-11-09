"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { HypnoMark } from "@/components/panel/logo";
import { PANEL_VERSION, REPO_URL, VENDOR } from "@/lib/constants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Info, Server, Activity, HardDrive, TerminalSquare, Database, ShieldCheck, Package, ExternalLink, Boxes, Globe, Ban } from "lucide-react";

interface TunnelData {
  tunnel: { status: string; latencyMs: number | null };
  access: { mode: string; token: string | null; relayUrlPath: string | null };
}

const LICENSES: [string, string][] = [
  ["Next.js", "MIT"], ["React", "MIT"], ["Prisma", "Apache-2.0"],
  ["Tailwind CSS", "MIT"], ["shadcn/ui", "MIT"], ["Radix UI", "MIT"],
  ["lucide-react", "ISC"], ["TanStack Query", "MIT"], ["Zustand", "MIT"],
  ["Recharts", "MIT"], ["socket.io", "MIT"], ["xterm.js", "MIT"],
  ["Monaco Editor", "MIT"], ["@node-rs/argon2", "MIT"], ["better-sqlite3", "MIT"],
  ["otpauth", "MIT"], ["qrcode", "MIT"], ["nodemailer", "MIT-0"],
  ["cron-parser", "MIT"], ["HipnoType Panel", "MIT"],
];

const LIVE_FEATURES = [
  { icon: Activity, text: "Real host metrics (CPU/RAM/disk/net from /proc) with 24h history" },
  { icon: HardDrive, text: "Real file manager on the server filesystem with trash + archives" },
  { icon: TerminalSquare, text: "Real PTY web terminal (node-pty over WebSocket)" },
  { icon: Database, text: "Real SQLite databases with a live SQL console" },
  { icon: Server, text: "Real process list, backups (tar.gz + SHA-256), cron scheduler, audit chain" },
  { icon: ShieldCheck, text: "Real relay tunnel with rotating secret access URLs, 2FA, Argon2id" },
];

const VPS_ONLY = [
  "nftables firewall apply (rulesets generated; apply refused honestly when nft is absent)",
  "Docker app deploys (real compose up when Docker is present; refused honestly when absent)",
  "PHP-FPM pools, MariaDB/PostgreSQL install, systemd service control",
  "Let's Encrypt HTTP-01, Git builds, SMTP delivery",
];

export function AboutView() {
  const tunnel = useQuery<TunnelData>({
    queryKey: ["tunnel"],
    queryFn: () => get<TunnelData>("/api/system/tunnel"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <HypnoMark className="h-11 w-11" />
            <div>
              <CardTitle className="text-xl">HipnoType Panel</CardTitle>
              <CardDescription>Crafted by {VENDOR}</CardDescription>
            </div>
            <Badge variant="outline" className="font-mono cursor-default">v{PANEL_VERSION}</Badge>
            <Badge variant={tunnel.data?.tunnel.status === "connected" ? "default" : "secondary"} className="cursor-default">
              tunnel {tunnel.data?.tunnel.status ?? "…"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground max-w-2xl">
            A single-VPS control panel: websites, apps, databases, files, terminal, firewall, backups,
            cron and monitoring — reachable through rotating secret access URLs via the HipnoType Relay.
            One installation manages exactly the server it runs on.
          </p>
          {tunnel.data?.access.relayUrlPath && (
            <p className="text-xs font-mono text-muted-foreground break-all">
              access path: {tunnel.data.access.relayUrlPath}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                <Globe className="h-4 w-4" aria-hidden /> Repository <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`${REPO_URL}/blob/main/docs/RESEARCH.md`} target="_blank" rel="noopener noreferrer">
                <Info className="h-4 w-4" aria-hidden /> docs/ <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            CLI on the server: <code className="bg-muted px-1 rounded">bun scripts/hypno.mjs --help</code> (status, url, rotate, reset emailpass, doctor…)
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" aria-hidden /> Live in this environment
            </CardTitle>
            <CardDescription>Everything below operates on the real machine right now.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-sm" role="list">
              {LIVE_FEATURES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5">
                  <Icon className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Boxes className="h-4 w-4 text-amber-600" aria-hidden /> Applies to the VPS deployment
            </CardTitle>
            <CardDescription>
              This sandbox is a container — these backends are reported honestly when absent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-sm" role="list">
              {VPS_ONLY.map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <Ban className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" aria-hidden /> Open-source licenses
          </CardTitle>
          <CardDescription>HipnoType Panel is original code (MIT). It builds on:</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="max-h-96 overflow-y-auto grid gap-1.5 sm:grid-cols-2 text-sm" role="list">
            {LICENSES.map(([name, license]) => (
              <li key={name} className="flex items-center justify-between rounded border px-3 py-1.5">
                <span>{name}</span>
                <Badge variant="outline" className="font-normal cursor-default">{license}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            Full texts are bundled with each package and in the repository LICENSE file.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
