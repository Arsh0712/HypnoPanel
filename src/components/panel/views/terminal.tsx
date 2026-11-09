"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { post } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, RotateCw, Minus, Maximize2 } from "lucide-react";

type TabStatus = "connecting" | "ready-pty" | "ready-pipe" | "exited";

interface Tab {
  key: number;
  title: string;
  status: TabStatus;
  auditId: string | null;
}

const STATUS_BADGE: Record<TabStatus, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  connecting: { label: "Connecting…", variant: "secondary" },
  "ready-pty": { label: "Ready · PTY", variant: "default" },
  "ready-pipe": { label: "Ready · pipe", variant: "secondary" },
  exited: { label: "Exited", variant: "destructive" },
};

let nextTabKey = 1;

/**
 * Real web terminal over the gateway (io('/?XTransformPort=3004')).
 * Session start/end is audited through /api/terminal/sessions.
 */
export function TerminalView() {
  const { toast } = useToast();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [fontSize, setFontSize] = useState(13);
  const [runAs, setRunAs] = useState("panel");
  const [users, setUsers] = useState<string[]>([]);

  // per-tab runtime refs (not part of react state)
  const runtime = useRef(
    new Map<
      number,
      { socket: Socket; term: Terminal; fit: FitAddon; container: HTMLDivElement | null }
    >()
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    get<{ users: string[] }>("/api/terminal/sessions")
      .then((r) => setUsers(r.users || []))
      .catch(() => {});
  }, []);

  // Instant access: the first shell opens automatically on mount.
  useEffect(() => {
    if (tabs.length === 0) openTab();
  }, []);

  const closeTab = useCallback(
    (key: number) => {
      const rt = runtime.current.get(key);
      if (rt) {
        const auditId = tabs.find((t) => t.key === key)?.auditId;
        if (auditId) {
          fetch(`/api/terminal/sessions`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: auditId }),
            credentials: "same-origin",
          }).catch(() => {});
        }
        try {
          rt.socket.emit("kill");
          rt.socket.disconnect();
        } catch {}
        rt.term.dispose();
        runtime.current.delete(key);
      }
      setTabs((prev) => {
        const next = prev.filter((t) => t.key !== key);
        if (activeKey === key) {
          const last = next[next.length - 1];
          setActiveKey(last ? last.key : null);
        }
        return next;
      });
    },
    [tabs, activeKey]
  );

  const openTab = useCallback(async () => {
    if (tabs.length >= 5) {
      toast({ title: "Session limit", description: "Maximum 5 tabs — close one first.", variant: "destructive" });
      return;
    }
    const key = nextTabKey++;
    const auditId: string | null = await fetch("/api/terminal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runAs }),
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d as { id?: string })?.id || null)
      .catch(() => null);

    setTabs((prev) => [...prev, { key, title: `shell ${prev.length + 1}`, status: "connecting", auditId }]);
    setActiveKey(key);
  }, [tabs.length, runAs, toast]);

  // mount a terminal for the active tab when it changes / appears
  useEffect(() => {
    if (activeKey === null) return;
    const host = containerRef.current;
    if (!host) return;
    if (runtime.current.has(activeKey)) return;

    const term = new Terminal({
      fontSize,
      fontFamily: "var(--font-geist-mono), Menlo, monospace",
      cursorBlink: true,
      theme: { background: "#0a0a0a" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    setTimeout(() => fit.fit(), 30);

    let disposed = false;
    let socket: Socket | null = null;

    const resizeHandler = () => {
      requestAnimationFrame(() => {
        try {
          fit.fit();
          socket?.emit("resize", { cols: term.cols, rows: term.rows });
        } catch {}
      });
    };

    (async () => {
      // Draw a single-use ticket first (survives cookie-stripping edges),
      // then connect. Falls back to cookie auth if the ticket endpoint fails.
      // Uses the base-aware api() so the call is correct in tunnel mode too.
      const ticket = await post<{ ticket?: string }>("/api/terminal/ticket", {})
        .then((d) => d?.ticket || null)
        .catch(() => null);
      if (disposed) return;

      // Connection routing:
      //  - tunnel mode (panel served through the relay): the socket.io client
      //    connects DIRECTLY to the relay origin (Vercel rewrites cannot carry
      //    WebSocket upgrades) under the token-prefixed path; the relay bridges
      //    the frames through the panel's tunnel to the local terminal service.
      //  - gateway/sandbox mode: same-origin via ?XTransformPort.
      const base = (typeof window !== "undefined" && window.__HIPNO_BASE__) || "";
      const relayOrigin =
        (typeof window !== "undefined" && window.__HIPNO_RELAY_ORIGIN__) || "";
      const inTunnel = !!relayOrigin && base.startsWith("/server/panel/");
      const socketOpts: Parameters<typeof io>[1] = {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        timeout: 10000,
        ...(ticket ? { auth: { ticket } } : {}),
      };
      socket = inTunnel
        ? io(relayOrigin, { ...socketOpts, path: `${base}/socket.io`, transports: ["websocket"] })
        : io("/?XTransformPort=3004", socketOpts);
      const sock = socket;

      const sendStart = () => sock.emit("start", { cols: term.cols, rows: term.rows });
      sock.on("connect", sendStart);
      sock.on("reconnect", sendStart);
      sock.on("ready", (d: { pty: boolean }) => {
        setTabs((prev) =>
          prev.map((t) => (t.key === activeKey ? { ...t, status: d.pty ? "ready-pty" : "ready-pipe" } : t))
        );
      });
      sock.on("output", (chunk: string) => term.write(chunk));
      sock.on("exit", (d: { code?: number | string }) => {
        setTabs((prev) => prev.map((t) => (t.key === activeKey ? { ...t, status: "exited" } : t)));
        term.write(`\r\n\x1b[33m[session ended${d.code !== undefined ? ` (${d.code})` : ""}]\x1b[0m\r\n`);
      });
      sock.on("notice", (d: { message: string }) =>
        toast({ title: "Terminal notice", description: d.message })
      );
      sock.on("auth_error", (d: { error: string }) =>
        toast({ title: "Authentication failed", description: d.error, variant: "destructive" })
      );
      term.onData((d) => sock.emit("input", d));

      if (disposed) {
        sock.disconnect();
        return;
      }
      runtime.current.set(activeKey, { socket: sock, term, fit, container: host });
      term.focus();
    })().catch(() => {});

    window.addEventListener("resize", resizeHandler);
    const ro = new ResizeObserver(resizeHandler);
    ro.observe(host);
    const interval = setInterval(resizeHandler, 2000);

    return () => {
      disposed = true;
      window.removeEventListener("resize", resizeHandler);
      ro.disconnect();
      clearInterval(interval);
      try {
        socket?.disconnect();
      } catch {}
    };
  }, [activeKey, fontSize]);

  // when the active tab changes, re-parent the correct terminal into the host
  useEffect(() => {
    if (activeKey === null) return;
    const host = containerRef.current;
    const rt = runtime.current.get(activeKey);
    if (!host || !rt) return;
    // dispose terminals of inactive tabs is NOT done (they persist); but xterm
    // only supports one DOM parent — so we keep per-tab containers.
  }, [activeKey]);

  // font size changes
  useEffect(() => {
    for (const rt of runtime.current.values()) {
      rt.term.options.fontSize = fontSize;
      try {
        rt.fit.fit();
        rt.socket.emit("resize", { cols: rt.term.cols, rows: rt.term.rows });
      } catch {}
    }
  }, [fontSize]);

  useEffect(() => {
    const onUnload = () => {
      for (const [, rt] of runtime.current) {
        try {
          rt.socket.emit("kill");
          rt.socket.disconnect();
        } catch {}
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      for (const [key, rt] of runtime.current) {
        try {
          rt.socket.emit("kill");
          rt.socket.disconnect();
          rt.term.dispose();
        } catch {}
        runtime.current.delete(key);
      }
    };
  }, []);

  const activeTab = tabs.find((t) => t.key === activeKey) || null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap" role="tablist" aria-label="Terminal sessions">
          {tabs.map((t) => (
            <div
              key={t.key}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm cursor-pointer transition-colors ${
                t.key === activeKey ? "bg-primary/10 border-primary/40 text-primary" : "hover:bg-muted"
              }`}
              onClick={() => setActiveKey(t.key)}
              role="tab"
              aria-selected={t.key === activeKey}
            >
              <span>{t.title}</span>
              <button
                aria-label={`Close ${t.title}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.key);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={openTab} aria-label="Open new terminal tab">
          <Plus className="h-4 w-4" aria-hidden /> New tab
        </Button>
        {activeTab && <Badge variant={STATUS_BADGE[activeTab.status].variant} className="cursor-default">{STATUS_BADGE[activeTab.status].label}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            aria-label="Decrease font size"
            onClick={() => setFontSize((f) => Math.max(10, f - 1))}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-8 text-center" aria-label="Font size">{fontSize}px</span>
          <Button
            size="icon"
            variant="outline"
            aria-label="Increase font size"
            onClick={() => setFontSize((f) => Math.min(20, f + 1))}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Reconnect terminal"
            onClick={() => {
              const rt = activeKey !== null ? runtime.current.get(activeKey) : null;
              if (rt) {
                rt.socket.disconnect();
                rt.socket.connect();
                toast({ title: "Reconnecting…" });
              }
            }}
          >
            <RotateCw className="h-4 w-4" aria-hidden />
          </Button>
          <Select value={runAs} onValueChange={(v) => {
            setRunAs(v);
            if (v !== "panel") {
              toast({
                title: "Run-as is informational in this preview",
                description: "Switching the OS user needs the privileged helper of the VPS deployment; sessions continue as the panel service user.",
              });
            }
          }}>
            <SelectTrigger className="w-32 h-8 text-xs" aria-label="Run terminal as user">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="panel">panel (default)</SelectItem>
              {users.filter((u) => u !== "panel").map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        role="log"
        aria-label="Server terminal output"
        className="h-[calc(100vh-13rem)] min-h-96 rounded-lg border bg-black p-2 overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {tabs.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-neutral-400">
            <p className="text-sm">Open a tab to start a real shell session on this server.</p>
            <Button onClick={openTab} size="sm">
              <Plus className="h-4 w-4" aria-hidden /> Start session
            </Button>
          </div>
        )}
        {tabs.length > 0 && (
          <div className="grid">
            {tabs.map((t) => (
              <div
                key={t.key}
                ref={(el) => {
                  if (el && t.key === activeKey) {
                    // mount this tab's terminal element here when it becomes active
                    const rt = runtime.current.get(t.key);
                    if (rt && rt.container !== el && !el.hasChildNodes()) {
                      el.appendChild(rt.term.element as HTMLElement);
                      rt.container = el;
                      try { rt.fit.fit(); } catch {}
                      rt.term.focus();
                    }
                  }
                }}
                className={t.key === activeKey ? "h-full" : "hidden"}
                style={{ height: "100%" }}
              />
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Sessions idle out after 15 minutes · hard cap 60 minutes · start/end is audit-logged (content is not recorded unless recording is enabled in Settings).
      </p>
    </div>
  );
}
