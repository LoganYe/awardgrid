/**
 * ask.json on the device (design §6.7): a round trip, files that cannot be read, and which actions remove it.
 *
 * The clearing cases run through AppServices, because the promise is about what "Clear cached results" and "New
 * conversation" do. A MemoryFileStore stands in for the Data directory, both keys are in-memory stores, and the
 * Anthropic transport fails the test if anything calls it. No network and no clock.
 */
import { describe, expect, it } from "vitest";
import { CONVERSATION_FILE_VERSION, newConversation, serializeConversation, type Conversation } from "@awardgrid/core/ask/conversation";
import type { Watch } from "@awardgrid/core/watch";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { bootstrap } from "../app/bootstrap";
import { MemoryKeyStore } from "../native/keychain";
import { ASK_FILE, AskStore } from "./ask-store";
import { CACHE_FILE, MemoryFileStore, QUOTA_FILE, SnapshotStore, WATCHES_FILE, type FileStore } from "./persistence";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const SEATS_KEY = "pro_ask_store_test_key_DO_NOT_LEAK";
const ANTHROPIC_KEY = "sk-ant-api03-ask-store-test-key-DO_NOT_LEAK";
const QUERY = "HKG to SEA next 30 days business";

/** A conversation with one answered question and everything the file keeps: history, allowlists, a memo. */
function conversation(): Conversation {
  const c = newConversation({ id: "conv-store", now: () => NOW });
  c.committed.push(
    { role: "user", content: [{ type: "text", text: "Context from awardgrid, not written by the person:" }, { type: "text", text: "Cheapest business to Tokyo?" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "synthetic_signature_not_from_anthropic" }, { type: "text", text: "Alaska, 75,000 miles." }] },
  );
  c.entries.push({
    id: "entry-1",
    question: "Cheapest business to Tokyo?",
    includeSearch: false,
    askedAt: NOW.toISOString(),
    steps: [
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
      { kind: "paused" },
    ],
    texts: ["Alaska, 75,000 miles."],
    usage: { requests: 2, inputTokens: 9000, cacheReadTokens: 3956, outputTokens: 400, lastRequestInputTokens: 5000, toolCalls: 1, seatsCalls: 1 },
    end: { status: "answered", committed: true, failure: null, stoppedDuring: null, at: NOW.toISOString() },
  });
  c.seenIds.add("2PPrELk9WcfJaNREWEPXypvhXAD");
  c.bookingUrls.add("https://www.alaskaair.com/search?from=SEA&to=NRT");
  c.flightsMemo.set("2PPrELk9WcfJaNREWEPXypvhXAD J", {
    id: "2PPrELk9WcfJaNREWEPXypvhXAD",
    cabin: "J",
    program: "alaska",
    looked_up_at: "2026-09-30T23:30:00.000Z",
    booking_url: "https://www.alaskaair.com/search?from=SEA&to=NRT",
    trips_total: 0,
    trips: [],
  });
  return c;
}

describe("AskStore", () => {
  it("round-trips a conversation, sets, memo and thinking block included, in ask.json alone", async () => {
    const files = new MemoryFileStore();
    const saved = conversation();
    await new AskStore(files).write(saved);

    expect([...files.files.keys()]).toEqual([ASK_FILE]);
    expect(ASK_FILE).toBe("ask.json");
    expect(await new AskStore(files).read()).toEqual(saved);
  });

  it("reads a missing file as no conversation", async () => {
    expect(await new AskStore(new MemoryFileStore()).read()).toBeNull();
  });

  it.each([
    ["not JSON", "{ this is not json"],
    ["empty", ""],
    ["cut short", serializeConversation(conversation()).slice(0, 200)],
    ["another version", serializeConversation(conversation()).replace(`"version":${CONVERSATION_FILE_VERSION}`, `"version":${CONVERSATION_FILE_VERSION + 1}`)],
    ["a broken shape", JSON.stringify({ version: CONVERSATION_FILE_VERSION, conversation: { id: 5 } })],
  ])("reads a corrupt file (%s) as no conversation, without throwing", async (_name, text) => {
    const files = new MemoryFileStore();
    await files.write(ASK_FILE, text);
    expect(await new AskStore(files).read()).toBeNull();
  });

  it("reads a Data directory that cannot be read as no conversation", async () => {
    const failing: FileStore = {
      read: async () => {
        throw new Error("disk I/O error");
      },
      write: async () => {},
      remove: async () => {},
    };
    expect(await new AskStore(failing).read()).toBeNull();
  });

  it("removes ask.json and nothing beside it", async () => {
    const files = new MemoryFileStore();
    await files.write(CACHE_FILE, "{}");
    await files.write(QUOTA_FILE, "{}");
    const store = new AskStore(files);
    await store.write(conversation());
    await store.remove();
    expect([...files.files.keys()].sort()).toEqual([CACHE_FILE, QUOTA_FILE].sort());
  });
});

function watch(): Watch {
  return { id: "w1", name: "HKG to SEA", text: QUERY, lastCheckedAt: null, baseline: [], dropThresholdPct: 10, enabled: true, createdAt: "2026-09-01T00:00:00.000Z" };
}

/** A device with every file on disk: a cached search, today's quota, a watch, both keys, and a saved conversation. */
async function device() {
  const files = new MemoryFileStore();
  await new AskStore(files).write(conversation());
  const keys = new MemoryKeyStore();
  await keys.set(SEATS_KEY);
  const anthropicKeys = new MemoryKeyStore();
  await anthropicKeys.set(ANTHROPIC_KEY);
  const anthropicFetch = (async () => {
    throw new Error("nothing in these tests may call Anthropic");
  }) as typeof fetch;
  const fetchImpl = fakeFetch((req) =>
    req.url.pathname.endsWith("/routes")
      ? jsonResponse([])
      : jsonResponse({
          data: [
            {
              ID: "id-2026-10-05",
              RouteID: "r1",
              Route: { ID: "r1", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "alaska" },
              Date: "2026-10-05",
              ParsedDate: "2026-10-05T00:00:00Z",
              Source: "alaska",
              JAvailable: true,
              JMileageCost: "80000",
              JRemainingSeats: 2,
              JAirlines: "AS",
              JDirect: true,
              YAvailable: false,
              WAvailable: false,
              FAvailable: false,
            },
          ],
          hasMore: false,
        }),
  );
  const svc = await bootstrap({ keys, anthropicKeys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl, anthropicFetch });
  await svc.engine.search(QUERY, SEATS_KEY);
  svc.watches.add(watch());
  await svc.persist();
  for (const file of [CACHE_FILE, QUOTA_FILE, WATCHES_FILE, ASK_FILE]) expect(files.files.has(file), `${file} should be on disk`).toBe(true);
  return { files, keys, anthropicKeys, svc };
}

describe("what clears ask.json, and what does not", () => {
  it("Clear cached results leaves ask.json exactly as it was, and both keys", async () => {
    const { files, keys, anthropicKeys, svc } = await device();
    const before = files.files.get(ASK_FILE);

    await svc.clearCache();

    expect(files.files.has(CACHE_FILE)).toBe(false);
    expect(files.files.get(ASK_FILE)).toBe(before);
    expect(await keys.get()).toBe(SEATS_KEY);
    expect(await anthropicKeys.get()).toBe(ANTHROPIC_KEY);
    expect(svc.ask.state().entries).toHaveLength(1);
  });

  it("New conversation removes ask.json and nothing else, and a later persist does not write it back", async () => {
    const { files, keys, anthropicKeys, svc } = await device();
    const others = Object.fromEntries([CACHE_FILE, QUOTA_FILE, WATCHES_FILE].map((file) => [file, files.files.get(file)]));

    const state = await svc.ask.newConversation();

    expect(files.files.has(ASK_FILE)).toBe(false);
    for (const [file, contents] of Object.entries(others)) expect(files.files.get(file), `${file} changed`).toBe(contents);
    expect(await keys.get()).toBe(SEATS_KEY);
    expect(await anthropicKeys.get()).toBe(ANTHROPIC_KEY);
    expect(state.entries).toEqual([]);
    expect(state.notice).toEqual({ kind: "cleared", message: "Conversation cleared." });

    await svc.persist();
    expect(files.files.has(ASK_FILE)).toBe(false);
  });
});
