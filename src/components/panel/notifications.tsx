"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { usePanelStore } from "@/lib/store";
import { get } from "@/lib/api";
import { setUnreadTitleCount } from "@/lib/title";
import { Bell, ChevronRight } from "lucide-react";
import { StatusChip } from "./primitives";

interface Alert {
  id: string;
  ruleName: string;
  severity: string;
  message: string;
  state: string;
  startedAt: string;
}

/**
 * Bell + live firing-alert feed (monitoring rules engine), with a jump to
 * the Monitoring view. Degrades silently when the viewer lacks permission.
 */
export function Notifications({ canRead }: { canRead: boolean }) {
  const setView = usePanelStore((s) => s.setView);
  const q = useQuery<{ alerts: Alert[] }>({
    queryKey: ["alerts-firing"],
    queryFn: () => get<{ alerts: Alert[] }>("/api/monitoring/alerts?state=firing"),
    refetchInterval: 30_000,
    enabled: canRead,
  });

  const alerts = (q.data?.alerts ?? []).slice(0, 6);
  const count = q.data?.alerts?.length ?? 0;

  // Tab-title badge: "(n) · …" while alerts are firing (spec §2), restored on
  // clear. Titles are managed centrally in src/lib/title.ts so the per-view
  // base title and this badge never overwrite each other.
  useEffect(() => {
    setUnreadTitleCount(count);
    return () => setUnreadTitleCount(0);
  }, [count]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-[18px] w-[18px]" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--brand-red)] text-white text-[10px] font-semibold grid place-items-center ring-2 ring-background">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-semibold tracking-tight">Alerts</p>
          <p className="text-xs text-muted-foreground">
            {count > 0 ? `${count} firing` : "All clear"}
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {q.isLoading ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : alerts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No firing alerts.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Monitor rules evaluate every few seconds.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {alerts.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{a.ruleName}</p>
                    <StatusChip status={a.severity} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{a.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    {new Date(a.startedAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={() => setView("monitoring")}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 border-t transition-colors"
        >
          Open Monitoring
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </PopoverContent>
    </Popover>
  );
}
