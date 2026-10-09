import { afterEach, describe, expect, it } from "vitest";
import { ASK_DEMO_STORAGE_KEY } from "./demo";
import { appendTurn, ASK_HISTORY_KEY, ASK_HISTORY_MAX, clearAskSession, loadHistory, parseHistory, saveHistory, type AskTurn } from "./history";

/** Answered just now, so the 24-hour limit keeps it. */
const NOW = Date.now();
const turn = (prompt: string, at: number = NOW): AskTurn => ({ prompt, text: `answer to ${prompt}`, tools: ["Bash"], costUsd: 0.31, at: new Date(at).toISOString() });

describe("parseHistory", () => {
  it("reads back what was written", () => {
    const stored = JSON.stringify([turn("a"), turn("b")]);
    expect(parseHistory(stored)).toEqual([turn("a"), turn("b")]);
  });

  it("treats missing, malformed and non-array payloads as an empty history", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("{oops")).toEqual([]);
    expect(parseHistory('{"prompt":"a"}')).toEqual([]);
  });

  it("drops entries that are not turns", () => {
    expect(parseHistory(JSON.stringify([turn("a"), { prompt: 1 }, "x"]))).toEqual([turn("a")]);
  });

  it("drops answers older than 24 hours, and turns stored with no time (they may quote seats.aero results)", () => {
    const day = 24 * 60 * 60 * 1000;
    const old = turn("yesterday", NOW - day - 1);
    const edge = turn("just inside", NOW - day + 60_000);
    const { at: _at, ...untimed } = turn("legacy");
    expect(parseHistory(JSON.stringify([old, edge, untimed, turn("now")]), NOW)).toEqual([edge, turn("now")]);
  });
});

describe("appendTurn", () => {
  it("appends and caps the history at ASK_HISTORY_MAX, oldest first", () => {
    let history: AskTurn[] = [];
    for (let i = 0; i < ASK_HISTORY_MAX + 3; i += 1) history = appendTurn(history, turn(`q${i}`));
    expect(history).toHaveLength(ASK_HISTORY_MAX);
    expect(history[0]?.prompt).toBe("q3");
    expect(history.at(-1)?.prompt).toBe(`q${ASK_HISTORY_MAX + 2}`);
  });
});

/** A sessionStorage stand-in: the suite runs on `node`, where there is no window. */
function fakeWindow(): Map<string, string> {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as { window?: unknown }).window = { sessionStorage };
  return store;
}

describe("clearAskSession", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("removes the stored history, so the next user in this tab sees none of it", () => {
    const store = fakeWindow();
    saveHistory([turn("what transfers into Alaska?")]);
    expect(loadHistory()).toHaveLength(1);
    clearAskSession();
    expect(store.get(ASK_HISTORY_KEY)).toBeUndefined();
    expect(loadHistory()).toEqual([]);
  });

  it("also drops the demo switch, so ?askdemo=1 cannot outlive the session that set it", () => {
    const store = fakeWindow();
    store.set(ASK_DEMO_STORAGE_KEY, "1");
    clearAskSession();
    expect(store.get(ASK_DEMO_STORAGE_KEY)).toBeUndefined();
  });

  it("is a no-op without a window (server render) and without storage", () => {
    expect(() => clearAskSession()).not.toThrow();
    (globalThis as { window?: unknown }).window = {
      get sessionStorage(): never {
        throw new Error("storage disabled");
      },
    };
    expect(() => clearAskSession()).not.toThrow();
  });
});
