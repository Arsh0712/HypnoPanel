"use client";

import { useEffect, useRef, useState } from "react";
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
import { api, ApiClientError, get, post, put } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AtSign,
  Check,
  Copy,
  Forward,
  KeyRound,
  Loader2,
  Mail,
  MailCheck,
  Plus,
  Power,
  Radar,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Ticket,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// API shapes (server: src/app/api/mail/**)
// ---------------------------------------------------------------------------

interface MailboxRow {
  id: string;
  domainId: string;
  localPart: string;
  quotaMb: number;
  usedMb: number;
  enabled: boolean;
  ratePerHour: number;
  createdAt: string;
  updatedAt: string;
}

interface AliasRow {
  id: string;
  domainId: string;
  source: string;
  destination: string;
  createdAt: string;
}

interface MailDomainRow {
  id: string;
  domain: string;
  enabled: boolean;
  catchAll: string | null;
  dkimSelector: string;
  dkimPublic: string | null;
  dmarcPolicy: string; // none | quarantine | reject
  mtaSts: boolean;
  createdAt: string;
  mailboxes: MailboxRow[];
  aliases: AliasRow[];
}

interface RelayInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  passwordMasked: string | null;
  hasPassword: boolean;
  fromEmail: string | null;
  enabled: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
}

interface RecordCheck {
  status: "pass" | "warn" | "fail";
  found: string[];
  expected: string;
  detail: string;
}

interface MailCheckResponse {
  at: number;
  hostname: string;
  ips: { v4: string | null; v6: string | null };
  checks: { key: string; title: string; status: "pass" | "warn" | "fail"; detail: string }[];
  ports: { port: number; host: string; purpose: string; note: string; open: boolean; ms: number | null }[];
  dnsbl: { ip: string | null; lists: { name: string; listed: boolean; code: string | null; detail: string }[] } | null;
  domains: { domain: string; spf: RecordCheck; dmarc: RecordCheck; dkim: RecordCheck }[];
}

interface VerifyDomainResponse {
  domain: string;
  spf: RecordCheck;
  dmarc: RecordCheck;
  dkim: RecordCheck;
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
    return format(new Date(iso), "MMM d, yyyy HH:mm");
  } catch {
    return "—";
  }
}

/** Client mirror of the server domain normaliser for live feedback. */
function normalizeDomainPreview(input: string): { ok: boolean; domain?: string; error?: string } {
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

function copyText(text: string, what: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => window.dispatchEvent(new CustomEvent("hipno-copy", { detail: what })))
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function EmailView() {
  return (
    <div className="space-y-6">
      <ViewHeader
        title="Email"
        description="Deliverability diagnostics for this server (PTR, ports, blocklists) and mail domain management — mailboxes, aliases, DKIM and SMTP relay."
      />
      <Tabs defaultValue="readiness">
        <TabsList>
          <TabsTrigger value="readiness">
            <Radar className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Readiness
          </TabsTrigger>
          <TabsTrigger value="server">
            <Server className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Mail server
          </TabsTrigger>
        </TabsList>
        <TabsContent value="readiness">
          <ReadinessTab />
        </TabsContent>
        <TabsContent value="server">
          <MailServerTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readiness tab (spec §5.17 diagnostics — every check is real)
// ---------------------------------------------------------------------------

const PORT_PURPOSE: Record<number, { purpose: string; note: string }> = {
  25: {
    purpose: "SMTP relay (MX delivery)",
    note: "Direct outbound delivery to other mail servers. Many VPS providers block port 25 by default — ask your provider to unblock it, or deliver through the SMTP relay in the Mail server tab.",
  },
  587: {
    purpose: "Submission · STARTTLS",
    note: "The recommended port for authenticated mail submission.",
  },
  465: {
    purpose: "SMTPS · implicit TLS",
    note: "Legacy implicit-TLS submission port; prefer 587 unless your relay requires it.",
  },
  2525: {
    purpose: "Alternative submission",
    note: "Fallback submission port, useful when 587 is blocked; accepted by many relay providers.",
  },
  993: { purpose: "IMAPS", note: "Encrypted IMAP for reading mail." },
  995: { purpose: "POP3S", note: "Encrypted POP3 for reading mail." },
};

function ReadinessTab() {
  const { toast } = useToast();
  const [result, setResult] = useState<MailCheckResponse | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function run(announce: boolean) {
    setRunning(true);
    setError(null);
    try {
      const d = await post<MailCheckResponse>("/api/mail/check");
      setResult(d);
      if (announce) toast({ title: "Checks finished", description: `${d.checks.filter((c) => c.status === "pass").length} of ${d.checks.length} server checks passed.` });
    } catch (e) {
      setError(errMessage(e));
      if (announce) toast({ title: "Checks failed", description: errMessage(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run(false);
  }, []);

  const pass = result?.checks.filter((c) => c.status === "pass").length ?? 0;
  const warn = result?.checks.filter((c) => c.status === "warn").length ?? 0;
  const fail = result?.checks.filter((c) => c.status === "fail").length ?? 0;

  // PTR ticket template appears whenever reverse DNS is missing or mismatched
  const ptrCheck = result?.checks.find((c) => c.key.startsWith("ptr_"));
  const fcrdnsCheck = result?.checks.find((c) => c.key.startsWith("fcrdns_"));
  const ptrProblem =
    !!result &&
    [ptrCheck, fcrdnsCheck, ...result.checks.filter((c) => c.key === "hostname")].some((c) => c && c.status !== "pass");
  const ticketIp = result?.ips.v4 || result?.ips.v6 || "<server-ip>";
  const ticket = [
    "Hello,",
    "",
    `Please set the reverse DNS (PTR) for the IP address ${ticketIp} on my server to:`,
    "",
    `    ${result?.hostname ?? "<hostname>"}`,
    "",
    `The hostname has a matching forward record that resolves back to ${ticketIp} (forward-confirmed reverse DNS), which is required for reliable outbound mail delivery.`,
    "",
    "Thank you.",
  ].join("\n");

  if (error) {
    return (
      <SectionCard>
        <div className="py-8 text-center space-y-3" role="alert">
          <p className="text-sm text-muted-foreground">Readiness checks failed. {error}</p>
          <Button variant="outline" onClick={() => void run(true)}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Retry
          </Button>
        </div>
      </SectionCard>
    );
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {result ? (
            <>
              <span className="font-mono">{result.ips.v4 ?? "no IPv4 detected"}</span>
              <span aria-hidden>·</span>
              <span className="font-mono">{result.hostname}</span>
              <span aria-hidden>·</span>
              <span>checked {fmtDate(new Date(result.at).toISOString())}</span>
            </>
          ) : (
            <span>Real PTR, port, blocklist and DNS checks against this server and your mail domains.</span>
          )}
        </div>
        <Button onClick={() => void run(true)} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Radar className="h-4 w-4 mr-1.5" aria-hidden />}
          Run checks
        </Button>
      </motion.div>

      {(!result || running) && !result ? (
        <SectionCard contentClassName="space-y-2" aria-busy="true">
          <p className="text-sm text-muted-foreground" role="status">
            Running reverse DNS, FCrDNS, outbound port, DNSBL and per-domain checks…
          </p>
          <Skeleton className="h-20 w-full hipno-shimmer" />
          <Skeleton className="h-20 w-full hipno-shimmer" />
          <Skeleton className="h-20 w-full hipno-shimmer" />
        </SectionCard>
      ) : result ? (
        <>
          <motion.div variants={fadeUp} className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <StatCard icon={ShieldCheck} label="Passing" value={<AnimatedNumber value={pass} />} sub={`${result.checks.length} server checks`} />
            <StatCard icon={Radar} label="Warnings" value={<AnimatedNumber value={warn} />} sub="need attention" />
            <StatCard icon={Mail} label="Failures" value={<AnimatedNumber value={fail} />} sub="blocking deliverability" />
          </motion.div>

          {ptrProblem && (
            <motion.div variants={fadeUp}>
              <SectionCard
                title="Reverse DNS support ticket"
                description="PTR records can only be set by the company that owns the IP address — no panel can change them. Copy this into a support ticket with your provider."
              >
                <pre className="rounded-lg border bg-muted/30 p-4 text-xs font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                  {ticket}
                </pre>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Button size="sm" variant="outline" onClick={() => copyText(ticket, "PTR support ticket")}>
                    <Copy className="h-4 w-4" aria-hidden /> Copy ticket text
                  </Button>
                  <CopyEcho />
                </div>
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                  <strong>Cloudflare Email Routing workaround:</strong> while the PTR is pending,{" "}
                  <span className="font-medium">Cloudflare Email Routing</span> can receive inbound mail for your
                  domain and forward it to an existing address — no mail server or PTR needed. For outbound, send
                  through the SMTP relay configured in the Mail server tab.
                </p>
              </SectionCard>
            </motion.div>
          )}

          <motion.div variants={fadeUp}>
            <SectionCard title="Server checks" description="PTR, forward-confirmed reverse DNS and hostname alignment — the foundation of mail deliverability.">
              <div className="grid gap-3 md:grid-cols-2">
                {result.checks.map((c) => (
                  <div
                    key={c.key}
                    className="rounded-lg border p-4 space-y-2 transition-all duration-300 hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{c.title}</p>
                      <StatusChip status={c.status} />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed break-words">{c.detail}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </motion.div>

          <motion.div variants={fadeUp}>
            <SectionCard
              title="Outbound port connectivity"
              description="Real TCP connects from this server to Google's mail infrastructure — the honest way to know what your provider lets through."
            >
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] text-muted-foreground border-b bg-muted/30">
                      <th className="py-2 px-3 font-medium">Port</th>
                      <th className="py-2 px-3 font-medium">Purpose</th>
                      <th className="py-2 px-3 font-medium">Target</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.ports.map((p) => (
                      <tr key={p.port} className="border-b last:border-0">
                        <td className="py-2.5 px-3 font-mono font-medium">{p.port}</td>
                        <td className="py-2.5 px-3">
                          <p>{p.purpose}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed max-w-md">{p.note}</p>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{p.host}</td>
                        <td className="py-2.5 px-3">
                          {p.open ? (
                            <StatusChip status="pass" label={`open · ${p.ms ?? "?"} ms`} />
                          ) : (
                            <StatusChip status="fail" label="blocked or unreachable from this server" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                Port 25 being blocked is normal on many VPS providers — it is the standard anti-spam default. The
                fix is a provider unblock request or an SMTP relay; the panel never pretends otherwise.
              </p>
            </SectionCard>
          </motion.div>

          {result.dnsbl && (
            <motion.div variants={fadeUp}>
              <SectionCard
                title="DNS blocklists"
                description={`Live A-record lookups for ${result.dnsbl.ip ?? "this server's IP"} on the three lists that matter most for outbound mail.`}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  {result.dnsbl.lists.map((l) => (
                    <div key={l.name} className="rounded-lg border p-4 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xs">{l.name}</p>
                        <StatusChip status={l.listed ? "fail" : "pass"} label={l.listed ? "listed" : "clean"} />
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{l.detail}</p>
                      {l.code && <p className="font-mono text-[10.5px] text-red-600 dark:text-red-400">return code {l.code}</p>}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                  Spamhaus restricts free-tier lookups from shared/public resolvers — results reflect the resolver
                  this server actually uses, which is what receiving mail servers see.
                </p>
              </SectionCard>
            </motion.div>
          )}

          <motion.div variants={fadeUp}>
            <SectionCard
              title="Mail domain DNS"
              description={
                result.domains.length
                  ? "SPF, DKIM and DMARC looked up live on the public DNS for each mail domain in the panel."
                  : undefined
              }
            >
              {result.domains.length === 0 ? (
                <EmptyState
                  icon={MailCheck}
                  title="No mail domains yet"
                  description="Create a mail domain in the Mail server tab and its SPF, DKIM and DMARC checks will appear here."
                />
              ) : (
                <div className="space-y-4">
                  {result.domains.map((d) => (
                    <div key={d.domain} className="rounded-lg border overflow-hidden">
                      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 bg-muted/30">
                        <Mail className="h-3.5 w-3.5 text-primary" aria-hidden />
                        <span className="font-mono text-xs font-medium">{d.domain}</span>
                      </div>
                      <ul className="divide-y text-xs">
                        {(
                          [
                            ["SPF", d.spf, "TXT @"],
                            ["DKIM", d.dkim, "TXT selector._domainkey"],
                            ["DMARC", d.dmarc, "TXT _dmarc"],
                          ] as const
                        ).map(([label, chk, at]) => (
                          <li key={label} className="px-3.5 py-2.5 flex flex-wrap items-start gap-2.5">
                            <span className="w-14 shrink-0 font-medium">{label}</span>
                            <span className="font-mono text-muted-foreground w-44 shrink-0">{at}</span>
                            <StatusChip status={chk.status} className="shrink-0" />
                            <span className="text-muted-foreground min-w-0 flex-1">
                              {chk.detail}
                              {chk.found.length > 0 && (
                                <span className="block font-mono break-all mt-1 opacity-80">{chk.found.join(" · ")}</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </motion.div>
        </>
      ) : null}
    </motion.div>
  );
}

/** Toast confirmation for clipboard copies driven by custom events. */
function CopyEcho() {
  const { toast } = useToast();
  useEffect(() => {
    function onCopy(e: Event) {
      const what = (e as CustomEvent<string>).detail;
      toast({ title: "Copied", description: what, duration: 1500 });
    }
    window.addEventListener("hipno-copy", onCopy);
    return () => window.removeEventListener("hipno-copy", onCopy);
  }, [toast]);
  return null;
}

// ---------------------------------------------------------------------------
// Mail server tab (spec §5.19 management)
// ---------------------------------------------------------------------------

function MailServerTab() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const list = useQuery<{ domains: MailDomainRow[] }>({
    queryKey: ["mail-domains"],
    queryFn: () => get<{ domains: MailDomainRow[] }>("/api/mail/domains"),
  });

  const domains = list.data?.domains ?? [];
  const mailboxes = domains.reduce((n, d) => n + d.mailboxes.length, 0);
  const aliases = domains.reduce((n, d) => n + d.aliases.length, 0);

  const relay = useQuery<{ relay: RelayInfo | null }>({
    queryKey: ["mail-relay"],
    queryFn: () => get<{ relay: RelayInfo | null }>("/api/mail/relay"),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["mail-domains"] });
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Mail} label="Mail domains" value={<AnimatedNumber value={domains.length} />} sub="receive/send zones" />
        <StatCard icon={AtSign} label="Mailboxes" value={<AnimatedNumber value={mailboxes} />} sub="panel-managed accounts" />
        <StatCard icon={Forward} label="Aliases" value={<AnimatedNumber value={aliases} />} sub="incl. catch-all" />
        <StatCard
          icon={Send}
          label="SMTP relay"
          value={relay.data?.relay?.enabled ? "enabled" : "off"}
          sub={relay.data?.relay ? `${relay.data.relay.host}:${relay.data.relay.port}` : "not configured"}
        />
      </motion.div>

      {list.isLoading ? (
        <SectionCard contentClassName="space-y-2" aria-busy="true">
          <Skeleton className="h-14 w-full hipno-shimmer" />
          <Skeleton className="h-14 w-full hipno-shimmer" />
        </SectionCard>
      ) : list.isError ? (
        <SectionCard>
          <div className="py-8 text-center space-y-3" role="alert">
            <p className="text-sm text-muted-foreground">Could not load mail domains. {errMessage(list.error)}</p>
            <Button variant="outline" onClick={() => list.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          </div>
        </SectionCard>
      ) : selectedId && domains.find((d) => d.id === selectedId) ? (
        <MailDomainDetail
          domain={domains.find((d) => d.id === selectedId)!}
          onBack={() => setSelectedId(null)}
          onChanged={invalidate}
        />
      ) : (
        <motion.div variants={fadeUp}>
          <SectionCard
            title="Mail domains"
            description={domains.length > 0 ? `${domains.length} domain${domains.length === 1 ? "" : "s"} — click one to manage mailboxes, aliases and DKIM.` : undefined}
            actions={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden /> Add domain
              </Button>
            }
          >
            {domains.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="No mail domains yet"
                description="Add a domain you own to create mailboxes and aliases for it, generate DKIM keys and get the exact DNS records to publish."
                action={
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> Add mail domain
                  </Button>
                }
              />
            ) : (
              <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="text-left text-[11px] text-muted-foreground border-b">
                      <th className="py-2 pr-3 font-medium">Domain</th>
                      <th className="py-2 pr-3 font-medium">Mailboxes</th>
                      <th className="py-2 pr-3 font-medium">Aliases</th>
                      <th className="py-2 pr-3 font-medium">DKIM</th>
                      <th className="py-2 pr-3 font-medium">State</th>
                      <th className="py-2 w-8"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains.map((d) => (
                      <tr
                        key={d.id}
                        tabIndex={0}
                        role="button"
                        aria-label={`Open mail domain ${d.domain}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedId(d.id);
                          }
                        }}
                        onClick={() => setSelectedId(d.id)}
                        className="border-b last:border-0 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/40"
                      >
                        <td className="py-2.5 pr-3 font-mono text-xs">{d.domain}</td>
                        <td className="py-2.5 pr-3 text-xs tabular-nums">{d.mailboxes.length}</td>
                        <td className="py-2.5 pr-3 text-xs tabular-nums">
                          {d.aliases.length}
                          {d.catchAll ? <span className="text-muted-foreground"> + catch-all</span> : null}
                        </td>
                        <td className="py-2.5 pr-3">
                          {d.dkimPublic ? (
                            <StatusChip status="pass" label="key ready" />
                          ) : (
                            <StatusChip status="warn" label="no key" />
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusChip status={d.enabled ? "active" : "disabled"} label={d.enabled ? "enabled" : "disabled"} />
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground">›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </motion.div>
      )}

      <RelaySection onChanged={() => void queryClient.invalidateQueries({ queryKey: ["mail-relay"] })} />

      <CreateDomainDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          invalidate();
          setSelectedId(id);
        }}
      />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Mail domain detail
// ---------------------------------------------------------------------------

function MailDomainDetail({
  domain,
  onBack,
  onChanged,
}: {
  domain: MailDomainRow;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<{ domain: MailDomainRow }>(`/api/mail/domains/${domain.id}`, body),
    onSuccess: () => onChanged(),
    onError: (e) => toast({ title: "Update failed", description: errMessage(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/mail/domains/${domain.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Mail domain deleted", description: `${domain.domain} and its mailboxes/aliases were removed.` });
      setDeleteOpen(false);
      onChanged();
      onBack();
    },
    onError: (e) => toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" }),
  });

  const dkimTxt = domain.dkimPublic ? `v=DKIM1; k=rsa; p=${domain.dkimPublic}` : null;
  const spfTxt = "v=spf1 mx -all";
  const dmarcTxt = `v=DMARC1; p=${domain.dmarcPolicy}; rua=mailto:postmaster@${domain.domain}`;

  return (
    <>
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
        <motion.div variants={fadeUp} className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <Button variant="ghost" size="sm" className="-ml-2 h-7 text-muted-foreground" onClick={onBack}>
              ← All domains
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight font-mono">{domain.domain}</h2>
              <StatusChip status={domain.enabled ? "active" : "disabled"} label={domain.enabled ? "enabled" : "disabled"} />
              <Badge variant="outline" className="cursor-default text-muted-foreground">
                DMARC {domain.dmarcPolicy}
              </Badge>
              {domain.mtaSts && (
                <Badge variant="outline" className="cursor-default border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                  MTA-STS
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {domain.mailboxes.length} mailbox{domain.mailboxes.length === 1 ? "" : "es"} · {domain.aliases.length} alias
              {domain.aliases.length === 1 ? "" : "es"}
              {domain.catchAll ? ` · catch-all → ${domain.catchAll}` : " · no catch-all"} · added {fmtDate(domain.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => update.mutate({ enabled: !domain.enabled })}
              disabled={update.isPending}
            >
              <Power className="h-4 w-4" aria-hidden /> {domain.enabled ? "Disable" : "Enable"}
            </Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> <span className="sr-only">Delete mail domain</span>
            </Button>
          </div>
        </motion.div>

        <DomainSettings domain={domain} onChanged={onChanged} />

        <DeliverabilitySection domain={domain} spfTxt={spfTxt} dkimTxt={dkimTxt} dmarcTxt={dmarcTxt} />

        <MailboxesSection domain={domain} onChanged={onChanged} />

        <AliasesSection domain={domain} onChanged={onChanged} />
      </motion.div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {domain.domain}?</DialogTitle>
            <DialogDescription>
              This removes the domain, its {domain.mailboxes.length} mailbox
              {domain.mailboxes.length === 1 ? "" : "es"} and {domain.aliases.length} alias
              {domain.aliases.length === 1 ? "" : "es"} from the panel. DNS records at your provider are untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Delete domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DomainSettings({ domain, onChanged }: { domain: MailDomainRow; onChanged: () => void }) {
  const { toast } = useToast();
  const [catchAll, setCatchAll] = useState(domain.catchAll ?? "");
  const [selector, setSelector] = useState(domain.dkimSelector);

  // Keep the inputs in sync with the saved row (adjusted during render
  // instead of an effect — react.dev pattern).
  const [lastCatchAll, setLastCatchAll] = useState(domain.catchAll ?? "");
  if ((domain.catchAll ?? "") !== lastCatchAll) {
    setLastCatchAll(domain.catchAll ?? "");
    setCatchAll(domain.catchAll ?? "");
  }
  const [lastSelector, setLastSelector] = useState(domain.dkimSelector);
  if (domain.dkimSelector !== lastSelector) {
    setLastSelector(domain.dkimSelector);
    setSelector(domain.dkimSelector);
  }

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<{ domain: MailDomainRow }>(`/api/mail/domains/${domain.id}`, body),
    onSuccess: () => {
      onChanged();
    },
    onError: (e) => toast({ title: "Update failed", description: errMessage(e), variant: "destructive" }),
  });

  const genDkim = useMutation({
    mutationFn: () => patch<{ domain: MailDomainRow }>(`/api/mail/domains/${domain.id}`, { action: "generate-dkim" }),
    onSuccess: (d) => {
      toast({
        title: "DKIM key generated",
        description: `Real 2048-bit RSA key for selector “${d.domain.dkimSelector}” — publish the TXT record shown below.`,
      });
      onChanged();
    },
    onError: (e) => toast({ title: "DKIM generation failed", description: errMessage(e), variant: "destructive" }),
  });

  const catchAllValid = catchAll.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(catchAll.trim());
  const selectorValid = /^[a-z0-9][a-z0-9-]{0,31}$/i.test(selector.trim());

  return (
    <motion.div variants={fadeUp}>
      <SectionCard
        title="Domain settings"
        description="Policy toggles for this mail domain. DKIM signs outbound mail; DMARC tells receivers what to do with unaligned mail."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3.5">
              <div>
                <p className="text-sm font-medium">DMARC policy</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  What receivers do with mail that fails alignment.
                </p>
              </div>
              <Select
                value={domain.dmarcPolicy}
                onValueChange={(v) => update.mutate({ dmarcPolicy: v })}
                disabled={update.isPending}
              >
                <SelectTrigger className="w-36" aria-label="DMARC policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">none — monitor</SelectItem>
                  <SelectItem value="quarantine">quarantine</SelectItem>
                  <SelectItem value="reject">reject</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3.5">
              <div>
                <p className="text-sm font-medium">MTA-STS</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Publishes an STS policy so senders must use TLS with this domain.
                </p>
              </div>
              <Switch
                checked={domain.mtaSts}
                onCheckedChange={(v) => update.mutate({ mtaSts: v })}
                aria-label="Toggle MTA-STS"
                disabled={update.isPending}
              />
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border p-3.5 space-y-2">
              <Label htmlFor="catchall">Catch-all destination</Label>
              <div className="flex gap-2">
                <Input
                  id="catchall"
                  value={catchAll}
                  onChange={(e) => setCatchAll(e.target.value)}
                  placeholder="you@personal.mail"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={catchAll.trim() !== "" && !catchAllValid}
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={!catchAllValid || update.isPending}
                  onClick={() => update.mutate({ catchAll: catchAll.trim() || null })}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {domain.catchAll ? "Active — unrouted addresses go here." : "Off — unrouted addresses are rejected."}
              </p>
            </div>
            <div className="rounded-lg border p-3.5 space-y-2">
              <Label htmlFor="dkim-selector">DKIM selector</Label>
              <div className="flex gap-2">
                <Input
                  id="dkim-selector"
                  value={selector}
                  onChange={(e) => setSelector(e.target.value)}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={selector.trim() !== "" && !selectorValid}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={!selectorValid || selector === domain.dkimSelector || update.isPending}
                  onClick={() => update.mutate({ dkimSelector: selector.trim().toLowerCase() })}
                >
                  Save
                </Button>
              </div>
              <Button
                size="sm"
                className="w-full mt-1"
                onClick={() => genDkim.mutate()}
                disabled={genDkim.isPending}
              >
                {genDkim.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4 mr-1.5" aria-hidden />}
                {domain.dkimPublic ? "Regenerate DKIM key" : "Generate DKIM key (2048-bit RSA)"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {domain.dkimPublic
                  ? "Key generated — the private half is encrypted at rest; the public value is shown under Deliverability."
                  : "Generates a real RSA keypair on this server. The private key is stored encrypted; you publish the public TXT record."}
              </p>
            </div>
          </div>
        </div>
      </SectionCard>
    </motion.div>
  );
}

function DeliverabilitySection({
  domain,
  spfTxt,
  dkimTxt,
  dmarcTxt,
}: {
  domain: MailDomainRow;
  spfTxt: string;
  dkimTxt: string | null;
  dmarcTxt: string;
}) {
  const { toast } = useToast();
  const [verify, setVerify] = useState<VerifyDomainResponse | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function runVerify() {
    setVerifying(true);
    try {
      const d = await post<VerifyDomainResponse>(`/api/mail/domains/${domain.id}/verify`);
      setVerify(d);
      toast({ title: "DNS verification finished", description: `Live lookups for ${domain.domain} updated.` });
    } catch (e) {
      toast({ title: "Verification failed", description: errMessage(e), variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  }

  const rows: { label: string; at: string; value: string | null; chk?: RecordCheck; note: string }[] = [
    {
      label: "SPF",
      at: `TXT @`,
      value: spfTxt,
      chk: verify?.spf,
      note: "Authorises this server (via MX) to send mail for the domain.",
    },
    {
      label: "DKIM",
      at: `TXT ${domain.dkimSelector}._domainkey`,
      value: dkimTxt,
      chk: verify?.dkim,
      note: domain.dkimPublic
        ? "Publish exactly this value — the selector must match the one set in Domain settings."
        : "Generate a DKIM key in Domain settings first — this is the value you will publish.",
    },
    {
      label: "DMARC",
      at: "TXT _dmarc",
      value: dmarcTxt,
      chk: verify?.dmarc,
      note: "Policy + report address; adjust the policy in Domain settings.",
    },
  ];

  return (
    <motion.div variants={fadeUp}>
      <SectionCard
        title="Deliverability records"
        description="The exact strings to publish at your DNS provider, with live verification against public resolvers."
        actions={
          <Button size="sm" variant="outline" onClick={() => void runVerify()} disabled={verifying}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Radar className="h-4 w-4 mr-1.5" aria-hidden />}
            Verify DNS
          </Button>
        }
      >
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.label} className="rounded-lg border p-3.5 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono cursor-default">{r.label}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{r.at}</span>
                {r.chk && <StatusChip status={r.chk.status} label={r.chk.status === "pass" ? "verified live" : r.chk.status === "warn" ? "check detail" : "not found"} />}
                <span className="ml-auto">
                  {r.value && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Copy ${r.label} record value`}
                      onClick={() => copyText(r.value!, `${r.label} record value`)}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </span>
              </div>
              <p className="font-mono text-xs break-all rounded bg-muted/40 px-3 py-2 border">
                {r.value ?? <span className="text-muted-foreground">— generate a DKIM key above —</span>}
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {r.note}
                {r.chk ? ` Live check: ${r.chk.detail}` : ""}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

function MailboxesSection({ domain, onChanged }: { domain: MailDomainRow; onChanged: () => void }) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [password, setPassword] = useState<{ localPart: string; password: string } | null>(null);

  const act = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/api/mail/mailboxes/${id}`, body),
    onSuccess: (_, v) => {
      if (v.body.action === "reset-password") {
        // handled below via direct call; keep for safety
      }
      onChanged();
    },
    onError: (e) => toast({ title: "Action failed", description: errMessage(e), variant: "destructive" }),
  });

  async function resetPassword(m: MailboxRow) {
    try {
      const d = await patch<{ mailbox: MailboxRow; password: string }>(`/api/mail/mailboxes/${m.id}`, {
        action: "reset-password",
      });
      setPassword({ localPart: `${m.localPart}@${domain.domain}`, password: d.password });
      onChanged();
    } catch (e) {
      toast({ title: "Reset failed", description: errMessage(e), variant: "destructive" });
    }
  }

  return (
    <motion.div variants={fadeUp}>
      <SectionCard
        title="Mailboxes"
        description={`Panel-managed accounts on ${domain.domain}. Passwords are generated, encrypted at rest and shown exactly once.`}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add mailbox
          </Button>
        }
      >
        {domain.mailboxes.length === 0 ? (
          <EmptyState
            icon={AtSign}
            title="No mailboxes"
            description="Add the first mailbox — a strong password is generated for you and shown once after creation."
            action={
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden /> Add mailbox
              </Button>
            }
          />
        ) : (
          <div className="max-h-80 overflow-y-auto -mx-1 px-1">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="text-left text-[11px] text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium">Address</th>
                  <th className="py-2 pr-3 font-medium">Quota</th>
                  <th className="py-2 pr-3 font-medium">Rate limit</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 w-28 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {domain.mailboxes.map((m) => (
                  <tr key={m.id} className={`border-b last:border-0 hover:bg-muted/40 ${m.enabled ? "" : "opacity-60"}`}>
                    <td className="py-2.5 pr-3">
                      <span className="font-mono text-xs">
                        {m.localPart}
                        <span className="text-muted-foreground">@{domain.domain}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                      {Math.round(m.usedMb)} / {m.quotaMb} MB
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{m.ratePerHour}/h</td>
                    <td className="py-2.5 pr-3">
                      <StatusChip status={m.enabled ? "active" : "disabled"} label={m.enabled ? "enabled" : "disabled"} />
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Reset password for ${m.localPart}@${domain.domain}`}
                          title="Reset password"
                          onClick={() => void resetPassword(m)}
                        >
                          <KeyRound className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={m.enabled ? `Disable ${m.localPart}@${domain.domain}` : `Enable ${m.localPart}@${domain.domain}`}
                          onClick={() => act.mutate({ id: m.id, body: { enabled: !m.enabled } })}
                        >
                          <Power className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label={`Delete ${m.localPart}@${domain.domain}`}
                          onClick={() =>
                            api(`/api/mail/mailboxes/${m.id}`, { method: "DELETE" })
                              .then(() => {
                                toast({ title: "Mailbox deleted", description: `${m.localPart}@${domain.domain} removed.` });
                                onChanged();
                              })
                              .catch((e) => toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" }))
                          }
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

      <CreateMailboxDialog domain={domain} open={createOpen} onOpenChange={setCreateOpen} onCreated={onChanged} onPassword={(p) => setPassword(p)} />
      <PasswordOnceDialog
        info={password}
        onClose={() => setPassword(null)}
      />
    </motion.div>
  );
}

function CreateMailboxDialog({
  domain,
  open,
  onOpenChange,
  onCreated,
  onPassword,
}: {
  domain: MailDomainRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
  onPassword: (info: { localPart: string; password: string }) => void;
}) {
  const { toast } = useToast();
  const [localPart, setLocalPart] = useState("");
  const [quota, setQuota] = useState("1024");
  const [rate, setRate] = useState("100");
  const [error, setError] = useState<string | null>(null);

  const localOk = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/i.test(localPart.trim()) && !localPart.trim().includes("..");
  const quotaNum = Number(quota);
  const rateNum = Number(rate);
  const numsOk = Number.isInteger(quotaNum) && quotaNum >= 16 && quotaNum <= 1_048_576 && Number.isInteger(rateNum) && rateNum >= 1 && rateNum <= 10000;

  const create = useMutation({
    mutationFn: () =>
      post<{ mailbox: MailboxRow; password: string }>(`/api/mail/domains/${domain.id}/mailboxes`, {
        localPart: localPart.trim().toLowerCase(),
        quotaMb: quotaNum,
        ratePerHour: rateNum,
      }),
    onSuccess: (d) => {
      toast({ title: "Mailbox created", description: `${d.mailbox.localPart}@${domain.domain} is ready.` });
      onPassword({ localPart: `${d.mailbox.localPart}@${domain.domain}`, password: d.password });
      onOpenChange(false);
      setLocalPart("");
      setError(null);
      onCreated();
    },
    onError: (e) => setError(errMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add mailbox — {domain.domain}</DialogTitle>
          <DialogDescription>
            A strong password is generated on the server, stored encrypted and shown to you exactly once.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mb-local">Local part</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="mb-local"
                value={localPart}
                onChange={(e) => {
                  setLocalPart(e.target.value);
                  setError(null);
                }}
                placeholder="hello"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={localPart.trim().length > 0 && !localOk}
              />
              <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">@{domain.domain}</span>
            </div>
            {localPart.trim().length > 0 && !localOk && (
              <p className="text-xs text-destructive" role="alert">
                Letters, digits, dots and - _ % + are allowed; no leading/trailing dot.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mb-quota">Quota (MB)</Label>
              <Input id="mb-quota" type="number" min={16} max={1048576} value={quota} onChange={(e) => setQuota(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mb-rate">Rate limit / hour</Label>
              <Input id="mb-rate" type="number" min={1} max={10000} value={rate} onChange={(e) => setRate(e.target.value)} />
              <p className="text-xs text-muted-foreground">Outbound cap — contains compromised accounts.</p>
            </div>
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
          <Button disabled={!localOk || !numsOk || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Create mailbox
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordOnceDialog({
  info,
  onClose,
}: {
  info: { localPart: string; password: string } | null;
  onClose: () => void;
}) {
  if (!info) return null;
  return (
    <Dialog open={!!info} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden /> Password for {info.localPart}
          </DialogTitle>
          <DialogDescription>
            Shown once — copy it now. It is stored encrypted and cannot be recovered later, only reset.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/40 px-4 py-3">
          <p className="font-mono text-sm break-all select-all" aria-label={`Generated password ${info.password}`}>
            {info.password}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => copyText(info.password, "Mailbox password")}>
            <Copy className="h-4 w-4" aria-hidden /> Copy
          </Button>
          <Button
            onClick={() => {
              copyText(info.password, "Mailbox password");
              onClose();
            }}
          >
            <Check className="h-4 w-4" aria-hidden /> Copy &amp; close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

function AliasesSection({ domain, onChanged }: { domain: MailDomainRow; onChanged: () => void }) {
  const { toast } = useToast();
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sourceOk = source.trim() === "*" || /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/i.test(source.trim());
  const destOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination.trim());

  const create = useMutation({
    mutationFn: () =>
      post<{ alias: AliasRow }>(`/api/mail/domains/${domain.id}/aliases`, {
        source: source.trim().toLowerCase(),
        destination: destination.trim().toLowerCase(),
      }),
    onSuccess: (d) => {
      toast({
        title: "Alias created",
        description: `${d.alias.source === "*" ? "catch-all" : d.alias.source}@${domain.domain} → ${d.alias.destination}`,
      });
      setSource("");
      setDestination("");
      setError(null);
      onChanged();
    },
    onError: (e) => setError(errMessage(e)),
  });

  return (
    <motion.div variants={fadeUp}>
      <SectionCard
        title="Aliases"
        description={`Forwarding rules on ${domain.domain}. Use “*” as source for a catch-all (or set the catch-all destination in Domain settings).`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5 flex-1 min-w-[8rem]">
            <Label htmlFor="alias-source">Source</Label>
            <Input
              id="alias-source"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setError(null);
              }}
              placeholder="info or *"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={source.trim().length > 0 && !sourceOk}
            />
          </div>
          <div className="space-y-1.5 flex-1 min-w-[12rem]">
            <Label htmlFor="alias-dest">Destination</Label>
            <Input
              id="alias-dest"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setError(null);
              }}
              placeholder="you@personal.mail"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={destination.trim().length > 0 && !destOk}
            />
          </div>
          <Button disabled={!sourceOk || !destOk || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            <Forward className="h-4 w-4" aria-hidden /> Add alias
          </Button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        {domain.aliases.length > 0 && (
          <div className="mt-4 max-h-60 overflow-y-auto rounded-lg border -mx-1 px-1">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-background">
                <tr className="text-left text-[11px] text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Destination</th>
                  <th className="py-2 w-12 text-right font-medium">
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {domain.aliases.map((a) => (
                  <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3 font-mono text-xs">
                      {a.source}
                      <span className="text-muted-foreground">@{domain.domain}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs break-all">{a.destination}</td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        aria-label={`Delete alias ${a.source}@${domain.domain}`}
                        onClick={() =>
                          api(`/api/mail/aliases/${a.id}`, { method: "DELETE" })
                            .then(() => {
                              toast({ title: "Alias deleted" });
                              onChanged();
                            })
                            .catch((e) => toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" }))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Create mail domain dialog
// ---------------------------------------------------------------------------

function CreateDomainDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [domain, setDomain] = useState("");
  const [selector, setSelector] = useState("mail");
  const [error, setError] = useState<string | null>(null);

  const preview = normalizeDomainPreview(domain);
  const selectorOk = /^[a-z0-9][a-z0-9-]{0,31}$/i.test(selector.trim());

  const create = useMutation({
    mutationFn: () =>
      post<{ domain: MailDomainRow }>("/api/mail/domains", {
        domain: domain.trim(),
        ...(selector.trim().toLowerCase() !== "mail" ? { dkimSelector: selector.trim().toLowerCase() } : {}),
      }),
    onSuccess: (d) => {
      toast({
        title: "Mail domain added",
        description: `${d.domain.domain} — generate a DKIM key and publish the records under Deliverability.`,
      });
      onOpenChange(false);
      setDomain("");
      setSelector("mail");
      setError(null);
      onCreated(d.domain.id);
    },
    onError: (e) => setError(errMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add mail domain</DialogTitle>
          <DialogDescription>
            A domain you own. After adding it you can create mailboxes and aliases, generate DKIM keys and copy the
            exact DNS records to publish.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="md-domain">Domain</Label>
            <Input
              id="md-domain"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setError(null);
              }}
              placeholder="example.com"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              aria-invalid={domain.trim().length > 0 && !preview.ok}
            />
            {domain.trim().length > 0 && (
              <p className={`text-xs ${preview.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`} role={preview.ok ? "status" : "alert"}>
                {preview.ok ? `Mail domain will be ${preview.domain}` : preview.error}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="md-selector">DKIM selector</Label>
            <Input
              id="md-selector"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={selector.trim().length > 0 && !selectorOk}
            />
            <p className="text-xs text-muted-foreground">
              Publishes DKIM at <span className="font-mono">&lt;selector&gt;._domainkey.&lt;domain&gt;</span>.
            </p>
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
          <Button disabled={!preview.ok || !selectorOk || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Add domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SMTP relay (spec §5.17.7 workaround — the honest way to send on port-25-blocked VPS)
// ---------------------------------------------------------------------------

function RelaySection({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast();
  const relay = useQuery<{ relay: RelayInfo | null }>({
    queryKey: ["mail-relay"],
    queryFn: () => get<{ relay: RelayInfo | null }>("/api/mail/relay"),
  });

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const r = relay.data?.relay ?? null;

  // Re-sync the form only when a different relay row arrives (by id) — never
  // on plain refetches, so half-typed edits survive background refreshes.
  const relayId = r?.id ?? null;
  const relayRow = r;
  useEffect(() => {
    if (relayId && relayRow) {
      setName(relayRow.name);
      setHost(relayRow.host);
      setPort(String(relayRow.port));
      setUsername(relayRow.username ?? "");
      setPassword("");
      setFromEmail(relayRow.fromEmail ?? "");
      setEnabled(relayRow.enabled);
    }
  }, [relayId, relayRow]);

  const hostOk = host.trim().length >= 3;
  const portNum = Number(port);
  const portOk = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const nameOk = name.trim().length >= 1 && name.trim().length <= 100;
  const fromOk = fromEmail.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail.trim());

  const save = useMutation({
    mutationFn: () =>
      put<{ relay: RelayInfo }>("/api/mail/relay", {
        name: name.trim(),
        host: host.trim(),
        port: portNum,
        username: username.trim() || null,
        ...(password.trim() ? { password: password.trim() } : {}),
        fromEmail: fromEmail.trim() || null,
        enabled,
      }),
    onSuccess: () => {
      toast({ title: "SMTP relay saved", description: `${host.trim()}:${portNum} — credentials stored encrypted.` });
      setPassword("");
      setError(null);
      onChanged();
    },
    onError: (e) => setError(errMessage(e)),
  });

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const d = await post<{ ok: boolean; messageId: string; accepted: string[] }>("/api/mail/relay", { to: testTo.trim() });
      setTestResult({ ok: true, message: `Delivered to ${d.accepted.join(", ")} — message id ${d.messageId}` });
    } catch (e) {
      setTestResult({ ok: false, message: errMessage(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <motion.div variants={fadeUp}>
      <SectionCard
        title="SMTP relay"
        description="When port 25 is blocked (§5.17.7 workaround), deliver outbound mail through an authenticated relay — real sends via SMTP, errors surfaced honestly."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="relay-name">Name</Label>
                <Input id="relay-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My relay" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="relay-port">Port</Label>
                <Input id="relay-port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="relay-host">Relay host</Label>
              <Input id="relay-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.relay.provider.com" className="font-mono" autoComplete="off" spellCheck={false} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="relay-user">Username</Label>
                <Input id="relay-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="relay-pass">Password {r?.hasPassword ? `(${r.passwordMasked})` : ""}</Label>
                <Input
                  id="relay-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={r?.hasPassword ? "leave empty to keep" : "relay password"}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="relay-from">Envelope from (optional)</Label>
              <Input id="relay-from" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="panel@yourdomain.com" className="font-mono" autoComplete="off" spellCheck={false} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3.5">
              <div>
                <p className="text-sm font-medium">Enabled</p>
                <p className="text-xs text-muted-foreground mt-0.5">Outbound mail is routed through this relay when on.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Toggle SMTP relay" />
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button disabled={!nameOk || !hostOk || !portOk || !fromOk || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {r ? "Save relay" : "Add relay"}
            </Button>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-primary" aria-hidden />
                <p className="text-sm font-medium">Send test email</p>
              </div>
              {r?.enabled ? (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Sends a real message through <span className="font-mono">{r.host}:{r.port}</span>
                    {r.fromEmail ? <> from <span className="font-mono">{r.fromEmail}</span></> : null} using the stored
                    credentials. Errors from the relay are shown as-is.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                      placeholder="you@example.com"
                      className="font-mono"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Test email recipient"
                    />
                    <Button
                      className="shrink-0"
                      disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.trim()) || testing}
                      onClick={() => void sendTest()}
                    >
                      {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                      Send
                    </Button>
                  </div>
                  {testResult && (
                    <p
                      className={`text-xs leading-relaxed ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                      role="status"
                    >
                      {testResult.message}
                    </p>
                  )}
                  {r.lastTestAt && !testResult && (
                    <p className="text-xs text-muted-foreground">
                      Last test {fmtDate(r.lastTestAt)} —{" "}
                      {r.lastTestOk === null ? "no result" : r.lastTestOk ? "delivered" : "failed"}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Save and enable a relay first — the test sender is disabled until a relay is configured, because
                  there is nothing honest to send through otherwise.
                </p>
              )}
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground leading-relaxed space-y-2">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <Ticket className="h-3.5 w-3.5 text-primary" aria-hidden /> Why a relay?
              </p>
              <p>
                Most VPS providers block outbound port 25 (verified live in the Readiness tab). A relay accepts your
                authenticated mail on 587/2525 and delivers it for you — the standard fix recommended by the panel
                when direct delivery is blocked.
              </p>
              {r?.lastTestOk === false && (
                <p className="text-amber-600 dark:text-amber-400">The last test send failed — check the credentials and the relay status.</p>
              )}
            </div>
          </div>
        </div>
      </SectionCard>
    </motion.div>
  );
}
