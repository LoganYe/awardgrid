/**
 * Pure state machine for Telegram linking on the Settings page (tested without React):
 *
 *   idle → linking → waiting (deep link + QR shown, GET /api/telegram/status polled every 3 s
 *                             for 2 minutes) → linked | timed out | error
 *        → unavailable (the server has no bot configured, so there is nothing to scan)
 *
 * A transient status failure does not end the wait: the window closing does.
 */
export const POLL_INTERVAL_MS = 3_000;
export const POLL_WINDOW_MS = 120_000;

export type Notice = { kind: "ok" | "error"; text: string };

export type TelegramLinkState =
  | { phase: "idle"; linked: boolean; notice: Notice | null }
  | { phase: "linking"; linked: false; notice: null }
  | { phase: "waiting"; linked: false; deepLink: string; startedAt: number; polls: number; notice: null }
  /** No bot token and no bot username on the server: linking cannot be offered here. */
  | { phase: "unavailable"; linked: false; notice: null };

export type TelegramLinkAction =
  | { type: "link_start" }
  | { type: "link_ready"; deepLink: string; now: number }
  | { type: "link_unavailable" }
  | { type: "link_failed"; text: string }
  | { type: "poll"; linked: boolean; now: number }
  | { type: "poll_failed"; now: number }
  | { type: "unlinked"; text: string }
  | { type: "error"; text: string }
  | { type: "dismiss" };

export interface TelegramTexts {
  linkedNow: string;
  timeout: string;
}

export function initialTelegramState(linked: boolean): TelegramLinkState {
  return { phase: "idle", linked, notice: null };
}

/** True while the status endpoint should be polled. */
export function shouldPoll(state: TelegramLinkState): boolean {
  return state.phase === "waiting";
}

/** Seconds left in the polling window (0 when expired or not waiting). */
export function secondsLeft(state: TelegramLinkState, now: number): number {
  if (state.phase !== "waiting") return 0;
  return Math.max(0, Math.ceil((state.startedAt + POLL_WINDOW_MS - now) / 1000));
}

export function telegramLinkReducer(state: TelegramLinkState, action: TelegramLinkAction, texts: TelegramTexts): TelegramLinkState {
  switch (action.type) {
    case "link_start":
      return { phase: "linking", linked: false, notice: null };
    case "link_ready":
      return { phase: "waiting", linked: false, deepLink: action.deepLink, startedAt: action.now, polls: 0, notice: null };
    case "link_unavailable":
      return { phase: "unavailable", linked: false, notice: null };
    case "link_failed":
      return { phase: "idle", linked: false, notice: { kind: "error", text: action.text } };
    case "poll":
    case "poll_failed": {
      if (state.phase !== "waiting") return state;
      if (action.type === "poll" && action.linked) return { phase: "idle", linked: true, notice: { kind: "ok", text: texts.linkedNow } };
      if (action.now - state.startedAt >= POLL_WINDOW_MS) return { phase: "idle", linked: false, notice: { kind: "error", text: texts.timeout } };
      return { ...state, polls: state.polls + 1 };
    }
    case "unlinked":
      return { phase: "idle", linked: false, notice: { kind: "ok", text: action.text } };
    case "error":
      return { phase: "idle", linked: state.linked, notice: { kind: "error", text: action.text } };
    case "dismiss":
      return state.phase === "idle" ? { ...state, notice: null } : state;
    default:
      return state;
  }
}
