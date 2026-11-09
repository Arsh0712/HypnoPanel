"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { api, ApiClientError, del, get, post } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Globe,
  Plus,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Power,
  PowerOff,
  Files,
  Loader2,
  Upload,
  KeyRound,
  ShieldCheck,
  Lock,
  ScrollText,
  Info,
  X,
  ChevronRight,
  Radar,
  Sparkles,
  Network,
} from "lucide-react";

// ---------------------------------------------------------------------------
// API shapes (server: src/app/api/websites/**, src/app/api/ssl/**)
// ---------------------------------------------------------------------------

interface SiteRedirect {
  from: string;
  to: string;
}

interface SiteSettings {
  redirects: SiteRedirect[];
  basicAuth: { enabled: boolean; user: string | null; hasPassword: boolean };
  cacheHeaders: { enabled: boolean; maxAge: number };
  gzip: boolean;
  forceHttps: boolean;
  phpPool?: string;
}

interface CertificateInfo {
  id: string;
  name: string;
  type: string; // custom | self | letsencrypt
  subject: string | null;
  issuer: string | null;
  sans: string | null; // JSON array
  validFrom: string | null;
  validTo: string | null;
  createdAt: string;
  sites?: { id: string; domain: string }[];
}

interface Website {
  id: string;
  name: string;
  slug: string;
  domain: string;
  type: string; // static | php | node | proxy
  docRoot: string;
  linuxUser: string;
  phpVersion: string | null;
  upstreamUrl: string | null;
  status: string; // active | disabled
  sslMode: string; // none | custom | self | letsencrypt
  certId: string | null;
  config: string | null;
  dnsStatus: string; // pending_dns | dns_verified | error
  dnsToken: string | null;
  dnsCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  certificate: CertificateInfo | null;
  settings: SiteSettings;
}

interface DnsContext {
  publicIpv4: string | null;
  publicIpv6: string | null;
  hostname: string;
  resolvers: string[];
  ipv6Only: boolean;
}

interface VerifyRecord {
  type: string;
  name: string;
  host: string;
  expected: string;
  required: boolean;
  ok: boolean;
  resolvers: { resolver: string; status: string; got: string[]; message: string }[];
}

interface Verification {
  domain: string;
  at: number;
  dnsHost: { detected: string | null; nameservers: string[] };
  records: VerifyRecord[];
  verdict: "verified" | "pending" | "failed";
  summary: string;
}

interface LogsResponse {
  type: string;
  lines: string[];
  truncated: boolean;
  note: string | null;
}

const SITE_TYPES = [
  { value: "static", label: "Static", hint: "Plain files (HTML / CSS / JS)" },
  { value: "php", label: "PHP", hint: "PHP-FPM pool per site" },
  { value: "node", label: "Node.js", hint: "Reverse proxy to the app port" },
  { value: "proxy", label: "Proxy", hint: "Reverse proxy to an upstream URL" },
] as const;

const PHP_VERSIONS = ["7.4", "8.0", "8.1", "8.2", "8.3"];

/** Base-path aware href builder (mirrors buildUrl in src/lib/api.ts). */
function buildHref(path: string): string {
  const base = typeof window !== "undefined" ? window.__HIPNO_BASE__ || "" : "";
  const url = path.startsWith("/") ? path : `/${path}`;
  if (!base) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${base}${url}${joiner}XTransformPort=${window.__HIPNO_PORT__ || 3005}`;
}

/** PATCH helper (lib/api exports get/post/put/del; PATCH goes through api()). */
const patch = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

function errMessage(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Unexpected error";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

function parseSans(sans: string | null): string[] {
  if (!sans) return [];
  try {
    const arr = JSON.parse(sans) as unknown;
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function daysLeft(iso: string): number {
  try {
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  } catch {
    return 0;
  }
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case "php":
      return "border-amber-500/40 text-amber-700 dark:text-amber-300";
    case "node":
      return "border-emerald-500/40 text-emerald-700 dark:text-emerald-300";
    case "proxy":
      return "border-orange-500/40 text-orange-700 dark:text-orange-300";
    default:
      return "border-border text-muted-foreground";
  }
}

function sslBadge(site: Website): { label: string; className: string } {
  switch (site.sslMode) {
    case "custom":
      return { label: "Custom SSL", className: "border-primary/40 text-primary" };
    case "self":
      return { label: "Self-signed", className: "border-amber-500/40 text-amber-700 dark:text-amber-300" };
    case "letsencrypt":
      return { label: "Let's Encrypt", className: "border-primary/40 text-primary" };
    default:
      return { label: "No SSL", className: "border-border text-muted-foreground" };
  }
}

/** Guided-domain-flow state chip (pending_dns / dns_verified). */
function DnsStatusBadge({ site, compact = false }: { site: Website; compact?: boolean }) {
  const verified = site.dnsStatus === "dns_verified";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium cursor-default ${
        verified
          ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/[0.06]"
          : "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/[0.06]"
      }`}
      title={
        verified
          ? "DNS records verified against public resolvers"
          : "DNS records not verified yet — open the site to see the exact records to create"
      }
    >
      {verified ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current hipno-pulse" aria-hidden />
      )}
      {verified ? (compact ? "DNS ok" : "DNS verified") : compact ? "DNS pending" : "Pending DNS"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function WebsitesView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const list = useQuery<{ websites: Website[] }>({
    queryKey: ["websites"],
    queryFn: () => get<{ websites: Website[] }>("/api/websites"),
  });

  const websites = list.data?.websites ?? [];
  const selected = websites.find((w) => w.id === selectedId) ?? null;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["websites"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Websites</h1>
          <p className="text-sm text-muted-foreground">
            Real docroots, generated Caddyfile vhosts and certificates — everything the web
            server will serve on the VPS deployment.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Create Website
        </Button>
      </div>

      {list.isLoading ? (
        <Card>
          <CardContent className="p-4 space-y-2" role="status" aria-label="Loading websites">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : list.isError ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3" role="alert">
            <p className="text-sm text-muted-foreground">
              Could not load websites. {errMessage(list.error)}
            </p>
            <Button variant="outline" onClick={() => list.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : websites.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-muted/40">
              <Globe className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No websites yet</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Create your first website — the panel provisions the real docroot, the linux
                user and the generated vhost config instantly.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Create Website
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Domain</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">SSL</th>
                    <th className="py-2 pr-3 font-medium">Created</th>
                    <th className="py-2 w-8 font-medium"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {websites.map((w) => {
                    const ssl = sslBadge(w);
                    const isActive = w.id === selectedId;
                    return (
                      <tr
                        key={w.id}
                        onClick={() => setSelectedId(isActive ? null : w.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedId(isActive ? null : w.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isActive}
                        aria-label={`Website ${w.name} (${w.domain}) — open details`}
                        className={`border-b last:border-0 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isActive ? "bg-muted/60" : "hover:bg-muted/40"
                        }`}
                      >
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{w.name}</div>
                          <div className="text-xs text-muted-foreground font-mono hidden sm:block">
                            {w.slug}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <a
                            href={buildHref(`/api/websites/${w.id}/preview/`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 font-mono text-xs hover:underline text-foreground"
                            aria-label={`Open live preview of ${w.domain} in a new tab`}
                          >
                            {w.domain}
                            <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
                          </a>
                          <div className="mt-1">
                            <DnsStatusBadge site={w} compact />
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge variant="outline" className={`cursor-default ${typeBadgeClass(w.type)}`}>
                            {w.type}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3">
                          {w.status === "active" ? (
                            <Badge variant="outline" className="cursor-default border-primary/40 text-primary">
                              active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="cursor-default text-muted-foreground">
                              disabled
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge variant="outline" className={`cursor-default ${ssl.className}`}>
                            {ssl.label}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(w.createdAt)}
                        </td>
                        <td className="py-2.5 text-right">
                          <ChevronRight
                            className={`h-4 w-4 text-muted-foreground transition-transform ${
                              isActive ? "rotate-90" : ""
                            }`}
                            aria-hidden
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="pt-3 text-xs text-muted-foreground">
              {websites.length} website{websites.length === 1 ? "" : "s"} · click a row for
              config, SSL and logs.
            </p>
          </CardContent>
        </Card>
      )}

      {selected && (
        <WebsiteDetail
          site={selected}
          onChanged={invalidate}
          onClose={() => setSelectedId(null)}
        />
      )}

      <CreateWebsiteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          invalidate();
          setSelectedId(id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create website wizard
// ---------------------------------------------------------------------------

function CreateWebsiteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [type, setType] = useState<string>("static");
  const [phpVersion, setPhpVersion] = useState("8.3");
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [created, setCreated] = useState<Website | null>(null);

  const ctx = useQuery<DnsContext>({
    queryKey: ["dns-context"],
    queryFn: () => get<DnsContext>("/api/websites/dns-context"),
    enabled: open,
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () =>
      post<{ website: Website }>("/api/websites", {
        name: name.trim(),
        domain: domain.trim(),
        type,
        ...(type === "php" ? { phpVersion } : {}),
        ...(type === "proxy" ? { upstreamUrl: upstreamUrl.trim() } : {}),
      }),
    onSuccess: (data) => {
      setCreated(data.website);
      setStep(2);
      void queryClient.invalidateQueries({ queryKey: ["websites"] });
      toast({
        title: "Website created",
        description: `${data.website.domain} — now point its DNS at this server.`,
      });
    },
    onError: (e) => {
      toast({ title: "Could not create website", description: errMessage(e), variant: "destructive" });
    },
  });

  function reset() {
    setStep(1);
    setName("");
    setDomain("");
    setType("static");
    setPhpVersion("8.3");
    setUpstreamUrl("");
    setCreated(null);
  }

  const nameOk = name.trim().length >= 1 && name.trim().length <= 100;
  const domainPreview = normalizeDomainPreview(domain);
  const domainOk = domainPreview.ok;
  const proxyOk = type !== "proxy" || /^https?:\/\/[^\s]+$/.test(upstreamUrl.trim());

  const steps = ["Configure", "DNS records", "Verify", "SSL"];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step > 1 && created ? created.domain : "Add Website"}
          </DialogTitle>
          <DialogDescription>
            A guided flow: configure the site, publish its DNS records, verify them live,
            then enable HTTPS.
          </DialogDescription>
        </DialogHeader>

        {/* stepper */}
        <ol className="flex items-center gap-1.5" aria-label="Wizard progress">
          {steps.map((label, i) => {
            const n = i + 1;
            const state = step === n ? "current" : step > n ? "done" : "todo";
            return (
              <li key={label} className="flex items-center gap-1.5 flex-1 last:flex-none">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
                    state === "done"
                      ? "bg-primary text-primary-foreground"
                      : state === "current"
                        ? "bg-primary/15 text-primary ring-2 ring-primary/40"
                        : "bg-muted text-muted-foreground"
                  }`}
                  aria-current={state === "current" ? "step" : undefined}
                >
                  {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
                </span>
                <span
                  className={`text-xs hidden sm:block ${
                    state === "current" ? "font-medium text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
                {n < steps.length && <span className="flex-1 h-px bg-border mx-1" aria-hidden />}
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-name">Site name</Label>
              <Input
                id="site-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Portfolio"
                autoComplete="off"
                aria-invalid={name.length > 0 && !nameOk}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="site-domain">Domain</Label>
              <Input
                id="site-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
                aria-invalid={domain.length > 0 && !domainOk}
              />
              {domain.trim().length > 0 && (
                <p
                  className={`text-xs ${domainOk ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                  role={domainOk ? "status" : "alert"}
                >
                  {domainOk
                    ? `Will be added as ${domainPreview.domain}${domainPreview.isSubdomain ? " (subdomain of " + domainPreview.parent + ")" : ""}`
                    : domainPreview.error}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                You will get the exact DNS records to create next — nothing is assumed to
                point here until it verifies.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="site-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="site-type" aria-label="Website type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div>
                        <div className="font-medium">{t.label}</div>
                        <div className="text-xs text-muted-foreground">{t.hint}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {type === "php" && (
              <div className="space-y-2">
                <Label htmlFor="site-php">PHP version</Label>
                <Select value={phpVersion} onValueChange={setPhpVersion}>
                  <SelectTrigger id="site-php" aria-label="PHP version">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHP_VERSIONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        PHP {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {type === "proxy" && (
              <div className="space-y-2">
                <Label htmlFor="site-upstream">Upstream URL</Label>
                <Input
                  id="site-upstream"
                  value={upstreamUrl}
                  onChange={(e) => setUpstreamUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8080"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={upstreamUrl.length > 0 && !proxyOk}
                />
              </div>
            )}
          </div>
        )}

        {step === 2 && created && created.dnsToken && (
          <DnsRecordsStep site={created} ctx={ctx.data} onVerified={() => setStep(3)} onBack={() => setStep(1)} />
        )}
        {step === 2 && created && !created.dnsToken && (
          <p className="text-sm text-muted-foreground">
            This website predates the guided flow and has no DNS challenge token.
          </p>
        )}

        {step === 3 && created && (
          <DnsVerifyStep
            site={created}
            onVerified={() => setStep(4)}
            onChanged={(w) => setCreated(w)}
          />
        )}

        {step === 4 && created && (
          <SslStep site={created} onChanged={(w) => setCreated(w)} onFinish={() => { onOpenChange(false); reset(); onCreated(created.id); }} />
        )}

        <DialogFooter>
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!nameOk || !domainOk || !proxyOk || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Create & configure DNS
              </Button>
            </>
          )}
          {step > 1 && (
            <Button variant="outline" onClick={() => { onOpenChange(false); reset(); onCreated(created?.id ?? ""); }}>
              {step === 4 ? "Finish" : "Save & close"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Client-side mirror of the server normaliser for live feedback. */
function normalizeDomainPreview(input: string): { ok: boolean; domain?: string; isSubdomain?: boolean; parent?: string; error?: string } {
  let raw = (input || "").trim().toLowerCase();
  if (!raw) return { ok: false, error: "" };
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  raw = raw.split("/")[0].split("?")[0].split("#")[0].split(":")[0].split("@").pop() || "";
  raw = raw.replace(/^\.+|\.+$/g, "").replace(/\*\./g, "");
  if (!raw) return { ok: false, error: "Enter a domain name." };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw) || raw.includes(":"))
    return { ok: false, error: "Enter a domain name, not an IP address." };
  if (raw === "localhost" || raw.endsWith(".localhost"))
    return { ok: false, error: "localhost cannot be used as a public domain." };
  const labels = raw.split(".");
  if (labels.length < 2)
    return { ok: false, error: "Enter a full domain like example.com." };
  const tld = labels[labels.length - 1];
  if (["localhost", "test", "invalid", "example", "local", "internal"].includes(tld))
    return { ok: false, error: `.${tld} is reserved and cannot be verified publicly.` };
  if (labels.some((l) => !l || l.length > 63 || !/^[a-z0-9-]+$/.test(l) || l.startsWith("-") || l.endsWith("-")))
    return { ok: false, error: "Labels: letters, digits, hyphens (not leading/trailing), max 63 chars." };
  return {
    ok: true,
    domain: raw,
    isSubdomain: labels.length > 2,
    parent: labels.length > 2 ? labels.slice(-2).join(".") : raw,
  };
}

/** Step 2 — the exact records to publish, with copy buttons and registrar hint. */
function DnsRecordsStep({
  site,
  ctx,
  onVerified,
  onBack,
}: {
  site: Website;
  ctx?: DnsContext;
  onVerified: () => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const check = useMutation({
    mutationFn: () => post<{ verification: Verification }>(`/api/websites/${site.id}/dns-check`),
    onSuccess: () => onVerified(), // always advance to the results step
    onError: (e) => toast({ title: "DNS check failed", description: errMessage(e), variant: "destructive" }),
  });

  const dnsToken = site.dnsToken || "";
  const records: { type: string; host: string; value: string; ttl: number; required: boolean; why: string }[] = [];
  const isSub = site.domain.split(".").length > 2;
  if (ctx?.publicIpv4) {
    records.push({ type: "A", host: isSub ? site.domain.split(".")[0] : "@", value: ctx.publicIpv4, ttl: 300, required: true, why: "Points this name at this server's public IPv4 address." });
  }
  if (ctx?.publicIpv6) {
    records.push({ type: "AAAA", host: isSub ? site.domain.split(".")[0] : "@", value: ctx.publicIpv6, ttl: 300, required: !ctx.publicIpv4, why: ctx.publicIpv4 ? "Optional — lets IPv6 visitors connect directly." : "This server is IPv6-only; this record is how visitors reach it." });
  }
  if (!isSub) {
    records.push({ type: "CNAME", host: "www", value: site.domain, ttl: 300, required: false, why: "Serves www.<domain> and redirects it to the root." });
  }
  records.push({ type: "TXT", host: `_hipno-challenge${isSub ? "." + site.domain.split(".")[0] : ""}`, value: `hipno-verify=${dnsToken}`, ttl: 300, required: true, why: "Proves you control this domain before it is served or trusted." });

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: "Copied", description: what, duration: 1500 }),
      () => {}
    );
  }
  const copyAll = records.map((r) => `${r.type}  ${r.host}  ${r.value}  (TTL ${r.ttl || 300})`).join("\n");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <p className="font-medium">Create these records at your DNS provider</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Verification queries {ctx?.resolvers?.join(", ") || "public resolvers"} live — propagation
          usually takes minutes, occasionally up to an hour.
        </p>
        <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => copy(copyAll, "All records as text")}>
          <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Copy all
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground border-b bg-muted/30">
              <th className="py-2 px-3 font-medium">Type</th>
              <th className="py-2 px-3 font-medium">Host</th>
              <th className="py-2 px-3 font-medium">Value</th>
              <th className="py-2 px-3 font-medium">TTL</th>
              <th className="py-2 px-2 w-8"><span className="sr-only">Copy</span></th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-2 px-3">
                  <Badge variant="outline" className="font-mono cursor-default">
                    {r.type}
                    {r.required ? "" : " · opt"}
                  </Badge>
                </td>
                <td className="py-2 px-3 font-mono text-xs">{r.host}</td>
                <td className="py-2 px-3 font-mono text-xs break-all max-w-56" title={r.why}>{r.value}</td>
                <td className="py-2 px-3 text-xs text-muted-foreground">{r.ttl}</td>
                <td className="py-2 px-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Copy ${r.type} record value`} onClick={() => copy(r.value, `${r.type} ${r.host}`)}>
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        The TXT record is the ownership challenge — it is public by design (it lives in DNS).
        Until the required records verify, the site is served only through its internal preview.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Radar className="h-4 w-4 mr-1.5" aria-hidden />}
          Verify DNS records
        </Button>
      </div>
    </div>
  );
}

/** Step 3 — live per-record, per-resolver verification with auto-recheck. */
function DnsVerifyStep({
  site,
  onVerified,
  onChanged,
}: {
  site: Website;
  onVerified: () => void;
  onChanged: (w: Website) => void;
}) {
  const { toast } = useToast();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = useCallback(
    async (announce = false) => {
      setChecking(true);
      try {
        const d = await post<{ verification: Verification; dnsStatus: string }>(`/api/websites/${site.id}/dns-check`);
        setVerification(d.verification);
        if (d.verification.verdict === "verified") {
          onVerified();
        } else if (announce) {
          toast({ title: "Not verified yet", description: d.verification.summary, variant: "destructive" });
        }
      } catch (e) {
        if (announce) toast({ title: "DNS check failed", description: errMessage(e), variant: "destructive" });
      } finally {
        setChecking(false);
      }
    },
    [site.id, onVerified, toast]
  );

  useEffect(() => {
    void runCheck(false);
    // auto-recheck every 30 s while the step is open (spec §2.1 step 3)
    const t = setInterval(() => void runCheck(false), 30_000);
    return () => clearInterval(t);
  }, [runCheck]);

  void onChanged;

  if (!verification && checking) {
    return (
      <div className="space-y-3 py-4" role="status" aria-label="Checking DNS">
        <p className="text-sm text-muted-foreground">Querying public resolvers…</p>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (!verification) return null;

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2.5 ${
          verification.verdict === "verified"
            ? "border-emerald-500/30 bg-emerald-500/[0.06]"
            : verification.verdict === "failed"
              ? "border-red-500/30 bg-red-500/[0.06]"
              : "border-amber-500/30 bg-amber-500/[0.06]"
        }`}
        role="status"
      >
        {verification.verdict === "verified" ? (
          <Check className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
        ) : (
          <Radar className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0 animate-[hypno-spin_2.4s_linear_infinite]" aria-hidden />
        )}
        <div>
          <p className="font-medium">{verification.verdict === "verified" ? "Domain verified" : "Verification pending"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{verification.summary}</p>
          {verification.dnsHost.nameservers.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Authoritative nameservers:{" "}
              <span className="font-mono">
                {verification.dnsHost.detected ? `${verification.dnsHost.detected} — ` : ""}
                {verification.dnsHost.nameservers.slice(0, 2).join(", ")}
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        {verification.records.map((r) => (
          <div key={`${r.type}-${r.name}`} className="rounded-lg border overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 bg-muted/30">
              <Badge variant="outline" className="font-mono cursor-default">{r.type}</Badge>
              <span className="font-mono text-xs truncate">{r.name}</span>
              {!r.required && <span className="text-[10px] text-muted-foreground uppercase tracking-wide">optional</span>}
              <span className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium ${r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                {r.ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {r.ok ? "verified" : "waiting"}
              </span>
            </div>
            <ul className="divide-y text-xs">
              {r.resolvers.map((res) => (
                <li key={res.resolver} className="flex items-start gap-2.5 px-3.5 py-2">
                  <span
                    className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                      res.status === "match" ? "bg-emerald-500" : res.status === "wrong" ? "bg-red-500" : "bg-amber-500"
                    }`}
                    aria-hidden
                  />
                  <span className="font-mono text-muted-foreground w-16 shrink-0">{res.resolver}</span>
                  <span className={res.status === "wrong" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                    {res.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void runCheck(true)} disabled={checking}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden />}
          Check again
        </Button>
        <span className="text-xs text-muted-foreground">Auto-rechecks every 30 s while this step is open.</span>
      </div>
    </div>
  );
}

/** Step 4 — HTTPS: self-signed now, or Let's Encrypt when the deployment allows it. */
function SslStep({
  site,
  onChanged,
  onFinish,
}: {
  site: Website;
  onChanged: (w: Website) => void;
  onFinish: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const issue = useMutation({
    mutationFn: () => post<{ certificate: CertificateInfo; website: Website }>("/api/ssl/self-signed", { domain: site.domain }),
    onSuccess: (d) => {
      toast({ title: "Self-signed certificate issued", description: `${site.domain} now serves HTTPS internally.` });
      onChanged({ ...site, sslMode: "self", certificate: d.certificate });
      void queryClient.invalidateQueries({ queryKey: ["websites"] });
    },
    onError: (e) => {
      toast({ title: "Could not issue certificate", description: errMessage(e), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm flex items-start gap-2.5" role="status">
        <Check className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">{site.domain} is verified and active</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            DNS resolves to this server and the ownership challenge passed. Last step: HTTPS.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Self-signed (works everywhere)</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Issues a real 2048-bit certificate via openssl on this server and binds it to the
            vhost. Browsers will warn until a CA certificate replaces it.
          </p>
          <Button size="sm" className="w-full" onClick={() => issue.mutate()} disabled={issue.isPending || site.sslMode === "self"}>
            {issue.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {site.sslMode === "self" ? "Issued" : "Issue now"}
          </Button>
        </div>

        <div className="rounded-lg border p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="text-sm font-medium">Let&rsquo;s Encrypt</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Automatic ACME (HTTP-01) needs the domain&rsquo;s DNS pointing here <em>and</em> port
            80/443 reachable from the internet — true on a real VPS deployment. The panel
            issues and auto-renews it there; in restricted preview environments this is not
            possible and the panel says so rather than pretending.
          </p>
          <Button size="sm" variant="outline" className="w-full" disabled title="Requires a public VPS deployment with ports 80/443 open">
            Available on VPS deployment
          </Button>
        </div>
      </div>

      <Button className="w-full" size="lg" onClick={onFinish}>
        <Check className="h-4 w-4 mr-1.5" aria-hidden /> Finish setup
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DNS tab (guided domain flow — records, live verification, state)
// ---------------------------------------------------------------------------

function DnsTab({ site, onChanged }: { site: Website; onChanged: () => void }) {
  const { toast } = useToast();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [checking, setChecking] = useState(false);

  const ctx = useQuery<DnsContext>({
    queryKey: ["dns-context"],
    queryFn: () => get<DnsContext>("/api/websites/dns-context"),
    staleTime: 60_000,
  });

  const last = useQuery<{ verification: Verification | null; dnsStatus: string; dnsToken: string | null }>({
    queryKey: ["dns-check-last", site.id],
    queryFn: () => get(`/api/websites/${site.id}/dns-check`),
  });

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const d = await post<{ verification: Verification }>(`/api/websites/${site.id}/dns-check`);
      setVerification(d.verification);
      onChanged();
      if (d.verification.verdict === "verified") {
        toast({ title: "Domain verified", description: d.verification.summary });
      } else {
        toast({ title: "Not verified yet", description: d.verification.summary, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "DNS check failed", description: errMessage(e), variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }, [site.id, onChanged, toast]);

  const v = verification ?? last.data?.verification ?? null;
  const dnsToken = site.dnsToken ?? last.data?.dnsToken ?? null;

  // records to publish (same computation as the wizard)
  const records: { type: string; host: string; value: string; required: boolean }[] = [];
  const isSub = site.domain.split(".").length > 2;
  const firstLabel = site.domain.split(".")[0];
  if (ctx.data?.publicIpv4)
    records.push({ type: "A", host: isSub ? firstLabel : "@", value: ctx.data.publicIpv4, required: true });
  if (ctx.data?.publicIpv6)
    records.push({ type: "AAAA", host: isSub ? firstLabel : "@", value: ctx.data.publicIpv6, required: !ctx.data?.publicIpv4 });
  if (!isSub) records.push({ type: "CNAME", host: "www", value: site.domain, required: false });
  if (dnsToken)
    records.push({
      type: "TXT",
      host: `_hipno-challenge${isSub ? "." + firstLabel : ""}`,
      value: `hipno-verify=${dnsToken}`,
      required: true,
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <DnsStatusBadge site={site} />
          {site.dnsCheckedAt && (
            <span className="text-xs text-muted-foreground">
              last checked {fmtDate(site.dnsCheckedAt)} ·{" "}
              {new Date(site.dnsCheckedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => void runCheck()} disabled={checking || !dnsToken}>
          {checking ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Radar className="h-4 w-4 mr-1.5" aria-hidden />
          )}
          Verify now
        </Button>
      </div>

      {v && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2.5 ${
            v.verdict === "verified"
              ? "border-emerald-500/30 bg-emerald-500/[0.06]"
              : v.verdict === "failed"
                ? "border-red-500/30 bg-red-500/[0.06]"
                : "border-amber-500/30 bg-amber-500/[0.06]"
          }`}
          role="status"
        >
          {v.verdict === "verified" ? (
            <Check className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
          ) : (
            <Radar className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden />
          )}
          <div>
            <p className="font-medium">
              {v.verdict === "verified" ? "DNS verified" : v.verdict === "failed" ? "Wrong values detected" : "Pending propagation"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{v.summary}</p>
            {v.dnsHost.nameservers.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Authoritative NS: <span className="font-mono">{v.dnsHost.nameservers.slice(0, 2).join(", ")}</span>
                {v.dnsHost.detected ? ` (${v.dnsHost.detected})` : ""}
              </p>
            )}
          </div>
        </div>
      )}

      {dnsToken ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b bg-muted/30">
                  <th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium">Host</th>
                  <th className="py-2 px-3 font-medium">Value</th>
                  <th className="py-2 px-2 w-8"><span className="sr-only">Copy</span></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 px-3">
                      <Badge variant="outline" className="font-mono cursor-default">
                        {r.type}
                        {r.required ? "" : " · opt"}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 font-mono text-xs">{r.host}</td>
                    <td className="py-2 px-3 font-mono text-xs break-all max-w-64">{r.value}</td>
                    <td className="py-2 px-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Copy ${r.type} record value`}
                        onClick={() =>
                          navigator.clipboard
                            .writeText(r.value)
                            .then(() => toast({ title: "Copied", duration: 1200 }))
                            .catch(() => {})
                        }
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {v && (
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Live verification detail</p>
              {v.records.map((r) => (
                <div key={`${r.type}-${r.name}`} className="rounded-lg border overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 bg-muted/30">
                    <Badge variant="outline" className="font-mono cursor-default">{r.type}</Badge>
                    <span className="font-mono text-xs truncate">{r.name}</span>
                    {!r.required && <span className="text-[10px] text-muted-foreground uppercase tracking-wide">optional</span>}
                    <span className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium ${r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {r.ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Network className="h-3.5 w-3.5" aria-hidden />}
                      {r.ok ? "verified" : "waiting"}
                    </span>
                  </div>
                  <ul className="divide-y text-xs">
                    {r.resolvers.map((res) => (
                      <li key={res.resolver} className="flex items-start gap-2.5 px-3.5 py-2">
                        <span
                          className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                            res.status === "match" ? "bg-emerald-500" : res.status === "wrong" ? "bg-red-500" : "bg-amber-500"
                          }`}
                          aria-hidden
                        />
                        <span className="font-mono text-muted-foreground w-16 shrink-0">{res.resolver}</span>
                        <span className={res.status === "wrong" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                          {res.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This website predates the guided domain flow — its DNS cannot be re-verified here.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Website detail (Config | SSL | Logs)
// ---------------------------------------------------------------------------

function WebsiteDetail({
  site,
  onChanged,
  onClose,
}: {
  site: Website;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneDomain, setCloneDomain] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const action = useMutation({
    mutationFn: (a: "enable" | "disable") =>
      patch<{ website: Website }>(`/api/websites/${site.id}`, { action: a }),
    onSuccess: (data, a) => {
      toast({
        title: a === "enable" ? "Website enabled" : "Website disabled",
        description: `${site.name} (${site.domain}) — vhost config regenerated.`,
      });
      onChanged();
    },
    onError: (e) => {
      toast({ title: "Action failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const clone = useMutation({
    mutationFn: () =>
      post<{ website: Website }>(`/api/websites/${site.id}/clone`, {
        newDomain: cloneDomain.trim().toLowerCase(),
      }),
    onSuccess: (data) => {
      toast({
        title: "Website cloned",
        description: `${data.website.name} (${data.website.domain}) — files copied.`,
      });
      setCloneOpen(false);
      setCloneDomain("");
      onChanged();
    },
    onError: (e) => {
      toast({ title: "Clone failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: () => del<{ ok: boolean }>(`/api/websites/${site.id}`),
    onSuccess: () => {
      toast({
        title: "Website deleted",
        description: `${site.name} (${site.domain}) — files moved to data/trash.`,
      });
      setDeleteOpen(false);
      setDeleteText("");
      onClose();
      onChanged();
    },
    onError: (e) => {
      toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const previewUrl = buildHref(`/api/websites/${site.id}/preview/`);
  const domainOk = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(cloneDomain.trim());

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base truncate">{site.name}</CardTitle>
              <Badge variant="outline" className={`cursor-default ${typeBadgeClass(site.type)}`}>
                {site.type}
              </Badge>
              {site.status === "active" ? (
                <Badge variant="outline" className="cursor-default border-primary/40 text-primary">
                  active
                </Badge>
              ) : (
                <Badge variant="outline" className="cursor-default text-muted-foreground">
                  disabled
                </Badge>
              )}
              {site.phpVersion && (
                <Badge variant="outline" className="cursor-default font-mono font-normal">
                  PHP {site.phpVersion}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{site.domain}</span>
              <span className="font-mono hidden lg:inline">{site.docRoot}</span>
              <span className="font-mono hidden md:inline">user: {site.linuxUser}</span>
              {site.upstreamUrl && (
                <span className="font-mono truncate max-w-64" title={site.upstreamUrl}>
                  → {site.upstreamUrl}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden /> Preview
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => action.mutate(site.status === "active" ? "disable" : "enable")}
              disabled={action.isPending}
            >
              {action.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : site.status === "active" ? (
                <PowerOff className="h-4 w-4" aria-hidden />
              ) : (
                <Power className="h-4 w-4" aria-hidden />
              )}
              {site.status === "active" ? "Disable" : "Enable"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCloneOpen(true)}>
              <Files className="h-4 w-4" aria-hidden /> Clone
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setDeleteText("");
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="config">
          <TabsList>
            <TabsTrigger value="config">Config</TabsTrigger>
            <TabsTrigger value="dns">DNS</TabsTrigger>
            <TabsTrigger value="ssl">SSL</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="mt-3">
            <ConfigTab site={site} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="dns" className="mt-3">
            <DnsTab site={site} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="ssl" className="mt-3">
            <SslTab site={site} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="logs" className="mt-3">
            <LogsTab site={site} />
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Clone dialog */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clone {site.name}</DialogTitle>
            <DialogDescription>
              Copies the entire site directory (docroot, logs, settings) to a new site with a
              fresh slug and vhost. The certificate is not inherited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="clone-domain">New domain</Label>
            <Input
              id="clone-domain"
              value={cloneDomain}
              onChange={(e) => setCloneDomain(e.target.value)}
              placeholder={`staging.${site.domain}`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!domainOk || clone.isPending} onClick={() => clone.mutate()}>
              {clone.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Clone Website
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog — typed domain confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {site.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The site directory is moved to <code className="font-mono text-xs">data/trash</code>{" "}
              and the website row is removed. This also removes the generated vhost. Type the
              domain <span className="font-mono font-semibold text-foreground">{site.domain}</span>{" "}
              to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder={site.domain}
            aria-label="Type the domain to confirm deletion"
            autoComplete="off"
            spellCheck={false}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteText.trim() !== site.domain || remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Delete Website
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Config tab — vhost, settings editor, PHP pool
// ---------------------------------------------------------------------------

function ConfigTab({ site, onChanged }: { site: Website; onChanged: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const regenerate = useMutation({
    mutationFn: () => patch<{ website: Website }>(`/api/websites/${site.id}`, { action: "regenerate" }),
    onSuccess: () => {
      toast({ title: "Vhost config regenerated", description: `${site.domain} — Caddyfile updated.` });
      onChanged();
    },
    onError: (e) => {
      toast({ title: "Regenerate failed", description: errMessage(e), variant: "destructive" });
    },
  });

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(site.config || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">Generated vhost (Caddyfile format)</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyConfig} disabled={!site.config}>
                {copied ? (
                  <Check className="h-4 w-4 text-primary" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => regenerate.mutate()}
                disabled={regenerate.isPending}
              >
                {regenerate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden />
                )}
                Regenerate
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <pre
            className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs font-mono whitespace-pre"
            aria-label={`Generated vhost config for ${site.domain}`}
          >
            {site.config || "(no config generated yet — click Regenerate)"}
          </pre>
          <p className="pt-2 text-xs text-muted-foreground">
            On the VPS deployment the installer drops this vhost into the real Caddy server and
            reloads it. Inside the panel preview it is served through the site preview link.
          </p>
        </CardContent>
      </Card>

      <SettingsEditor key={`${site.id}-${site.updatedAt}`} site={site} onChanged={onChanged} />

      {site.type === "php" && site.settings.phpPool && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">PHP-FPM pool (generated)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <pre
              className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs font-mono whitespace-pre"
              aria-label={`PHP-FPM pool config for ${site.slug}`}
            >
              {site.settings.phpPool}
            </pre>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <p>
                PHP-FPM installation applies on the VPS deployment (Ondrej/Sury/Remi) — the pool
                config is generated with the site and shipped by the installer.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings editor (redirects, basic auth, cache, gzip, force-https)
// ---------------------------------------------------------------------------

interface SettingsPayload {
  redirects: SiteRedirect[];
  basicAuth: { enabled: boolean; user: string | null; password?: string };
  cacheHeaders: { enabled: boolean; maxAge: number };
  gzip: boolean;
  forceHttps: boolean;
}

function SettingsEditor({ site, onChanged }: { site: Website; onChanged: () => void }) {
  const { toast } = useToast();
  const s = site.settings;
  const [redirects, setRedirects] = useState<SiteRedirect[]>(s.redirects.map((r) => ({ ...r })));
  const [authEnabled, setAuthEnabled] = useState(s.basicAuth.enabled);
  const [authUser, setAuthUser] = useState(s.basicAuth.user || "");
  const [authPassword, setAuthPassword] = useState("");
  const [cacheEnabled, setCacheEnabled] = useState(s.cacheHeaders.enabled);
  const [maxAge, setMaxAge] = useState(String(s.cacheHeaders.maxAge));
  const [gzip, setGzip] = useState(s.gzip);
  const [forceHttps, setForceHttps] = useState(s.forceHttps);

  const save = useMutation({
    mutationFn: (payload: SettingsPayload) =>
      patch<{ website: Website }>(`/api/websites/${site.id}`, { settings: payload }),
    onSuccess: () => {
      toast({
        title: "Settings saved",
        description: `${site.domain} — vhost config regenerated with the new settings.`,
      });
      onChanged();
    },
    onError: (e) => {
      toast({ title: "Could not save settings", description: errMessage(e), variant: "destructive" });
    },
  });

  function buildPayload(): SettingsPayload {
    const age = Math.min(Math.max(parseInt(maxAge, 10) || 3600, 0), 2_592_000);
    return {
      redirects: redirects.filter((r) => r.from.startsWith("/") && r.to.trim().length > 0),
      basicAuth: {
        enabled: authEnabled,
        user: authUser.trim() || null,
        ...(authPassword.length > 0 ? { password: authPassword } : {}),
      },
      cacheHeaders: { enabled: cacheEnabled, maxAge: age },
      gzip,
      forceHttps,
    };
  }

  const dirty =
    JSON.stringify(buildPayload()) !==
    JSON.stringify({
      redirects: s.redirects,
      basicAuth: { enabled: s.basicAuth.enabled, user: s.basicAuth.user },
      cacheHeaders: s.cacheHeaders,
      gzip: s.gzip,
      forceHttps: s.forceHttps,
    });

  const userOk = !authEnabled || /^[A-Za-z0-9._-]{1,32}$/.test(authUser.trim());
  const passwordOk = authPassword.length === 0 || authPassword.length >= 6;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">Site settings</CardTitle>
          <Button
            size="sm"
            disabled={!dirty || !userOk || !passwordOk || save.isPending}
            onClick={() => save.mutate(buildPayload())}
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save settings
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Redirects */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Redirects (301)</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRedirects([...redirects, { from: "", to: "" }])}
            >
              <Plus className="h-4 w-4" aria-hidden /> Add
            </Button>
          </div>
          {redirects.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No redirects — add one to emit <code className="font-mono">redir</code> lines in the vhost.
            </p>
          ) : (
            <div className="space-y-2">
              {redirects.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input
                    value={r.from}
                    onChange={(e) => {
                      const next = [...redirects];
                      next[i] = { ...r, from: e.target.value };
                      setRedirects(next);
                    }}
                    placeholder="/old-path"
                    className="font-mono flex-1 min-w-32"
                    aria-label={`Redirect ${i + 1} from path`}
                    spellCheck={false}
                  />
                  <span className="text-muted-foreground text-xs">→</span>
                  <Input
                    value={r.to}
                    onChange={(e) => {
                      const next = [...redirects];
                      next[i] = { ...r, to: e.target.value };
                      setRedirects(next);
                    }}
                    placeholder="/new-path or https://…"
                    className="font-mono flex-1 min-w-32"
                    aria-label={`Redirect ${i + 1} to target`}
                    spellCheck={false}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setRedirects(redirects.filter((_, j) => j !== i))}
                    aria-label={`Remove redirect ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Basic auth */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="basicauth-toggle" className="text-sm">Basic authentication</Label>
              <p className="text-xs text-muted-foreground">
                {s.basicAuth.hasPassword
                  ? "A password is stored (encrypted at rest)."
                  : "No password stored yet."}
              </p>
            </div>
            <Switch
              id="basicauth-toggle"
              checked={authEnabled}
              onCheckedChange={setAuthEnabled}
              aria-label="Enable basic authentication"
            />
          </div>
          {authEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="basicauth-user">User</Label>
                <Input
                  id="basicauth-user"
                  value={authUser}
                  onChange={(e) => setAuthUser(e.target.value)}
                  placeholder="admin"
                  autoComplete="off"
                  aria-invalid={!userOk}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="basicauth-pass">
                  Password {s.basicAuth.hasPassword ? "(leave blank to keep)" : ""}
                </Label>
                <Input
                  id="basicauth-pass"
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  aria-invalid={!passwordOk}
                />
              </div>
              {!userOk && (
                <p className="text-xs text-destructive sm:col-span-2">
                  User must be 1–32 characters (letters, digits, dot, underscore, dash).
                </p>
              )}
              {!passwordOk && (
                <p className="text-xs text-destructive sm:col-span-2">
                  Password must be at least 6 characters.
                </p>
              )}
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Stored AES-256-GCM encrypted; bcrypt hashing for the web server applies on the
                VPS deployment.
              </p>
            </div>
          )}
        </div>

        <Separator />

        {/* Toggles */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="cache-toggle" className="text-sm">Cache headers</Label>
              <p className="text-xs text-muted-foreground">
                Adds <code className="font-mono">Cache-Control</code> to responses.
              </p>
            </div>
            <Switch
              id="cache-toggle"
              checked={cacheEnabled}
              onCheckedChange={setCacheEnabled}
              aria-label="Enable cache headers"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="gzip-toggle" className="text-sm">Gzip</Label>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">encode gzip</code> in the vhost.
              </p>
            </div>
            <Switch
              id="gzip-toggle"
              checked={gzip}
              onCheckedChange={setGzip}
              aria-label="Enable gzip encoding"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="https-toggle" className="text-sm">Force HTTPS</Label>
              <p className="text-xs text-muted-foreground">
                301-redirects plain HTTP once a certificate is attached.
              </p>
            </div>
            <Switch
              id="https-toggle"
              checked={forceHttps}
              onCheckedChange={setForceHttps}
              aria-label="Force HTTPS redirects"
            />
          </div>

          {cacheEnabled && (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <Label htmlFor="cache-maxage" className="text-sm">max-age (seconds)</Label>
                <p className="text-xs text-muted-foreground">0 – 2 592 000 (30 days).</p>
              </div>
              <Input
                id="cache-maxage"
                value={maxAge}
                onChange={(e) => setMaxAge(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="w-24 font-mono text-right"
                aria-label="Cache-Control max-age in seconds"
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SSL tab — cert summary, upload, self-signed, attach/detach, Let's Encrypt
// ---------------------------------------------------------------------------

function SslTab({ site, onChanged }: { site: Website; onChanged: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [attachId, setAttachId] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selfSignedOpen, setSelfSignedOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [ssDomain, setSsDomain] = useState(site.domain);
  const [ssDays, setSsDays] = useState("365");

  const certsQuery = useQuery<{ certificates: CertificateInfo[] }>({
    queryKey: ["ssl-certs"],
    queryFn: () => get<{ certificates: CertificateInfo[] }>("/api/ssl"),
  });

  function invalidateCerts() {
    void queryClient.invalidateQueries({ queryKey: ["ssl-certs"] });
  }

  const attach = useMutation({
    mutationFn: (certId: string) =>
      patch<{ website: Website }>(`/api/websites/${site.id}`, { action: "attach-cert", certId }),
    onSuccess: (data) => {
      toast({
        title: "Certificate attached",
        description: `${data.website.domain} now serves TLS via ${data.website.certificate?.name}.`,
      });
      setAttachId("");
      onChanged();
    },
    onError: (e) => {
      toast({ title: "Attach failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const detach = useMutation({
    mutationFn: () => patch<{ website: Website }>(`/api/websites/${site.id}`, { action: "detach-cert" }),
    onSuccess: () => {
      toast({ title: "Certificate detached", description: `${site.domain} now serves plain HTTP.` });
      onChanged();
    },
    onError: (e) => {
      toast({ title: "Detach failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const upload = useMutation({
    mutationFn: () =>
      post<{ certificate: CertificateInfo }>("/api/ssl/upload", {
        name: uploadName.trim(),
        certPem: certPem.trim(),
        keyPem: keyPem.trim(),
      }),
    onSuccess: (data) => {
      toast({
        title: "Certificate uploaded",
        description: `${data.certificate.name} parsed and stored (key encrypted at rest).`,
      });
      setUploadOpen(false);
      setUploadName("");
      setCertPem("");
      setKeyPem("");
      invalidateCerts();
    },
    onError: (e) => {
      toast({ title: "Upload failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const selfSigned = useMutation({
    mutationFn: () =>
      post<{ certificate: CertificateInfo }>("/api/ssl/self-signed", {
        domain: ssDomain.trim().toLowerCase(),
        days: parseInt(ssDays, 10) || 365,
      }),
    onSuccess: (data) => {
      toast({
        title: "Self-signed certificate generated",
        description: `${data.certificate.subject || ssDomain} — created with openssl, stored and encrypted.`,
      });
      setSelfSignedOpen(false);
      invalidateCerts();
    },
    onError: (e) => {
      toast({ title: "Generation failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const certs = certsQuery.data?.certificates ?? [];
  const cert = site.certificate;
  const sans = cert ? parseSans(cert.sans) : [];
  const dLeft = cert?.validTo ? daysLeft(cert.validTo) : null;
  const leSnippet = [
    `# Let's Encrypt (ACME) snippet for ${site.domain} — generated by HipnoType Panel`,
    `# Applies on the VPS deployment only: ports 80/443 must be publicly reachable`,
    `# for the HTTP-01 challenge. Caddy then issues + renews the certificate automatically.`,
    ``,
    `${site.domain} {`,
    `\t# tls is obtained and renewed automatically by Caddy's ACME integration —`,
    `\t# no tls directive needed. The site's directives from the Config tab apply unchanged:`,
    `\tencode gzip`,
    `\t# root * ${site.docRoot}`,
    `\t# ...`,
    `}`,
  ].join("\n");

  return (
    <div className="space-y-4">
      {/* Attached certificate summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Certificate</CardTitle>
        </CardHeader>
        <CardContent>
          {!cert ? (
            <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0" aria-hidden />
              <p>
                No certificate attached — {site.domain} serves plain HTTP. Upload, generate or
                attach one below.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck
                    className={`h-5 w-5 shrink-0 ${
                      cert.type === "self" ? "text-amber-600 dark:text-amber-400" : "text-primary"
                    }`}
                    aria-hidden
                  />
                  <span className="font-medium truncate">{cert.name}</span>
                  <Badge variant="outline" className="cursor-default text-muted-foreground">
                    {cert.type}
                  </Badge>
                </div>
                {dLeft !== null && (
                  <Badge
                    variant="outline"
                    className={`cursor-default ${
                      dLeft <= 7
                        ? "border-destructive/50 text-destructive"
                        : dLeft <= 30
                          ? "border-amber-500/50 text-amber-700 dark:text-amber-300"
                          : "border-primary/40 text-primary"
                    }`}
                  >
                    {dLeft < 0 ? `expired ${Math.abs(dLeft)}d ago` : `${dLeft}d left`}
                  </Badge>
                )}
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Subject</dt>
                  <dd className="font-mono text-xs break-all">{cert.subject || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Issuer</dt>
                  <dd className="font-mono text-xs break-all">{cert.issuer || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Valid</dt>
                  <dd className="text-xs">
                    {fmtDate(cert.validFrom)} → {fmtDate(cert.validTo)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">SANs</dt>
                  <dd className="flex flex-wrap gap-1 pt-0.5">
                    {sans.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      sans.slice(0, 6).map((s) => (
                        <Badge
                          key={s}
                          variant="outline"
                          className="font-mono font-normal cursor-default text-muted-foreground"
                        >
                          {s}
                        </Badge>
                      ))
                    )}
                    {sans.length > 6 && (
                      <Badge variant="outline" className="cursor-default text-muted-foreground">
                        +{sans.length - 6} more
                      </Badge>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Manage certificates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5 min-w-56 flex-1">
              <Label htmlFor="attach-cert">Attach a stored certificate</Label>
              <Select value={attachId} onValueChange={setAttachId}>
                <SelectTrigger id="attach-cert" aria-label="Select a certificate to attach">
                  <SelectValue placeholder={certs.length ? "Choose certificate…" : "No certificates stored"} />
                </SelectTrigger>
                <SelectContent>
                  {certs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="max-w-72">
                        <div className="truncate font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground truncate font-mono">
                          {c.subject || c.type}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!attachId || attach.isPending}
              onClick={() => attach.mutate(attachId)}
            >
              {attach.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Attach
            </Button>
            {cert && (
              <Button
                variant="outline"
                disabled={detach.isPending}
                onClick={() => detach.mutate()}
              >
                {detach.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Detach current
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden /> Upload certificate
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSsDomain(site.domain);
                setSelfSignedOpen(true);
              }}
            >
              <KeyRound className="h-4 w-4" aria-hidden /> Generate self-signed
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Let's Encrypt — honest card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Let&apos;s Encrypt (ACME)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <p>
              Let&apos;s Encrypt issuance requires the VPS deployment with public ports 80/443
              (HTTP-01 challenge) — it cannot run inside this panel preview. The ACME
              Caddyfile snippet is generated with the site and applied by the installer.
            </p>
          </div>
          <pre
            className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs font-mono whitespace-pre"
            aria-label="Let's Encrypt ACME Caddyfile snippet"
          >
            {leSnippet}
          </pre>
        </CardContent>
      </Card>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload certificate</DialogTitle>
            <DialogDescription>
              Paste the certificate and private key in PEM format. The key is verified against
              the certificate and stored AES-256-GCM encrypted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cert-name">Name</Label>
              <Input
                id="cert-name"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="example.com — Let's Encrypt 2026"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cert-pem">Certificate (cert.pem)</Label>
                <Textarea
                  id="cert-pem"
                  value={certPem}
                  onChange={(e) => setCertPem(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  className="font-mono text-xs min-h-36"
                  spellCheck={false}
                  aria-required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-pem">Private key (key.pem)</Label>
                <Textarea
                  id="key-pem"
                  value={keyPem}
                  onChange={(e) => setKeyPem(e.target.value)}
                  placeholder="-----BEGIN PRIVATE KEY-----"
                  className="font-mono text-xs min-h-36"
                  spellCheck={false}
                  aria-required
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !uploadName.trim() ||
                !certPem.includes("-----BEGIN CERTIFICATE-----") ||
                !keyPem.includes("PRIVATE KEY-----") ||
                upload.isPending
              }
              onClick={() => upload.mutate()}
            >
              {upload.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Upload &amp; verify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Self-signed dialog */}
      <Dialog open={selfSignedOpen} onOpenChange={setSelfSignedOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate self-signed certificate</DialogTitle>
            <DialogDescription>
              Runs a real <code className="font-mono text-xs">openssl req -x509</code> for the
              domain (RSA 2048, SAN <span className="font-mono">DNS:{site.domain}</span>) and
              stores the result like an upload.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ss-domain">Domain (CN)</Label>
              <Input
                id="ss-domain"
                value={ssDomain}
                onChange={(e) => setSsDomain(e.target.value)}
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ss-days">Validity (days)</Label>
              <Input
                id="ss-days"
                value={ssDays}
                onChange={(e) => setSsDays(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="font-mono"
                aria-label="Validity in days"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelfSignedOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(ssDomain.trim()) || selfSigned.isPending
              }
              onClick={() => selfSigned.mutate()}
            >
              {selfSigned.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logs tab — access / error tails with auto-refresh
// ---------------------------------------------------------------------------

function LogsTab({ site }: { site: Website }) {
  const [type, setType] = useState<"access" | "error">("access");
  const [auto, setAuto] = useState(false);

  const logs = useQuery<LogsResponse>({
    queryKey: ["website-logs", site.id, type],
    queryFn: () =>
      get<LogsResponse>(`/api/websites/${site.id}/logs?type=${type}&lines=200`),
    refetchInterval: auto ? 10_000 : false,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">Logs</CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id={`logs-auto-${site.id}`}
                checked={auto}
                onCheckedChange={setAuto}
                aria-label="Auto-refresh logs every 10 seconds"
              />
              <Label
                htmlFor={`logs-auto-${site.id}`}
                className="text-xs text-muted-foreground whitespace-nowrap"
              >
                Auto 10s
              </Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logs.refetch()}
              aria-label="Refresh logs"
            >
              <RefreshCw
                className={`h-4 w-4 ${logs.isFetching ? "animate-spin" : ""}`}
                aria-hidden
              />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={type} onValueChange={(v) => setType(v === "error" ? "error" : "access")}>
          <TabsList>
            <TabsTrigger value="access">access.log</TabsTrigger>
            <TabsTrigger value="error">error.log</TabsTrigger>
          </TabsList>
          <TabsContent value={type} className="mt-3">
            {logs.isLoading ? (
              <div className="space-y-2" role="status" aria-label="Loading logs">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : logs.isError ? (
              <div className="py-6 text-center space-y-3" role="alert">
                <p className="text-sm text-muted-foreground">
                  Could not load logs. {errMessage(logs.error)}
                </p>
                <Button variant="outline" size="sm" onClick={() => logs.refetch()}>
                  <RefreshCw className="h-4 w-4" aria-hidden /> Retry
                </Button>
              </div>
            ) : logs.data && logs.data.lines.length > 0 ? (
              <>
                <pre
                  className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs font-mono whitespace-pre"
                  aria-label={`${type}.log tail for ${site.domain}`}
                >
                  {logs.data.lines.join("\n")}
                </pre>
                <p className="pt-2 text-xs text-muted-foreground">
                  Last {logs.data.lines.length} lines{logs.data.truncated ? " (tail truncated)" : ""}{" "}
                  of <code className="font-mono">{site.slug}/logs/{type}.log</code>.
                </p>
              </>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <ScrollText className="h-5 w-5 mx-auto mb-2 opacity-60" aria-hidden />
                {logs.data?.note || "No entries yet."}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
