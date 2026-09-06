/**
 * Ask history — sessionStorage only (spec §3.6: "History is kept for this browser session
 * only", and the drawer says so in one muted line). Nothing is written to localStorage, to a
 * cookie or to the server: closing the tab ends the history, which is what the line promises.
 *
 * Pure except for the two storage calls, both guarded: a browser with storage disabled reads
 * back an empty history instead of throwing.
 */

import { ASK_DEMO_STORAGE_KEY } from "@/components/ask/demo";

export const ASK_HISTORY_KEY = "awardgrid.ask.history";
/** Keep the drawer light: only the last few turns survive a re-open. */
export const ASK_HISTORY_MAX = 10;

export interface AskTurn {
  prompt: string;
  text: string;
  tools: string[];
  costUsd: number | null;
}

function isTurn(v: unknown): v is AskTurn {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.prompt === "string" &&
    typeof t.text === "string" &&
    Array.isArray(t.tools) &&
    t.tools.every((x) => typeof x === "string") &&
    (t.costUsd === null || typeof t.costUsd === "number")
  );
}

/** Parse a stored payload; anything unexpected becomes an empty history. */
export function parseHistory(raw: string | null): AskTurn[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTurn).slice(-ASK_HISTORY_MAX);
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
