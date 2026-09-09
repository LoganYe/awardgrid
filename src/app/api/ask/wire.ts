/**
 * Wire format shared by POST /api/ask (server) and the Ask drawer (client) — pure, no I/O.
 *
 *   - `AskRequestBody`   zod schema of the POST body (prompt 1..2000 chars + optional context).
 *   - `sseFrame`         one SSE message: `event: <type>\ndata: <json>\n\n`.
 *   - `redactSecrets`    belt-and-braces: the only place a user's key may exist is the env map
 *                        handed to the SDK, but every byte streamed to the browser still passes
 *                        through here so a key can never appear in an event (kickoff §0.2 #8).
 *   - `AskWireEvent`     the loosely-typed event shape the drawer parses back from `data:`.
 */
import { z } from "zod";
import { QueryObject } from "@awardgrid/core/query/schema";

export const ASK_PROMPT_MAX = 2000;

/** The selected grid cell, as the drawer sends it (a subset of AvailabilityRow). */
export const AskCellContext = z.object({
  origin: z.string().min(3).max(4),
  dest: z.string().min(3).max(4),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cabin: z.enum(["Y", "W", "J", "F"]),
  program: z.string().min(1).max(64),
  miles: z.number().int().nonnegative(),
  fees_cents: z.number().int().nonnegative().nullable(),
  seats_left: z.number().int().nonnegative(),
  source_id: z.string().max(128),
});
export type AskCellContext = z.infer<typeof AskCellContext>;

export const AskContext = z.object({
  query: QueryObject.optional(),
  cell: AskCellContext.optional(),
});
export type AskContext = z.infer<typeof AskContext>;

export const AskRequestBody = z.object({
  prompt: z.string().trim().min(1).max(ASK_PROMPT_MAX),
  context: AskContext.optional(),
});
export type AskRequestBody = z.infer<typeof AskRequestBody>;

/** Event names runAsk() yields; anything else is forwarded verbatim but the drawer ignores it. */
export const ASK_EVENT_TYPES = ["init", "text", "tool", "result", "error"] as const;
export type AskEventType = (typeof ASK_EVENT_TYPES)[number];

/** Error codes the drawer knows how to explain (others render as a generic failure). */
export type AskErrorCode = "no_key" | "budget" | "timeout" | "plugin_missing" | "sdk" | "aborted" | "internal" | "unauthorized" | "invalid_body";

/** What the drawer reads out of each `data:` payload; every field is optional on purpose. */
export interface AskWireEvent {
  type: string;
  /** text */
  text?: string;
  /** tool */
  name?: string;
  /** init */
  model?: string;
  skills?: string[];
  /** result */
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
  subtype?: string;
  spentTodayUsd?: number;
  capUsd?: number;
  /** error */
  code?: string;
  message?: string;
}

/** Usage readout for the footer (GET /api/ask/usage). */
export interface AskUsageResponse {
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  /** ISO timestamp of the next UTC midnight (the cap resets then). */
  resetAt: string;
}

function nextUtcMidnight(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Normalize whatever getAskUsage returns to the wire shape. The lib contract is
 * { spentUsd, capUsd, remainingUsd }; `resetAt` is derived here when absent.
 */
export function usageResponse(raw: unknown, now: Date = new Date()): AskUsageResponse {
  const u = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const spentUsd = finiteNumber(u.spentUsd) ?? 0;
  const capUsd = finiteNumber(u.capUsd) ?? 0;
  const remainingUsd = finiteNumber(u.remainingUsd) ?? Math.max(0, capUsd - spentUsd);
  const resetAt = typeof u.resetAt === "string" ? u.resetAt : nextUtcMidnight(now);
  return { spentUsd, capUsd, remainingUsd, resetAt };
}

/** JSON error codes POST /api/ask answers with before the stream starts. */
export type AskApiErrorCode = "unauthorized" | "invalid_body" | "no_key" | "internal";

/** `event: <type>\ndata: <json>\n\n` — data is a single line because JSON.stringify never emits raw newlines. */
export function sseFrame(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Replace every occurrence of each secret (raw, and as it would appear inside a JSON string)
 * with a fixed mask. Secrets shorter than 8 chars are skipped: masking them would be noise and
 * a 7-char string cannot be a real API key.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined | null)[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 8) continue;
    const forms = new Set([s, JSON.stringify(s).slice(1, -1)]);
    for (const f of forms) {
      if (f.length === 0) continue;
      out = out.split(f).join("••••");
    }
  }
  return out;
}

/** Narrow an unknown value to { type: string, ... } for the wire; non-objects become an error event. */
export function toWireEvent(ev: unknown): { type: string; data: Record<string, unknown> } {
  if (ev && typeof ev === "object" && typeof (ev as { type?: unknown }).type === "string") {
    return { type: (ev as { type: string }).type, data: ev as Record<string, unknown> };
  }
  return { type: "error", data: { type: "error", code: "internal", message: "Malformed event" } };
}

/** Client side: parse a `data:` payload; null when it is not a JSON object with a string `type`. */
export function parseWireEvent(data: string, fallbackType?: string): AskWireEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : fallbackType;
  if (!type) return null;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const out: AskWireEvent = { type };
  const text = str(obj.text) ?? str(obj.delta);
  if (text !== undefined) out.text = text;
  const name = str(obj.name) ?? str(obj.tool);
  if (name !== undefined) out.name = name;
  const model = str(obj.model);
  if (model !== undefined) out.model = model;
  if (Array.isArray(obj.skills)) out.skills = obj.skills.filter((s): s is string => typeof s === "string");
  const cost = num(obj.costUsd) ?? num(obj.cost_usd) ?? num(obj.total_cost_usd);
  if (cost !== undefined) out.costUsd = cost;
  const turns = num(obj.numTurns) ?? num(obj.num_turns);
  if (turns !== undefined) out.numTurns = turns;
  const dur = num(obj.durationMs) ?? num(obj.duration_ms);
  if (dur !== undefined) out.durationMs = dur;
  const subtype = str(obj.subtype);
  if (subtype !== undefined) out.subtype = subtype;
  const spent = num(obj.spentTodayUsd) ?? num(obj.spentUsd);
  if (spent !== undefined) out.spentTodayUsd = spent;
  const cap = num(obj.capUsd);
  if (cap !== undefined) out.capUsd = cap;
  const code = str(obj.code);
  if (code !== undefined) out.code = code;
  const message = str(obj.message);
  if (message !== undefined) out.message = message;
  return out;
}
