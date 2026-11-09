"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { fadeUp, stagger } from "@/components/panel/motion";
import {
  AnimatedNumber,
  EmptyState,
  SectionCard,
  StatCard,
  StatusChip,
  ViewHeader,
} from "@/components/panel/primitives";
import { api, apiBase, ApiClientError, get, post } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  ArrowLeft,
  Check,
  CloudUpload,
  Download,
  FileText,
  Globe,
  Layers,
  Loader2,
  Mail,
  Network,
  Pencil,
  Plus,
  Power,
  Radar,
  RefreshCw,
  Server,
  Trash2,
  Upload,
} from "lucide-react";

// ---------------------------------------------------------------------------
// API shapes (server: src/app/api/dns/**)
// ---------------------------------------------------------------------------

interface DnsRecordRow {
  id: string;
  zoneId: string;
  type: string; // A | AAAA | CNAME | MX | TXT | SRV | CAA | NS
  name: string; // "@" or subdomain
  value: string;
  ttl: number;
  priority: number | null;
  port: number | null;
  weight: number | null;
  enabled: boolean;
  remoteId?: string | null;
  syncState?: string | null; // synced | pending | error | null (local-only zone)
  syncError?: string | null;
  proxied?: boolean;
  origin?: string; // panel | import-bind | import-cloudflare
  createdAt: string;
  updatedAt: string;
}

interface DnsZoneSummary {
  id: string;
  name: string;
  mode: string; // local | provider
  provider: string | null;
  hasToken: boolean;
  tokenMasked: string | null;
  tokenStatus: string | null; // verified | verified_read_only | unverified | null
  tokenVerifiedAt: string | null;
  lastSyncAt: string | null;
  primary: string | null;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
}

interface DnsZoneDetail extends DnsZoneSummary {
  records: DnsRecordRow[];
}

interface DnsContext {
  publicIpv4: string | null;
  publicIpv6: string | null;
  hostname: string;
  resolvers: string[];
  ipv6Only: boolean;
}

interface PropagateResult {
  name: string;
  type: string;
  localValues: string[];
  resolvers: { resolver: string; ok: boolean; values: string[]; error: string | null; ms: number; match: boolean }[];
}

interface SyncDiffItem {
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority: number | null;
  recordId?: string;
  from?: string;
}

interface SyncResult {
  dryRun: boolean;
  zoneName: string;
  diff: {
    create: SyncDiffItem[];
    update: SyncDiffItem[];
    unchanged: number;
    remoteOnly: { id: string; name: string; type: string; content: string }[];
  };
  applied?: { created: number; updated: number; failed: { name: string; error: string }[] };
}

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA", "NS"] as const;

const TYPE_VALUE_LABEL: Record<string, string> = {
  A: "IPv4 address",
  AAAA: "IPv6 address",
  CNAME: "Target domain",
  MX: "Mail server hostname",
  TXT: "Text value",
  SRV: "Target hostname",
  CAA: 'Flags, tag and value (e.g. 0 issue "letsencrypt.org")',
  NS: "Nameserver hostname",
};

const TYPE_HINT: Record<string, string> = {
  A: "Points a name at an IPv4 address.",
  AAAA: "Points a name at an IPv6 address.",
  CNAME: "Alias to another name — cannot coexist with other records at the same name.",
  MX: "Mail exchanger for the zone. Priority 0–65535 (lower = preferred).",
  TXT: "Free-form text (SPF, DKIM, verification tokens…).",
  SRV: "Service record. Name format: _service._proto (e.g. _sip._tcp).",
  CAA: 'Restricts which CAs may issue certificates, e.g. 0 issue "letsencrypt.org".',
  NS: "Delegates the name to another nameserver.",
};

/** PATCH helper (lib/api exports get/post/put/del; PATCH goes through api()). */
const patch = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

function errMessage(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Unexpected error";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "MMM d, yyyy HH:mm");
  } catch {
    return "—";
  }
}

/** Client mirror of the server zone-name normaliser for live feedback. */
function normalizeZonePreview(input: string): { ok: boolean; domain?: string; error?: string } {
  let raw = (input || "").trim().toLowerCase();
  if (!raw) return { ok: false, error: "" };
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  raw = raw.split("/")[0].split("?")[0].split("#")[0].split(":")[0].split("@").pop() || "";
  raw = raw.replace(/^\.+|\.+$/g, "").replace(/\*\./g, "");
  if (!raw) return { ok: false, error: "Enter a domain name." };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw) || raw.includes(":"))
    return { ok: false, error: "Enter a domain name, not an IP address." };
  const labels = raw.split(".");
  if (labels.length < 2) return { ok: false, error: "Enter a full domain like example.com." };
  if (labels.some((l) => !l || l.length > 63 || !/^[a-z0-9-]+$/.test(l) || l.startsWith("-") || l.endsWith("-")))
    return { ok: false, error: "Labels: letters, digits, hyphens (not leading/trailing), max 63 chars." };
  return { ok: true, domain: raw };
}

/** Record-name validation mirror ("@", "*", "sub", "a.b", "*.sub"). */
function validRecordName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/\.$/, "");
  if (!n || n.length > 254) return false;
  if (n === "@") return true;
  if (n.includes("*") && !n.startsWith("*.")) return false;
  return n
    .replace(/^\*\./, "")
    .split(".")
    .every((l) => l.length >= 1 && l.length <= 63 && /^[a-z0-9_-]+$/.test(l) && !l.startsWith("-") && !l.endsWith("-"));
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function validIpv4(v: string): boolean {
  const m = v.trim().match(IPV4_RE);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

function validIpv6(v: string): boolean {
  const s = v.trim();
  return s.includes(":") && /^[0-9a-f:]+$/i.test(s) && (s.match(/::/g)?.length ?? 0) <= 1;
}

function validHost(v: string): boolean {
  const s = v.trim().toLowerCase().replace(/\.$/, "");
  if (!s || s.length > 253) return false;
  return s.split(".").every((l) => l.length >= 1 && l.length <= 63 && /^[a-z0-9-]+$/.test(l));
}

function validPortNumber(v: number | null | undefined, min = 0, max = 65535): boolean {
  return v !== null && v !== undefined && Number.isInteger(v) && v >= min && v <= max;
}

/** Full client-side record validation → error string or null. */
function validateRecord(
  r: { type: string; name: string; value: string; ttl: number; priority: number | null; port: number | null; weight: number | null }
): string | null {
  if (!RECORD_TYPES.includes(r.type as (typeof RECORD_TYPES)[number])) return "Unsupported record type.";
  if (!validRecordName(r.name)) return "Name must be “@”, “*”, or subdomain labels (letters, digits, hyphens).";
  if (!validPortNumber(r.ttl, 30, 604800)) return "TTL must be an integer between 30 and 604800 seconds.";
  const v = r.value.trim();
  if (!v) return "Value is required.";
  switch (r.type) {
    case "A":
      return validIpv4(v) ? null : "A records need a valid IPv4 address (e.g. 203.0.113.10).";
    case "AAAA":
      return validIpv6(v) ? null : "AAAA records need a valid IPv6 address (e.g. 2001:db8::1).";
    case "CNAME":
    case "NS":
      return validHost(v) ? null : `Enter a valid hostname (e.g. ${r.type === "CNAME" ? "example.com" : "ns1.example.com"}).`;
    case "MX":
      if (!validPortNumber(r.priority, 0, 65535)) return "MX priority is required (0–65535, lower = preferred).";
      return validHost(v) ? null : "MX value must be a mail server hostname.";
    case "TXT":
      return v.length <= 4096 ? null : "TXT values are limited to 4096 characters.";
    case "SRV": {
      if (!validPortNumber(r.priority, 0, 65535)) return "SRV priority is required (0–65535).";
      if (!validPortNumber(r.weight, 0, 65535)) return "SRV weight is required (0–65535).";
      if (!validPortNumber(r.port, 1, 65535)) return "SRV port is required (1–65535).";
      if (!validHost(v)) return "SRV value must be the target hostname.";
      if (!/^_[a-z0-9-]+\._(tcp|udp|tls|sctp)\b/.test(r.name.trim().toLowerCase()))
        return 'SRV names must look like _service._proto (e.g. "_sip._tcp").';
      return null;
    }
    case "CAA":
      return /^(\d+)\s+(issue|issuewild|iodef)\s+"?.+"?$/i.test(v)
        ? null
        : 'CAA value must look like: 0 issue "letsencrypt.org".';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function DomainsView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const list = useQuery<{ zones: DnsZoneSummary[] }>({
    queryKey: ["dns-zones"],
    queryFn: () => get<{ zones: DnsZoneSummary[] }>("/api/dns/zones"),
  });

  const zones = list.data?.zones ?? [];
  const totalRecords = zones.reduce((n, z) => n + z.recordCount, 0);
  const providerZones = zones.filter((z) => z.mode === "provider").length;

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Domains & DNS"
        description="Full zone editor for the domains this panel manages — records, templates, propagation checks, BIND import/export and live Cloudflare sync."
        actions={
          <>
            <Button variant="outline" onClick={() => list.refetch()} disabled={list.isFetching} aria-label="Refresh zones">
              <RefreshCw className={`h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} aria-hidden />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Add zone
            </Button>
          </>
        }
      />

      {list.isLoading ? (
        <SectionCard contentClassName="space-y-2">
          <Skeleton className="h-14 w-full hipno-shimmer" />
          <Skeleton className="h-14 w-full hipno-shimmer" />
          <Skeleton className="h-14 w-full hipno-shimmer" />
        </SectionCard>
      ) : list.isError ? (
        <SectionCard>
          <div className="py-8 text-center space-y-3" role="alert">
            <p className="text-sm text-muted-foreground">Could not load zones. {errMessage(list.error)}</p>
            <Button variant="outline" onClick={() => list.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          </div>
        </SectionCard>
      ) : selectedId ? (
        <ZoneDetail zoneId={selectedId} onBack={() => setSelectedId(null)} onChanged={() => void list.refetch()} />
      ) : (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
          <motion.div variants={fadeUp} className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <StatCard icon={Network} label="Zones" value={<AnimatedNumber value={zones.length} />} sub="DNS zones managed here" />
            <StatCard icon={Layers} label="Records" value={<AnimatedNumber value={totalRecords} />} sub="across all zones" />
            <StatCard
              icon={CloudUpload}
              label="Provider zones"
              value={<AnimatedNumber value={providerZones} />}
              sub="sync-capable (Cloudflare)"
            />
          </motion.div>

          <motion.div variants={fadeUp}>
            <SectionCard
              title="Zones"
              description={zones.length > 0 ? `${zones.length} zone${zones.length === 1 ? "" : "s"} — click one to edit its records.` : undefined}
            >
              {zones.length === 0 ? (
                <EmptyState
                  icon={Network}
                  title="No DNS zones yet"
                  description="Add a zone to manage its records here. Local zones are edited directly; provider zones can also sync with Cloudflare through a real API token."
                  action={
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4" aria-hidden /> Add zone
                    </Button>
                  }
                />
              ) : (
                <div className="max-h-96 overflow-y-auto -mx-1 px-1">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-background z-10">
                      <tr className="text-left text-[11px] text-muted-foreground border-b">
                        <th className="py-2 pr-3 font-medium">Zone</th>
                        <th className="py-2 pr-3 font-medium">Mode</th>
                        <th className="py-2 pr-3 font-medium">Provider</th>
                        <th className="py-2 pr-3 font-medium">Records</th>
                        <th className="py-2 pr-3 font-medium">Updated</th>
                        <th className="py-2 w-8"><span className="sr-only">Open</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {zones.map((z) => (
                        <tr
                          key={z.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`Open zone ${z.name}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(z.id);
                            }
                          }}
                          onClick={() => setSelectedId(z.id)}
                          className="border-b last:border-0 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/40"
                        >
                          <td className="py-2.5 pr-3 font-mono text-xs">{z.name}</td>
                          <td className="py-2.5 pr-3">
                            <Badge
                              variant="outline"
                              className={`cursor-default ${
                                z.mode === "provider"
                                  ? "border-primary/40 text-primary"
                                  : "border-border text-muted-foreground"
                              }`}
                            >
                              {z.mode}
                            </Badge>
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                            {z.provider ?? "—"}
                            {z.mode === "provider" && (z.hasToken ? " · token ✓" : " · no token")}
                          </td>
                          <td className="py-2.5 pr-3 text-xs tabular-nums">{z.recordCount}</td>
                          <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(z.updatedAt)}</td>
                          <td className="py-2.5 text-right text-muted-foreground">›</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </motion.div>
        </motion.div>
      )}

      <AddZoneDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          void list.refetch();
          setSelectedId(id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit zone dialogs
// ---------------------------------------------------------------------------

function AddZoneDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [mode, setMode] = useState("local");
  const [provider, setProvider] = useState("cloudflare");
  const [token, setToken] = useState("");
  const [primary, setPrimary] = useState("");

  const preview = normalizeZonePreview(name);
  const providerMode = mode === "provider";
  const tokenOk = !providerMode || token.trim().length >= 20;
  const primaryOk = primary.trim() === "" || validHost(primary);

  const create = useMutation({
    mutationFn: () =>
      post<{ zone: DnsZoneDetail }>("/api/dns/zones", {
        name: name.trim(),
        mode,
        ...(providerMode ? { provider, apiToken: token.trim() || undefined } : {}),
        ...(primary.trim() ? { primary: primary.trim().toLowerCase() } : {}),
      }),
    onSuccess: (d) => {
      toast({ title: "Zone created", description: `${d.zone.name} is ready for records.` });
      onOpenChange(false);
      setName("");
      setMode("local");
      setProvider("cloudflare");
      setToken("");
      setPrimary("");
      onCreated(d.zone.id);
    },
    onError: (e) => toast({ title: "Could not create zone", description: errMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add DNS zone</DialogTitle>
          <DialogDescription>
            The zone holds the records for one domain. Local zones are edited here; provider zones can also
            sync their records to Cloudflare with an API token.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="zone-name">Zone name</Label>
            <Input
              id="zone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              aria-invalid={name.trim().length > 0 && !preview.ok}
            />
            {name.trim().length > 0 && (
              <p className={`text-xs ${preview.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`} role={preview.ok ? "status" : "alert"}>
                {preview.ok ? `Zone will be ${preview.domain}` : preview.error}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="zone-mode">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="zone-mode" aria-label="Zone mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  <div>
                    <div className="font-medium">Local zone</div>
                    <div className="text-xs text-muted-foreground">Panel-managed records, BIND import/export</div>
                  </div>
                </SelectItem>
                <SelectItem value="provider">
                  <div>
                    <div className="font-medium">Provider zone</div>
                    <div className="text-xs text-muted-foreground">Records live at a DNS provider (Cloudflare sync)</div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {providerMode && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="zone-provider">Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger id="zone-provider" aria-label="DNS provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloudflare">
                      <div>
                        <div className="font-medium">Cloudflare</div>
                        <div className="text-xs text-muted-foreground">Sync via the Cloudflare API v4</div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="zone-token">API token (optional)</Label>
                <Input
                  id="zone-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Cloudflare API token — Zone:Read + DNS:Edit"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Pasting a token verifies it against the real Cloudflare API before the zone is created (token check,
                  zone lookup, temporary write probe) — invalid tokens are rejected with the exact reason. Stored
                  AES-256-GCM encrypted and only ever shown masked. Leave empty now and add it later via “Edit zone”.
                </p>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="zone-primary">Primary nameserver (optional)</Label>
            <Input
              id="zone-primary"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder="ns1.example.com"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">Shown in the SOA record of exported BIND files.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!preview.ok || !tokenOk || !primaryOk || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Create zone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditZoneDialog({
  zone,
  open,
  onOpenChange,
  onChanged,
}: {
  zone: DnsZoneDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState(zone.mode);
  const [provider, setProvider] = useState(zone.provider ?? "cloudflare");
  const [token, setToken] = useState("");
  const [primary, setPrimary] = useState(zone.primary ?? "");
  const providerMode = mode === "provider";

  // Reinitialise the form each time the dialog opens (or the zone row changes)
  // — state adjusted during render instead of an effect (react.dev pattern).
  const formKey = `${open}:${zone.id}:${zone.updatedAt}`;
  const [lastFormKey, setLastFormKey] = useState(formKey);
  if (formKey !== lastFormKey) {
    setLastFormKey(formKey);
    if (open) {
      setMode(zone.mode);
      setProvider(zone.provider ?? "cloudflare");
      setToken("");
      setPrimary(zone.primary ?? "");
    }
  }

  const save = useMutation({
    mutationFn: () =>
      patch<{ zone: DnsZoneDetail }>(`/api/dns/zones/${zone.id}`, {
        mode,
        ...(providerMode ? { provider } : { provider: null }),
        ...(token.trim() ? { apiToken: token.trim() } : {}),
        ...(primary.trim() ? { primary: primary.trim().toLowerCase() } : { primary: null }),
      }),
    onSuccess: () => {
      toast({ title: "Zone updated" });
      onOpenChange(false);
      onChanged();
    },
    onError: (e) => toast({ title: "Could not update zone", description: errMessage(e), variant: "destructive" }),
  });

  const primaryOk = primary.trim() === "" || validHost(primary);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit zone — {zone.name}</DialogTitle>
          <DialogDescription>Change mode, provider credentials (stored encrypted) or the primary nameserver.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ez-mode">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="ez-mode" aria-label="Zone mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local zone</SelectItem>
                <SelectItem value="provider">Provider zone</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {providerMode && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ez-provider">Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger id="ez-provider" aria-label="DNS provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloudflare">Cloudflare</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ez-token">
                  API token{" "}
                  {zone.hasToken && (
                    <span className="text-muted-foreground">
                      (stored: {zone.tokenMasked}
                      {zone.tokenStatus?.startsWith("verified")
                        ? " · verified against Cloudflare"
                        : zone.tokenStatus
                          ? " · unverified"
                          : ""}
                      )
                    </span>
                  )}
                </Label>
                <Input
                  id="ez-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={zone.hasToken ? "Leave empty to keep the current token" : "Cloudflare API token — Zone:Read + DNS:Edit"}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-[11px] text-muted-foreground">
                  {token.trim()
                    ? "On save the token is verified against Cloudflare first — token check, zone lookup and a temporary write probe. Invalid or read-only tokens are rejected with the exact reason."
                    : "A new token is verified against the real Cloudflare API before it replaces the stored one."}
                </p>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="ez-primary">Primary nameserver</Label>
            <Input
              id="ez-primary"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder="ns1.example.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={primary.trim() !== "" && !primaryOk}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!primaryOk || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Zone detail
// ---------------------------------------------------------------------------

function ZoneDetail({ zoneId, onBack, onChanged }: { zoneId: string; onBack: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [recordDialog, setRecordDialog] = useState<{ open: boolean; record: DnsRecordRow | null }>({ open: false, record: null });
  const [importOpen, setImportOpen] = useState(false);
  const [importRemoteOpen, setImportRemoteOpen] = useState(false);
  const [importRemoteBusy, setImportRemoteBusy] = useState<"" | "merge" | "replace">("");
  const [importRemoteResult, setImportRemoteResult] = useState<{
    mode: string;
    remoteTotal: number;
    imported: number;
    linked: number;
    replaced: number;
    skipped: { name: string; type: string; reason: string }[];
  } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [syncDiff, setSyncDiff] = useState<SyncResult | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  const detail = useQuery<{ zone: DnsZoneDetail }>({
    queryKey: ["dns-zone", zoneId],
    queryFn: () => get<{ zone: DnsZoneDetail }>(`/api/dns/zones/${zoneId}`),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["dns-zone", zoneId] });
    void queryClient.invalidateQueries({ queryKey: ["dns-zones"] });
    onChanged();
  }

  const zone = detail.data?.zone;
  const records = zone?.records ?? [];

  const removeZone = useMutation({
    mutationFn: () => api(`/api/dns/zones/${zoneId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Zone deleted", description: `${zone?.name ?? "Zone"} and all its records were removed.` });
      setDeleteOpen(false);
      invalidate();
      onBack();
    },
    onError: (e) => toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" }),
  });

  async function downloadExport() {
    try {
      const base = apiBase();
      const path = `/api/dns/zones/${zoneId}/export`;
      const gwPort = window.__HIPNO_PORT__ || (window.__HIPNO_BASE__ ? null : 3005);
      const url = base
        ? gwPort
          ? `${base}${path}${path.includes("?") ? "&" : "?"}XTransformPort=${gwPort}`
          : `${base}${path}`
        : path;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* not json */
        }
        throw new Error(msg);
      }
      const text = await res.text();
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${zone?.name ?? "zone"}.zone`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast({ title: "Zone exported", description: `${zone?.name}.zone downloaded as a BIND zone file.` });
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "Unexpected error", variant: "destructive" });
    }
  }

  const importRemote = async (mode: "merge" | "replace") => {
    setImportRemoteBusy(mode);
    try {
      const r = await post<{
        mode: string;
        remoteTotal: number;
        imported: number;
        linked: number;
        replaced: number;
        skipped: { name: string; type: string; reason: string }[];
      }>(`/api/dns/zones/${zoneId}/import-remote`, { mode });
      setImportRemoteResult(r);
      invalidate();
      toast({
        title: "Records imported from Cloudflare",
        description: `${r.imported} new · ${r.linked} linked to existing · ${r.skipped.length} skipped.`,
      });
    } catch (e) {
      toast({ title: "Import from Cloudflare failed", description: errMessage(e), variant: "destructive" });
    } finally {
      setImportRemoteBusy("");
    }
  };

  const syncZone = async (dryRun: boolean) => {
    setSyncBusy(true);
    try {
      const d = await post<SyncResult>(`/api/dns/zones/${zoneId}/sync`, { dryRun });
      if (dryRun) {
        setSyncDiff(d);
      } else {
        const { applied } = d;
        setSyncDiff(d);
        invalidate();
        const failed = applied?.failed.length ?? 0;
        toast({
          title: failed > 0 ? "Sync finished with errors" : "Zone synced",
          description: `${applied?.created ?? 0} created · ${applied?.updated ?? 0} updated${failed ? ` · ${failed} failed` : ""}.`,
          variant: failed > 0 ? "destructive" : undefined,
        });
      }
    } catch (e) {
      toast({ title: "Sync failed", description: errMessage(e), variant: "destructive" });
    } finally {
      setSyncBusy(false);
    }
  };

  if (detail.isLoading || !zone) {
    return (
      <SectionCard contentClassName="space-y-2" aria-busy="true">
        <Skeleton className="h-10 w-64 hipno-shimmer" />
        <Skeleton className="h-32 w-full hipno-shimmer" />
        <Skeleton className="h-32 w-full hipno-shimmer" />
      </SectionCard>
    );
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <Button variant="ghost" size="sm" className="-ml-2 h-7 text-muted-foreground" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" aria-hidden /> All zones
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight font-mono">{zone.name}</h2>
            <Badge variant="outline" className={`cursor-default ${zone.mode === "provider" ? "border-primary/40 text-primary" : "text-muted-foreground"}`}>
              {zone.mode}
            </Badge>
            {zone.provider && (
              <Badge variant="outline" className="cursor-default text-muted-foreground">
                {zone.provider}
              </Badge>
            )}
            {zone.mode === "provider" &&
              (zone.hasToken ? (
                zone.tokenStatus?.startsWith("verified") ? (
                  <StatusChip status="ok" label={`token ${zone.tokenMasked} · verified`} />
                ) : (
                  <StatusChip status="warn" label={`token ${zone.tokenMasked} · unverified — re-save to verify`} />
                )
              ) : (
                <StatusChip status="warn" label="no API token" />
              ))}
            {zone.mode === "provider" && zone.lastSyncAt && (
              <span className="text-[11px] text-muted-foreground">synced {fmtDate(zone.lastSyncAt)}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {records.length} record{records.length === 1 ? "" : "s"} · updated {fmtDate(zone.updatedAt)}
            {zone.primary ? ` · primary ${zone.primary}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={downloadExport}>
            <Download className="h-4 w-4" aria-hidden /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden /> Import
          </Button>
          {zone.mode === "provider" && zone.provider === "cloudflare" && zone.hasToken && (
            <Button variant="outline" size="sm" onClick={() => { setImportRemoteResult(null); setImportRemoteOpen(true); }}>
              <CloudUpload className="h-4 w-4" aria-hidden /> From Cloudflare
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit zone
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> <span className="sr-only">Delete zone</span>
          </Button>
        </div>
      </motion.div>

      {records.length === 0 && (
        <motion.div variants={fadeUp}>
          <TemplatesSection zone={zone} onChanged={invalidate} />
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <SectionCard
          title="Records"
          description="Type · Name · Value · TTL — with per-type validation. Disabled records stay stored but are excluded from exports and syncs."
          actions={
            <Button size="sm" onClick={() => setRecordDialog({ open: true, record: null })}>
              <Plus className="h-4 w-4" aria-hidden /> Add record
            </Button>
          }
        >
          {records.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No records in this zone"
              description="Add records one by one, apply a template above, or import an existing BIND zone file."
              action={
                <Button size="sm" variant="outline" onClick={() => setRecordDialog({ open: true, record: null })}>
                  <Plus className="h-4 w-4" aria-hidden /> Add record
                </Button>
              }
            />
          ) : (
            <div className="max-h-96 overflow-y-auto -mx-1 px-1">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="text-left text-[11px] text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Value</th>
                    <th className="py-2 pr-3 font-medium">TTL</th>
                    <th className="py-2 pr-3 font-medium">{zone.records.some((r) => r.type === "SRV" || r.type === "MX") ? "Prio · W · Port" : "Priority"}</th>
                    <th className="py-2 pr-3 font-medium">State</th>
                    <th className="py-2 w-24 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/40 ${r.enabled ? "" : "opacity-60"}`}>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="font-mono cursor-default">{r.type}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {r.name === "@" ? (
                          <span>
                            <span className="text-muted-foreground">@&nbsp;=&nbsp;</span>
                            {zone.name}
                          </span>
                        ) : (
                          <span>
                            {r.name}
                            <span className="text-muted-foreground">.{zone.name}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs break-all max-w-[16rem] lg:max-w-xs" title={r.value}>
                        {r.value}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{r.ttl}s</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {r.type === "SRV"
                          ? `${r.priority ?? "—"} · ${r.weight ?? "—"} · ${r.port ?? "—"}`
                          : r.priority ?? "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusChip status={r.enabled ? "active" : "disabled"} label={r.enabled ? "enabled" : "disabled"} />
                          {zone.mode === "provider" && r.syncState && (
                            <span title={r.syncError || (r.syncState === "synced" ? "This record exists in Cloudflare with the same value" : r.syncState === "pending" ? "Waiting to be pushed to Cloudflare — run Sync" : r.syncError || "Cloudflare error")}>
                              <StatusChip
                                status={r.syncState === "synced" ? "ok" : r.syncState === "error" ? "fail" : "warn"}
                                label={r.syncState === "synced" ? "in Cloudflare" : r.syncState === "error" ? "sync error" : "pending sync"}
                              />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <div className="inline-flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Edit ${r.type} record ${r.name}`}
                            onClick={() => setRecordDialog({ open: true, record: r })}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={r.enabled ? `Disable ${r.type} record ${r.name}` : `Enable ${r.type} record ${r.name}`}
                            onClick={() =>
                              patch(`/api/dns/records/${r.id}`, { enabled: !r.enabled })
                                .then(invalidate)
                                .catch((e) => toast({ title: "Action failed", description: errMessage(e), variant: "destructive" }))
                            }
                          >
                            <Power className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={`Delete ${r.type} record ${r.name}`}
                            onClick={() => {
                              api(`/api/dns/records/${r.id}`, { method: "DELETE" })
                                .then(() => {
                                  toast({ title: "Record deleted", description: `${r.type} ${r.name} removed from ${zone.name}.` });
                                  invalidate();
                                })
                                .catch((e) => toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" }));
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </motion.div>

      {zone.provider === "cloudflare" && (
        <motion.div variants={fadeUp}>
          <CloudflareSyncSection
            zone={zone}
            busy={syncBusy}
            onSync={syncZone}
            diff={syncDiff}
            onDiffClose={() => setSyncDiff(null)}
          />
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <PropagationChecker zone={zone} />
      </motion.div>

      <RecordDialog
        zoneId={zone.id}
        zoneName={zone.name}
        record={recordDialog.record}
        open={recordDialog.open}
        onOpenChange={(o) => setRecordDialog({ open: o, record: o ? recordDialog.record : null })}
        onChanged={invalidate}
      />
      <ImportDialog zone={zone} open={importOpen} onOpenChange={setImportOpen} onChanged={invalidate} />
      <ImportRemoteDialog
        zone={zone}
        open={importRemoteOpen}
        onOpenChange={setImportRemoteOpen}
        busy={importRemoteBusy}
        result={importRemoteResult}
        onRun={importRemote}
      />
      <EditZoneDialog zone={zone} open={editOpen} onOpenChange={setEditOpen} onChanged={invalidate} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete zone {zone.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the zone and its {records.length} record{records.length === 1 ? "" : "s"} from the panel.
              Records already published at an external provider are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                removeZone.mutate();
              }}
            >
              {removeZone.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Delete zone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Record add/edit dialog (per-type validation)
// ---------------------------------------------------------------------------

function RecordDialog({
  zoneId,
  zoneName,
  record,
  open,
  onOpenChange,
  onChanged,
}: {
  zoneId: string;
  zoneName: string;
  record: DnsRecordRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState("A");
  const [name, setName] = useState("@");
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState("3600");
  const [priority, setPriority] = useState("10");
  const [weight, setWeight] = useState("0");
  const [port, setPort] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  // Reinitialise the form each time the dialog opens (or the edited record
  // changes) — state adjusted during render instead of an effect.
  const formKey = `${open}:${record?.id ?? "new"}:${record?.updatedAt ?? ""}`;
  const [lastFormKey, setLastFormKey] = useState(formKey);
  if (formKey !== lastFormKey) {
    setLastFormKey(formKey);
    if (open) {
      setServerError(null);
      if (record) {
        setType(record.type);
        setName(record.name);
        setValue(record.value);
        setTtl(String(record.ttl));
        setPriority(record.priority !== null ? String(record.priority) : "10");
        setWeight(record.weight !== null ? String(record.weight) : "0");
        setPort(record.port !== null ? String(record.port) : "");
      } else {
        setType("A");
        setName("@");
        setValue("");
        setTtl("3600");
        setPriority("10");
        setWeight("0");
        setPort("");
      }
    }
  }

  const draft = {
    type,
    name: name.trim(),
    value: value.trim(),
    ttl: Number(ttl) || 0,
    priority: ["MX", "SRV"].includes(type) ? Number(priority) : null,
    port: type === "SRV" ? Number(port) || null : null,
    weight: type === "SRV" ? Number(weight) || null : null,
  };
  const error = validateRecord(draft);

  const save = useMutation({
    mutationFn: () =>
      record
        ? patch<{ record: DnsRecordRow }>(`/api/dns/records/${record.id}`, draft)
        : post<{ record: DnsRecordRow }>(`/api/dns/zones/${zoneId}/records`, draft),
    onSuccess: (d) => {
      toast({
        title: record ? "Record updated" : "Record added",
        description: `${d.record.type} ${d.record.name}.${zoneName}`,
      });
      onOpenChange(false);
      onChanged();
    },
    onError: (e) => setServerError(errMessage(e)),
  });

  const needsPriority = type === "MX" || type === "SRV";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record ? `Edit ${record.type} record` : "Add record"} — {zoneName}</DialogTitle>
          <DialogDescription>{TYPE_HINT[type]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rec-type">Type</Label>
              <Select value={type} onValueChange={setType} disabled={!!record}>
                <SelectTrigger id="rec-type" aria-label="Record type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECORD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      <span className="font-mono">{t}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-name">Name</Label>
              <Input
                id="rec-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === "SRV" ? "_sip._tcp" : "@"}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={name.trim().length > 0 && !!error?.startsWith("Name")}
              />
              <p className="text-xs text-muted-foreground">
                “@” is the zone apex; anything else is a label under <span className="font-mono">{zoneName}</span>.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rec-value">{TYPE_VALUE_LABEL[type]}</Label>
            <Input
              id="rec-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                type === "A"
                  ? "203.0.113.10"
                  : type === "AAAA"
                    ? "2001:db8::1"
                    : type === "CNAME"
                      ? zoneName
                      : type === "MX"
                        ? `mail.${zoneName}`
                        : type === "TXT"
                          ? "v=spf1 mx -all"
                          : type === "SRV"
                            ? `sip.${zoneName}`
                            : type === "CAA"
                              ? '0 issue "letsencrypt.org"'
                              : `ns1.${zoneName}`
              }
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="rec-ttl">TTL (seconds)</Label>
              <Input id="rec-ttl" type="number" min={30} max={604800} value={ttl} onChange={(e) => setTtl(e.target.value)} />
            </div>
            {needsPriority && (
              <div className="space-y-2">
                <Label htmlFor="rec-prio">Priority</Label>
                <Input id="rec-prio" type="number" min={0} max={65535} value={priority} onChange={(e) => setPriority(e.target.value)} />
              </div>
            )}
            {type === "SRV" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rec-weight">Weight</Label>
                  <Input id="rec-weight" type="number" min={0} max={65535} value={weight} onChange={(e) => setWeight(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rec-port">Port</Label>
                  <Input id="rec-port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
                </div>
              </>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {serverError && (
            <p className="text-xs text-destructive" role="alert">
              {serverError}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!!error || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {record ? "Save changes" : "Add record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Templates (empty zone)
// ---------------------------------------------------------------------------

function TemplatesSection({ zone, onChanged }: { zone: DnsZoneDetail; onChanged: () => void }) {
  const { toast } = useToast();
  const [googleToken, setGoogleToken] = useState("");
  const [applying, setApplying] = useState<string | null>(null);

  const ctx = useQuery<DnsContext>({
    queryKey: ["dns-context"],
    queryFn: () => get<DnsContext>("/api/websites/dns-context"),
  });

  const v4 = ctx.data?.publicIpv4 ?? null;
  const v6 = ctx.data?.publicIpv6 ?? null;
  const hostname = ctx.data?.hostname ?? zone.name;

  type TemplateRecord = { type: string; name: string; value: string; ttl: number; priority?: number | null; port?: number | null; weight?: number | null };
  const templates: { key: string; icon: typeof Globe; title: string; description: string; extra?: "google"; records: TemplateRecord[]; disabled?: boolean; disabledReason?: string }[] = [
    {
      key: "website",
      icon: Globe,
      title: "Website",
      description: v4
        ? `A @ → ${v4} and CNAME www → ${zone.name} — the standard set for a site hosted on this server.`
        : v6
          ? `AAAA @ → ${v6} and CNAME www → ${zone.name} — this server has no public IPv4.`
          : "Waiting for this server's public IP to be detected…",
      disabled: !v4 && !v6,
      disabledReason: "Public IP not detected yet — add records manually or retry in a moment.",
      records: [
        ...(v4 ? [{ type: "A", name: "@", value: v4, ttl: 300 }] : []),
        ...(v6 && !v4 ? [{ type: "AAAA", name: "@", value: v6, ttl: 300 }] : []),
        { type: "CNAME", name: "www", value: zone.name, ttl: 300 },
      ],
    },
    {
      key: "mail",
      icon: Mail,
      title: "Mail server",
      description: `MX @ → ${hostname} (10), SPF “v=spf1 mx -all” and a DMARC policy — the minimum for sending mail from this domain.`,
      records: [
        { type: "MX", name: "@", value: hostname, ttl: 3600, priority: 10 },
        { type: "TXT", name: "@", value: "v=spf1 mx -all", ttl: 3600 },
        { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=quarantine", ttl: 3600 },
      ],
    },
    {
      key: "google",
      icon: Server,
      title: "Google Workspace",
      description: "MX → smtp.google.com. and your Google verification TXT — paste the google-site-verification value below.",
      extra: "google",
      records: [
        { type: "MX", name: "@", value: "smtp.google.com", ttl: 3600, priority: 1 },
        { type: "TXT", name: "@", value: googleToken.trim(), ttl: 3600 },
      ],
    },
  ];

  async function applyTemplate(key: string, records: TemplateRecord[]) {
    setApplying(key);
    try {
      let ok = 0;
      for (const r of records) {
        if (!r.value) continue;
        await post(`/api/dns/zones/${zone.id}/records`, r);
        ok++;
      }
      if (ok === 0) throw new Error("Nothing to add — fill in the required values first.");
      toast({ title: "Template applied", description: `${ok} records added to ${zone.name}.` });
      onChanged();
    } catch (e) {
      toast({ title: "Template failed", description: errMessage(e), variant: "destructive" });
    } finally {
      setApplying(null);
    }
  }

  return (
    <SectionCard
      title="Quick templates"
      description={`${zone.name} is empty — start from a common record set, then fine-tune individual records.`}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {templates.map((t) => {
          const needsToken = t.extra === "google" && !googleToken.trim();
          const disabled = t.disabled || (t.extra === "google" && needsToken);
          return (
            <div
              key={t.key}
              className="rounded-xl border p-4 space-y-3 flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/20"
            >
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg grid place-items-center bg-primary/10 text-primary">
                  <t.icon className="h-4 w-4" aria-hidden />
                </div>
                <p className="text-sm font-medium">{t.title}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed flex-1">{t.description}</p>
              {t.extra === "google" && (
                <Input
                  value={googleToken}
                  onChange={(e) => setGoogleToken(e.target.value)}
                  placeholder="google-site-verification=…"
                  aria-label="Google verification TXT value"
                  className="font-mono text-xs"
                />
              )}
              <Button
                size="sm"
                variant={t.key === "website" ? "default" : "outline"}
                className="w-full"
                disabled={disabled || applying !== null}
                onClick={() => applyTemplate(t.key, t.records)}
                title={t.disabledReason}
              >
                {applying === t.key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                {t.extra === "google" && needsToken ? "Paste verification value" : "Apply template"}
              </Button>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Propagation checker
// ---------------------------------------------------------------------------

function PropagationChecker({ zone }: { zone: DnsZoneDetail }) {
  const { toast } = useToast();
  const [name, setName] = useState("@");
  const [type, setType] = useState("A");
  const [result, setResult] = useState<PropagateResult | null>(null);
  const [checking, setChecking] = useState(false);

  const ctx = useQuery<DnsContext>({
    queryKey: ["dns-context"],
    queryFn: () => get<DnsContext>("/api/websites/dns-context"),
    staleTime: 60_000,
  });

  async function run() {
    setChecking(true);
    try {
      const d = await post<PropagateResult>("/api/dns/propagate", {
        zoneId: zone.id,
        name: name.trim() || "@",
        type,
      });
      setResult(d);
    } catch (e) {
      toast({ title: "Check failed", description: errMessage(e), variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }

  return (
    <SectionCard
      title="Propagation checker"
      description={
        ctx.data?.resolvers?.length
          ? `Queries ${ctx.data.resolvers.join(", ")} directly and compares their answers with this zone's local records.`
          : "Queries public resolvers directly and compares their answers with this zone's local records."
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[10rem]">
          <Label htmlFor="prop-name">Name</Label>
          <Input
            id="prop-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="@ or www or full name"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5 w-28">
          <Label htmlFor="prop-type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="prop-type" aria-label="Record type to query">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECORD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  <span className="font-mono">{t}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => run()} disabled={checking}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Radar className="h-4 w-4 mr-1.5" aria-hidden />}
          Check
        </Button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <p className="font-mono text-[13px] break-all">
              {result.type} {result.name}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Local zone value{result.localValues.length === 1 ? "" : "s"}:{" "}
              {result.localValues.length ? (
                <span className="font-mono break-all">{result.localValues.join(" · ")}</span>
              ) : (
                "none — no matching record in this zone"
              )}
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <ul className="divide-y text-xs">
              {result.resolvers.map((r) => (
                <li key={r.resolver} className="px-3.5 py-2.5 flex flex-wrap items-start gap-2.5">
                  <span className="font-mono text-muted-foreground w-16 shrink-0 pt-0.5">{r.resolver}</span>
                  <span
                    className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${
                      !r.ok ? "bg-red-500" : r.match ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    {!r.ok ? (
                      <span className="text-red-600 dark:text-red-400">{r.error || "query failed"}</span>
                    ) : r.values.length === 0 ? (
                      <span className="text-muted-foreground">no {result.type} records published yet</span>
                    ) : (
                      <div className="space-y-1">
                        {r.values.map((v, i) => (
                          <p key={i} className="font-mono break-all">
                            {v}
                            {result.localValues.length > 0 && (
                              <span
                                className={`ml-2 font-sans ${
                                  r.match ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                                }`}
                              >
                                {r.match ? "matches local" : "differs from local"}
                              </span>
                            )}
                          </p>
                        ))}
                      </div>
                    )}
                    <p className="text-[10.5px] text-muted-foreground mt-0.5">{r.ms} ms</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Resolvers answer independently — a record visible on one but missing on another means it is still
            propagating (or negative-cached). TTLs of 300 s or less converge fastest.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Cloudflare sync
// ---------------------------------------------------------------------------

function CloudflareSyncSection({
  zone,
  busy,
  onSync,
  diff,
  onDiffClose,
}: {
  zone: DnsZoneDetail;
  busy: boolean;
  onSync: (dryRun: boolean) => void;
  diff: SyncResult | null;
  onDiffClose: () => void;
}) {
  const enabledRecords = useMemo(() => zone.records.filter((r) => r.enabled), [zone.records]);

  return (
    <SectionCard
      title="Cloudflare sync"
      description={`Pushes this zone's ${enabledRecords.length} enabled record${enabledRecords.length === 1 ? "" : "s"} to Cloudflare through the real API v4 — nothing is applied before you review the diff.`}
      actions={
        zone.hasToken ? (
          <Button size="sm" onClick={() => onSync(true)} disabled={busy || enabledRecords.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4 mr-1.5" aria-hidden />}
            Sync zone
          </Button>
        ) : undefined
      }
    >
      {!zone.hasToken ? (
        <EmptyState
          icon={CloudUpload}
          title="No Cloudflare API token stored"
          description={
            <>
              Sync needs a token with <span className="font-mono">Zone:Read</span> and{" "}
              <span className="font-mono">DNS:Edit</span> permissions. Create one in Cloudflare under My Profile → API Tokens,
              then add it via <strong>Edit zone</strong> — it is stored encrypted and only shown masked.
            </>
          }
        />
      ) : enabledRecords.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Add records to this zone first — sync pushes local records to Cloudflare.
        </p>
      ) : (
        <div className="text-sm text-muted-foreground space-y-1.5">
          <p className="flex items-start gap-2">
            <Check className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
            Token stored ({zone.tokenMasked}) — “Sync zone” fetches the live Cloudflare records first and shows a diff preview.
          </p>
          <p className="flex items-start gap-2">
            <Check className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
            Records that exist only at Cloudflare are listed in the preview and left untouched.
          </p>
        </div>
      )}

      <Dialog open={!!diff} onOpenChange={(o) => (o ? undefined : onDiffClose())}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cloudflare sync — {zone.name}</DialogTitle>
            <DialogDescription>
              {diff?.dryRun
                ? "Review what would change at Cloudflare before anything is applied."
                : "Result of the applied sync."}
            </DialogDescription>
          </DialogHeader>
          {diff && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums">{diff.diff.create.length}</p>
                  <p className="text-[11px] text-muted-foreground">to create</p>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums">{diff.diff.update.length}</p>
                  <p className="text-[11px] text-muted-foreground">to update</p>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums">{diff.diff.unchanged}</p>
                  <p className="text-[11px] text-muted-foreground">already in sync</p>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums">{diff.diff.remoteOnly.length}</p>
                  <p className="text-[11px] text-muted-foreground">Cloudflare-only</p>
                </div>
              </div>

              {(diff.diff.create.length > 0 || diff.diff.update.length > 0) && (
                <div className="max-h-72 overflow-y-auto rounded-lg border">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-background">
                      <tr className="text-left text-[11px] text-muted-foreground border-b">
                        <th className="py-2 px-3 font-medium">Action</th>
                        <th className="py-2 px-3 font-medium">Record</th>
                        <th className="py-2 px-3 font-medium">Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.diff.create.map((c, i) => (
                        <tr key={`c-${i}`} className="border-b last:border-0">
                          <td className="py-2 px-3">
                            <StatusChip status="pass" label="create" />
                          </td>
                          <td className="py-2 px-3 font-mono text-xs">
                            {c.type} {c.name}
                          </td>
                          <td className="py-2 px-3 font-mono text-xs break-all max-w-[14rem]">{c.content}</td>
                        </tr>
                      ))}
                      {diff.diff.update.map((u, i) => (
                        <tr key={`u-${i}`} className="border-b last:border-0">
                          <td className="py-2 px-3">
                            <StatusChip status="warn" label="update" />
                          </td>
                          <td className="py-2 px-3 font-mono text-xs">
                            {u.type} {u.name}
                          </td>
                          <td className="py-2 px-3 font-mono text-xs break-all max-w-[14rem]">
                            <span className="text-red-600 dark:text-red-400 line-through">{u.from}</span>
                            <span className="mx-1.5 text-muted-foreground">→</span>
                            {u.content}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {diff.diff.remoteOnly.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Exists at Cloudflare but not in this zone (left untouched):</p>
                  <ul className="space-y-0.5">
                    {diff.diff.remoteOnly.map((r) => (
                      <li key={r.id} className="font-mono">
                        {r.type} {r.name} → {r.content}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {diff.applied && (
                <div
                  className={`rounded-lg border px-4 py-3 text-sm ${
                    diff.applied.failed.length ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.06]"
                  }`}
                  role="status"
                >
                  <p className="font-medium">
                    {diff.applied.created} created · {diff.applied.updated} updated
                    {diff.applied.failed.length ? ` · ${diff.applied.failed.length} failed` : ""}
                  </p>
                  {diff.applied.failed.length > 0 && (
                    <ul className="mt-1.5 space-y-1 text-xs">
                      {diff.applied.failed.map((f, i) => (
                        <li key={i}>
                          <span className="font-mono">{f.name}</span>: {f.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={onDiffClose}>
                  Close
                </Button>
                {diff.dryRun && (diff.diff.create.length > 0 || diff.diff.update.length > 0) && (
                  <Button onClick={() => onSync(false)} disabled={busy}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Apply {diff.diff.create.length + diff.diff.update.length} change
                    {diff.diff.create.length + diff.diff.update.length === 1 ? "" : "s"}
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// BIND import dialog
// ---------------------------------------------------------------------------

function ImportRemoteDialog({
  zone,
  open,
  onOpenChange,
  busy,
  result,
  onRun,
}: {
  zone: DnsZoneDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: "" | "merge" | "replace";
  result: {
    mode: string;
    remoteTotal: number;
    imported: number;
    linked: number;
    replaced: number;
    skipped: { name: string; type: string; reason: string }[];
  } | null;
  onRun: (mode: "merge" | "replace") => void;
}) {
  const isCloudflare = zone.provider === "cloudflare";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import records from Cloudflare</DialogTitle>
          <DialogDescription>
            Pulls every record the API token can see for <span className="font-mono">{zone.name}</span> into the panel
            {isCloudflare ? " — priority, SRV parts and proxied state are preserved" : ""}. Nothing is deleted in Cloudflare.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/40 p-3 space-y-1">
              <p className="font-medium">
                {result.imported} imported · {result.linked} linked · {result.skipped.length} skipped
                {result.mode === "replace" && result.replaced > 0 ? ` · ${result.replaced} local-only records replaced` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                Cloudflare listed {result.remoteTotal} records in the zone. Imported records are marked
                “in Cloudflare” — edit them here and changes push straight back.
              </p>
            </div>
            {result.skipped.length > 0 && (
              <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground space-y-1">
                {result.skipped.map((s, i) => (
                  <p key={i} className="font-mono">
                    {s.type} {s.name} — {s.reason}
                  </p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-1">
              <p>
                <span className="font-medium text-foreground">Merge</span> — keep what the panel already has and add the
                Cloudflare records that are missing. Records that exist on both sides get linked (edits will push to
                Cloudflare from now on). Recommended.
              </p>
              <p>
                <span className="font-medium text-destructive">Replace</span> — make the panel mirror Cloudflare exactly:
                local-only records are <span className="text-destructive">deleted from the panel</span> first. Cloudflare
                itself is never modified.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!!busy}
                onClick={() => onRun("replace")}
              >
                {busy === "replace" && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
                Replace panel records
              </Button>
              <Button disabled={!!busy} onClick={() => onRun("merge")}>
                {busy === "merge" && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
                Merge (recommended)
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  zone,
  open,
  onOpenChange,
  onChanged,
}: {
  zone: DnsZoneDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [mode, setMode] = useState("replace");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setText("");
    setError(null);
    setMode("replace");
  }

  const run = useMutation({
    mutationFn: () => post<{ imported: number; replaced: number }>(`/api/dns/zones/${zone.id}/import`, { text, mode }),
    onSuccess: (d) => {
      toast({
        title: "Zone file imported",
        description: `${d.imported} record${d.imported === 1 ? "" : "s"} imported${mode === "replace" ? ` (${d.replaced} previous removed)` : ""}.`,
      });
      onOpenChange(false);
      reset();
      onChanged();
    },
    onError: (e) => setError(errMessage(e)),
  });

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
          <DialogTitle>Import BIND zone file — {zone.name}</DialogTitle>
          <DialogDescription>
            Paste a standard BIND zone file. Supported: <span className="font-mono">$TTL</span>,{" "}
            <span className="font-mono">$ORIGIN</span> and A, AAAA, CNAME, MX, TXT, NS records. SOA lines are
            skipped. Errors are reported with exact line numbers — nothing is imported unless the whole file parses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bind-text">Zone file contents</Label>
            <Textarea
              id="bind-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              placeholder={`$ORIGIN ${zone.name}.\n$TTL 3600\n@ 3600 IN A 203.0.113.10\nwww 300 IN CNAME ${zone.name}.\n@ 3600 IN TXT "v=spf1 mx -all"`}
              className="font-mono text-xs min-h-52"
              spellCheck={false}
              aria-label="BIND zone file text"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bind-mode">Import mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="bind-mode" aria-label="Import mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">Replace — delete existing records, import the file</SelectItem>
                <SelectItem value="merge">Merge — keep existing records, add parsed ones</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!text.trim() || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
            Parse &amp; import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
