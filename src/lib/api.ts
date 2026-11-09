"use client";

/**
 * Client API layer. All requests use RELATIVE paths and are base-path aware:
 * when the panel is served through the HipnoType Relay (under
 * /server/panel/<TOKEN>/), the relay injects window.__HIPNO_BASE__ and
 * window.__HIPNO_PORT__ into the page, and this client prefixes every call
 * and adds the gateway XTransformPort query (spec §4.3 sub-path correctness).
 */

declare global {
  interface Window {
    __HIPNO_BASE__?: string;
    __HIPNO_PORT__?: number;
  }
}

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function apiBase(): string {
  if (typeof window === "undefined") return "";
  return window.__HIPNO_BASE__ || "";
}

function buildUrl(path: string): string {
  const base = apiBase();
  const url = path.startsWith("/") ? path : `/${path}`;
  if (!base) return url;
  // gateway routing for the relay port (sandbox/gateway mode only — the relay
  // injects __HIPNO_PORT__ when the request came through ?XTransformPort=N;
  // in production tunnel mode it is intentionally absent)
  if (typeof window !== "undefined" && window.__HIPNO_PORT__) {
    const joiner = url.includes("?") ? "&" : "?";
    return `${base}${url}${joiner}XTransformPort=${window.__HIPNO_PORT__}`;
  }
  return `${base}${url}`;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(buildUrl(path), {
    ...opts,
    credentials: "same-origin",
    headers: {
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON (downloads) */
  }
  if (!res.ok) {
    const err = (data || {}) as { error?: string; code?: string };
    throw new ApiClientError(res.status, err.code || "error", err.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const get = <T = unknown>(path: string) => api<T>(path);
export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });
export const del = <T = unknown>(path: string) => api<T>(path, { method: "DELETE" });

/** Build a WebSocket/absolute URL under the current base (for socket.io etc.). */
export function wsUrl(): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const base = apiBase();
  if (!base) return `${proto}://${window.location.host}`;
  return `${proto}://${window.location.host}${base}`;
}

/** Format bytes for display. */
export function fmtBytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function fmtDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
