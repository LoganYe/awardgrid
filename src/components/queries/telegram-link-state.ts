/**
 * Pure state machine for the Telegram linking card (tested without React):
 *   idle → linking → waiting (deep link shown, status polled every 3 s for 2 min)
 *        → linked | timeout | error.
 */
export const POLL_INTERVAL_MS = 3_000;
export const POLL_WINDOW_MS = 120_000;

export type TelegramLinkState =
  | { phase: "idle"; linked: boolean; mock: boolean; notice: Notice | null }
  | { phase: "linking"; linked: false; mock: boolean; notice: null }
  | { phase: "waiting"; linked: false; mock: false; deepLink: string; startedAt: number; polls: number; notice: null }
  | { phase: "mock"; linked: false; mock: true; notice: null };

export type Notice = { kind: "ok" | "error"; text: string };

export type TelegramLinkAction =
  | { type: "link_start" }
  | { type: "link_ready"; deepLink: string; now: number }
  | { type: "link_mock" }
  | { type: "link_failed"; text: string }
  | { type: "poll"; linked: boolean; now: number }
  | { type: "poll_failed"; now: number }
  | { type: "unlinked"; text: string }
  | { type: "error"; text: string }
  | { type: "dismiss" };

export function initialTelegramState(linked: boolean, mock: boolean): TelegramLinkState {
  return { phase: "idle", linked, mock, notice: null };
}

/** True while the status endpoint should be polled. */
export function shouldPoll(state: TelegramLinkState): boolean {
  return state.phase === "waiting";
}

/** Seconds left in the polling window (0 when expired). */
export function secondsLeft(state: TelegramLinkState, now: number): number {
  if (state.phase !== "waiting") return 0;
  return Math.max(0, Math.ceil((state.startedAt + POLL_WINDOW_MS - now) / 1000));
}

export function telegramLinkReducer(state: TelegramLinkState, action: TelegramLinkAction, texts: { linkedNow: string; timeout: string }): TelegramLinkState {
  switch (action.type) {
    case "link_start":
      return { phase: "linking", linked: false, mock: state.mock, notice: null };
    case "link_ready":
      return { phase: "waiting", linked: false, mock: false, deepLink: action.deepLink, startedAt: action.now, polls: 0, notice: null };
    case "link_mock":
      return { phase: "mock", linked: false, mock: true, notice: null };
    case "link_failed":
      return { phase: "idle", linked: false, mock: state.mock, notice: { kind: "error", text: action.text } };
    case "poll": {
      if (state.phase !== "waiting") return state;
      if (action.linked) return { phase: "idle", linked: true, mock: false, notice: { kind: "ok", text: texts.linkedNow } };
      if (action.now - state.startedAt >= POLL_WINDOW_MS) return { phase: "idle", linked: false, mock: false, notice: { kind: "error", text: texts.timeout } };
      return { ...state, polls: state.polls + 1 };
    }
    case "poll_failed": {
      // A transient status failure keeps waiting until the window closes.
      if (state.phase !== "waiting") return state;
      if (action.now - state.startedAt >= POLL_WINDOW_MS) return { phase: "idle", linked: false, mock: false, notice: { kind: "error", text: texts.timeout } };
      return { ...state, polls: state.polls + 1 };
    }
    case "unlinked":
      return { phase: "idle", linked: false, mock: state.mock, notice: { kind: "ok", text: action.text } };
    case "error":
      return { phase: "idle", linked: state.linked, mock: state.mock, notice: { kind: "error", text: action.text } };
    case "dismiss":
      return state.phase === "idle" ? { ...state, notice: null } : state;
    default:
      return state;
  }
}
