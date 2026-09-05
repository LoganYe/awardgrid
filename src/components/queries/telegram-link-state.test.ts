import { describe, expect, it } from "vitest";
import { POLL_WINDOW_MS, initialTelegramState, secondsLeft, shouldPoll, telegramLinkReducer, type TelegramLinkState } from "./telegram-link-state";

const texts = { linkedNow: "linked!", timeout: "timed out" };
const r = (s: TelegramLinkState, a: Parameters<typeof telegramLinkReducer>[1]) => telegramLinkReducer(s, a, texts);
const T0 = 1_000_000;

describe("telegramLinkReducer", () => {
  it("walks idle → linking → waiting → linked and stops polling", () => {
    let s = initialTelegramState(false, false);
    expect(shouldPoll(s)).toBe(false);
    s = r(s, { type: "link_start" });
    expect(s.phase).toBe("linking");
    s = r(s, { type: "link_ready", deepLink: "https://t.me/bot?start=abc", now: T0 });
    expect(s.phase).toBe("waiting");
    expect(shouldPoll(s)).toBe(true);
    expect(secondsLeft(s, T0)).toBe(120);
    s = r(s, { type: "poll", linked: false, now: T0 + 3000 });
    expect(s.phase).toBe("waiting");
    expect(secondsLeft(s, T0 + 3000)).toBe(117);
    s = r(s, { type: "poll", linked: true, now: T0 + 6000 });
    expect(s).toEqual({ phase: "idle", linked: true, mock: false, notice: { kind: "ok", text: "linked!" } });
    expect(shouldPoll(s)).toBe(false);
  });

  it("times out after the 2-minute window, also when a poll fails", () => {
    let s = r(initialTelegramState(false, false), { type: "link_ready", deepLink: "x", now: T0 });
    s = r(s, { type: "poll_failed", now: T0 + 5000 });
    expect(s.phase).toBe("waiting");
    const out = r(s, { type: "poll", linked: false, now: T0 + POLL_WINDOW_MS });
    expect(out).toEqual({ phase: "idle", linked: false, mock: false, notice: { kind: "error", text: "timed out" } });
    const outFailed = r(s, { type: "poll_failed", now: T0 + POLL_WINDOW_MS + 1 });
    expect(outFailed.phase).toBe("idle");
    expect(secondsLeft(out, T0 + POLL_WINDOW_MS)).toBe(0);
  });

  it("mock mode shows the explanation and never polls", () => {
    let s = initialTelegramState(false, true);
    s = r(s, { type: "link_start" });
    s = r(s, { type: "link_mock" });
    expect(s).toEqual({ phase: "mock", linked: false, mock: true, notice: null });
    expect(shouldPoll(s)).toBe(false);
    expect(r(s, { type: "poll", linked: true, now: T0 })).toBe(s);
  });

  it("link failure, unlink and dismiss", () => {
    let s = initialTelegramState(true, false);
    s = r(s, { type: "unlinked", text: "bye" });
    expect(s).toEqual({ phase: "idle", linked: false, mock: false, notice: { kind: "ok", text: "bye" } });
    s = r(s, { type: "dismiss" });
    expect(s.notice).toBeNull();
    s = r(s, { type: "link_start" });
    s = r(s, { type: "link_failed", text: "nope" });
    expect(s).toEqual({ phase: "idle", linked: false, mock: false, notice: { kind: "error", text: "nope" } });
    const linked = r(initialTelegramState(true, false), { type: "error", text: "err" });
    expect(linked.linked).toBe(true);
  });
});
