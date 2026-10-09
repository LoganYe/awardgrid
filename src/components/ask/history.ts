/**
 * Ask history — sessionStorage only (spec §3.6: "History is kept for this browser session
 * only", and the drawer says so in one muted line). Nothing is written to localStorage, to a
 * cookie or to the server: closing the tab ends the history, which is what the line promises.
 *
 * Pure except for the two storage calls, both guarded: a browser with storage disabled reads
 * back an empty history instead of throwing.
 *
 * Short-term caching: an answer can quote seats.aero results, which are kept 24 hours at most
 * (src/components/workspace/retention.ts). Each turn records when it was answered, and a turn
 * older than ASK_HISTORY_MAX_AGE_MS (or with no readable time, as turns stored before this rule)
 * is dropped when the history is read. Disconnect clears it at once (clearAskSession).
 */

import { ASK_DEMO_STORAGE_KEY } from "@/components/ask/demo";

export const ASK_HISTORY_KEY = "awardgrid.ask.history";
/** Keep the drawer light: only the last few turns survive a re-open. */
export const ASK_HISTORY_MAX = 10;
/** The Short-Term Caching limit for anything quoting seats.aero results. */
export const ASK_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface AskTurn {
  prompt: string;
  text: string;
  tools: string[];
  costUsd: number | null;
  /** When the answer finished (ISO). */
  at: string;
}

function isTurn(v: unknown): v is AskTurn {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.prompt === "string" &&
    typeof t.text === "string" &&
    Array.isArray(t.tools) &&
    t.tools.every((x) => typeof x === "string") &&
    (t.costUsd === null || typeof t.costUsd === "number") &&
    typeof t.at === "string"
  );
}

/** Whether a turn was answered at or after `cutoff` (ms); a time that cannot be read cannot be shown to be recent. */
function recent(turn: AskTurn, cutoff: number): boolean {
  const at = Date.parse(turn.at);
  return Number.isFinite(at) && at >= cutoff;
}

/** Parse a stored payload; anything unexpected, and any turn older than 24 hours at `nowMs`, is left out. */
export function parseHistory(raw: string | null, nowMs: number = Date.now()): AskTurn[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = nowMs - ASK_HISTORY_MAX_AGE_MS;
    return parsed.filter(isTurn).filter((turn) => recent(turn, cutoff)).slice(-ASK_HISTORY_MAX);
  } catch {
    return [];
  }
}

/** Append a turn, capped at ASK_HISTORY_MAX (oldest dropped first). */
export function appendTurn(history: readonly AskTurn[], turn: AskTurn): AskTurn[] {
  return [...history, turn].slice(-ASK_HISTORY_MAX);
}

/** Read this session's history. Server-side or storage-less browsers get []. */
export function loadHistory(): AskTurn[] {
  if (typeof window === "undefined") return [];
  try {
    return parseHistory(window.sessionStorage.getItem(ASK_HISTORY_KEY));
  } catch {
    return [];
  }
}

/** Persist this session's history; failures are silent (the drawer still works without it). */
export function saveHistory(history: readonly AskTurn[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ASK_HISTORY_KEY, JSON.stringify(history.slice(-ASK_HISTORY_MAX)));
  } catch {
    // storage disabled or full: the in-memory history is still correct for this drawer
  }
}

/**
 * Forget everything the Ask drawer kept for this browser session. sessionStorage survives a
 * same-tab navigation, so without this a log-out followed by another user's log-in in the same
 * tab would show that user the previous one's questions and answers. Called from the log-out
 * button and again on a successful log-in: whichever end of the hand-over runs first, the next
 * session starts empty. The `?askdemo=1` switch goes with it, so an e2e switch cannot outlive
 * the session that set it either.
 */
export function clearAskSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ASK_HISTORY_KEY);
    window.sessionStorage.removeItem(ASK_DEMO_STORAGE_KEY);
  } catch {
    // storage disabled: there was nothing stored to clear
  }
}
