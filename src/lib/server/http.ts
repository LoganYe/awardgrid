/**
 * Tiny helpers shared by the route handlers. Error responses are `{ error: <code> }` only —
 * never a message that could carry a username, token or key (kickoff §10).
 */
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export type ApiErrorCode =
  | "invalid_body"
  | "invalid_credentials"
  | "rate_limited"
  | "invalid_invite"
  | "username_taken"
  | "weak_password"
  | "invalid_username"
  | "registration_failed"
  | "unauthorized"
  | "forbidden_origin"
  | "internal";

export function jsonError(status: number, error: ApiErrorCode, init?: ResponseInit): NextResponse {
  return NextResponse.json({ error }, { ...init, status });
}

export class BodyError extends Error {
  constructor() {
    super("invalid body");
    this.name = "BodyError";
  }
}

/**
 * True when the request declares a JSON body. Required for every JSON handler: an HTML form
 * cannot send `application/json` cross-site without a CORS preflight, so this (with the
 * Origin / Sec-Fetch-Site guard in src/proxy.ts) closes the text/plain login-CSRF trick.
 */
export function hasJsonContentType(request: Request): boolean {
  const ct = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  return ct === "application/json" || ct.startsWith("application/json;");
}

/**
 * Parse + validate a JSON body; throws BodyError (→ 400 invalid_body) on any failure,
 * including a missing or non-JSON Content-Type.
 */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  if (!hasJsonContentType(request)) throw new BodyError();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new BodyError();
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BodyError();
  return parsed.data;
}
