"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollText, ShieldCheck, Download, ChevronLeft, ChevronRight, FileJson, Search, Braces } from "lucide-react";

interface AuditEntryRow {
  id: string; seq: number; ts: string; actorId: string | null; actorEmail: string | null;
  action: string; target: string | null; source: string; sourceIp: string | null;
  result: string; details: string | null;
}

export function AuditView() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [result, setResult] = useState("all");
  const [source, setSource] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (action) params.set("action", action);
  if (actor) params.set("actor", actor);
  if (result !== "all") params.set("result", result);
  if (source !== "all") params.set("source", source);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const list = useQuery<{ entries: AuditEntryRow[]; total: number; page: number; pageSize: number }>({
    queryKey: ["audit", params.toString()],
    queryFn: () => get(`/api/audit?${params.toString()}`),
  });
  const verification = useQuery<{ valid: boolean; checked: number; firstBrokenSeq?: number }>({
    queryKey: ["audit-verify"],
    queryFn: () => get("/api/audit/verify"),
  });

  function exportUrl(format: "csv" | "json") {
    const p = new URLSearchParams(params);
    p.set("format", format);
    return `/api/audit/export?${p.toString()}`;
  }

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <span className="text-xs text-muted-foreground">append-only · SHA-256 hash chain</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { verification.refetch(); toast({ title: "Verifying chain…" }); }}>
            <ShieldCheck className="h-4 w-4" aria-hidden /> Verify chain
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={exportUrl("csv")} download><Download className="h-4 w-4" aria-hidden /> CSV</a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={exportUrl("json")} download><FileJson className="h-4 w-4" aria-hidden /> JSON</a>
          </Button>
        </div>
      </div>

      {verification.data && (
        <Card className={verification.data.valid ? "border-l-4 border-l-primary" : "border-l-4 border-l-destructive"}>
          <CardContent className="p-3 text-sm flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${verification.data.valid ? "text-primary" : "text-destructive"}`} aria-hidden />
            {verification.data.valid ? (
              <span>Hash chain intact — <strong>{verification.data.checked}</strong> entries verified.</span>
            ) : (
              <span className="text-destructive">Chain broken at seq {verification.data.firstBrokenSeq} — entries may have been tampered with.</span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="f-action" className="text-xs">Action</Label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="f-action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}
                placeholder="login, website…" className="pl-7 h-8 text-xs" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-actor" className="text-xs">Actor</Label>
            <Input id="f-actor" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} placeholder="email" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Result</Label>
            <Select value={result} onValueChange={(v) => { setResult(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs" aria-label="Result filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="success">success</SelectItem>
                <SelectItem value="failure">failure</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Source</Label>
            <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs" aria-label="Source filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="web">web</SelectItem>
                <SelectItem value="local-cli">local-cli</SelectItem>
                <SelectItem value="system">system</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-from" className="text-xs">From</Label>
            <Input id="f-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-to" className="text-xs">To</Label>
            <Input id="f-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-8 text-xs" />
          </div>
        </CardContent>
      </Card>

      {list.isLoading ? (
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      ) : list.isError ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Could not load audit log. <Button variant="link" onClick={() => list.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : !list.data?.entries.length ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <ScrollText className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden />
            <p className="font-medium">No matching entries</p>
            <p className="text-sm text-muted-foreground">Adjust the filters — every sensitive action lands here.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="p-3 font-medium w-14">#</th>
                      <th className="p-3 font-medium">Time</th>
                      <th className="p-3 font-medium">Actor</th>
                      <th className="p-3 font-medium">Action</th>
                      <th className="p-3 font-medium">Target</th>
                      <th className="p-3 font-medium">Source</th>
                      <th className="p-3 font-medium">Result</th>
                      <th className="p-3 font-medium sr-only">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.entries.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="p-3 font-mono text-xs text-muted-foreground">{e.seq}</td>
                        <td className="p-3 text-xs whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                        <td className="p-3 text-xs">{e.actorEmail || "system"}</td>
                        <td className="p-3 font-mono text-xs">{e.action}</td>
                        <td className="p-3 text-xs text-muted-foreground max-w-44 truncate" title={e.target || ""}>{e.target || "—"}</td>
                        <td className="p-3 text-xs">
                          <Badge variant="outline" className="font-normal">{e.source}</Badge>
                          {e.sourceIp && <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{e.sourceIp}</p>}
                        </td>
                        <td className="p-3">
                          {e.result === "success"
                            ? <Badge variant="default">success</Badge>
                            : <Badge variant="destructive">failure</Badge>}
                        </td>
                        <td className="p-3 text-right">
                          {e.details && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button size="sm" variant="ghost" aria-label={`Details for entry ${e.seq}`}>
                                  <Braces className="h-4 w-4" aria-hidden />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80" align="end">
                                <pre className="text-xs font-mono max-h-64 overflow-auto whitespace-pre-wrap">
                                  {(() => { try { return JSON.stringify(JSON.parse(e.details!), null, 2); } catch { return e.details; } })()}
                                </pre>
                              </PopoverContent>
                            </Popover>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <div className="flex items-center justify-between text-sm">
            <p className="text-xs text-muted-foreground">
              {list.data.total} entries · page {list.data.page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
