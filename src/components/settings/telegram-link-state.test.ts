import { describe, expect, it } from "vitest";
import {
  initialTelegramState,
  POLL_WINDOW_MS,
  secondsLeft,
  shouldPoll,
  telegramLinkReducer,
  type TelegramLinkAction,
  type TelegramLinkState,
} from "./telegram-link-state";

const TEXTS = { linkedNow: "Telegram linked", timeout: "No Start received" };
const T0 = 1_000_000;
const run = (state: TelegramLinkState, ...actions: TelegramLinkAction[]): TelegramLinkState =>
  actions.reduce((s, a) => telegramLinkReducer(s, a, TEXTS), state);

describe("telegram link state", () => {
  it("walks from idle to waiting once a deep link arrives", () => {
    const state = run(initialTelegramState(false), { type: "link_start" }, { type: "link_ready", deepLink: "https://t.me/bot?start=x", now: T0 });
    expect(state).toMatchObject({ phase: "waiting", deepLink: "https://t.me/bot?start=x", startedAt: T0, polls: 0 });
    expect(shouldPoll(state)).toBe(true);
    expect(secondsLeft(state, T0)).toBe(POLL_WINDOW_MS / 1000);
  });

  it("lands on linked as soon as a poll says so", () => {
    const waiting = run(initialTelegramState(false), { type: "link_start" }, { type: "link_ready", deepLink: "d", now: T0 });
    const linked = run(waiting, { type: "poll", linked: true, now: T0 + 6_000 });
    expect(linked).toEqual({ phase: "idle", linked: true, notice: { kind: "ok", text: TEXTS.linkedNow } });
    expect(shouldPoll(linked)).toBe(false);
  });

  it("keeps waiting through a failed status call and gives up when the window closes", () => {
    const waiting = run(initialTelegramState(false), { type: "link_start" }, { type: "link_ready", deepLink: "d", now: T0 });
    const still = run(waiting, { type: "poll_failed", now: T0 + 3_000 }, { type: "poll", linked: false, now: T0 + 6_000 });
    expect(still).toMatchObject({ phase: "waiting", polls: 2 });
    expect(secondsLeft(still, T0 + 6_000)).toBe(114);
    const expired = run(still, { type: "poll", linked: false, now: T0 + POLL_WINDOW_MS });
    expect(expired).toEqual({ phase: "idle", linked: false, notice: { kind: "error", text: TEXTS.timeout } });
  });

  it("reports the server having no bot as its own state, not an error", () => {
    const state = run(initialTelegramState(false), { type: "link_start" }, { type: "link_unavailable" });
    expect(state).toEqual({ phase: "unavailable", linked: false, notice: null });
    expect(shouldPoll(state)).toBe(false);
    expect(secondsLeft(state, T0)).toBe(0);
  });

  it("carries link, unlink and error notices on the idle state", () => {
    expect(run(initialTelegramState(false), { type: "link_start" }, { type: "link_failed", text: "no" })).toEqual({
      phase: "idle",
      linked: false,
      notice: { kind: "error", text: "no" },
    });
    expect(run(initialTelegramState(true), { type: "unlinked", text: "gone" })).toEqual({
      phase: "idle",
      linked: false,
      notice: { kind: "ok", text: "gone" },
    });
    expect(run(initialTelegramState(true), { type: "error", text: "boom" })).toMatchObject({ linked: true, notice: { kind: "error", text: "boom" } });
    expect(run(initialTelegramState(true), { type: "error", text: "boom" }, { type: "dismiss" })).toEqual({
      phase: "idle",
      linked: true,
      notice: null,
    });
  });

  it("ignores polls that arrive after the wait ended", () => {
    const idle = initialTelegramState(false);
    expect(run(idle, { type: "poll", linked: true, now: T0 })).toBe(idle);
  });
});
