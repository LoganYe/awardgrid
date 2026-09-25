/**
 * What goes to Claude with a question, beside the question itself (UI/UX v1 T15; docs/04 S09; D08; acceptance A26).
 *
 * The context label is built from the payload, not from a checkbox: results are only said to be attached when their
 * rows are in what is sent, and every row comes from the trusted snapshot on screen, found by its key. A reference
 * to another snapshot, or to a row that snapshot does not have, is refused, never replaced by a guess.
 */
import { describe, expect, it, vi } from "vitest";
import { ContextError, attachedRows, buildAIContext } from "./context";
import { fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { AskModel } from "@awardgrid/core/ask/client";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import type { ResultRef, ResultSnapshot } from "@awardgrid/core/workspace/types";
import { MemoryKeyStore } from "../native/keychain";
import { SearchEngine } from "../search/search";
import { AskStore } from "../store/ask-store";
import { MemoryFileStore } from "../store/persistence";
import { DeviceQuotaStore } from "../store/quota-store";
import { createAskService } from "./ask-service";
import { CONTEXT_CHANGED } from "./labels";

it("context label matches exactly what will be sent", () => {
  const snapshot = fixtureSnapshot();
  const ref = { snapshotId: snapshot.id, rowKey: snapshot.rows[0]!.key };
  const a = buildAIContext(snapshot, [ref], false);
  expect(a.context.sent).toBe("query_only");
  expect(a.rows).toEqual([]);
  const b = buildAIContext(snapshot, [ref], true);
  expect(b.context.sent).toBe("query_and_selected_rows");
  expect(b.rows.map((r) => r.key)).toEqual([ref.rowKey]);
});

// ---- Step 4: counter-examples, and the payload a question really sends -------------------------------------


describe("buildAIContext refuses what the snapshot does not hold, and never overstates", () => {
  const snapshot = fixtureSnapshot();
  it("a reference to another snapshot, or to a row this one lacks, is refused", () => {
    expect(() => buildAIContext(snapshot, [{ snapshotId: "another", rowKey: snapshot.rows[0]!.key }], true)).toThrow(expect.objectContaining({ code: "context_snapshot_mismatch" }));
    expect(() => buildAIContext(snapshot, [{ snapshotId: snapshot.id, rowKey: "made-up-row" }], true)).toThrow(expect.objectContaining({ code: "unknown_result_reference" }));
    // Refused only when rows are to be sent: a query-only question does not depend on them.
    expect(buildAIContext(snapshot, [{ snapshotId: "another", rowKey: "x" }], false).context.sent).toBe("query_only");
  });

  it("asking to attach with nothing selected sends the query only, and says so", () => {
    const built = buildAIContext(snapshot, [], true);
    expect(built.context.sent).toBe("query_only");
    expect(built.context.selectedRefs).toEqual([]);
  });

  it("at most four, each once, in the order chosen", () => {
    const refs = snapshot.rows.slice(0, 2).map((r) => ({ snapshotId: snapshot.id, rowKey: r.key }));
    expect(buildAIContext(snapshot, [refs[1]!, refs[0]!, refs[1]!], true).rows.map((r) => r.key)).toEqual([refs[1]!.rowKey, refs[0]!.rowKey]);
    const five = Array.from({ length: 5 }, () => refs[0]!);
    expect(() => buildAIContext(snapshot, five, true)).toThrow(ContextError);
  });

  it("attached rows are the snapshot's values; unknown taxes, seats and age are null, never zero", () => {
    const row = snapshot.rows[0]!;
    const unknown = { ...row, value: { ...row.value, fees_cents: null, currency: null, seats_left: 0 }, time: { basis: "local_fallback" as const, providerAt: null, fetchedAt: "2026-10-18T11:00:00.000Z" } };
    const [a] = attachedRows([unknown], new Date("2026-10-18T12:00:00.000Z"));
    expect(a).toMatchObject({ ref: "R1", miles: row.value.miles, taxes: null, seats: null, age_minutes: null });
    const zero = { ...row, value: { ...row.value, fees_cents: 0, currency: "USD", seats_left: 3 }, time: { basis: "provider_last_seen" as const, providerAt: "2026-10-18T11:30:00.000Z", fetchedAt: null } };
    expect(attachedRows([zero], new Date("2026-10-18T12:00:00.000Z"))[0]).toMatchObject({ taxes: { cents: 0, currency: "USD" }, seats: 3, age_minutes: 30 });
    const ahead = { ...zero, time: { ...zero.time, providerAt: "2026-10-18T13:00:00.000Z" } };
    expect(attachedRows([ahead], new Date("2026-10-18T12:00:00.000Z"))[0]!.age_minutes).toBeNull();
  });
});

type Params = Parameters<AskModel["send"]>[0];
type Message = Awaited<ReturnType<AskModel["send"]>>;

function answer(text: string): Message {
  return {
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

/** The Ask service over a trusted snapshot and selection the test controls, and a model that records what it was sent. */
async function service(start: { snapshot: ResultSnapshot | null; selected: ResultRef[] }, replies: Message[] = []) {
  const now = () => new Date("2026-10-18T12:00:00.000Z");
  const anthropicKeys = new MemoryKeyStore();
  await anthropicKeys.set("sk-ant-api03-context-test-key-DO_NOT_LEAK");
  const seatsKeys = new MemoryKeyStore();
  await seatsKeys.set("pro_context_test_key_SECRET");
  const sent: Params[] = [];
  const model: AskModel = {
    send: vi.fn(async (params: Params) => {
      sent.push(structuredClone(params));
      return replies.shift() ?? answer("R1 is the lower-mileage option.");
    }),
    checkKey: vi.fn(async () => {}),
  };
  const state = { ...start };
  const seatsFetch = vi.fn(async () => {
    throw new Error("no seats.aero call is expected here");
  }) as unknown as typeof fetch;
  const ask = createAskService({
    consent: () => true,
    anthropicKeys,
    seatsKeys,
    anthropicFetch: seatsFetch,
    seatsFetch,
    engine: new SearchEngine({ fetchImpl: seatsFetch, quota: new Quota({ store: new DeviceQuotaStore(), now }), now }),
    store: new AskStore(new MemoryFileStore()),
    persist: async () => {},
    lastSearch: { get: () => null },
    context: { snapshot: () => state.snapshot, selected: () => state.selected },
    whenWatchesIdle: async () => {},
    now,
    visibility: { isHidden: () => false, onChange: () => () => {} },
    createClient: () => model,
    assertNative: () => {},
    newId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  const firstTurnText = (i: number) => ((sent[i]!.messages.at(-1)!.content as Array<{ type: string; text?: string }>)[0]!.text ?? "");
  return { ask, sent, state, firstTurnText, model };
}

describe("the question's payload is what the context line says (A26)", () => {
  const snapshot = fixtureSnapshot();
  const refs = snapshot.rows.slice(0, 2).map((r) => ({ snapshotId: snapshot.id, rowKey: r.key }));

  it("query only: the search goes, no result does, and the entry records exactly that", async () => {
    const s = await service({ snapshot, selected: refs });
    const preview = s.ask.preview!(true, false);
    expect(preview.context?.sent).toBe("query_only");
    await s.ask.ask("Which is cheapest?", true, false);
    expect(s.firstTurnText(0)).toContain("The person's last search on the Search screen");
    expect(s.firstTurnText(0)).not.toContain("attached");
    expect(s.ask.state().entries[0]!.context).toMatchObject({ sent: "query_only", snapshotId: snapshot.id, refs: [], earlier: 0 });
  });

  it("with results: each goes as R1, R2… with the snapshot's own values, and the entry records which cards", async () => {
    const s = await service({ snapshot, selected: refs });
    const preview = s.ask.preview!(true, true);
    expect(preview.rows.map((r) => r.key)).toEqual(refs.map((r) => r.rowKey));
    await s.ask.ask("Compare these two.", true, true);
    const text = s.firstTurnText(0);
    expect(text).toContain("attached 2 results");
    expect(text).toContain(`"ref":"R1"`);
    expect(text).toContain(`"miles":${snapshot.rows[0]!.value.miles}`);
    expect(s.ask.state().entries[0]!.context).toEqual({ sent: "query_and_selected_rows", snapshotId: snapshot.id, revision: snapshot.revision, refs, earlier: 0 });
  });

  it("without the search: nothing of it goes, whatever is selected", async () => {
    const s = await service({ snapshot, selected: refs });
    expect(s.ask.preview!(false, true).context).toBeNull();
    await s.ask.ask("What is a sweet spot?", false, true);
    expect(s.firstTurnText(0)).toContain("The person did not include a search.");
    expect(s.firstTurnText(0)).not.toContain("attached");
    expect(s.ask.state().entries[0]!.context).toMatchObject({ sent: "none", refs: [] });
  });

  it("a selection from another snapshot sends nothing at all, and says why", async () => {
    const s = await service({ snapshot, selected: [{ snapshotId: "an-older-snapshot", rowKey: refs[0]!.rowKey }] });
    expect(s.ask.preview!(true, true).refused).toBe("context_snapshot_mismatch");
    const after = await s.ask.ask("Compare these.", true, true);
    expect(s.model.send).not.toHaveBeenCalled();
    expect(after.notice).toEqual({ kind: "context_changed", message: CONTEXT_CHANGED });
    expect(after.entries).toEqual([]);
  });

  it("counts earlier questions, not messages: a question that used a tool is one question (review CTX-1)", async () => {
    // The first question looks up flights once (refused before any request: the id was never shown), then answers.
    const toolRound = {
      ...answer(""),
      content: [{ type: "tool_use", id: "toolu_synthetic", name: "get_flights", input: { id: "never-shown", cabin: "J" } }],
      stop_reason: "tool_use",
    } as unknown as Message;
    const s = await service({ snapshot, selected: [] }, [toolRound, answer("Done.")]);
    await s.ask.ask("Look up the flights.", true, false);
    expect(s.ask.state().entries[0]!.end).toMatchObject({ status: "answered", committed: true });
    expect(s.ask.preview!(true, false).earlier).toBe(1);
    await s.ask.ask("And the taxes?", true, false);
    expect(s.ask.state().entries[1]!.context!.earlier).toBe(1);
  });

  it("the search goes in full: a mileage cap, a mixed-cabin minimum and dynamic pricing, when set (review CTX-2)", async () => {
    const narrowed = fixtureSnapshot({ query: { ...snapshot.query, max_miles: 80000, min_cabin_pct: 75, include_filtered: true } });
    const s = await service({ snapshot: narrowed, selected: [] });
    await s.ask.ask("Anything under the cap?", true, false);
    expect(s.firstTurnText(0)).toContain(
      "That search also had these conditions: at most 80,000 miles; mixed-cabin itineraries with at least 75% of the distance flown in the cabin asked for; dynamically priced seats included.",
    );
    // Unset, they are not written at all: the same bytes as before T15.
    const plain = await service({ snapshot, selected: [] });
    await plain.ask.ask("Anything?", true, false);
    expect(plain.firstTurnText(0)).not.toContain("also had these conditions");
  });

  it("a search replaced after the page said what would go sends nothing (review CTX-3)", async () => {
    const s = await service({ snapshot, selected: [] });
    const shown = s.ask.preview!(true, false).context!.snapshotId;
    s.state.snapshot = fixtureSnapshot({ id: "a-newer-search" });
    const after = await s.ask.ask("Which is cheapest?", true, false, shown);
    expect(s.model.send).not.toHaveBeenCalled();
    expect(after.notice?.kind).toBe("search_changed");
    // The page, redrawn, says the new one; asking with it goes.
    await s.ask.ask("Which is cheapest?", true, false, "a-newer-search");
    expect(s.ask.state().entries[0]!.context!.snapshotId).toBe("a-newer-search");
  });

  it("a selection that cannot go is still counted, so the page can say so (review CTX-4)", async () => {
    const s = await service({ snapshot, selected: [{ snapshotId: "an-older-snapshot", rowKey: refs[0]!.rowKey }] });
    expect(s.ask.preview!(true, true)).toMatchObject({ selected: 1, refused: "context_snapshot_mismatch", context: null });
  });

  it("partial results are said to be partial", async () => {
    const partial = fixtureSnapshot({ coverage: { ...snapshot.coverage, state: "partial" } });
    const s = await service({ snapshot: partial, selected: [] });
    await s.ask.ask("Anything nonstop?", true, false);
    expect(s.firstTurnText(0)).toContain("are incomplete");
  });

  it("Ask again sends the results it was sent with, not today's selection; if they are gone, nothing is sent", async () => {
    const s = await service({ snapshot, selected: refs });
    await s.ask.ask("Compare these two.", true, true);
    s.state.selected = [refs[1]!];
    // An ended entry that did not answer is what offers Ask again; any ended entry can be asked again by id.
    await s.ask.askAgain(s.ask.state().entries[0]!.id);
    expect(s.ask.state().entries[1]!.context!.refs).toEqual(refs);
    expect(s.ask.state().entries[1]!.context!.earlier).toBe(1);
    s.state.snapshot = fixtureSnapshot({ id: "a-new-search" });
    const calls = (s.model.send as ReturnType<typeof vi.fn>).mock.calls.length;
    const after = await s.ask.askAgain(s.ask.state().entries[0]!.id);
    expect((s.model.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    expect(after.notice?.kind).toBe("context_changed");
  });
});
