import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";
import { ApiError } from "@/lib/api-error";
import { hasPermission, type Permission } from "@/lib/permissions";
import { SESSION_COOKIE } from "@/lib/constants";
import {
  validateSessionToken,
  verifySameOrigin,
  getClientIp,
} from "./session";

/**
 * API guard: cookie sessions (browser) or Bearer API tokens (CLI / programmatic).
 * Enforces: authentication → account state → forced password change → permission.
 */

export interface AuthContext {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  via: "cookie" | "api-token";
  scopes: string[];
  sessionId: string;
}

export async function authenticate(req: Request): Promise<AuthContext | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  const m = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`)
  );
  if (m) {
    const found = await validateSessionToken(decodeURIComponent(m[1]));
    if (found) {
      return {
        userId: found.user.id,
        email: found.user.email,
        name: found.user.name,
        role: found.user.role,
        mustChangePassword: found.user.mustChangePassword,
        totpEnabled: found.user.totpEnabled,
        via: "cookie",
        scopes: ["*"],
        sessionId: found.sessionId,
      };
    }
  }
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    const row = await db.apiToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    if (row.user.disabled) return null;
    if (row.lastUsedAt === null || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    }
    return {
      userId: row.user.id,
      email: row.user.email,
      name: row.user.name,
      role: row.user.role,
      mustChangePassword: false, // token auth bypasses forced-change gate
      totpEnabled: row.user.totpEnabled,
      via: "api-token",
      scopes: JSON.parse(row.scopes || "[]") as string[],
      sessionId: `token:${row.id}`,
    };
  }
  return null;
}

export interface GuardOptions {
  permission?: Permission | string;
  /** Allow the call while mustChangePassword is pending (login flow only). */
  allowDuringPasswordChange?: boolean;
  /** Enforce same-origin for mutating methods (default true). */
  csrf?: boolean;
}

export async function guard(req: Request, opts: GuardOptions = {}): Promise<AuthContext> {
  const ctx = await authenticate(req);
  if (!ctx) throw new ApiError(401, "unauthenticated", "Authentication required");

  if (opts.csrf !== false) {
    const method = req.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      // verifySameOrigin handles browsers (unforgeable Sec-Fetch-Site) and
      // non-browser clients (CLI, relay server-to-server) separately, and
      // keeps working when a gateway rewrites the Host header.
      const ok = verifySameOrigin(req);
      if (!ok) throw new ApiError(403, "csrf", "Cross-origin request rejected");
    }
  }

  if (ctx.mustChangePassword && !opts.allowDuringPasswordChange) {
    throw new ApiError(403, "must_change_password", "Password change required");
  }

  if (opts.permission) {
    const hasScope =
      ctx.via === "api-token"
        ? (ctx.scopes.includes("*") || ctx.scopes.includes(opts.permission))
        : true;
    if (!hasScope) throw new ApiError(403, "token_scope", "Token scope insufficient");
    if (!hasPermission(ctx.role, opts.permission)) {
      throw new ApiError(403, "forbidden", "You do not have permission for this action");
    }
  }
  return ctx;
}

export { getClientIp };
