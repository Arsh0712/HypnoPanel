"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { usePanelStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Link2, Copy, KeyRound, ShieldCheck, Globe, RefreshCw, Download, LogOut, Loader2,
  Eye, EyeOff, CheckCircle2, XCircle,
} from "lucide-react";

interface SettingsData {
  settings: Record<string, unknown>;
  settableKeys: string[];
}
interface TunnelData {
  tunnel: { status: string; latencyMs: number | null; lastError: string | null };
  access: { mode: string; token: string | null; relayUrlPath: string | null; domain: string | null };
}
interface UpdateData {
  current: string; channel: string; latest: string | null; upToDate: boolean | null;
  checkError: string | null; lastCheckAt: string | null; note: string; repo: string;
}

function strength(pw: string): number {
  let score = 0;
  if (pw.length >= 12) score += 30;
  if (pw.length >= 16) score += 15;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 20;
  if (/\d/.test(pw)) score += 15;
  if (/[^A-Za-z0-9]/.test(pw)) score += 20;
  return Math.min(100, score);
}

export function SettingsView() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Settings</h2>
      <Tabs defaultValue="access" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="access">Access URL</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>
        <TabsContent value="access"><AccessTab /></TabsContent>
        <TabsContent value="account"><AccountTab /></TabsContent>
        <TabsContent value="security"><SecurityTab /></TabsContent>
        <TabsContent value="network"><NetworkTab /></TabsContent>
        <TabsContent value="updates"><UpdatesTab /></TabsContent>
        <TabsContent value="backups"><BackupsSettingsTab /></TabsContent>
        <TabsContent value="branding"><BrandingTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------- access URL */

function AccessTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const viewer = usePanelStore((s) => s.viewer);
  const tunnel = useQuery<TunnelData>({
    queryKey: ["tunnel"],
    queryFn: () => get<TunnelData>("/api/system/tunnel"),
    refetchInterval: 10_000,
  });
  const [reveal, setReveal] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; token: string } | null>(null);

  const access = tunnel.data?.access;
  // Gateway suffix only in sandbox gateway mode (the relay injects __HIPNO_PORT__);
  // in production tunnel mode the URL is exactly origin + token path.
  const gwSuffix =
    typeof window !== "undefined" && window.__HIPNO_PORT__
      ? `?XTransformPort=${window.__HIPNO_PORT__}`
      : "";
  const fullUrl =
    access?.relayUrlPath && typeof window !== "undefined"
      ? `${window.location.origin}${access.relayUrlPath}${gwSuffix}`
      : null;

  async function rotate() {
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; token: string; url: string }>("/api/settings/rotate-url", {
        password,
        ...(viewer?.totpEnabled ? { totp } : {}),
        ...(custom.trim() ? { custom: custom.trim() } : {}),
      });
      setResult({ url: r.url, token: r.token });
      setRotateOpen(false);
      qc.invalidateQueries({ queryKey: ["tunnel"] });
    } catch (e) {
      toast({ title: "Rotation failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    } finally {
      setBusy(false);
      setPassword(""); setTotp(""); setCustom("");
    }
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="h-5 w-5" aria-hidden /> Access URL rotated
          </CardTitle>
          <CardDescription>
            The old URL returns 404 immediately and all sessions were revoked — including this one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border bg-muted/50 p-3 font-mono text-sm break-all">
            {typeof window !== "undefined"
              ? `${window.location.origin}${result.url}${gwSuffix}`
              : result.url}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${result.url}${gwSuffix}`); toast({ title: "Copied" }); }}>
              <Copy className="h-4 w-4" aria-hidden /> Copy URL
            </Button>
            <Button size="sm" onClick={async () => { await post("/api/auth/logout").catch(() => {}); window.location.reload(); }}>
              <LogOut className="h-4 w-4" aria-hidden /> Sign in again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" aria-hidden /> Access URL</CardTitle>
          <CardDescription>
            Every installation gets a secret-path URL routed through the HipnoType Relay tunnel —
            works even on IPv6-only or NAT-ed VPSes with zero inbound ports.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tunnel.data?.tunnel.status === "connected" ? "default" : tunnel.data?.tunnel.status === "connecting" ? "secondary" : "destructive"} className="cursor-default">
              tunnel {tunnel.data?.tunnel.status ?? "…"}
              {tunnel.data?.tunnel.latencyMs != null ? ` · ${tunnel.data.tunnel.latencyMs}ms` : ""}
            </Badge>
            <Badge variant="outline" className="cursor-default">mode: {access?.mode ?? "relay"}</Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Current token</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted/50 border rounded px-2 py-1.5 flex-1 truncate">
                {access?.token ? (reveal ? access.token : `${access.token.slice(0, 4)}${"•".repeat(Math.max(0, access.token.length - 8))}${access.token.slice(-4)}`) : "obtaining from relay…"}
              </code>
              <Button size="sm" variant="ghost" onClick={() => setReveal((v) => !v)} aria-label={reveal ? "Mask token" : "Reveal token"}>
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => { if (fullUrl) { navigator.clipboard.writeText(fullUrl); toast({ title: "Access URL copied" }); } }}
              >
                <Copy className="h-4 w-4" aria-hidden /> Copy URL
              </Button>
            </div>
            {fullUrl && (
              <p className="text-xs text-muted-foreground break-all font-mono">{fullUrl}</p>
            )}
          </div>
          <Button onClick={() => setRotateOpen(true)} className="w-full sm:w-auto">
            <RefreshCw className="h-4 w-4" aria-hidden /> Rotate access URL
          </Button>
          <p className="text-xs text-muted-foreground">
            Rotation is two-phase (relay confirms → panel commits) and revokes every active session.
            Custom slugs: 16–64 chars, letters/digits/-/_ , high entropy only.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Trust model</CardTitle>
          <CardDescription>
            In relay mode TLS terminates at the relay (hypnotype.mangocloud.cyou), which can technically
            see traffic — same as Cloudflare Tunnel. Direct mode (Network tab) uses the panel&apos;s own
            certificate; per-server passthrough is documented in docs/RELAY.md.
          </CardDescription>
        </CardHeader>
      </Card>

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rotate access URL</DialogTitle>
            <DialogDescription>
              A new secret path is issued; the old one dies immediately and ALL sessions (including this
              one) are revoked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rot-custom">Custom slug (optional — leave empty for random 32 chars)</Label>
              <Input id="rot-custom" value={custom} onChange={(e) => setCustom(e.target.value)}
                placeholder="e.g. my-very-own-secret-path-42" className="font-mono" />
              {custom && (
                <p className="text-xs text-muted-foreground">
                  {custom.length < 16 ? "Too short (min 16)" :
                   custom.length > 64 ? "Too long (max 64)" :
                   !/^[A-Za-z0-9_-]+$/.test(custom) ? "Only letters, digits, - and _" :
                   "Looks valid — the relay checks uniqueness and entropy"}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rot-pass">Confirm password</Label>
              <Input id="rot-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {viewer?.totpEnabled && (
              <div className="space-y-2">
                <Label htmlFor="rot-totp">2FA code</Label>
                <Input id="rot-totp" inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="123456" />
              </div>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="w-full" disabled={!password || (viewer?.totpEnabled && totp.length !== 6) || busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  Rotate now
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rotate and sign everyone out?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The old URL 404s within seconds; you will need the new URL and to sign in again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={rotate}>Yes, rotate</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------------------------------------------------------- account */

function AccountTab() {
  const { toast } = useToast();
  const viewer = usePanelStore((s) => s.viewer);
  const session = useQuery<{ user?: { email: string; totpEnabled: boolean } }>({
    queryKey: ["session"],
    queryFn: () => get("/api/auth/session"),
  });
  const [cur, setCur] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // 2FA
  const [twofaPhase, setTwofaPhase] = useState<"idle" | "scan" | "codes">("idle");
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [disablePw, setDisablePw] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const totpEnabled = session.data?.user?.totpEnabled ?? viewer?.totpEnabled ?? false;

  async function changePassword() {
    if (newPw !== confirm) { toast({ title: "Passwords do not match", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await post("/api/auth/change-password", {
        currentPassword: cur, newPassword: newPw,
        ...(newEmail ? { newEmail } : {}),
      });
      toast({ title: "Password updated", description: "Other sessions were revoked." });
      setCur(""); setNewPw(""); setConfirm(""); setNewEmail("");
    } catch (e) {
      toast({ title: "Change failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function startSetup() {
    const r = await post<{ secret: string; qr: string }>("/api/auth/2fa/setup");
    setSetup(r);
    setTwofaPhase("scan");
  }
  async function enableTotp() {
    if (!setup) return;
    try {
      const r = await post<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { secret: setup.secret, token: code });
      setRecovery(r.recoveryCodes);
      setTwofaPhase("codes");
    } catch (e) {
      toast({ title: "Verification failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    }
  }
  async function disableTotp() {
    try {
      await post("/api/auth/2fa/disable", { password: disablePw, token: disableCode });
      toast({ title: "2FA disabled" });
      setDisablePw(""); setDisableCode("");
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Email &amp; password</CardTitle>
          <CardDescription>Argon2id hashing · policy: 12+ chars, mixed case, digit, symbol.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="acc-email">New email (optional)</Label>
            <Input id="acc-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              placeholder={session.data?.user?.email || viewer?.email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="acc-cur">Current password</Label>
            <Input id="acc-cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="acc-new">New password</Label>
            <Input id="acc-new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            {newPw && <Progress value={strength(newPw)} className="h-1.5" aria-label="Password strength" />}
          </div>
          <div className="space-y-2">
            <Label htmlFor="acc-conf">Confirm new password</Label>
            <Input id="acc-conf" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button disabled={!cur || !newPw || busy} onClick={changePassword}>Save changes</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Two-factor authentication (TOTP)
            <Badge variant={totpEnabled ? "default" : "secondary"}>{totpEnabled ? "enabled" : "disabled"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="max-w-md space-y-3">
          {!totpEnabled && twofaPhase === "idle" && (
            <Button onClick={startSetup} variant="outline"><ShieldCheck className="h-4 w-4" aria-hidden /> Enable 2FA</Button>
          )}
          {twofaPhase === "scan" && setup && (
            <div className="space-y-3">
              <img src={setup.qr} alt="TOTP QR code" className="mx-auto rounded-lg border bg-white p-2 w-52 h-52" />
              <p className="text-xs text-center text-muted-foreground break-all font-mono">{setup.secret}</p>
              <div className="flex gap-2">
                <Input inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="6-digit code" />
                <Button disabled={code.length !== 6} onClick={enableTotp}>Verify &amp; enable</Button>
              </div>
            </div>
          )}
          {twofaPhase === "codes" && (
            <div className="space-y-3">
              <p className="text-sm">Recovery codes (each works once — shown only now):</p>
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {recovery.map((c) => <div key={c} className="rounded border bg-muted/50 px-2 py-1.5 text-center">{c}</div>)}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(recovery.join("\n")); toast({ title: "Copied" }); }}>
                  <Copy className="h-4 w-4" aria-hidden /> Copy
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const blob = new Blob([`HipnoType recovery codes\n\n${recovery.join("\n")}\n`], { type: "text/plain" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "hypnotype-recovery-codes.txt";
                  a.click();
                }}>
                  <Download className="h-4 w-4" aria-hidden /> Download
                </Button>
                <Button size="sm" onClick={() => window.location.reload()}>Done</Button>
              </div>
            </div>
          )}
          {totpEnabled && (
            <div className="space-y-2">
              <div className="space-y-2">
                <Label htmlFor="tfa-pw">Password</Label>
                <Input id="tfa-pw" type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tfa-code">Current 2FA code</Label>
                <Input id="tfa-code" inputMode="numeric" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="123456" />
              </div>
              <Button variant="destructive" disabled={!disablePw || disableCode.length !== 6} onClick={disableTotp}>Disable 2FA</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- security */

function useSettingSetter() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => post("/api/settings", { key, value }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast({ title: "Saved" }); },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });
}

function SecurityTab() {
  const settings = useQuery<SettingsData>({ queryKey: ["settings"], queryFn: () => get("/api/settings") });
  const setter = useSettingSetter();
  const s = (k: string) => settings.data?.settings[k];

  if (settings.isLoading) return <div className="h-40 rounded-xl bg-muted animate-pulse" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Idle timeout slides on activity; absolute timeout caps any session.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 max-w-xl">
          <div className="space-y-2">
            <Label htmlFor="idle">Idle timeout (minutes, 5–240)</Label>
            <Input id="idle" type="number" min={5} max={240} defaultValue={String(s("session.idleTimeoutMin") ?? 30)}
              onBlur={(e) => { const v = Number(e.target.value); if (v !== s("session.idleTimeoutMin")) setter.mutate({ key: "session.idleTimeoutMin", value: v }); }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="abs">Absolute timeout (hours, 1–168)</Label>
            <Input id="abs" type="number" min={1} max={168} defaultValue={String(s("session.absoluteTimeoutHours") ?? 12)}
              onBlur={(e) => { const v = Number(e.target.value); if (v !== s("session.absoluteTimeoutHours")) setter.mutate({ key: "session.absoluteTimeoutHours", value: v }); }} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Terminal</CardTitle></CardHeader>
        <CardContent className="space-y-3 max-w-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Idle timeout (minutes)</p>
              <p className="text-xs text-muted-foreground">Sessions are killed after inactivity.</p>
            </div>
            <Input type="number" min={5} max={120} className="w-24" defaultValue={String(s("terminal.idleTimeoutMin") ?? 15)}
              onBlur={(e) => setter.mutate({ key: "terminal.idleTimeoutMin", value: Number(e.target.value) })}
              aria-label="Terminal idle timeout minutes" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Session recording (asciinema format)</p>
              <p className="text-xs text-muted-foreground">Records full terminal content — audited toggle.</p>
            </div>
            <Switch checked={!!s("terminal.recordingEnabled")}
              onCheckedChange={(v) => setter.mutate({ key: "terminal.recordingEnabled", value: v })}
              aria-label="Terminal recording" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Brute-force protection</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Fixed policy: 5 failed logins lock the account and IP for 1 → 5 → 15 minutes. Constant-time
            comparisons, generic errors, and every attempt is audit-logged.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- network */

function NetworkTab() {
  const { toast } = useToast();
  const settings = useQuery<SettingsData>({ queryKey: ["settings"], queryFn: () => get("/api/settings") });
  const tunnel = useQuery<TunnelData>({ queryKey: ["tunnel"], queryFn: () => get("/api/system/tunnel") });
  const setter = useSettingSetter();
  const [mode, setMode] = useState<string | null>(null);
  const [domainEdit, setDomainEdit] = useState<string | null>(null);
  const currentMode = mode ?? (tunnel.data?.access.mode as string) ?? "relay";
  const domain = domainEdit ?? (tunnel.data?.access.domain || "");

  async function applyMode() {
    try {
      const r = await post<{ note: string }>("/api/settings/access-mode", {
        mode: currentMode,
        ...(currentMode === "direct" ? { domain } : {}),
      });
      toast({ title: "Access mode saved", description: r.note });
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" aria-hidden /> Access mode</CardTitle>
          <CardDescription>
            Relay: outbound tunnel via hypnotype.mangocloud.cyou (works everywhere). Direct: your own
            IPv4 + domain with Let&apos;s Encrypt on 443 (VPS deployment).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 max-w-xl">
          <RadioGroup value={currentMode} onValueChange={setMode}>
            <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${currentMode === "relay" ? "border-primary bg-primary/5" : ""}`}>
              <RadioGroupItem value="relay" className="mt-1" />
              <div>
                <p className="text-sm font-medium">Relay tunnel</p>
                <p className="text-xs text-muted-foreground">Outbound-only connection — no inbound ports needed.</p>
              </div>
            </label>
            <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${currentMode === "direct" ? "border-primary bg-primary/5" : ""}`}>
              <RadioGroupItem value="direct" className="mt-1" />
              <div className="flex-1">
                <p className="text-sm font-medium">Direct domain</p>
                <p className="text-xs text-muted-foreground">Caddy obtains a certificate and serves the panel on 443 under the same secret path.</p>
                {currentMode === "direct" && (
                  <Input className="mt-2" placeholder="panel.example.com" value={domain} onChange={(e) => setDomainEdit(e.target.value)} aria-label="Direct domain" />
                )}
              </div>
            </label>
          </RadioGroup>
          <Button onClick={applyMode} disabled={currentMode === "direct" && !domain}>Save access mode</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Ports</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 max-w-xl">
          <div className="space-y-2">
            <Label htmlFor="sshport">SSH port</Label>
            <Input id="sshport" type="number" min={1} max={65535} defaultValue={String(settings.data?.settings["network.sshPort"] ?? 22)}
              onBlur={(e) => setter.mutate({ key: "network.sshPort", value: Number(e.target.value) })} />
            <p className="text-xs text-muted-foreground">Changing the real SSH port applies via the firewall module on the VPS deployment.</p>
          </div>
          <div className="space-y-2">
            <Label>Panel port</Label>
            <Input value="3000" disabled />
            <p className="text-xs text-muted-foreground">Managed by the environment in this preview (hypno port on the VPS deployment).</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- updates */

function UpdatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const update = useQuery<UpdateData>({
    queryKey: ["update"],
    queryFn: () => get<UpdateData>("/api/system/update"),
  });
  const setter = useSettingSetter();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Version</CardTitle>
          <CardDescription>Update channel and release check.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {update.isLoading ? (
            <div className="h-20 rounded-lg bg-muted animate-pulse" />
          ) : update.data && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-2xl font-bold">v{update.data.current}</p>
                {update.data.upToDate === true && (
                  <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden /> up to date</Badge>
                )}
                {update.data.upToDate === false && <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" aria-hidden /> v{update.data.latest} available</Badge>}
                {update.data.checkError && <Badge variant="secondary">check failed</Badge>}
                <Button size="sm" variant="outline" onClick={() => { update.refetch(); toast({ title: "Checking GitHub releases…" }); }}>
                  <RefreshCw className="h-4 w-4" aria-hidden /> Check now
                </Button>
              </div>
              {update.data.checkError && (
                <p className="text-xs text-muted-foreground">{update.data.checkError}</p>
              )}
              {update.data.lastCheckAt && (
                <p className="text-xs text-muted-foreground">Last check: {new Date(update.data.lastCheckAt).toLocaleString()}</p>
              )}
              <div className="flex items-center gap-3">
                <span className="text-sm">Channel:</span>
                <RadioGroup
                  value={String(update.data.channel)}
                  onValueChange={(v) => setter.mutate({ key: "update.channel", value: v })}
                  className="flex gap-3"
                >
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <RadioGroupItem value="stable" /> stable
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <RadioGroupItem value="beta" /> beta
                  </label>
                </RadioGroup>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl">{update.data.note}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- backups */

function BackupsSettingsTab() {
  const settings = useQuery<SettingsData>({ queryKey: ["settings"], queryFn: () => get("/api/settings") });
  const setter = useSettingSetter();
  const s = (k: string) => settings.data?.settings[k];
  const [scheduleEdit, setScheduleEdit] = useState<string | null>(null);
  const schedule = scheduleEdit ?? String(s("backup.schedule") ?? "0 3 * * *");

  if (settings.isLoading) return <div className="h-40 rounded-xl bg-muted animate-pulse" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup policy</CardTitle>
        <CardDescription>Retention and the nightly schedule (the Backups module runs it).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3 max-w-2xl">
        <div className="space-y-2">
          <Label htmlFor="retention">Retention (keep N)</Label>
          <Input id="retention" type="number" min={1} max={100} defaultValue={String(s("backup.retention") ?? 10)}
            onBlur={(e) => setter.mutate({ key: "backup.retention", value: Number(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bksched">Schedule (cron)</Label>
          <Input id="bksched" className="font-mono" value={schedule} onChange={(e) => setScheduleEdit(e.target.value)}
            onBlur={() => { if (schedule !== s("backup.schedule")) setter.mutate({ key: "backup.schedule", value: schedule }); }}
            placeholder="0 3 * * *" />
          <p className="text-xs text-muted-foreground">Daily at 03:00 by default (server time).</p>
        </div>
        <div className="space-y-2">
          <Label>Encrypt archives</Label>
          <div className="pt-2">
            <Switch checked={!!s("backup.encryption")}
              onCheckedChange={(v) => setter.mutate({ key: "backup.encryption", value: v })}
              aria-label="Backup encryption" />
          </div>
          <p className="text-xs text-muted-foreground">AES-256-GCM encryption of archives (age on the VPS deployment).</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- branding */

function BrandingTab() {
  const settings = useQuery<SettingsData>({ queryKey: ["settings"], queryFn: () => get("/api/settings") });
  const setter = useSettingSetter();
  const [brandingEdit, setBrandingEdit] = useState<string | null>(null);
  const branding = brandingEdit ?? String(settings.data?.settings["panel.branding"] ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>The panel name stays “HipnoType Panel” — the branding line is yours.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="branding">Branding text</Label>
          <Input id="branding" value={branding} onChange={(e) => setBrandingEdit(e.target.value)}
            onBlur={() => { if (branding && branding !== settings.data?.settings["panel.branding"]) setter.mutate({ key: "panel.branding", value: branding }); }}
            placeholder="Your company / name" />
        </div>
        <p className="text-xs text-muted-foreground">
          Shown in the panel footer as “crafted by {branding || "HipnoType"}”.
        </p>
      </CardContent>
    </Card>
  );
}
