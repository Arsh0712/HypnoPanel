import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { sha256Hex } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * POST /api/terminal/tickets/consume — redeem a one-shot terminal ticket.
 *
 * Machine-to-machine: called by the terminal mini-service on localhost with
 * the panel's local CLI token (Bearer, same trust path as the `hypno` CLI).
 * The user identity comes from the ticket itself (issued to an authenticated
 * browser session), so consuming is safe regardless of which admin token
 * performs the call. Single-use, 30-second TTL.
 */

interface TicketRecord {
  hash: string;
  userId: string;
  email: string;
  role: string;
  expiresAt: number;
  used: boolean;
}

const g = globalThis as unknown as { __hipnoTermTickets?: Map<string, TicketRecord> };

export const POST = handle(async (req: NextRequest) => {
  // Only API-token bearers (CLI / internal services) may redeem tickets.
  const ctx = await authenticate(req);
  if (!ctx || ctx.via !== "api-token") {
    throw new ApiError(401, "unauthenticated", "Internal token required");
  }

  const body = (await req.json().catch(() => ({}))) as { ticket?: string };
  const ticket = (body.ticket || "").trim();
  if (!ticket || ticket.length < 24 || ticket.length > 64) {
    throw new ApiError(400, "invalid_input", "Ticket required");
  }

  const store = g.__hipnoTermTickets;
  if (!store) throw new ApiError(404, "not_found", "Unknown ticket");
  const rec = store.get(sha256Hex(ticket));
  if (!rec) throw new ApiError(404, "not_found", "Unknown ticket");
  if (rec.used) throw new ApiError(410, "gone", "Ticket already used");
  if (rec.expiresAt < Date.now()) {
    store.delete(sha256Hex(ticket));
    throw new ApiError(410, "gone", "Ticket expired");
  }
  rec.used = true;
  store.delete(sha256Hex(ticket));
  return NextResponse.json({ ok: true, userId: rec.userId, email: rec.email, role: rec.role });
});
