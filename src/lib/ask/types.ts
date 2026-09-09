/**
 * Shared types for the ask lane. Nothing here may carry key material except `AskKeys`, which
 * exists only to be handed to `buildAskOptions` (→ the SDK subprocess env) and is never
 * serialized, logged, or placed in an event.
 */
import type { QueryObject } from "@awardgrid/core/query/schema";

/** Decrypted per-user provider keys. seats.aero is mandatory (no key → `no_key`, never a fallback). */
export interface AskKeys {
  seats_aero: string;
  duffel?: string;
  ignav?: string;
}

export type AskLang = "en" | "zh";

/** What the Ask drawer injects: the current grid's QueryObject and the selected cell, if any. */
export interface AskContext {
  query?: QueryObject | null;
  /** The selected grid cell as plain JSON (GridCell or a compact projection of it). */
  cell?: unknown;
  /** UI language; the model still answers in the language of the question. */
  lang?: AskLang;
}

export interface AskUserRef {
  id: string;
  locale?: string | null;
}

export type AskErrorCode = "no_key" | "budget" | "timeout" | "plugin_missing" | "sdk";

export type AskEvent =
  | {
      type: "init";
      plugins: { name: string; path: string }[];
      skills: string[];
      mcp_servers: { name: string; status: string }[];
      model: string;
    }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "result"; cost_usd: number; num_turns: number; duration_ms: number; subtype: string }
  | { type: "error"; code: AskErrorCode; message: string };
