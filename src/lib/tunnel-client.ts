import { db } from "@/lib/db";
import { decrypt, encrypt, randomBase62, sha256Hex } from "@/lib/crypto";
import { PANEL_PORT, RELAY_INTERNAL_URL } from "@/lib/constants";
import { getSetting, setSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";

/**
 * HipnoType Relay tunnel client (spec §4.3):
 * - Registers once with the relay (install nonce) → serverId + tunnelSecret + token
 * - Opens an OUTBOUND persistent WebSocket to the relay, authenticates with
 *   the tunnel secret, and serves proxied HTTP requests from the local panel.
 * - Auto-reconnect with exponential backoff + jitter, 15s heartbeats,
 *   status exposed to the UI and `hypno tunnel status`.
 */

export type TunnelStatus = "connecting" | "connected" | "failed" | "disabled";

export interface TunnelState {
  status: TunnelStatus;
  latencyMs: number | null;
  lastError: string | null;
  lastConnectedAt: number | null;
  relayUrl: string;
  serverId: string | null;
}

const g = globalThis as unknown as {
  __hipnoTunnel?: {
    state: TunnelState;
    socket: import("socket.io-client").Socket | null;
    started: boolean;
  };
};

function tunnelG() {
  if (!g.__hipnoTunnel) {
    g.__hipnoTunnel = { state: {
      status: "connecting", latencyMs: null, lastError: null,
      lastConnectedAt: null, relayUrl: RELAY_INTERNAL_URL, serverId: null,
    }, socket: null, started: false };
  }
  return g.__hipnoTunnel;
}

export function getTunnelStatus(): TunnelState & { token?: string | null } {
  const t = tunnelG();
  return { ...t.state };
}

/** Registration with the relay (idempotent — stored in settings). */
export async function ensureRegistered(): Promise<{ serverId: string; secret: string }> {
  const serverId = await getSetting("access.serverId", null);
  const secretEnc = await getSetting("access.tunnelSecretEnc", null);
  if (serverId && secretEnc) {
    tunnelG().state.serverId = serverId;
    return { serverId, secret: decrypt(secretEnc) };
  }
  const relayUrl = await getSetting("access.relayUrl", RELAY_INTERNAL_URL);
  const nonce = randomBase62(32);
  const res = await fetch(`${relayUrl}/api/v1/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, nonceHash: sha256Hex(nonce), label: "panel", version: "1.0.0" }),
  });
  if (!res.ok) throw new Error(`relay registration failed: HTTP ${res.status}`);
  const data = (await res.json()) as { serverId: string; tunnelSecret: string; token: string };
  await setSetting("access.serverId", data.serverId);
  await setSetting("access.tunnelSecretEnc", encrypt(data.tunnelSecret));
  await setSetting("access.token", data.token);
  await setSetting("access.tokenCreatedAt", new Date().toISOString());
  await db.accessToken.create({
    data: { token: data.token, isCustom: false, label: "initial (relay-issued)", createdBy: "system" },
  });
  await audit({
    action: "relay.registered",
    source: "system",
    target: data.serverId,
    details: { tokenFingerprint: data.token.slice(0, 4) + "…" },
  });
  tunnelG().state.serverId = data.serverId;
  return { serverId: data.serverId, secret: data.tunnelSecret };
}

/**
 * Two-phase access-URL rotation (spec §4.4):
 * Phase 1 — relay confirms the new token; Phase 2 — panel commits.
 * On commit failure the relay change is rolled back.
 */
export async function rotateAccessToken(
  newToken: string,
  actor?: { id?: string; email?: string }
): Promise<{ ok: boolean; error?: string; url?: string }> {
  const relayUrl = await getSetting("access.relayUrl", RELAY_INTERNAL_URL);
  const { serverId, secret } = await ensureRegistered();
  const currentToken = await getSetting("access.token", null);
  if (!currentToken) return { ok: false, error: "No current token — tunnel not registered yet" };

  // Phase 1: relay
  try {
    const res = await fetch(`${relayUrl}/api/v1/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ currentToken, newToken, serverId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error || `relay rejected rotation (HTTP ${res.status})` };
    }
  } catch (e) {
    return { ok: false, error: `Relay unreachable — nothing was changed (${e instanceof Error ? e.message : "network error"})` };
  }

  // Phase 2: commit locally
  const oldToken = currentToken;
  try {
    await setSetting("access.token", newToken);
    await setSetting("access.tokenCreatedAt", new Date().toISOString());
    await db.accessToken.updateMany({
      where: { token: oldToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await db.accessToken.create({
      data: { token: newToken, isCustom: newToken.length !== 32, label: "rotated", createdBy: actor?.email || "system" },
    });
    // Invalidate ALL active sessions (spec §4.4)
    await db.session.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: "access.rotate",
      source: actor ? "web" : "system",
      details: {
        oldTokenFingerprint: oldToken.slice(0, 4) + "…",
        newTokenFingerprint: newToken.slice(0, 4) + "…",
        sessionsRevoked: true,
      },
    });
    return { ok: true, url: `/server/panel/${newToken}/` };
  } catch (e) {
    // Commit failed → roll back the relay change
    try {
      await fetch(`${relayUrl}/api/v1/rotate`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ currentToken: newToken, newToken: oldToken, serverId }),
      });
    } catch {}
    return { ok: false, error: `Commit failed, rolled back: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

/** Start (or restart) the tunnel. Safe to call repeatedly. */
export async function startTunnel(force = false): Promise<void> {
  const t = tunnelG();
  if (t.started && !force) return;
  t.started = true;
  const relayUrl = await getSetting("access.relayUrl", RELAY_INTERNAL_URL);
  t.state.relayUrl = relayUrl;

  let serverId: string;
  let secret: string;
  try {
    const reg = await ensureRegistered();
    serverId = reg.serverId;
    secret = reg.secret;
  } catch (e) {
    t.state.status = "failed";
    t.state.lastError = e instanceof Error ? e.message : "registration failed";
    // retry registration via reconnect cycle
    t.started = false;
    setTimeout(() => void startTunnel(), 10_000);
    return;
  }

  const { io } = await import("socket.io-client");
  if (t.socket) {
    try { t.socket.disconnect(); } catch {}
  }
  const socket = io(relayUrl, {
    path: "/tunnel-socket",
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.4, // jitter
    timeout: 10_000,
  });
  t.socket = socket;
  t.state.status = "connecting";
  t.state.lastError = null;

  socket.on("connect", () => {
    socket.emit("auth", { serverId, secret: sha256Hex(secret), ts: Date.now() });
  });
  socket.on("authenticated", () => {
    t.state.status = "connected";
    t.state.lastError = null;
    t.state.lastConnectedAt = Date.now();
  });
  socket.on("auth_failed", (err: { error?: string }) => {
    t.state.status = "failed";
    t.state.lastError = err?.error || "relay authentication failed";
    socket.disconnect();
  });
  socket.on("disconnect", () => {
    if (t.state.status !== "failed") t.state.status = "connecting";
  });
  socket.on("connect_error", (err: Error) => {
    t.state.status = "failed";
    t.state.lastError = err.message;
  });

  // Heartbeat / latency every 15s. The interval self-guards on socket.connected
  // and survives reconnects (socket.io reuses the same socket object), so it is
  // armed once per tunnel lifetime.
  setInterval(() => {
    if (!socket.connected) return;
    const sent = Date.now();
    socket
      .timeout(5000)
      .emit("ping", { ts: sent }, () => {
        t.state.latencyMs = Date.now() - sent;
      });
  }, 15_000);

  // Serve proxied requests from the local panel
  socket.on("request", async (req: {
    id: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    bodyB64?: string;
  }) => {
    try {
      const url = `http://127.0.0.1:${PANEL_PORT}${req.path}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (["host", "connection", "content-length", "transfer-encoding"].includes(k.toLowerCase())) continue;
        headers[k] = v;
      }
      const res = await fetch(url, {
        method: req.method,
        headers,
        body: req.bodyB64 ? Buffer.from(req.bodyB64, "base64") : undefined,
        redirect: "manual",
      });
      const ab = await res.arrayBuffer();
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (["transfer-encoding", "content-encoding", "content-length", "connection"].includes(k.toLowerCase())) return;
        resHeaders[k] = v;
      });
      socket.emit("response", {
        id: req.id,
        status: res.status,
        headers: resHeaders,
        bodyB64: Buffer.from(ab).toString("base64"),
      });
    } catch (e) {
      socket.emit("response", {
        id: req.id,
        status: 502,
        headers: { "content-type": "text/plain" },
        bodyB64: Buffer.from(`tunnel upstream error: ${e instanceof Error ? e.message : "unknown"}`).toString("base64"),
      });
    }
  });

  // ---- WebSocket bridge: relay ↔ local WS service (browser terminal etc.)
  const wsSessions = new Map<string, import("ws").WebSocket>();
  socket.on("wsopen", (msg: { id: string; path: string }) => {
    console.log(`[hipno] tunnel wsopen: ${msg.id} → ${msg.path}`);
    const terminalPort = Number(process.env.HIPNO_TERMINAL_PORT || 3004);
    const target = `ws://127.0.0.1:${terminalPort}${msg.path}`;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: ws is only needed when a terminal session opens
      const { WebSocket } = require("ws") as typeof import("ws");
      const local = new WebSocket(target);
      let firstMsg = true;
      local.on("open", () => { console.log(`[hipno] tunnel ws ${msg.id} local OPEN`); socket.emit("wsopened", { id: msg.id, ok: true }); });
      local.on("message", (data) => {
        if (firstMsg) { firstMsg = false; console.log(`[hipno] tunnel ws ${msg.id} local→relay frame: ${String(data).slice(0, 60)}`); }
        socket.emit("wsdata", { id: msg.id, b64: Buffer.from(data as Buffer).toString("base64") });
      });
      const gone = () => {
        wsSessions.delete(msg.id);
        socket.emit("wsclose", { id: msg.id });
      };
      local.on("close", gone);
      local.on("error", (e: Error) => {
        console.log(`[hipno] tunnel ws ${msg.id} local ERROR: ${e.message}`);
        wsSessions.delete(msg.id);
        socket.emit("wsopened", { id: msg.id, ok: false, error: e.message });
      });
      wsSessions.set(msg.id, local);
    } catch (e) {
      console.log(`[hipno] tunnel ws ${msg.id} DIAL FAILED: ${e instanceof Error ? e.message : String(e)}`);
      socket.emit("wsopened", {
        id: msg.id,
        ok: false,
        error: e instanceof Error ? e.message : "local ws dial failed",
      });
    }
  });
  socket.on("wsdata", (msg: { id: string; b64: string }) => {
    const local = wsSessions.get(msg.id);
    if (local && local.readyState === local.OPEN) local.send(Buffer.from(msg.b64, "base64"));
  });
  socket.on("wsclose", (msg: { id: string }) => {
    const local = wsSessions.get(msg.id);
    if (local) {
      try { local.close(); } catch {}
      wsSessions.delete(msg.id);
    }
  });
  socket.on("disconnect", () => {
    for (const [, local] of wsSessions) {
      try { local.close(); } catch {}
    }
    wsSessions.clear();
  });
}
