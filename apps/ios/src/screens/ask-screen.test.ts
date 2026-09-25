/**
 * The Ask screen (design §6.3-§6.5) over a fake AskService.
 *
 * AskView is the screen without its Keychain read: it takes which keys are on file as a prop, so each state renders
 * through react-dom/server with nothing to wait for. Effects do not run on the server, so no interval starts and no
 * timer is left behind. The rules that decide what is announced and which key is missing are pure functions, tested
 * directly with states shaped as the service builds them. No DOM, no clock, no network.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { AskEntry, EntryEnd } from "@awardgrid/core/ask/conversation";
import { buildGrid } from "@awardgrid/core/grid/pivot";
import { QueryObject } from "@awardgrid/core/query/schema";
import { copy } from "@awardgrid/core/workspace/present";
import type { AskActivity, AskService, AskState, ContextPreview } from "../ask/ask-service";
import * as labels from "../ask/labels";
import { MemoryKeyStore, type KeyStore } from "../native/keychain";
import type { LastSearchEntry } from "../search/last-search";
import { AskView, type KeyPresence, askAnnouncement, lastSearchLabel, missingKeys, readKeyPresence } from "./AskScreen";

const AT = "2026-10-01T00:00:00.000Z";
const BOTH: KeyPresence = { anthropic: true, seats: true };

function state(over: Partial<AskState> = {}): AskState {
  return { entries: [], running: null, retryEntryId: null, notice: null, wiring: null, full: null, bookingUrls: new Set(), ...over };
}

function entry(id: string, over: Partial<AskEntry> = {}): AskEntry {
  return {
    id,
    question: `Question ${id}`,
    includeSearch: false,
    askedAt: AT,
    steps: [],
    texts: [],
    usage: { requests: 1, inputTokens: 5000, cacheReadTokens: 0, outputTokens: 100, lastRequestInputTokens: 5000, toolCalls: 0, seatsCalls: 0 },
    end: null,
    ...over,
  };
}

const ended = (status: EntryEnd["status"], over: Partial<EntryEnd> = {}): EntryEnd => ({ status, committed: false, failure: null, stoppedDuring: null, at: AT, ...over });

function fakeAsk(current: AskState): AskService {
  return {
    state: () => current,
    subscribe: () => () => {},
    isRunning: () => current.running !== null,
    ask: vi.fn(async () => current),
    stop: vi.fn(),
    retry: vi.fn(async () => current),
    askAgain: vi.fn(async () => current),
    newConversation: vi.fn(async () => current),
    checkKey: vi.fn(async () => ({ outcome: "accepted" as const, ok: true, message: labels.KEY_ACCEPTED, requestId: null })),
    restore: vi.fn(async () => current),
    persist: vi.fn(async () => {}),
  };
}

/** T17: the approved Stop (S09 "停止后续步骤") and its note, never a claim that a request is recalled. */
const STOP = copy("ai.stop", "en");
const STOP_NOTE = copy("ai.stop_note", "en");

const LAST_SEARCH: LastSearchEntry = (() => {
  const query = QueryObject.parse({
    origins: ["SEA"],
    destinations: ["NRT", "HND"],
    date_from: "2026-10-01",
    date_to: "2026-10-30",
    cabins: ["J"],
    raw_text: "SEA to TYO, 2026-10-01 to 2026-10-30, business",
    language: "en",
  });
  return {
    text: "SEA to TYO, 2026-10-01 to 2026-10-30, business",
    value: {
      grid: buildGrid([], query, { now: new Date(AT) }),
      query,
      warnings: [],
      notices: [],
      quota: { used: 12, remaining: 988, softLimit: 950, resetAt: "2026-10-02T00:00:00.000Z" },
      served_from_cache: false,
      api_calls_used: 1,
      fetched_at_min: null,
    },
  };
})();

function render(current: AskState, opts: { keys?: KeyPresence; last?: LastSearchEntry | null; now?: () => number } = {}): string {
  const services = { ask: fakeAsk(current), lastSearch: { get: () => opts.last ?? null, set: () => {} } };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AskView, { services, keys: opts.keys ?? BOTH, now: opts.now })));
}

/** The key notice as rendered: role="alert", the sentence, and the router Link to Settings. */
const keyCallout = (message: string) => `<div role="alert" class="ask-callout"><p>${message}</p><a class="ag-button" href="/settings" data-discover="true">${labels.OPEN_SETTINGS}</a></div>`;

function buttons(html: string): Array<{ text: string; attrs: string }> {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((m) => ({ attrs: m[1] ?? "", text: m[2] ?? "" }));
}

const buttonTexts = (html: string) => buttons(html).map((b) => b.text);

/** The button with this text, or undefined: for asserting that the screen renders none. */
const findButton = (html: string, text: string) => buttons(html).find((b) => b.text === text);

/** The button with this text. Asking about one the screen did not render fails here, instead of reading as enabled. */
function button(html: string, text: string): { text: string; attrs: string } {
  const found = findButton(html, text);
  if (found === undefined) throw new Error(`no "${text}" button in the markup`);
  return found;
}

function textarea(html: string): string {
  const found = html.match(/<textarea[^>]*>/)?.[0];
  if (found === undefined) throw new Error("no textarea in the markup");
  return found;
}

const isDisabled = (attrs: string) => /\sdisabled=""/.test(attrs);

describe("no key on file", () => {
  it("without an Anthropic key: the notice with a way to Settings, and the composer disabled before any question", () => {
    const html = render(state(), { keys: { anthropic: false, seats: true }, last: LAST_SEARCH });
    // T11: the first AI entry without a key says what connecting Anthropic means, and links to its settings page — a
    // setup step in a labelled region, not an alert.
    expect(html).toContain('<section aria-labelledby="ask-connect-title" class="ask-connect"');
    expect(html).toContain('<h2 id="ask-connect-title" class="ask-connect-title">Connect Anthropic</h2>');
    expect(html).not.toMatch(/role="alert"[^>]*class="[^"]*ask-connect/);
    expect(html).toMatch(/<a class="ag-button ag-button-primary" href="\/settings\/anthropic"[^>]*>Add an Anthropic key<\/a>/);
    expect(html).not.toContain(labels.NO_SEATS_KEY);
    expect(isDisabled(textarea(html))).toBe(true);
    expect(isDisabled(button(html, labels.ASK_BUTTON).attrs)).toBe(true);
    for (const suggestion of labels.SUGGESTIONS_WITH_SEARCH) expect(isDisabled(button(html, suggestion).attrs), suggestion).toBe(true);
  });

  it("without a seats.aero key: its own notice, and the composer disabled", () => {
    const html = render(state(), { keys: { anthropic: true, seats: false } });
    expect(html).toContain(keyCallout(labels.NO_SEATS_KEY));
    expect(html).not.toContain(labels.NO_ANTHROPIC_KEY);
    expect(isDisabled(textarea(html))).toBe(true);
    expect(isDisabled(button(html, labels.ASK_BUTTON).attrs)).toBe(true);
  });

  it("while the Keychain is still being read, no question can start, and nothing claims a key is missing", () => {
    // An ended entry, so Ask again is on screen: it carries its own question, where Ask is also off for an empty box.
    const stopped = state({ entries: [entry("e1", { end: ended("stopped", { stoppedDuring: "request" }) })] });
    const reading = render(stopped, { keys: { anthropic: null, seats: null } });
    expect(isDisabled(button(reading, labels.ASK_BUTTON).attrs)).toBe(true);
    expect(isDisabled(button(reading, labels.ASK_AGAIN).attrs)).toBe(true);
    expect(isDisabled(textarea(reading))).toBe(false);
    expect(reading).not.toContain(labels.NO_ANTHROPIC_KEY);
    expect(reading).not.toContain(labels.NO_SEATS_KEY);
    expect(reading).not.toContain(labels.OPEN_SETTINGS);
    // One key read and on file, the other not read yet: still nothing starts.
    expect(isDisabled(button(render(stopped, { keys: { anthropic: true, seats: null } }), labels.ASK_AGAIN).attrs)).toBe(true);
    expect(isDisabled(button(render(stopped, { keys: { anthropic: null, seats: true } }), labels.ASK_AGAIN).attrs)).toBe(true);
    // Both read and on file: Ask again is on.
    expect(isDisabled(button(render(stopped, { keys: BOTH }), labels.ASK_AGAIN).attrs)).toBe(false);
  });

  it("a no-key refusal the service gave after the screen opened disables the composer too; one from an earlier visit does not", () => {
    const opened = state();
    const refused = state({ notice: { kind: "no_anthropic_key", message: labels.NO_ANTHROPIC_KEY } });
    expect(missingKeys(refused, opened, BOTH)).toEqual({ anthropic: true, seats: false });
    // The screen opened on that same refusal, and the Keychain read since says the key is there.
    expect(missingKeys(refused, refused, BOTH)).toEqual({ anthropic: false, seats: false });
    expect(missingKeys(state({ notice: { kind: "no_seats_key", message: labels.NO_SEATS_KEY } }), opened, BOTH)).toEqual({ anthropic: false, seats: true });
    expect(missingKeys(opened, opened, { anthropic: false, seats: null })).toEqual({ anthropic: true, seats: false });
  });

  it("reads each key as the service does: a blank key or a store that throws is no key", async () => {
    const withKey = new MemoryKeyStore();
    await withKey.set("sk-ant-api03-ask-screen-test-key");
    const blank: KeyStore = { get: async () => "   ", set: async () => {}, clear: async () => {} };
    const throwing: KeyStore = { get: async () => Promise.reject(new Error("errSecInteractionNotAllowed")), set: async () => {}, clear: async () => {} };
    expect(await readKeyPresence({ anthropicKeys: withKey, keys: blank })).toEqual({ anthropic: true, seats: false });
    expect(await readKeyPresence({ anthropicKeys: throwing, keys: withKey })).toEqual({ anthropic: false, seats: true });
  });
});

describe("a build without native HTTP", () => {
  it("offers no New conversation beside it, even with a conversation on file (review REG-10)", () => {
    const html = render(state({ wiring: labels.WIRING, notice: { kind: "wiring", message: labels.WIRING }, entries: [entry("e1", { end: ended("answered") })] }));
    expect(findButton(html, labels.NEW_CONVERSATION)).toBeUndefined();
    expect(html).toContain(labels.WIRING);
  });

  it("renders only the wiring message", () => {
    const html = render(state({ wiring: labels.WIRING, notice: { kind: "wiring", message: labels.WIRING } }), { last: LAST_SEARCH });
    // The page's header (Back, title) and the wiring message: nothing else (T15: Ask is a full-height page).
    expect(html).toMatch(/^<div class="ask-screen" lang="en"><header class="ask-header">.*<h1 tabindex="-1" class="ask-title">Ask Claude<\/h1><\/header>/);
    expect(html).toMatch(new RegExp(`</header><p role="alert" class="ask-callout">${labels.WIRING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p></div>$`));
  });
});

describe("idle", () => {
  it("with a last search: the checkbox on by default, what is sent said from the payload, the suggestions for it, and the composer", () => {
    const html = render(state(), { last: LAST_SEARCH });
    expect(html).toContain(`<p role="status" class="sr-only"></p>`);
    expect(html).toContain(`<h1 tabindex="-1" class="ask-title">${labels.ASK_TITLE}</h1>`);
    expect(html).toContain(`<p class="ask-subline">${labels.ASK_SUBLINE}</p>`);
    // T15: what goes with the question (the approved row), the search in the results summary's words, and the choice.
    expect(html).toContain(`<p class="ask-context-sends">Only the query conditions will be sent.</p><p class="ask-context-search">Search: SEA → NRT, HND · Oct 1 – 30 · Business</p>`);
    expect(html).toContain(`<label class="ask-check"><input type="checkbox" checked=""/><span>Include this search</span></label>`);
    // The header's Back (an icon, named "Back"), then the suggestions and Ask.
    expect(buttonTexts(html).slice(1)).toEqual([...labels.SUGGESTIONS_WITH_SEARCH, labels.ASK_BUTTON]);
    expect(html).toContain('<button type="button" aria-label="Back" class="ag-icon-button">');
    expect(textarea(html)).toBe(`<textarea class="ag-input ask-input" aria-label="${labels.QUESTION_LABEL}" maxLength="1000" rows="1">`);
    // Ask waits for a question; nothing is running, so there is no Stop and no Stop note.
    expect(isDisabled(button(html, labels.ASK_BUTTON).attrs)).toBe(true);
    expect(findButton(html, STOP)).toBeUndefined();
    expect(html).not.toContain(STOP_NOTE);
    expect(html).toContain(labels.CONVERSATION_NOTE);
    expect(findButton(html, labels.NEW_CONVERSATION)).toBeUndefined();
    // Top to bottom (S09): title, what is sent and its choice, the suggestions, the conversation note, the composer.
    const order = [labels.ASK_TITLE, "Include this search", labels.SUGGESTIONS_WITH_SEARCH[0]!, labels.CONVERSATION_NOTE, labels.QUESTION_LABEL].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("without a last search: no checkbox, and the suggestions that need no search", () => {
    const html = render(state());
    expect(html).not.toContain('type="checkbox"');
    expect(buttonTexts(html).slice(1)).toEqual([...labels.SUGGESTIONS_WITHOUT_SEARCH, labels.ASK_BUTTON]);
  });

  it("a selection that cannot be attached is said, and offers no attach choice (review CTX-4)", () => {
    const ask = fakeAsk(state());
    // Two results chosen on an earlier search: attaching them is refused; the search alone can go.
    const refused = (_include: boolean, attach: boolean): ContextPreview =>
      attach
        ? { snapshot: null, context: null, rows: [], refused: "context_snapshot_mismatch", earlier: 0, selected: 2, revision: null }
        : { snapshot: null, context: { revision: 1, snapshotId: "s1", sent: "query_only", query: LAST_SEARCH.value.query, selectedRefs: [] }, rows: [], refused: null, earlier: 0, selected: 2, revision: null };
    ask.preview = refused;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AskView, { services: { ask, lastSearch: { get: () => LAST_SEARCH, set: () => {} } }, keys: BOTH })));
    expect(html).toContain("The selected results are not all from the search on screen, so none can be attached.");
    expect(html).not.toContain("Attach the");
    expect(html).toContain("Only the query conditions will be sent.");
  });

  it("labels the checkbox with the query Claude is told about", () => {
    expect(lastSearchLabel(LAST_SEARCH)).toBe("Include my last search: SEA to NRT, HND, 2026-10-01 to 2026-10-30, business");
  });
});

describe("running", () => {
  const request: AskActivity = { kind: "request", request: 1, startedAt: AT, resend: false };
  const runningState = state({ entries: [entry("e1")], running: { entryId: "e1", activity: request, stopping: false } });

  it("renders Stop in Ask's place with the Stop note, the status region, and the entry list marked busy", () => {
    const html = render(runningState, { now: () => Date.parse(AT) + 12_400 });
    expect(findButton(html, labels.ASK_BUTTON)).toBeUndefined();
    expect(button(html, STOP).attrs).toBe(' type="button" class="ag-button ag-button-primary ask-send"');
    expect(html).toContain(`<button type="button" class="ag-button ag-button-primary ask-send">${STOP}</button><p class="ask-note ask-stop-note">${STOP_NOTE}</p>`);
    expect(html).toContain('<p role="status" class="sr-only">');
    expect(html).toContain('<ol class="ask-entries" data-surface="flat" aria-busy="true">');
    expect(html).not.toContain("aria-live");
    expect(html).toContain('<span aria-hidden="true">Waiting for Claude (12 s)</span>');
    // The suggestions are for an empty conversation, and New conversation waits for the question to end.
    expect(html).not.toContain(labels.SUGGESTIONS_WITHOUT_SEARCH[0]);
    expect(isDisabled(button(html, labels.NEW_CONVERSATION).attrs)).toBe(true);
  });

  it("turns Stop off once it has been pressed", () => {
    const html = render(state({ ...runningState, running: { entryId: "e1", activity: request, stopping: true } }));
    expect(isDisabled(button(html, STOP).attrs)).toBe(true);
  });
});

describe("the conversation", () => {
  it("shows entries oldest first, newest at the bottom (T15, S09), with New conversation in the header and its note after them", () => {
    const html = render(state({ entries: [entry("e1", { end: ended("answered") }), entry("e2", { end: ended("answered") })] }));
    expect(html.indexOf("Question e1")).toBeLessThan(html.indexOf("Question e2"));
    expect(html.indexOf(`>${labels.NEW_CONVERSATION}<`)).toBeLessThan(html.indexOf("Question e1"));
    expect(html.indexOf("Question e2")).toBeLessThan(html.indexOf(labels.CONVERSATION_NOTE));
    expect(html).toContain('aria-busy="false"');
  });

  it("hands each entry the entries before it, so a follow-up that resent a committed search carries Data: seats.aero (E6)", () => {
    const searched: AskEntry["steps"] = [
      {
        kind: "tool",
        step: {
          tool: "search_awards",
          outcome: "ok",
          calls: 1,
          fromCache: false,
          fromMemo: false,
          search: { origins: ["SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-31", cabins: ["J"], programs: null, direct_only: false, max_miles: null },
          program: null,
          estimate: null,
        },
      },
    ];
    const attribution = `<p class="ask-attribution">${labels.ATTRIBUTION}</p>`;
    /** Each entry's markup, as the screen lists them: oldest first (T15). */
    const listed = (html: string) => html.split('<li class="ag-surface ask-entry">').slice(1);
    const followUp = entry("e2", { texts: ["The taxes on that seat are $5.60."], end: ended("answered", { committed: true }) });

    const committed = listed(render(state({ entries: [entry("e1", { steps: searched, end: ended("answered", { committed: true }) }), followUp] })));
    expect(committed.map((html) => [html.includes("Question e2"), html.includes(attribution)])).toEqual([
      [false, true],
      [true, true],
    ]);

    // A stopped question is never committed, so the follow-up after it resent none of its results.
    const stopped = listed(render(state({ entries: [entry("e1", { steps: searched, end: ended("stopped", { stoppedDuring: "between" }) }), followUp] })));
    expect(stopped.map((html) => [html.includes("Question e2"), html.includes(attribution)])).toEqual([
      [false, true],
      [true, false],
    ]);

    // A later question's search was in no request of an earlier one.
    const later = listed(render(state({ entries: [entry("e1", { texts: ["Qatar flies this route."], end: ended("answered", { committed: true }) }), entry("e2", { steps: searched, end: ended("answered", { committed: true }) })] })));
    expect(later.map((html) => [html.includes("Question e2"), html.includes(attribution)])).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  it("a full conversation says why, offers New conversation where it says so, and starts no question, Ask again included", () => {
    const full = "This conversation has reached 8 questions. Start a new conversation.";
    const html = render(state({ entries: [entry("e1", { end: ended("stopped", { stoppedDuring: "request" }) })], full }));
    expect(html).toContain(`<div class="ask-callout"><p>${full}</p><button type="button" class="ag-button">${labels.NEW_CONVERSATION}</button></div>`);
    expect(isDisabled(button(html, labels.ASK_BUTTON).attrs)).toBe(true);
    // Ask again is a new question too, and the service would refuse it with the same sentence.
    expect(isDisabled(button(html, labels.ASK_AGAIN).attrs)).toBe(true);
  });

  it("an entry with no whole answer offers Ask again only when a question could start", () => {
    const stopped = state({ entries: [entry("e1", { end: ended("stopped", { stoppedDuring: "request" }) })] });
    expect(isDisabled(button(render(stopped), labels.ASK_AGAIN).attrs)).toBe(false);
    expect(isDisabled(button(render(stopped, { keys: { anthropic: false, seats: true } }), labels.ASK_AGAIN).attrs)).toBe(true);
  });

  it("shows the last refusal next to the composer, and a failure the screen opened on without re-announcing it", () => {
    const html = render(
      state({
        entries: [entry("e1", { end: ended("failed", { failure: { code: "overloaded", retryable: true, message: "Anthropic is overloaded and did not answer.", requestId: null } }) })],
        retryEntryId: "e1",
        notice: { kind: "keys_changed", message: labels.KEYS_CHANGED },
      }),
    );
    expect(html).toContain(`<p class="ask-callout">${labels.KEYS_CHANGED}</p>`);
    // After the conversation, directly above the composer the refused action came from (T15: the composer is last).
    expect(html.indexOf("Question e1")).toBeLessThan(html.indexOf(labels.KEYS_CHANGED));
    expect(html.indexOf(labels.KEYS_CHANGED)).toBeLessThan(html.indexOf(labels.QUESTION_LABEL));
    expect(html).toContain('<div class="ask-failure"><p>Anthropic is overloaded and did not answer.</p></div>');
    expect(html).not.toContain('role="alert"');
    expect(buttonTexts(html)).toContain(labels.TRY_AGAIN);
  });

  it("a cleared conversation reads as a neutral note", () => {
    const html = render(state({ notice: { kind: "cleared", message: labels.CLEARED } }));
    expect(html).toContain(`<p class="ask-callout ask-callout-neutral">${labels.CLEARED}</p>`);
  });
});

describe("the status region announces transitions only (design §6.5)", () => {
  const request: AskActivity = { kind: "request", request: 1, startedAt: AT, resend: false };
  const opened = state({ entries: [entry("e0", { end: ended("answered") })] });

  it("announces a request or a tool call that started after the screen opened", () => {
    expect(askAnnouncement(state({ ...opened, running: { entryId: "e1", activity: request, stopping: false } }), opened)).toBe(labels.ANNOUNCEMENTS.waiting);
    const searching: AskActivity = { kind: "tool", name: "search_awards", input: {} };
    expect(askAnnouncement(state({ running: { entryId: "e1", activity: searching, stopping: false } }), opened)).toBe(labels.ANNOUNCEMENTS.searching);
    const flights: AskActivity = { kind: "tool", name: "get_flights", input: {} };
    expect(askAnnouncement(state({ running: { entryId: "e1", activity: flights, stopping: false } }), opened)).toBe("Looking up flights on seats.aero");
  });

  it("says nothing for the step the screen opened during, between steps, while paused, or while keys are read", () => {
    const during = state({ running: { entryId: "e1", activity: request, stopping: false } });
    expect(askAnnouncement(during, during)).toBe("");
    for (const activity of [{ kind: "between" }, { kind: "paused" }] as AskActivity[]) {
      expect(askAnnouncement(state({ running: { entryId: "e1", activity, stopping: false } }), opened), activity.kind).toBe("");
    }
    expect(askAnnouncement(state({ running: { entryId: null, activity: { kind: "starting" }, stopping: false } }), state())).toBe("");
  });

  it.each<[EntryEnd["status"], string]>([
    ["answered", labels.ANNOUNCEMENTS.answered],
    ["truncated", labels.ANNOUNCEMENTS.answered],
    ["stopped", labels.ANNOUNCEMENTS.stopped],
    ["failed", labels.ANNOUNCEMENTS.failed],
    ["refused", labels.ANNOUNCEMENTS.failed],
    ["unfinished", ""],
  ])("a question that ended %s after the screen opened announces %j", (status, said) => {
    const atOpen = state({ entries: [entry("e1")] });
    expect(askAnnouncement(state({ entries: [entry("e1", { end: ended(status) })] }), atOpen)).toBe(said);
  });

  it("says nothing for an ending the screen opened on, and announces the same entry again when Try again ends it anew", () => {
    const answered = state({ entries: [entry("e1", { end: ended("failed") })] });
    expect(askAnnouncement(answered, answered)).toBe("");
    const resent = state({ entries: [entry("e1", { end: ended("answered", { at: "2026-10-01T00:01:00.000Z" }) })] });
    expect(askAnnouncement(resent, answered)).toBe(labels.ANNOUNCEMENTS.answered);
  });
});
