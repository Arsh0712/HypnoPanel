/**
 * HipnoType Terminal Service — mini-service on port 3004.
 *
 * Real web terminal (spec §5.2): PTY shell via node-pty (with an honest
 * pipe-shell fallback), multiplexed over socket.io. Browsers connect through
 * the gateway as io('/?XTransformPort=3004').
 *
 * Auth (ticket-first, cookie-fallback):
 *   1. Ticket: the browser view draws a 30s single-use ticket from the panel
 *      API (same-origin cookie — always works) and passes it inside the
 *      socket.io CONNECT packet (`auth`). We redeem it against the panel's
 *      /api/terminal/tickets/consume endpoint using the local CLI token.
 *      This survives proxy chains that rewrite WebSocket handshakes and drop
 *      cookies (the outer preview edge does exactly that).
 *   2. Fallback: forward the handshake cookie to /api/auth/session for
 *      same-network deployments where cookies do arrive.
 * Only admin and developer roles may open shells. Terminal CONTENT is never
 * logged — only session lifecycle events.
 */
import { createServer } from "http";
import fs from "fs";
import path from "path";
import * as childProcess from "child_process";
import { Server } from "socket.io";

const PORT = Number(process.env.HIPNO_TERMINAL_PORT || 3004);
const PANEL = process.env.HIPNO_PANEL_URL || "http://127.0.0.1:3000";
const PANEL_SESSION_URL = `${PANEL}/api/auth/session`;
const PANEL_TICKET_CONSUME_URL = `${PANEL}/api/terminal/tickets/consume`;
// VPS deployments pass HIPNO_STATE_DIR=/var/lib/hipno (installer env file);
// workspace default: <repo>/data.
const STATE_DIR = process.env.HIPNO_STATE_DIR
  ? path.resolve(process.env.HIPNO_STATE_DIR)
  : path.resolve(import.meta.dirname, "../../data");
const CLI_TOKEN_FILE = path.join(STATE_DIR, "cli-token.json");
const MAX_SESSIONS = 5;
const IDLE_TIMEOUT_MS = 15 * 60_000;
const HARD_CAP_MS = 60 * 60_000;

function cliBearerToken(): string | null {
  try {
    const raw = fs.readFileSync(CLI_TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed.token || null;
  } catch {
    return null;
  }
}

interface ShellSession {
  startedAt: number;
  lastInputAt: number;
  kill: () => void;
  write: (data: string) => void;
  resize?: (cols: number, rows: number) => void;
  idleTimer?: NodeJS.Timeout;
  hardTimer?: NodeJS.Timeout;
  pty: boolean;
}

const sessions = new Map<string, ShellSession>();
let counter = 0;

// --- PTY backend: prefer node-pty, fall back to plain pipes -------------
import { createRequire } from "module";
const nodeRequire = createRequire(import.meta.url);
let ptyModule: typeof import("node-pty") | null = null;
try {
  ptyModule = nodeRequire("node-pty") as typeof import("node-pty");
  console.log("[terminal] node-pty loaded — full PTY mode");
} catch (e) {
  console.log("[terminal] node-pty unavailable — plain pipe shell fallback:", (e as Error).message);
}

function spawnShell(
  onData: (chunk: string) => void,
  onExit: (code: number) => void,
  cols: number,
  rows: number
): ShellSession {
  const env = { ...process.env, TERM: "xterm-256color" };
  if (ptyModule) {
    const pty = ptyModule.spawn("bash", [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: "/home/z/my-project",
      env: env as Record<string, string>,
    });
    pty.onData(onData);
    pty.onExit(({ exitCode }) => onExit(exitCode));
    return {
      startedAt: Date.now(),
      lastInputAt: Date.now(),
      pty: true,
      write: (d) => pty.write(d),
      resize: (c, r) => {
        try {
          pty.resize(c, r);
        } catch {}
      },
      kill: () => {
        try {
          pty.kill();
        } catch {}
      },
    };
  }
  // Fallback: plain bash over pipes (no true TTY)
  const { spawn } = childProcess;
  const child = spawn("bash", ["-l"], { cwd: "/home/z/my-project", env });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => onExit(code ?? 0));
  return {
    startedAt: Date.now(),
    lastInputAt: Date.now(),
    pty: false,
    write: (d) => {
      try {
        child.stdin.write(d);
      } catch {}
    },
    kill: () => {
      try {
        child.kill("SIGKILL");
      } catch {}
    },
  };
}

function armIdleTimer(socket: import("socket.io").Socket, sess: ShellSession, sessionId: string) {
  clearTimeout(sess.idleTimer);
  sess.idleTimer = setTimeout(() => {
    console.log(`[terminal] session ${sessionId} idle timeout`);
    socket.emit("exit", { code: "idle" });
    sess.kill();
  }, IDLE_TIMEOUT_MS);
}

async function authorize(
  cookieHeader: string | undefined,
  ticket: unknown
): Promise<{ ok: boolean; role?: string; reason?: string }> {
  // Path 1 — single-use ticket (works through cookie-stripping proxies).
  if (typeof ticket === "string" && ticket.length >= 24) {
    const bearer = cliBearerToken();
    if (bearer) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(PANEL_TICKET_CONSUME_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ ticket }),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; role?: string };
          if (data.ok) return { ok: true, role: data.role };
        }
        return { ok: false, reason: `ticket rejected (HTTP ${res.status})` };
      } catch (e) {
        return { ok: false, reason: `ticket consume failed: ${(e as Error).message}` };
      }
    }
    return { ok: false, reason: "CLI token unavailable to terminal service" };
  }
  // Path 2 — cookie fallback (direct same-network access).
  if (!cookieHeader) return { ok: false, reason: "no ticket and no cookie" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(PANEL_SESSION_URL, {
      headers: { cookie: cookieHeader },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, reason: `session endpoint HTTP ${res.status}` };
    const data = (await res.json()) as { authenticated: boolean; user?: { role: string } };
    if (!data.authenticated || !data.user) return { ok: false, reason: "session not authenticated" };
    return { ok: true, role: data.user.role };
  } catch (e) {
    return { ok: false, reason: `session check failed: ${(e as Error).message}` };
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, sessions: sessions.size, pty: !!ptyModule }));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

const io = new Server(httpServer, {
  path: "/", // gateway requirement
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 30000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
});

io.on("connection", (socket) => {
  // Buffer events that arrive before async authorization completes (race fix):
  let authorized = false;
  const early = new Map<string, unknown[]>();

  let sessionId = `s${++counter}`;
  let sess: ShellSession | null = null;

  function onEvent(event: string, handler: (data: never) => void) {
    socket.on(event, (data: unknown) => {
      if (!authorized) {
        const list = early.get(event) || [];
        list.push(data);
        early.set(event, list);
        return;
      }
      handler(data as never);
    });
  }

  function armIdleTimer() {
    if (!sess) return;
    clearTimeout(sess.idleTimer);
    sess.idleTimer = setTimeout(() => {
      console.log(`[terminal] session ${sessionId} idle timeout`);
      socket.emit("exit", { code: "idle" });
      sess?.kill();
    }, IDLE_TIMEOUT_MS);
  }

  function handleStart(data: { cols?: number; rows?: number }) {
    if (sessions.size >= MAX_SESSIONS) {
      socket.emit("notice", { message: "Session limit reached (5) — close a tab first" });
      return;
    }
    if (sess) return;
    const cols = Math.min(500, Math.max(10, data.cols || 80));
    const rows = Math.min(300, Math.max(4, data.rows || 24));
    sess = spawnShell(
      (chunk) => socket.emit("output", chunk),
      (code) => {
        socket.emit("exit", { code });
        cleanup();
      },
      cols,
      rows
    );
    sessions.set(sessionId, sess);
    armIdleTimer();
    sess.hardTimer = setTimeout(() => {
      socket.emit("exit", { code: "max-duration" });
      sess?.kill();
    }, HARD_CAP_MS);
    if (!sess.pty) {
      socket.emit("notice", { message: "PTY backend unavailable — plain pipe shell mode (no TTY control sequences)" });
    }
    socket.emit("ready", { pty: sess.pty });
    console.log(`[terminal] ${sessionId} started (pty=${sess.pty})`);
  }

  function handleInput(data: string) {
    if (!sess || typeof data !== "string" || data.length > 4096) return;
    sess.lastInputAt = Date.now();
    armIdleTimer();
    sess.write(data);
  }

  function handleResize(data: { cols?: number; rows?: number }) {
    if (!sess?.resize) return;
    const cols = Math.min(500, Math.max(10, data.cols || 80));
    const rows = Math.min(300, Math.max(4, data.rows || 24));
    sess.resize(cols, rows);
  }

  function cleanup() {
    if (!sess) return;
    clearTimeout(sess.idleTimer);
    clearTimeout(sess.hardTimer);
    sessions.delete(sessionId);
    console.log(`[terminal] ${sessionId} ended`);
    sess = null;
  }

  // Attach listeners immediately (events buffer until authorized)
  onEvent("start", handleStart);
  onEvent("input", handleInput);
  onEvent("resize", handleResize);
  socket.on("kill", () => sess?.kill());
  socket.on("disconnect", () => {
    sess?.kill();
    cleanup();
  });

  // Async authorization (ticket-first), then replay buffered events
  authorize(socket.handshake.headers.cookie, (socket.handshake.auth as { ticket?: unknown } | undefined)?.ticket)
    .then((auth) => {
      if (!auth.ok || (auth.role !== "admin" && auth.role !== "developer")) {
        console.log(`[terminal] denied: ${auth.reason || `role=${auth.role}`}`);
        socket.emit("auth_error", {
          error:
            auth.role && auth.role !== "admin" && auth.role !== "developer"
              ? `Terminal access is limited to admins and developers (you are ${auth.role}).`
              : "Panel authentication required — reopen the Terminal view to draw a fresh ticket.",
        });
        socket.disconnect(true);
        return;
      }
      authorized = true;
      for (const [event, list] of early) {
        for (const data of list) {
          if (event === "start") handleStart(data as { cols?: number; rows?: number });
          else if (event === "input") handleInput(data as string);
          else if (event === "resize") handleResize(data as { cols?: number; rows?: number });
        }
      }
      early.clear();
    })
    .catch(() => {
      socket.emit("auth_error", { error: "Panel authentication failed" });
      socket.disconnect(true);
    });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[terminal] listening on 127.0.0.1:${PORT} (pty=${!!ptyModule})`);
});

process.on("SIGTERM" as string, () => {
  for (const s of sessions.values()) s.kill();
  process.exit(0);
});
process.on("SIGINT" as string, () => {
  for (const s of sessions.values()) s.kill();
  process.exit(0);
});
