"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, api, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { usePanelStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { UserPlus, Trash2, KeyRound, Copy, Ban, CheckCircle2, ShieldCheck, Download, Users as UsersIcon, ScrollText, Braces } from "lucide-react";

interface UserRow {
  id: string; email: string; name: string | null; role: string; disabled: boolean;
  totpEnabled: boolean; mustChangePassword: boolean; lastLoginAt: string | null;
  createdAt: string; sessionCount: number; tokenCount: number;
}
interface SessionRow {
  id: string; userId: string; email: string; current: boolean; ip: string | null;
  userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string;
}
interface TokenRow {
  id: string; name: string; prefix: string; scopes: string[]; email: string;
  createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null;
}

const SCOPES = [
  "dashboard:read", "websites:read", "websites:write", "apps:read", "apps:write",
  "databases:read", "databases:write", "files:read", "files:write", "terminal:use",
  "cron:read", "cron:write", "backups:read", "backups:write", "firewall:read",
  "firewall:write", "processes:read", "processes:write", "services:read",
  "services:write", "monitoring:read", "monitoring:write", "users:read",
  "users:write", "audit:read", "settings:read", "settings:write", "access:rotate",
];

function ShowOnceSecret({ title, value, note }: { title: string; value: string; note: string }) {
  const { toast } = useToast();
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <div className="rounded-lg border bg-muted/50 p-3 font-mono text-sm break-all">{value}</div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(value); toast({ title: "Copied" }); }}>
          <Copy className="h-4 w-4" aria-hidden /> Copy
        </Button>
      </div>
      <p className="text-xs text-amber-600 dark:text-amber-400">{note}</p>
    </div>
  );
}

export function UsersView() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Users &amp; Tokens</h2>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="tokens">API Tokens</TabsTrigger>
        </TabsList>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="sessions"><SessionsTab /></TabsContent>
        <TabsContent value="tokens"><TokensTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ----------------------------------------------------------------- users */

function UsersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const viewer = usePanelStore((s) => s.viewer);
  const users = useQuery<{ users: UserRow[] }>({ queryKey: ["users"], queryFn: () => get("/api/users") });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("viewer");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);

  const invite = useMutation({
    mutationFn: () => post<{ user: UserRow; temporaryPassword: string }>("/api/users", { email, name, role }),
    onSuccess: (r) => {
      setTempPassword(r.temporaryPassword);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast({ title: "Invite failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (_d, v) => {
      const a = v.body.action;
      if (a === "reset-password") {
        const pw = (_d as { temporaryPassword?: string }).temporaryPassword;
        if (pw) setTempPassword(pw);
      } else {
        toast({ title: "Updated" });
      }
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast({ title: "Failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "User deleted" }); setDeleteTarget(null); setDeleteText(""); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e) => toast({ title: "Delete failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Roles: admin (everything) · developer (workloads) · viewer (read-only) — see docs/PERMISSIONS.md.</p>
        <Button size="sm" onClick={() => { setInviteOpen(true); setTempPassword(null); }}>
          <UserPlus className="h-4 w-4" aria-hidden /> Invite user
        </Button>
      </div>

      {users.isLoading ? (
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="p-3 font-medium">Email</th>
                    <th className="p-3 font-medium">Role</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">2FA</th>
                    <th className="p-3 font-medium">Last login</th>
                    <th className="p-3 font-medium">Sessions</th>
                    <th className="p-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(users.data?.users || []).map((u) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-3">
                        <p className="font-medium">{u.email}</p>
                        {u.name && <p className="text-xs text-muted-foreground">{u.name}</p>}
                      </td>
                      <td className="p-3">
                        <Select
                          value={u.role}
                          onValueChange={(v) => patch.mutate({ id: u.id, body: { role: v } })}
                          disabled={u.id === viewer?.id}
                        >
                          <SelectTrigger className="h-8 w-32" aria-label={`Role for ${u.email}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">admin</SelectItem>
                            <SelectItem value="developer">developer</SelectItem>
                            <SelectItem value="viewer">viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3">
                        {u.disabled ? <Badge variant="destructive">disabled</Badge>
                          : u.mustChangePassword ? <Badge variant="secondary">temp password</Badge>
                          : <Badge variant="default">active</Badge>}
                      </td>
                      <td className="p-3">
                        {u.totpEnabled ? <Badge variant="outline"><ShieldCheck className="h-3 w-3 mr-1" aria-hidden />on</Badge> : <span className="text-xs text-muted-foreground">off</span>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}
                      </td>
                      <td className="p-3 text-xs">{u.sessionCount} / {u.tokenCount} tokens</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setResetTarget(u)} aria-label={`Reset password for ${u.email}`}>
                          <KeyRound className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => patch.mutate({ id: u.id, body: { action: u.disabled ? "enable" : "disable" } })}
                          disabled={u.id === viewer?.id}
                          aria-label={`${u.disabled ? "Enable" : "Disable"} ${u.email}`}
                        >
                          {u.disabled ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Ban className="h-4 w-4" aria-hidden />}
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="text-destructive"
                          onClick={() => { setDeleteTarget(u); setDeleteText(""); }}
                          disabled={u.id === viewer?.id}
                          aria-label={`Delete ${u.email}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => { setInviteOpen(o); if (!o) setTempPassword(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tempPassword ? "User invited" : "Invite user"}</DialogTitle>
            <DialogDescription>
              {tempPassword ? "Share the temporary password securely — it is shown only once and hashed (Argon2id) at rest." : "Creates the account with a temporary password that must be changed at first login."}
            </DialogDescription>
          </DialogHeader>
          {tempPassword ? (
            <>
              <ShowOnceSecret title="Temporary password" value={tempPassword} note="Shown only once. The user must change it at first login." />
              <Button variant="outline" onClick={() => { setInviteOpen(false); setEmail(""); setName(""); }}>
                Done
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="inv-email">Email</Label>
                <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-name">Name (optional)</Label>
                <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">admin — full control</SelectItem>
                    <SelectItem value="developer">developer — workloads, no panel security</SelectItem>
                    <SelectItem value="viewer">viewer — read-only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" disabled={!email || invite.isPending} onClick={() => invite.mutate()}>
                <UserPlus className="h-4 w-4" aria-hidden /> Create user
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* reset password confirm */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password for {resetTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Generates a new temporary password (shown once) and revokes all their sessions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetTarget && patch.mutate({ id: resetTarget.id, body: { action: "reset-password" } })}>
              Reset password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* delete (typed) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their sessions and API tokens are revoked. Type <strong>{deleteTarget?.email}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder={deleteTarget?.email} aria-label="Type the email to confirm" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteText !== deleteTarget?.email}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
            >
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------------------------------------------------- sessions */

function SessionsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const sessions = useQuery<{ sessions: SessionRow[] }>({
    queryKey: ["sessions"],
    queryFn: () => get("/api/sessions"),
    refetchInterval: 30_000,
  });
  const [revokeAllText, setRevokeAllText] = useState("");
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);

  const revoke = useMutation({
    mutationFn: (id: string) => api("/api/sessions", { method: "PATCH", body: JSON.stringify({ sessionId: id }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sessions"] }); toast({ title: "Session revoked" }); },
  });
  const revokeAll = useMutation({
    mutationFn: () => api("/api/sessions", { method: "PATCH", body: JSON.stringify({ all: true }) }),
    onSuccess: (r) => {
      toast({ title: `Revoked ${(r as { revoked?: number }).revoked || "all"} sessions`, description: "You were logged out of other devices." });
      setRevokeAllOpen(false);
      setRevokeAllText("");
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Active cookie sessions (idle 30 min · absolute 12 h, configurable in Settings).</p>
        <Button size="sm" variant="destructive" onClick={() => setRevokeAllOpen(true)}>
          <Ban className="h-4 w-4" aria-hidden /> Revoke all
        </Button>
      </div>
      {sessions.isLoading ? (
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      ) : !sessions.data?.sessions.length ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No active sessions.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="p-3 font-medium">User</th>
                    <th className="p-3 font-medium">IP</th>
                    <th className="p-3 font-medium">Client</th>
                    <th className="p-3 font-medium">Last seen</th>
                    <th className="p-3 font-medium">Expires</th>
                    <th className="p-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.data.sessions.map((s) => (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-3">
                        {s.email} {s.current && <Badge variant="default" className="ml-1">this device</Badge>}
                      </td>
                      <td className="p-3 font-mono text-xs">{s.ip}</td>
                      <td className="p-3 text-xs text-muted-foreground max-w-56 truncate" title={s.userAgent}>{s.userAgent || "—"}</td>
                      <td className="p-3 text-xs">{new Date(s.lastSeenAt).toLocaleString()}</td>
                      <td className="p-3 text-xs text-muted-foreground">{new Date(s.expiresAt).toLocaleTimeString()}</td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" disabled={s.current} onClick={() => revoke.mutate(s.id)}>
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke all sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone (including you on other devices) is signed out. Type <strong>REVOKE</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={revokeAllText} onChange={(e) => setRevokeAllText(e.target.value)} placeholder="REVOKE" aria-label="Type REVOKE to confirm" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={revokeAllText !== "REVOKE"} className="bg-destructive text-white hover:bg-destructive/90" onClick={() => revokeAll.mutate()}>
              Revoke all sessions
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------------------------------------------------------- tokens */

function TokensTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const tokens = useQuery<{ tokens: TokenRow[] }>({
    queryKey: ["tokens"],
    queryFn: () => get("/api/tokens?mine=1"),
    refetchInterval: 60_000,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [fullAccess, setFullAccess] = useState(false);
  const [expiry, setExpiry] = useState("30");
  const [newToken, setNewToken] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      post<{ token: string }>("/api/tokens", {
        name,
        scopes: fullAccess ? ["*"] : scopes,
        expiresInDays: expiry === "never" ? undefined : Number(expiry),
      }),
    onSuccess: (r) => {
      setNewToken(r.token);
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (e) => toast({ title: "Failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Token revoked" }); qc.invalidateQueries({ queryKey: ["tokens"] }); },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          API tokens authenticate the <code className="bg-muted px-1 rounded">hypno</code> CLI and integrations. Shown once, stored hashed.
        </p>
        <Button size="sm" onClick={() => { setCreateOpen(true); setNewToken(null); }}>
          <Braces className="h-4 w-4" aria-hidden /> New token
        </Button>
      </div>
      {tokens.isLoading ? (
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      ) : !tokens.data?.tokens.filter((t) => !t.revokedAt).length ? (
        <Card><CardContent className="py-10 text-center space-y-2">
          <ScrollText className="h-9 w-9 mx-auto text-muted-foreground" aria-hidden />
          <p className="font-medium">No active tokens</p>
          <p className="text-sm text-muted-foreground">Create a scoped token for the CLI or external tooling.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Prefix</th>
                    <th className="p-3 font-medium">Scopes</th>
                    <th className="p-3 font-medium">Last used</th>
                    <th className="p-3 font-medium">Expires</th>
                    <th className="p-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.data.tokens.filter((t) => !t.revokedAt).map((t) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-3 font-medium">{t.name}</td>
                      <td className="p-3 font-mono text-xs">{t.prefix}…</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 max-w-64">
                          {t.scopes.includes("*") ? <Badge>full access</Badge> : t.scopes.slice(0, 3).map((s) => (
                            <Badge key={s} variant="outline" className="font-normal">{s}</Badge>
                          ))}
                          {t.scopes.length > 3 && <Badge variant="outline" className="font-normal">+{t.scopes.length - 3}</Badge>}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
                      </td>
                      <td className="p-3 text-xs">{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "never"}</td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revoke.mutate(t.id)}>Revoke</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen || !!newToken} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setNewToken(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{newToken ? "Token created" : "New API token"}</DialogTitle>
            <DialogDescription>
              {newToken ? "Copy it now — it will not be shown again." : "Scope the token to only what it needs."}
            </DialogDescription>
          </DialogHeader>
          {newToken ? (
            <>
              <ShowOnceSecret title="API token" value={newToken} note="Only a SHA-256 hash is stored. Use it as: Authorization: Bearer <token>" />
              <Button variant="outline" onClick={() => setNewToken(null)}>Done</Button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="tok-name">Name</Label>
                <Input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-deploy" />
              </div>
              <div className="space-y-2">
                <Label>Expiry</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger aria-label="Expiry"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="tok-full" checked={fullAccess} onCheckedChange={(v) => setFullAccess(!!v)} />
                  <Label htmlFor="tok-full">Full access (*)</Label>
                </div>
                {!fullAccess && (
                  <div className="max-h-48 overflow-y-auto rounded-lg border p-2 space-y-1">
                    {SCOPES.map((s) => (
                      <label key={s} className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={scopes.includes(s)}
                          onCheckedChange={(c) =>
                            setScopes((prev) => (c ? [...prev, s] : prev.filter((x) => x !== s)))
                          }
                        />
                        <span className="font-mono">{s}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <Button className="w-full" disabled={!name || (!fullAccess && scopes.length === 0) || create.isPending} onClick={() => create.mutate()}>
                Create token
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
