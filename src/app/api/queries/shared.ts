/**
 * Shared bits of the /api/queries handlers: body schemas, error codes and the 404-on-other-
 * user rule. Error bodies are `{ error: <code> }` only (no names, ids or keys).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { QueryObject } from "@awardgrid/core/query/schema";
import {
  NAME_MAX,
  NAME_MIN,
  NOTIFY_ON,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  validateCron,
} from "@/lib/server/queries";

export type QueriesErrorCode =
  | "unauthorized"
  | "invalid_body"
  | "invalid_name"
  | "invalid_cron"
  | "cron_too_frequent"
  | "invalid_threshold"
  | "invalid_notify_on"
  | "invalid_query"
  | "not_found"
  | "no_key"
  | "run_in_progress"
  | "quota"
  | "seatsaero"
  | "internal";

const NO_STORE = { headers: { "cache-control": "no-store" } } as const;

export function queriesError(status: number, error: QueriesErrorCode, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, ...NO_STORE });
}

export function queriesJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, ...NO_STORE });
}

export const Name = z.string().trim().min(NAME_MIN).max(NAME_MAX);
export const Threshold = z.number().int().min(THRESHOLD_MIN).max(THRESHOLD_MAX);
export const Cron = z.string().trim().min(1).max(64);
export const Notify = z.enum(NOTIFY_ON);

export const CreateBody = z
  .object({
    name: Name,
    query: QueryObject,
    schedule_cron: Cron.optional(),
    notify_on: Notify.optional(),
    drop_threshold_pct: Threshold.optional(),
  })
  .strict();

export const PatchBody = z
  .object({
    enabled: z.boolean().optional(),
    name: Name.optional(),
    // The edit drawer's chip editors send the whole QueryObject back, the same shape CreateBody
    // takes; omitting it leaves the stored chips untouched.
    query: QueryObject.optional(),
    schedule_cron: Cron.optional(),
    notify_on: Notify.optional(),
    drop_threshold_pct: Threshold.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "empty patch");

/** Map a zod failure to the most specific code the UI can translate. */
export function codeForIssues(issues: { path: PropertyKey[] }[]): QueriesErrorCode {
  const paths = new Set(issues.map((i) => String(i.path[0] ?? "")));
  if (paths.has("name")) return "invalid_name";
  if (paths.has("schedule_cron")) return "invalid_cron";
  if (paths.has("drop_threshold_pct")) return "invalid_threshold";
  if (paths.has("notify_on")) return "invalid_notify_on";
  if (paths.has("query")) return "invalid_query";
  return "invalid_body";
}

/** Cron is validated after zod (node-cron + the ≤ hourly rule); null = fine. */
export function cronProblem(cron: string | undefined): QueriesErrorCode | null {
  if (cron === undefined) return null;
  const v = validateCron(cron);
  if (v.ok) return null;
  return v.reason === "too_frequent" ? "cron_too_frequent" : "invalid_cron";
}

/** Validate a JSON body against `schema`; returns a ready error response on failure. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const ct = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  if (!(ct === "application/json" || ct.startsWith("application/json;"))) return { ok: false, response: queriesError(400, "invalid_body") };
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: queriesError(400, "invalid_body") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: queriesError(400, codeForIssues(parsed.error.issues)) };
  return { ok: true, data: parsed.data };
}
