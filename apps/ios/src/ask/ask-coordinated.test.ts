/**
 * Stop and the request queue (UI/UX v1 T17; docs/02 D09; acceptance A28): a tool call waiting its turn behind a watch
 * run, a search or a lookup never starts once Stop is pressed, sends nothing, and says so; the question ends stopped.
 * A tool call already started finishes, and nothing claims it was recalled.
 */
import { describe, expect, it, vi } from "vitest";
import type { AskModel } from "@awardgrid/core/ask/client";
import { SEARCH_AWARDS } from "@awardgrid/core/ask/tools";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import { MemoryKeyStore } from "../native/keychain";
import { SearchEngine } from "../search/search";
import { AskStore } from "../store/ask-store";
import { MemoryFileStore } from "../store/persistence";
import { DeviceQuotaStore } from "../store/quota-store";
import { RequestCoordinator } from "../workspace/request-coordinator";
import { createAskService } from "./ask-service";
import { endLabel, stepLabel } from "./labels";

type Message = Awaited<ReturnType<AskModel["send"]>>;
const usage = { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const snapshot = fixtureSnapshot();
const q = snapshot.query;
const inside = { origins: q.origins, destinations: q.destinations, date_from: q.date_from, date_to: q.date_to, cabins: q.cabins, programs: q.programs ?? null, direct_only: q.direct_only, max_miles: null };
const toolUse = { id: "m", type: "message", role: "assistant", model: "claude-opus-5", content: [{ type: "tool_use", id: "toolu_1", name: SEARCH_AWARDS, input: inside }], stop_reason: "tool_use", stop_sequence: null, usage } as unknown as Message;
const text = { id: "m", type: "message", role: "assistant", model: "claude-opus-5", content: [{ type: "text", text: "Done.", citations: null }], stop_reason: "end_turn", stop_sequence: null, usage } as unknown as Message;

describe("Stop and the queue", () => {
  it("a tool call waiting behind a watch run never starts once Stop is pressed, and sends nothing", async () => {
    const now = () => new Date("2026-10-18T12:00:00.000Z");
    const anthropicKeys = new MemoryKeyStore();
    await anthropicKeys.set("sk-ant-api03-coordinated-test-key-DO_NOT_LEAK");
    const seatsKeys = new MemoryKeyStore();
    await seatsKeys.set("pro_coordinated_test_key_SECRET");
    const seatsFetch = vi.fn(async () => {
      throw new Error("seats.aero must not be reached");
    }) as unknown as typeof fetch;
    const replies = [toolUse, text];
    const model: AskModel = { send: vi.fn(async () => replies.shift() ?? text), checkKey: vi.fn(async () => {}) };
    const requests = new RequestCoordinator();
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
      context: { snapshot: () => snapshot, selected: () => [], revision: () => snapshot.revision },
      coordinate: (kind, operation, signal) => requests.run(kind, operation, { signal }),
      whenWatchesIdle: async () => {},
      now,
      visibility: { isHidden: () => false, onChange: () => () => {} },
      createClient: () => model,
      assertNative: () => {},
    });

    // A watch run holds the queue.
    let release!: () => void;
    const watchRun = requests.run("watch", () => new Promise<void>((resolve) => (release = resolve)));
    const asked = ask.ask("Anything nonstop?", true, false);
    // The question's tool call waits its turn behind the watch run, and is said as waiting, not searching.
    await vi.waitFor(() => {
      expect(requests.active()).toBe("watch");
      expect(ask.state().running?.activity.kind).toBe("queued");
      expect(requests.waiting()).toBe(1);
    });
    ask.stop();
    // The question ends at once, while the watch run is still out (review COORD-1).
    const state = await asked;
    expect(requests.active()).toBe("watch");
    expect(ask.isRunning()).toBe(false);
    release();
    await watchRun;

    const entry = state.entries[0]!;
    expect(entry.end).toMatchObject({ status: "stopped" });
    const step = entry.steps.find((s) => s.kind === "tool");
    expect(step).toMatchObject({ kind: "tool", step: { tool: SEARCH_AWARDS, outcome: "stopped", calls: 0 } });
    expect(stepLabel(step!)).toBe("Search not started: you pressed Stop before it began. No calls.");
    // The ending agrees with the step: it never began (review COORD-2).
    expect(endLabel(entry)).toBe("Stopped before the next step began. Nothing more will be sent for this question.");
    expect(seatsFetch).not.toHaveBeenCalled();
    // Nothing more went to Anthropic after Stop.
    expect(model.send).toHaveBeenCalledTimes(1);
  });
});
