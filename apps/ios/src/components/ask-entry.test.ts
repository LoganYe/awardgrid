/**
 * One Ask entry (design §6.3, §6.4): which lines and actions it shows for each way a question can be under way or end.
 *
 * Rendered through react-dom/server inside a MemoryRouter (the Settings way on is a router Link), with plain entries
 * and failures shaped as core stores them. The sentences are labels.ts's, so these tests assert which of them appear,
 * and where an action sits, rather than re-pinning copy. No DOM, no clock, no timers.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { AskEntry as Entry, EntryEnd, QuestionFailure } from "@awardgrid/core/ask/conversation";
import type { ToolStep } from "@awardgrid/core/ask/tools";
import * as labels from "../ask/labels";
import { AskEntry, type AskEntryProps } from "./AskEntry";

const AT = "2026-10-01T00:00:00.000Z";

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    question: "Cheapest business class from SEA to Tokyo in October?",
    includeSearch: false,
    askedAt: AT,
    steps: [],
    texts: [],
    usage: { requests: 1, inputTokens: 5200, cacheReadTokens: 0, outputTokens: 140, lastRequestInputTokens: 5200, toolCalls: 0, seatsCalls: 0 },
    end: null,
    ...over,
  };
}

function ended(status: EntryEnd["status"], over: Partial<EntryEnd> = {}): EntryEnd {
  return { status, committed: status === "answered", failure: null, stoppedDuring: null, at: AT, ...over };
}

const OVERLOADED: QuestionFailure = { code: "overloaded", retryable: true, message: "Anthropic is overloaded and did not answer.", requestId: "req_0123" };
const REJECTED: QuestionFailure = { code: "anthropic_key_rejected", retryable: false, message: "Anthropic rejected your API key. Check it in Settings.", requestId: null };
const TOO_LARGE: QuestionFailure = { code: "too_large", retryable: false, message: "This conversation is too large to send. Start a new conversation.", requestId: "req_0413" };

const failed = (failure: QuestionFailure) => entry({ end: ended("failed", { failure }) });

function search(over: Partial<ToolStep> = {}): ToolStep {
  return {
    tool: "search_awards",
    outcome: "ok",
    calls: 1,
    fromCache: false,
    fromMemo: false,
    search: { origins: ["SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-31", cabins: ["J"], programs: null, direct_only: false, max_miles: null },
    program: null,
    estimate: null,
    ...over,
  };
}

function render(props: Partial<AskEntryProps> & { entry: Entry }): string {
  const full: AskEntryProps = { earlier: [], bookingUrls: new Set(), retryEntryId: null, ...props };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AskEntry, full)));
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/** Every button, as its attributes and its text. */
function buttons(html: string): Array<{ text: string; attrs: string }> {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((m) => ({ attrs: m[1] ?? "", text: m[2] ?? "" }));
}

const buttonTexts = (html: string) => buttons(html).map((b) => b.text);

describe("the failure line", () => {
  it("offers Try again with its hint only on the entry the service can resend, beside Ask again", () => {
    const html = render({ entry: failed(OVERLOADED), retryEntryId: "e1" });
    expect(buttonTexts(html)).toEqual([labels.TRY_AGAIN, labels.ASK_AGAIN]);
    expect(html).toContain(escape(labels.TRY_AGAIN_HINT));
    expect(html).toContain(`<div role="alert" class="ask-failure"><p>${escape(OVERLOADED.message)}</p><p class="tabular">Anthropic request ID: req_0123</p></div>`);
  });

  it("offers Ask again alone when the failure is retryable but this session cannot resend it (a relaunch, another entry)", () => {
    for (const retryEntryId of [null, "e2"]) {
      const html = render({ entry: failed(OVERLOADED), retryEntryId });
      expect(buttonTexts(html), String(retryEntryId)).toEqual([labels.ASK_AGAIN]);
      expect(html).not.toContain(escape(labels.TRY_AGAIN_HINT));
      expect(html).toContain(escape(OVERLOADED.message));
    }
  });

  it("points a rejected key at Settings beside Ask again, and shows no request ID line when there was none", () => {
    const html = render({ entry: failed(REJECTED) });
    expect(buttonTexts(html)).toEqual([labels.ASK_AGAIN]);
    expect(html).toContain(`<a class="ag-button" href="/settings" data-discover="true">${labels.OPEN_SETTINGS}</a>`);
    expect(html).not.toContain("Anthropic request ID");
    expect(html).not.toContain(labels.NEW_CONVERSATION);
  });

  it("points a conversation too large to send at New conversation", () => {
    const html = render({ entry: failed(TOO_LARGE) });
    expect(buttonTexts(html)).toEqual([labels.ASK_AGAIN, labels.NEW_CONVERSATION]);
    expect(html).toContain("Anthropic request ID: req_0413");
    expect(html).not.toContain(labels.OPEN_SETTINGS);
  });

  it("is an alert when the failure is news, and plain text when the screen opened on it", () => {
    expect(render({ entry: failed(OVERLOADED) })).toContain('role="alert"');
    const quiet = render({ entry: failed(OVERLOADED), announce: false });
    expect(quiet).not.toContain('role="alert"');
    expect(quiet).toContain(escape(OVERLOADED.message));
  });

  it("turns Try again and New conversation off while a question runs, and Ask again when no question can start", () => {
    const busy = buttons(render({ entry: failed(OVERLOADED), retryEntryId: "e1", busy: true }));
    expect(busy.find((b) => b.text === labels.TRY_AGAIN)?.attrs).toContain("disabled");
    expect(busy.find((b) => b.text === labels.ASK_AGAIN)?.attrs).not.toContain("disabled");
    expect(buttons(render({ entry: failed(TOO_LARGE), busy: true })).find((b) => b.text === labels.NEW_CONVERSATION)?.attrs).toContain("disabled");
    expect(buttons(render({ entry: failed(OVERLOADED), askAgainDisabled: true })).find((b) => b.text === labels.ASK_AGAIN)?.attrs).toContain("disabled");
  });
});

describe("other endings", () => {
  it("an answer shows its text, the meta line and no action", () => {
    const html = render({ entry: entry({ texts: ["Alaska has 2 seats at 75,000 miles."], end: ended("answered") }) });
    expect(html).toContain("Alaska has 2 seats at 75,000 miles.");
    expect(html).toContain(labels.metaLine(entry().usage));
    expect(buttons(html)).toEqual([]);
    expect(html).not.toContain('role="alert"');
  });

  it("an unfinished entry's meta line states its saved counts as lower bounds, and no count it cannot vouch for", () => {
    // E8's race: the process died before the sent request's count reached ask.json.
    const lost = render({ entry: entry({ usage: { ...entry().usage, requests: 0, inputTokens: 0, outputTokens: 0, lastRequestInputTokens: null }, end: ended("unfinished") }) });
    expect(lost).toContain(`<p class="ask-meta tabular">${labels.MODEL_NAME} · ${labels.UNFINISHED_COUNTS}</p>`);
    expect(lost).not.toMatch(/No requests|\b0 requests|seats\.aero calls: 0/);

    const landed = render({ entry: entry({ end: ended("unfinished") }) });
    expect(landed).toContain(`<p class="ask-meta tabular">${escape(labels.unfinishedMetaLine(entry().usage))}</p>`);
    expect(landed).toContain("at least 1 request");
  });

  it.each<[string, EntryEnd]>([
    ["stopped during a request", ended("stopped", { stoppedDuring: "request" })],
    ["unfinished after a relaunch", ended("unfinished")],
    ["truncated", ended("truncated")],
    ["refused", ended("refused")],
  ])("%s shows its sentence and Ask again, and is not an alert", (_name, end) => {
    const e = entry({ end });
    const html = render({ entry: e });
    expect(html).toContain(escape(labels.endLabel(e)!));
    expect(buttonTexts(html)).toEqual([labels.ASK_AGAIN]);
    expect(html).not.toContain('role="alert"');
  });
});

describe("while the question runs", () => {
  it("counts the wait up in a span VoiceOver skips, and reads the same words without the number", () => {
    const html = render({ entry: entry(), activity: { kind: "request", request: 1, startedAt: AT, resend: false }, waitSeconds: 12.7 });
    expect(html).toContain('<span class="sr-only">Waiting for Claude</span><span aria-hidden="true">Waiting for Claude (12 s)</span>');
    // Nothing has ended: no meta line, no ending, no action.
    expect(html).not.toContain(labels.MODEL_NAME);
    expect(buttons(html)).toEqual([]);
  });

  it("says which search is under way", () => {
    const input = { origins: ["SEA"], destinations: ["TYO"], date_from: "2026-10-01", date_to: "2026-10-31", cabins: ["J"] };
    const html = render({ entry: entry(), activity: { kind: "tool", name: "search_awards", input } });
    expect(html).toContain("Searching seats.aero: SEA to TYO, 2026-10-01 to 2026-10-31, business");
  });

  it("writes a pause once: as the step the service recorded, not again as the activity", () => {
    const html = render({ entry: entry({ steps: [{ kind: "paused" }] }), activity: { kind: "paused" } });
    expect(html.split(escape(labels.PAUSED_STEP)).length - 1).toBe(1);
    expect(render({ entry: entry(), activity: { kind: "paused" } })).toContain(escape(labels.PAUSED_STEP));
  });
});

describe("steps, attribution and the follow-up note", () => {
  it("lists finished steps in order in an <ol>", () => {
    const steps = [{ kind: "tool" as const, step: search() }, { kind: "paused" as const }];
    const html = render({ entry: entry({ steps }) });
    expect(html).toContain(`<ol class="ask-steps"><li>${escape(labels.stepLabel(steps[0]!))}</li><li>${escape(labels.PAUSED_STEP)}</li></ol>`);
  });

  it("shows Data: seats.aero when a search was included or a seats.aero tool answered, and not otherwise", () => {
    const shown = (e: Entry) => render({ entry: e }).includes(`<p class="ask-attribution">${labels.ATTRIBUTION}</p>`);
    expect(shown(entry({ includeSearch: true, end: ended("answered") }))).toBe(true);
    expect(shown(entry({ steps: [{ kind: "tool", step: search() }], end: ended("answered") }))).toBe(true);
    expect(shown(entry({ steps: [{ kind: "tool", step: search({ outcome: "too_wide", calls: 0, estimate: 5 }) }], end: ended("answered") }))).toBe(false);
    expect(shown(entry({ texts: ["Qatar flies this route daily."], end: ended("answered") }))).toBe(false);
  });

  it("shows Data: seats.aero under a follow-up answered without a tool call when an earlier committed question carried seats.aero data", () => {
    const shown = (earlier: Entry[]) => render({ entry: entry({ id: "e2", texts: ["The taxes on that seat are $5.60."], end: ended("answered") }), earlier }).includes(`<p class="ask-attribution">${labels.ATTRIBUTION}</p>`);
    const searched = entry({ steps: [{ kind: "tool", step: search() }], end: ended("answered") });
    expect(shown([searched])).toBe(true);
    expect(shown([entry({ includeSearch: true, end: ended("answered") })])).toBe(true);
    // Not committed, so never resent: its search results are not what the follow-up rests on.
    expect(shown([{ ...searched, end: ended("stopped", { stoppedDuring: "request" }) }])).toBe(false);
    expect(shown([entry({ end: ended("answered") })])).toBe(false);
    expect(shown([])).toBe(false);
  });

  it("adds the follow-up note under an answer that offers what awardgrid cannot do, and leaves the answer unchanged", () => {
    const promise = "I'll keep an eye on this route for you.";
    const html = render({ entry: entry({ texts: [promise], end: ended("answered") }) });
    expect(html).toContain(escape(labels.FOLLOW_UP_NOTE));
    expect(html).toContain(escape(promise));
    expect(render({ entry: entry({ texts: ["Alaska has 2 seats at 75,000 miles."], end: ended("answered") }) })).not.toContain(escape(labels.FOLLOW_UP_NOTE));
  });

  it("shows the question as text, never as markup", () => {
    const html = render({ entry: entry({ question: "<b>SEA</b> to Tokyo?" }) });
    expect(html).toContain('<h2 class="ask-question">&lt;b&gt;SEA&lt;/b&gt; to Tokyo?</h2>');
  });
});
