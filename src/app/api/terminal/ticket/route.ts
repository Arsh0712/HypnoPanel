import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { randomBase62, sha256Hex } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * Short-lived, single-use terminal connection tickets (spec §5.2 auth model).
 *
 * The browser cannot rely on the session cookie surviving every proxy chain
 * between it and the terminal mini-service (the outer preview edge rewrites
 * WebSocket handshakes). Instead the view — already authenticated by its
 * same-origin cookie — draws a 30-second, single-use ticket here and passes it
 * inside the socket.io CONNECT packet (never a URL). The terminal service
 * redeems it via /api/terminal/tickets/consume on localhost.
 */

interface TicketRecord {
  hash: string;
  userId: string;
  email: string;
  role: string;
  expiresAt: number;
  used: boolean;
}

const TTL_MS = 30_000;
const MAX_LIVE = 64;

const g = globalThis as unknown as { __hipnoTermTickets?: Map<string, TicketRecord> };
if (!g.__hipnoTermTickets) g.__hipnoTermTickets = new Map();

function prune(store: Map<string, TicketRecord>) {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now || v.used) store.delete(k);
  }
}

/** POST /api/terminal/ticket — issue a one-shot connection ticket. */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "terminal:use" });
  const ticket = randomBase62(36);
  const store = g.__hipnoTermTickets!;
  prune(store);
  if (store.size >= MAX_LIVE) {
    throw new ApiError(429, "too_many_tickets", "Too many pending terminal tickets — retry in a moment");
  }
  store.set(sha256Hex(ticket), {
    hash: sha256Hex(ticket),
    userId: ctx.userId,
    email: ctx.email,
    role: ctx.role,
    expiresAt: Date.now() + TTL_MS,
    used: false,
  });
  return NextResponse.json({ ticket, ttlMs: TTL_MS });
});
