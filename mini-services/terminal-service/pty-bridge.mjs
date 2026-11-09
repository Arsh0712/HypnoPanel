#!/usr/bin/env node
/**
 * HipnoType terminal-service — PTY bridge (runs under Node, spawned by the
 * bun service).
 *
 * WHY THIS EXISTS: node-pty's master side uses `tty.ReadStream`; under Bun
 * (≥1.3) that stream treats EAGAIN as fatal — the master closes and the
 * kernel SIGHUPs the shell ~immediately after the first output chunk. Under
 * Node the very same node-pty build works flawlessly (verified). So when the
 * service runs under Bun it hosts each shell in this tiny Node sidecar.
 *
 * Protocol — JSON lines over stdio (content of terminal sessions NEVER hits
 * any log; it only transits these pipes):
 *   service → bridge: {"t":"start","file","args","cols","rows","cwd"}
 *                      {"t":"in","d"} {"t":"resize","cols","rows"} {"t":"kill"}
 *   bridge → service: {"t":"ready","pty":true}
 *                      {"t":"out","d"} {"t":"exit","code","signal"}
 *                      {"t":"error","message"}
 *
 * The bridge can never outlive the service: when stdin closes (service death)
 * the shell is killed and the bridge exits.
 */
import pty from "node-pty";

let term = null;
let started = false;
let finished = false;

function emit(msg) {
  try {
    process.stdout.write(JSON.stringify(msg) + "\n");
  } catch {
    /* stdout gone — nothing left to do */
  }
}

function tryKill() {
  if (term) {
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  }
}

function finish(code, signal) {
  if (finished) return;
  finished = true;
  emit({ t: "exit", code: typeof code === "number" ? code : 0, signal: signal ?? null });
  // Give stdout a moment to flush before exiting.
  setTimeout(() => process.exit(0), 50).unref();
  setTimeout(() => process.exit(0), 500).unref();
}

function handle(msg) {
  if (msg.t === "start" && !started) {
    started = true;
    try {
      term = pty.spawn(msg.file || "bash", Array.isArray(msg.args) ? msg.args : [], {
        name: "xterm-256color",
        cols: msg.cols || 80,
        rows: msg.rows || 24,
        cwd: typeof msg.cwd === "string" && msg.cwd ? msg.cwd : process.cwd(),
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (err) {
      emit({ t: "error", message: String(err && err.message ? err.message : err) });
      setTimeout(() => process.exit(1), 50).unref();
      return;
    }
    term.onData((d) => {
      if (!finished) emit({ t: "out", d });
    });
    term.onExit((e) => finish(e.exitCode, e.signal));
    emit({ t: "ready", pty: true });
  } else if (msg.t === "in" && term && typeof msg.d === "string") {
    try {
      term.write(msg.d);
    } catch {
      /* child gone */
    }
  } else if (msg.t === "resize" && term) {
    try {
      term.resize(Math.max(2, msg.cols | 0 || 80), Math.max(2, msg.rows | 0 || 24));
    } catch {
      /* child gone */
    }
  } else if (msg.t === "kill" && term) {
    tryKill();
  }
}

process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // partial/corrupt line — skip
    }
    handle(msg);
  }
});

// Service died (pipe closed) or signalled us — never leak the shell.
process.stdin.on("close", () => {
  tryKill();
  setTimeout(() => process.exit(0), 100).unref();
});
process.stdin.on("end", () => {
  tryKill();
  setTimeout(() => process.exit(0), 100).unref();
});
process.on("SIGTERM", () => {
  tryKill();
  setTimeout(() => process.exit(0), 50).unref();
});
process.on("SIGINT", () => {
  tryKill();
  setTimeout(() => process.exit(0), 50).unref();
});
