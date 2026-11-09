import { NextResponse } from "next/server";

/** Typed API error used by all route handlers. */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  // Never leak internals; log server-side only.
  console.error("[api] unhandled error:", err);
  return NextResponse.json(
    { error: "Internal server error", code: "internal" },
    { status: 500 }
  );
}

/** Wrap a route handler with uniform error handling (NextResponse or plain Response). */
export function handle<T extends unknown[]>(
  fn: (...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      return jsonError(err);
    }
  };
}
