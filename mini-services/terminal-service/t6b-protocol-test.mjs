/**
 * T6-b protocol test (throwaway — deleted after verification) — drives the
 * terminal service through the gateway (Caddy :81, XTransformPort=3004)
 * exactly like the browser would (minus the browser's automatic cookie
 * attach, emulated with extraHeaders).
 */
import { io } from "/home/z/my-project/node_modules/socket.io-client/build/esm/index.js";

const PANEL = "http://127.0.0.1:3000";
const GATEWAY = "http://127.0.0.1:81";
const EMAIL = "admin@hypnotype.mangocloud.cyou";
const PASSWORD = "HypnoTest@Pass2026!";

async function login() {
  const res = await fetch(`${PANEL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: PANEL },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const raw = res.headers.get("set-cookie") || "";
  const m = raw.match(/hipno_session=([^;]+)/);
  if (!m) throw new Error(`login failed (${res.status}): ${await res.text()}`);
  return m[1];
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function runCase(name, cookie, { expectAuthError = false } = {}) {
  return new Promise((resolve) => {
    const socket = io(`${GATEWAY}/?XTransformPort=3004`, {
      transports: ["polling", "websocket"],
      reconnection: false,
      timeout: 8000,
      forceNew: true,
      extraHeaders: { cookie: `hipno_session=${cookie}` },
    });
    let output = "";
    let ready = null;
    const timer = setTimeout(() => fail(`${name}: timed out`), 20000);

    const done = (ok, msg) => {
      clearTimeout(timer);
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {}
      if (!ok) fail(msg);
      console.log(`PASS: ${name}${msg ? ` — ${msg}` : ""}`);
      resolve();
    };

    socket.on("connect", () => {
      socket.emit("start", { cols: 80, rows: 24 });
    });
    socket.on("ready", (d) => {
      ready = d;
      if (!ready || ready.pty !== true) fail(`${name}: ready payload ${JSON.stringify(ready)}`);
      socket.emit("input", "echo T6B-MARKER-$((41+1))\n");
    });
    socket.on("output", (d) => {
      output += String(d);
      if (output.includes("T6B-MARKER-42") && output.includes("\n")) {
        // marker echoed back — now exercise resize, then kill
        socket.emit("resize", { cols: 100, rows: 30 });
        socket.emit("kill");
      }
    });
    socket.on("exit", (d) => {
      if (expectAuthError) fail(`${name}: got exit ${JSON.stringify(d)} instead of auth_error`);
      done(true, `pty=${ready?.pty}, exit=${JSON.stringify(d)}, outputLen=${output.length}`);
    });
    socket.on("auth_error", (d) => {
      if (expectAuthError) done(true, `auth_error as expected: ${JSON.stringify(d)}`);
      else fail(`${name}: unexpected auth_error ${JSON.stringify(d)}`);
    });
    socket.on("connect_error", (err) => {
      fail(`${name}: connect_error ${err.message}`);
    });
  });
}

const cookie = await login();
console.log("login ok, cookie len", cookie.length);
await runCase("authenticated PTY session through gateway", cookie);
await runCase("bad cookie rejected", "definitely-not-a-valid-session-token", { expectAuthError: true });
console.log("ALL PASS");
process.exit(0);
