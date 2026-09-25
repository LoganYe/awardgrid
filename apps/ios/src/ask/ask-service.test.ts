/**
 * AskService over a scripted model, the grid lane's real stores and a fake seats.aero (design §1.2, §2.5, §10.1).
 *
 * The model's replies are real SDK messages. Before any test, each script in core's streams.json runs once through
 * createAskClient over a fake fetch, as core's loop tests build them. The service is then handed a client factory
 * that returns a scripted AskModel, so no SDK request is built unless a test wants one; the key checks do, to meet
 * the SDK's real errors. Tool calls run core's real runner and runFind over a fake seats.aero. The clock, timers,
 * visibility and the watch runner's idle signal are injected fakes, and nothing reaches the network or the Keychain.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type AskModel, createAskClient } from "@awardgrid/core/ask/client";
import { type AskEntry, type Conversation, newConversation, parseConversation, serializeConversation } from "@awardgrid/core/ask/conversation";
import { ASK_REQUEST_LIMIT_MS } from "@awardgrid/core/ask/limits";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { type StreamEvent, toSse } from "@awardgrid/core/test-fixtures/ask/sse";
import streams from "@awardgrid/core/test-fixtures/ask/streams.json";
import { type FakeHandler, fakeFetch } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { NativeHttpUnavailableError } from "../native/http";
import { type KeyStore, MemoryKeyStore } from "../native/keychain";
import { createLastSearch } from "../search/last-search";
import { LOCAL_USER, SearchEngine } from "../search/search";
import { ASK_FILE, AskStore } from "../store/ask-store";
import { type FileStore, MemoryFileStore } from "../store/persistence";
import { DeviceQuotaStore } from "../store/quota-store";
import { type AskServiceDeps, type Visibility, createAskService } from "./ask-service";
import * as labels from "./labels";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const ANTHROPIC_KEY = "sk-ant-api03-service-test-key-DO_NOT_LEAK";
const SEATS_KEY = "pro_seats_key_for_service_tests_SECRET";
const QUESTION = "Cheapest business class from SEA to Tokyo in October?";
/** Parses to exactly the search the tool_use_search script asks for: SEA to NRT and HND, 2026-10-01 to 2026-10-31, business. */
const GRID_QUERY = "SEA to TYO 2026-10-01 to 2026-10-31 business";

type Message = Awaited<ReturnType<AskModel["send"]>>;
type Params = Parameters<AskModel["send"]>[0];
type ScriptName = Exclude<keyof typeof streams, `_${string}`>;

const messages = new Map<ScriptName, Message>();
const errors: Record<"overloaded" | "rejected" | "echoesKeys", unknown> = { overloaded: null, rejected: null, echoesKeys: null };

async function viaClient(respond: () => Response): Promise<{ message?: Message; error?: unknown }> {
  const fetchImpl = (async () => respond()) as typeof fetch;
  const params: Params = { model: "claude-opus-5", max_tokens: 16000, messages: [{ role: "user", content: QUESTION }] };
  try {
    return { message: await createAskClient({ apiKey: ANTHROPIC_KEY, fetch: fetchImpl }).send(params, { signal: new AbortController().signal }) };
  } catch (error) {
    return { error };
  }
}

const errorBody = (status: number, type: string, message: string) => () =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: { "content-type": "application/json", "request-id": `req_synthetic_${status}` },
  });

beforeAll(async () => {
  for (const name of ["text", "tool_use_search", "refusal"] as const) {
    const { message } = await viaClient(() => new Response(toSse(streams[name] as unknown as StreamEvent[], { pingEvery: 2 }), { status: 200, headers: { "content-type": "text/event-stream" } }));
    messages.set(name, message!);
  }
  errors.overloaded = (await viaClient(errorBody(529, "overloaded_error", "Overloaded"))).error;
  errors.rejected = (await viaClient(errorBody(401, "authentication_error", "invalid x-api-key"))).error;
  errors.echoesKeys = (await viaClient(errorBody(400, "invalid_request_error", `keys ${ANTHROPIC_KEY} and ${SEATS_KEY} do not belong in a message`))).error;
});

beforeEach(() => {
  // The SDK folds this variable into every request's headers (core client.ts); the tests must not depend on the shell.
  vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A copy of what the SDK built from a script, as a fresh object for each request. */
const scripted = (name: ScriptName): Message => JSON.parse(JSON.stringify(messages.get(name)!)) as Message;

type Reply = { script: ScriptName } | { error: unknown } | { later: Deferred<Message> } | { hang: true };

/** `onSend` runs as each request goes out, before anything else, so a test can read what was on disk at that moment. */
function scriptedModel(replies: Reply[], onSend?: () => void) {
  const sent: Params[] = [];
  const signals: AbortSignal[] = [];
  const send = vi.fn((params: Params, { signal }: { signal: AbortSignal }) => {
    onSend?.();
    sent.push(params);
    signals.push(signal);
    const reply = replies.shift();
    return new Promise<Message>((resolve, reject) => {
      // What the SDK does when the loop aborts its request: the wait ends in a rejection.
      signal.addEventListener("abort", () => reject(new Error("Request was aborted.")), { once: true });
      if (reply === undefined) reject(new Error(`no scripted reply for request ${sent.length}`));
      else if ("script" in reply) resolve(scripted(reply.script));
      else if ("error" in reply) reject(reply.error);
      else if ("later" in reply) reply.later.promise.then(resolve, reject);
    });
  });
  const model: AskModel = { send, checkKey: vi.fn(async () => {}) };
  return { model, send, sent, signals };
}

/** Timers the test fires itself, by the delay they were set for. */
function manualTimers() {
  const pending = new Map<number, { ms: number; fire: () => void }>();
  let next = 0;
  return {
    pending,
    setTimer(ms: number, fire: () => void): unknown {
      next += 1;
      pending.set(next, { ms, fire });
      return next;
    },
    clearTimer(handle: unknown): void {
      pending.delete(handle as number);
    },
    fire(ms: number): void {
      for (const [id, timer] of [...pending]) {
        if (timer.ms !== ms) continue;
        pending.delete(id);
        timer.fire();
      }
    },
  };
}

function fakeVisibility() {
  let hidden = false;
  const listeners = new Set<() => void>();
  const visibility: Visibility = {
    isHidden: () => hidden,
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const tell = () => [...listeners].forEach((listener) => listener());
  return {
    visibility,
    hide() {
      hidden = true;
      tell();
    },
    show() {
      hidden = false;
      tell();
    },
    /** How many visibility listeners are registered now. */
    listening: () => listeners.size,
  };
}

function availability(dest: string, date: string) {
  return {
    ID: `id-SEA-${dest}-${date}`,
    RouteID: `r-SEA-${dest}`,
    Route: { ID: `r-SEA-${dest}`, OriginAirport: "SEA", DestinationAirport: dest, Source: "alaska" },
    Date: date,
    ParsedDate: `${date}T00:00:00Z`,
    Source: "alaska",
    JAvailable: true,
    JMileageCost: "75000",
    JRemainingSeats: 2,
    JAirlines: "JL",
    JDirect: true,
    YAvailable: false,
    WAvailable: false,
    FAvailable: false,
  };
}

/** A search answers rows for SEA to NRT and HND, so it is one request and no Get Routes call follows. */
const seatsAero: FakeHandler = (req) =>
  new Response(JSON.stringify(req.url.pathname.endsWith("/routes") ? [] : { data: [availability("NRT", "2026-10-05"), availability("HND", "2026-10-06")], hasMore: false }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A MemoryFileStore that also keeps every ask.json it was handed, in order. */
class RecordingFiles extends MemoryFileStore {
  readonly written: string[] = [];
  override async write(path: string, data: string): Promise<void> {
    if (path === ASK_FILE) this.written.push(data);
    await super.write(path, data);
  }
}

/**
 * A Data directory whose ask.json writes land only when the test lets them, as a Filesystem write lands only when
 * the bridge answers. Other files are written at once.
 */
class HeldFiles extends MemoryFileStore {
  /** Whether an ask.json write waits for release(). */
  hold = true;
  readonly #waiting: Array<() => void> = [];
  override async write(path: string, data: string): Promise<void> {
    if (path === ASK_FILE && this.hold) await new Promise<void>((land) => this.#waiting.push(land));
    await super.write(path, data);
  }
  /** ask.json writes waiting to land. */
  get held(): number {
    return this.#waiting.length;
  }
  /** Let every write waiting now land. */
  release(): void {
    for (const land of this.#waiting.splice(0)) land();
  }
  /** ask.json as it is on disk at this moment. */
  onDisk(): Conversation | null {
    return parseConversation(this.files.get(ASK_FILE) ?? null);
  }
}

interface HarnessOptions {
  replies?: Reply[];
  onSend?: () => void;
  anthropicKey?: string | null;
  seatsKey?: string | null;
  files?: FileStore;
  anthropicFetch?: typeof fetch;
  whenWatchesIdle?: () => Promise<void>;
  assertNative?: () => void;
  createClient?: AskServiceDeps["createClient"];
}

async function harness(opts: HarnessOptions = {}) {
  const files = opts.files ?? new RecordingFiles();
  const anthropicKeys = new MemoryKeyStore();
  if (opts.anthropicKey !== null) await anthropicKeys.set(opts.anthropicKey ?? ANTHROPIC_KEY);
  const seatsKeys = new MemoryKeyStore();
  if (opts.seatsKey !== null) await seatsKeys.set(opts.seatsKey ?? SEATS_KEY);
  const anthropicFetch =
    opts.anthropicFetch ??
    (vi.fn(async () => {
      throw new Error("nothing in this test may reach the Anthropic transport");
    }) as unknown as typeof fetch);
  const seatsFetch = fakeFetch(seatsAero);
  const clock = { ms: NOW.getTime() };
  const now = () => new Date(clock.ms);
  const quotaStore = new DeviceQuotaStore();
  const engine = new SearchEngine({ fetchImpl: seatsFetch, quota: new Quota({ store: quotaStore, now }), now });
  const model = scriptedModel(opts.replies ?? [], opts.onSend);
  const createClient = vi.fn(opts.createClient ?? (() => model.model));
  const persist = vi.fn(async () => {});
  const timers = manualTimers();
  const screen = fakeVisibility();
  const lastSearch = createLastSearch();
  const whenWatchesIdle = vi.fn(opts.whenWatchesIdle ?? (async () => {}));
  let ids = 0;
  const service = createAskService({
    anthropicKeys,
    seatsKeys,
    anthropicFetch,
    seatsFetch,
    engine,
    store: new AskStore(files),
    persist,
    lastSearch,
    whenWatchesIdle,
    now,
    visibility: screen.visibility,
    timers,
    createClient,
    assertNative: opts.assertNative ?? (() => {}),
    newId: () => `id-${++ids}`,
  });
  return { service, files, anthropicKeys, seatsKeys, anthropicFetch, seatsFetch, engine, quotaStore, createClient, persist, timers, screen, lastSearch, clock, whenWatchesIdle, ...model };
}

/** Let the event loop turn until `check` holds. Counts turns, never wall-clock time. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 1000; turn++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`never reached: ${what}`);
}

/** Let the event loop turn `n` times, so whatever was not waiting on the test has happened. Counts turns, never wall-clock time. */
async function turns(n: number): Promise<void> {
  for (let turn = 0; turn < n; turn++) await new Promise((resolve) => setImmediate(resolve));
}

function savedFile(files: FileStore): Promise<Conversation | null> {
  return new AskStore(files).read();
}

function answered(id: string, question: string): AskEntry {
  return {
    id,
    question,
    includeSearch: false,
    askedAt: NOW.toISOString(),
    steps: [],
    texts: ["Alaska has 2 seats at 75,000 miles."],
    usage: { requests: 1, inputTokens: 4392, cacheReadTokens: 3956, outputTokens: 96, lastRequestInputTokens: 4392, toolCalls: 0, seatsCalls: 0 },
    end: { status: "answered", committed: false, failure: null, stoppedDuring: null, at: NOW.toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Keys and wiring
// ---------------------------------------------------------------------------

describe("keys, read when a question starts", () => {
  it("with no Anthropic key, builds no client and sends nothing to Anthropic", async () => {
    const h = await harness({ anthropicKey: null });
    const state = await h.service.ask(QUESTION, false);

    expect(state.notice).toEqual({ kind: "no_anthropic_key", message: labels.NO_ANTHROPIC_KEY });
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.anthropicFetch).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.seatsFetch.calls).toHaveLength(0);
    expect(state.entries).toEqual([]);
    expect(state.running).toBeNull();
    expect(await h.files.read(ASK_FILE)).toBeNull();
  });

  it("with no seats.aero key, refuses the question before it starts", async () => {
    const h = await harness({ seatsKey: null, replies: [{ script: "text" }] });
    const state = await h.service.ask(QUESTION, false);

    expect(state.notice).toEqual({ kind: "no_seats_key", message: labels.NO_SEATS_KEY });
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(state.entries).toEqual([]);
  });

  it("reads the keys at the question, not at restore, so a key added afterwards is the one used", async () => {
    const h = await harness({ anthropicKey: null, replies: [{ script: "text" }] });
    const get = vi.spyOn(h.anthropicKeys, "get");
    await h.service.restore();
    expect(get).not.toHaveBeenCalled();

    const later = "sk-ant-api03-added-after-launch-DO_NOT_LEAK";
    await h.anthropicKeys.set(later);
    await h.service.ask(QUESTION, false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(h.createClient).toHaveBeenCalledWith({ apiKey: later, fetch: h.anthropicFetch });
  });

  it("hands the client factory the key and the Anthropic transport, and no baseURL", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    await h.service.ask(QUESTION, false);

    expect(h.createClient).toHaveBeenCalledTimes(1);
    const [options] = h.createClient.mock.calls[0]!;
    expect(options).toEqual({ apiKey: ANTHROPIC_KEY, fetch: h.anthropicFetch });
    expect(Object.keys(options)).toEqual(["apiKey", "fetch"]);
    expect(options.fetch).not.toBe(h.seatsFetch);
  });
});

describe("native HTTP", () => {
  const unavailable = () => {
    throw new NativeHttpUnavailableError('Not a native platform (got "web").');
  };

  it("a failed check is a wiring state of Ask's own: no key is read and no client is built", async () => {
    const h = await harness({ assertNative: unavailable, replies: [{ script: "text" }] });
    const get = vi.spyOn(h.anthropicKeys, "get");
    const seatsGet = vi.spyOn(h.seatsKeys, "get");
    const state = await h.service.ask(QUESTION, false);

    expect(state.wiring).toBe(labels.WIRING);
    expect(state.notice).toEqual({ kind: "wiring", message: labels.WIRING });
    expect(get).not.toHaveBeenCalled();
    expect(seatsGet).not.toHaveBeenCalled();
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("restore() reports it, and a build that has native HTTP reports none", async () => {
    expect((await (await harness({ assertNative: unavailable })).service.restore()).wiring).toBe(labels.WIRING);
    expect((await (await harness()).service.restore()).wiring).toBeNull();
  });

  it("a client that refuses its transport is reported as wiring, not as an outage", async () => {
    const h = await harness({
      createClient: () => {
        throw Object.assign(new Error("createAskClient needs the native adapter; the global fetch in this app is the WebView's."), { name: "AskTransportError" });
      },
    });
    const state = await h.service.ask(QUESTION, false);
    expect(state.notice).toEqual({ kind: "wiring", message: labels.WIRING });
    expect(state.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A question
// ---------------------------------------------------------------------------

describe("a question", () => {
  it("answers, commits, and saves ask.json when it starts, with pending, and when it ends, without", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    const state = await h.service.ask(`  ${QUESTION}  `, false);

    const entry = state.entries[0]!;
    expect(state.entries).toHaveLength(1);
    expect(entry.question).toBe(QUESTION);
    expect(entry.end).toMatchObject({ status: "answered", committed: true, failure: null, stoppedDuring: null });
    expect(entry.texts).toHaveLength(1);
    // Every input token sent, cached or not: 12 + 424 + 3,956.
    expect(entry.usage).toMatchObject({ requests: 1, inputTokens: 4392, cacheReadTokens: 3956, outputTokens: 96, seatsCalls: 0 });
    expect(state.running).toBeNull();
    expect(h.service.isRunning()).toBe(false);

    const written = (h.files as RecordingFiles).written.map((text) => JSON.parse(text) as { conversation: { pending: unknown; entries: Array<{ end: unknown }> } });
    expect(written.some((file) => file.conversation.pending !== null && file.conversation.entries[0]!.end === null)).toBe(true);
    const saved = await savedFile(h.files);
    expect(saved?.pending).toBeNull();
    expect(saved?.entries[0]?.end?.status).toBe("answered");
    expect(saved?.committed).toHaveLength(2);
    // Nothing spent seats.aero calls, so nothing asked for the snapshots to be saved.
    expect(h.persist).not.toHaveBeenCalled();
  });

  it("creates the entry when the question starts, so the eighth question runs and the ninth is refused", async () => {
    const files = new RecordingFiles();
    const seven = newConversation({ id: "conv-seven", now: () => NOW });
    for (let i = 1; i <= 7; i++) seven.entries.push(answered(`entry-${i}`, `Question ${i}?`));
    await new AskStore(files).write(seven);
    const h = await harness({ files, replies: [{ script: "text" }] });

    const eighth = await h.service.ask(QUESTION, false);
    expect(eighth.entries).toHaveLength(8);
    expect(eighth.entries[7]!.end?.status).toBe("answered");
    expect(eighth.full).toBe("This conversation has reached 8 questions. Start a new conversation.");

    const ninth = await h.service.ask("And one more?", false);
    expect(ninth.notice).toEqual({ kind: "not_started", message: "This conversation has reached 8 questions. Start a new conversation." });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty question before reading a key", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    const get = vi.spyOn(h.anthropicKeys, "get");
    const state = await h.service.ask("   ", false);
    expect(state.notice).toEqual({ kind: "not_started", message: "Type a question for Claude first." });
    expect(get).not.toHaveBeenCalled();
    expect(state.entries).toEqual([]);
  });

  it("includes the last grid search when asked, and records whether one was included", async () => {
    const h = await harness({ replies: [{ script: "text" }, { script: "text" }] });
    const search = await h.engine.search(GRID_QUERY, SEATS_KEY);
    if (!search.ok) throw new Error("the grid search should have succeeded");

    // Asked for, but there is no last search yet: the choice is recorded as not included.
    const without = await h.service.ask(QUESTION, true);
    expect(without.entries[0]!.includeSearch).toBe(false);
    expect(JSON.stringify(h.sent[0]!.messages[0])).toContain("The person did not include a search.");

    h.lastSearch.set({ text: GRID_QUERY, value: search.value });
    const withSearch = await h.service.ask("Which program has the cheapest seats in this search?", true);
    expect(withSearch.entries[1]!.includeSearch).toBe(true);
    const context = JSON.stringify(h.sent[1]!.messages.at(-1));
    expect(context).toContain("which they chose to include");
    expect(context).toContain(JSON.stringify(JSON.stringify({ origins: ["SEA"], destinations: ["NRT", "HND"] })).slice(1, -3));
  });

  it("runs its tools over this device's seats.aero stores, and saves everything after the call that spent", async () => {
    const h = await harness({ replies: [{ script: "tool_use_search" }, { script: "text" }] });
    const state = await h.service.ask(QUESTION, false);

    const entry = state.entries[0]!;
    expect(entry.end?.status).toBe("answered");
    expect(entry.steps).toEqual([{ kind: "tool", step: expect.objectContaining({ tool: "search_awards", outcome: "ok", calls: 1, fromCache: false }) }]);
    expect(labels.stepLabel(entry.steps[0]!)).toBe("Searched seats.aero: SEA to NRT, HND, 2026-10-01 to 2026-10-31, business. 1 call.");
    expect(entry.usage).toMatchObject({ requests: 2, toolCalls: 1, seatsCalls: 1 });

    expect(h.seatsFetch.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search"]);
    expect(h.seatsFetch.calls[0]!.headers["partner-authorization"]).toBe(SEATS_KEY);
    expect(JSON.stringify(h.seatsFetch.calls)).not.toContain(ANTHROPIC_KEY);
    expect(await h.engine.quota.used(LOCAL_USER)).toBe(1);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.whenWatchesIdle).toHaveBeenCalledTimes(1);

    // The tool's result went back to Claude, and the ids it returned are the conversation's, on disk too.
    expect(JSON.stringify(h.sent[1]!.messages.at(-1))).toContain("tool_result");
    const saved = await savedFile(h.files);
    expect(saved?.entries[0]?.steps).toHaveLength(1);
    expect([...(saved?.seenIds ?? [])].sort()).toEqual(["id-SEA-HND-2026-10-06", "id-SEA-NRT-2026-10-05"]);
  });

  it("saves ask.json after a tool call and before the next request ends, with the question still pending", async () => {
    const second = deferred<Message>();
    const files = new RecordingFiles();
    const h = await harness({ files, replies: [{ script: "tool_use_search" }, { later: second }] });
    const run = h.service.ask(QUESTION, false);
    await until(() => h.send.mock.calls.length === 2, "the request after the tool call");
    const stepsIn = (text: string) => (JSON.parse(text) as { conversation: { entries: Array<{ steps: unknown[] }> } }).conversation.entries[0]!.steps.length;
    await until(() => files.written.length > 0 && stepsIn(files.written.at(-1)!) === 1, "a save that holds the tool step");

    const mid = await savedFile(files);
    expect(mid?.pending).toEqual({ entryId: "id-2", startedAt: NOW.toISOString() });
    expect(mid?.entries[0]?.end).toBeNull();
    expect(mid?.seenIds.size).toBe(2);

    second.resolve(scripted("text"));
    expect((await run).entries[0]!.end?.status).toBe("answered");
  });

  it("sends nothing before the saves ahead of it land: the pending marker, then what each step returned", async () => {
    const files = new HeldFiles();
    const atSend: Array<Conversation | null> = [];
    const h = await harness({ files, replies: [{ script: "tool_use_search" }, { script: "text" }], onSend: () => atSend.push(files.onDisk()) });
    const run = h.service.ask(QUESTION, false);

    // The question has started, and its pending marker is still on its way to disk: the first request waits for it.
    await until(() => files.held === 1, "the save that marks the question pending");
    await turns(10);
    expect(h.send).not.toHaveBeenCalled();
    expect(files.onDisk()).toBeNull();
    files.release();
    await until(() => h.send.mock.calls.length === 1, "the first request");
    expect(atSend[0]?.pending).toEqual({ entryId: "id-2", startedAt: NOW.toISOString() });
    expect(atSend[0]?.entries[0]?.end).toBeNull();

    // The request is counted on disk as it goes out. That save does not hold the request back: it was already sent.
    await until(() => files.held === 1, "the save that counts the first request");
    files.release();
    // Claude's first response asks for a search. What it returned is saved before the search goes to seats.aero.
    await until(() => files.held === 1, "the save after the first request");
    expect(files.onDisk()?.entries[0]).toMatchObject({ texts: [], usage: { requests: 1 } });
    await turns(10);
    expect(h.seatsFetch.calls).toHaveLength(0);
    files.release();
    await until(() => h.seatsFetch.calls.length === 1, "the search");
    expect(files.onDisk()?.entries[0]).toMatchObject({ texts: ["I'll search seats.aero for business class from Seattle to Tokyo in October."], usage: { requests: 1 } });

    // The search's step and the ids it returned are saved before the next request goes out.
    await until(() => files.held === 1, "the save after the search");
    await turns(10);
    expect(h.send).toHaveBeenCalledTimes(1);
    files.hold = false;
    files.release();
    const state = await run;

    expect(state.entries[0]!.end?.status).toBe("answered");
    expect(atSend[1]?.pending).toEqual({ entryId: "id-2", startedAt: NOW.toISOString() });
    expect(atSend[1]?.entries[0]?.steps).toEqual([{ kind: "tool", step: expect.objectContaining({ tool: "search_awards", outcome: "ok", calls: 1 }) }]);
    expect([...(atSend[1]?.seenIds ?? [])].sort()).toEqual(["id-SEA-HND-2026-10-06", "id-SEA-NRT-2026-10-05"]);
    expect(files.onDisk()?.pending).toBeNull();
  });

  it("reads a search this device already holds without spending a call or saving the snapshots", async () => {
    const h = await harness({ replies: [{ script: "tool_use_search" }, { script: "text" }] });
    await h.engine.search(GRID_QUERY, SEATS_KEY);
    const callsBefore = h.seatsFetch.calls.length;

    const state = await h.service.ask(QUESTION, false);
    const step = state.entries[0]!.steps[0]!;
    expect(step).toEqual({ kind: "tool", step: expect.objectContaining({ outcome: "ok", calls: 0, fromCache: true }) });
    expect(labels.stepLabel(step)).toBe("Read from this device's cache: SEA to NRT, HND, 2026-10-01 to 2026-10-31, business. No calls.");
    expect(h.seatsFetch.calls).toHaveLength(callsBefore);
    expect(h.persist).not.toHaveBeenCalled();
  });

  it("masks both keys from a failure's message, on screen and in ask.json", async () => {
    const h = await harness({ replies: [{ error: errors.echoesKeys }] });
    const state = await h.service.ask(QUESTION, false);

    const failure = state.entries[0]!.end?.failure;
    expect(failure?.code).toBe("bad_request");
    expect(failure?.message).toContain("••••");
    for (const secret of [ANTHROPIC_KEY, SEATS_KEY]) {
      expect(JSON.stringify(state)).not.toContain(secret);
      expect(await h.files.read(ASK_FILE)).not.toContain(secret);
    }
  });

  it("carries on when ask.json cannot be saved: a failed save never ends a question", async () => {
    const failing: FileStore = {
      read: async () => null,
      write: async () => {
        throw new Error("disk full");
      },
      remove: async () => {},
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await harness({ files: failing, replies: [{ script: "text" }] });
    const state = await h.service.ask(QUESTION, false);
    expect(state.entries[0]!.end?.status).toBe("answered");
    expect(logged).toHaveBeenCalledWith("ask.json save failed", "Error");
    // T13: the save is still owed, and says so, for the app's save report.
    await h.service.persist();
    expect(h.service.saveFailed?.()).toBe(true);
  });

  it("says a save is no longer owed once ask.json is written (T13)", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    await h.service.ask(QUESTION, false);
    await h.service.persist();
    expect(h.service.saveFailed?.()).toBe(false);
  });
});

describe("one question at a time, owned by the service", () => {
  it("refuses a second question, a retry, Ask again and New conversation while one runs, and drops the refusal when it ends", async () => {
    const reply = deferred<Message>();
    const h = await harness({ replies: [{ later: reply }] });
    const first = h.service.ask(QUESTION, false);
    await until(() => h.send.mock.calls.length === 1, "the first request");
    expect(h.service.isRunning()).toBe(true);

    const busy = { kind: "busy", message: "A question is already running. Stop it or wait for the answer." };
    expect((await h.service.ask("Another question?", false)).notice).toEqual(busy);
    expect((await h.service.retry()).notice).toEqual(busy);
    expect((await h.service.askAgain("id-2")).notice).toEqual(busy);
    expect((await h.service.newConversation()).notice).toEqual(busy);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.service.state().entries).toHaveLength(1);

    reply.resolve(scripted("text"));
    const done = await first;
    expect(done.entries[0]!.end?.status).toBe("answered");
    expect(done.notice).toBeNull();
    expect(await h.files.read(ASK_FILE)).not.toBeNull();
  });

  it("keeps running when the screen unsubscribes: leaving Ask never stops a question", async () => {
    const reply = deferred<Message>();
    const h = await harness({ replies: [{ later: reply }] });
    const listener = vi.fn();
    const unsubscribe = h.service.subscribe(listener);

    const run = h.service.ask(QUESTION, false);
    await until(() => h.send.mock.calls.length === 1, "the request");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    const heard = listener.mock.calls.length;

    reply.resolve(scripted("text"));
    const state = await run;
    expect(state.entries[0]!.end?.status).toBe("answered");
    expect(h.signals[0]!.aborted).toBe(false);
    expect(listener).toHaveBeenCalledTimes(heard);
  });

  it("returns the same state object until something changes, as useSyncExternalStore requires", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    const before = h.service.state();
    expect(h.service.state()).toBe(before);
    await h.service.ask(QUESTION, false);
    expect(h.service.state()).not.toBe(before);
    expect(h.service.state()).toBe(h.service.state());
  });
});

describe("Stop, leaving the app, and watch runs", () => {
  it("Stop during a model request ends the question stopped during the request, and sends nothing more", async () => {
    const h = await harness({ replies: [{ hang: true }, { script: "text" }] });
    const run = h.service.ask(QUESTION, false);
    await until(() => h.send.mock.calls.length === 1, "the request");
    expect(h.service.state().running?.activity.kind).toBe("request");

    h.service.stop();
    expect(h.service.state().running?.stopping).toBe(true);
    const state = await run;

    const entry = state.entries[0]!;
    expect(entry.end).toMatchObject({ status: "stopped", stoppedDuring: "request", committed: false });
    expect(labels.endLabel(entry)).toBe(labels.STOPPED_DURING_REQUEST);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect((await savedFile(h.files))?.pending).toBeNull();
  });

  it("Stop while the keys are read sends nothing and records no question", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    const reading = deferred<void>();
    let asked = false;
    h.anthropicKeys.get = async () => {
      asked = true;
      await reading.promise;
      return ANTHROPIC_KEY;
    };

    const run = h.service.ask(QUESTION, false);
    await until(() => asked, "the key read");
    h.service.stop();
    reading.resolve();
    const state = await run;

    expect(state.entries).toEqual([]);
    expect(state.notice).toBeNull();
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("waits while awardgrid is hidden, records the pause, and goes on when it is visible again", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    h.screen.hide();
    const run = h.service.ask(QUESTION, false);
    await until(() => h.service.state().running?.activity.kind === "paused", "the pause");
    expect(h.send).not.toHaveBeenCalled();
    expect(h.service.state().entries[0]!.steps).toEqual([{ kind: "paused" }]);

    h.screen.show();
    const state = await run;
    expect(state.entries[0]!.end?.status).toBe("answered");
    expect(state.entries[0]!.steps).toEqual([{ kind: "paused" }]);
    expect(labels.stepLabel(state.entries[0]!.steps[0]!)).toBe("Paused while you were away from awardgrid.");
  });

  it("Stop while awardgrid is away ends stopped between steps, and stops listening for its return", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    h.screen.hide();
    const run = h.service.ask(QUESTION, false);
    await until(() => h.service.state().running?.activity.kind === "paused", "the pause");
    expect(h.screen.listening()).toBe(1);

    h.service.stop();
    const state = await run;
    expect(state.entries[0]!.end).toMatchObject({ status: "stopped", stoppedDuring: "between" });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.screen.listening()).toBe(0);
  });

  it("Stop while a save is landing ends the wait at once, stopped between steps, with nothing sent", async () => {
    const files = new HeldFiles();
    const h = await harness({ files, replies: [{ script: "text" }] });
    const run = h.service.ask(QUESTION, false);
    await until(() => files.held === 1, "the save that marks the question pending");

    h.service.stop();
    // The question ends while the write is still out: Stop does not wait for it.
    await until(() => h.service.state().entries[0]?.end?.status === "stopped", "the stopped question");
    expect(files.held).toBe(1);
    expect(h.send).not.toHaveBeenCalled();

    files.hold = false;
    files.release();
    const state = await run;
    expect(state.entries[0]!.end).toMatchObject({ status: "stopped", stoppedDuring: "between" });
    expect(labels.endLabel(state.entries[0]!)).toBe("Stopped before the next step began. Nothing more will be sent for this question.");
    expect(h.send).not.toHaveBeenCalled();
    expect(files.onDisk()?.pending).toBeNull();
  });

  it("a hide while a save lands is a pause too: nothing goes out until awardgrid is visible, and one pause is recorded", async () => {
    const files = new HeldFiles();
    const h = await harness({ files, replies: [{ script: "text" }] });
    const run = h.service.ask(QUESTION, false);
    await until(() => files.held === 1, "the save that marks the question pending");

    // The loop looked before the write landed, when awardgrid was still visible.
    h.screen.hide();
    files.hold = false;
    files.release();
    await until(() => h.service.state().running?.activity.kind === "paused", "the pause");
    await turns(10);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.service.state().entries[0]!.steps).toEqual([{ kind: "paused" }]);

    h.screen.show();
    const state = await run;
    expect(state.entries[0]!.end?.status).toBe("answered");
    expect(state.entries[0]!.steps).toEqual([{ kind: "paused" }]);
    expect(h.screen.listening()).toBe(0);
  });

  it("back on screen but still waiting for a watch run, the activity is between steps, not paused", async () => {
    const files = new HeldFiles();
    const watchRun = deferred<void>();
    const h = await harness({ files, replies: [{ script: "tool_use_search" }, { script: "text" }], whenWatchesIdle: () => watchRun.promise });
    const run = h.service.ask(QUESTION, false);
    await until(() => files.held === 1, "the save that marks the question pending");
    files.release();
    await until(() => h.send.mock.calls.length === 1 && files.held === 1, "the save after request 1");

    // Away while that save lands, so the tool step waits for awardgrid to come back.
    h.screen.hide();
    files.hold = false;
    files.release();
    await until(() => h.service.state().running?.activity.kind === "paused", "the pause");
    expect(h.seatsFetch.calls).toHaveLength(0);

    h.screen.show();
    await until(() => h.whenWatchesIdle.mock.calls.length === 1, "the wait for the watch run");
    expect(h.service.state().running?.activity.kind).toBe("between");

    watchRun.resolve();
    const state = await run;
    expect(state.entries[0]!.end?.status).toBe("answered");
    expect(state.entries[0]!.steps[0]).toEqual({ kind: "paused" });
  });

  it("Stop between steps, while waiting for a watch run, ends stopped between steps and runs no tool", async () => {
    const watchRun = deferred<void>();
    const h = await harness({ replies: [{ script: "tool_use_search" }, { script: "text" }], whenWatchesIdle: () => watchRun.promise });
    const run = h.service.ask(QUESTION, false);
    await until(() => h.whenWatchesIdle.mock.calls.length === 1, "the wait for the watch run");
    expect(h.service.state().running?.activity.kind).toBe("between");
    expect(h.seatsFetch.calls).toHaveLength(0);

    h.service.stop();
    const state = await run;
    expect(state.entries[0]!.end).toMatchObject({ status: "stopped", stoppedDuring: "between" });
    expect(labels.endLabel(state.entries[0]!)).toBe("Stopped before the next step began. Nothing more will be sent for this question.");
    expect(h.seatsFetch.calls).toHaveLength(0);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("runs a tool only once the watch run under way has finished", async () => {
    const watchRun = deferred<void>();
    const h = await harness({ replies: [{ script: "tool_use_search" }, { script: "text" }], whenWatchesIdle: () => watchRun.promise });
    const run = h.service.ask(QUESTION, false);
    await until(() => h.whenWatchesIdle.mock.calls.length === 1, "the wait for the watch run");
    expect(h.seatsFetch.calls).toHaveLength(0);

    watchRun.resolve();
    const state = await run;
    expect(h.seatsFetch.calls).toHaveLength(1);
    expect(state.entries[0]!.end?.status).toBe("answered");
  });

  it("stops waiting on a request after 450 s through its own timers, and offers Try again", async () => {
    const h = await harness({ replies: [{ hang: true }, { script: "text" }] });
    const run = h.service.ask(QUESTION, false);
    await until(() => h.send.mock.calls.length === 1, "the request");
    expect([...h.timers.pending.values()].map((t) => t.ms)).toEqual([ASK_REQUEST_LIMIT_MS]);

    h.clock.ms += ASK_REQUEST_LIMIT_MS;
    h.timers.fire(ASK_REQUEST_LIMIT_MS);
    const state = await run;

    const entry = state.entries[0]!;
    expect(entry.end?.failure?.code).toBe("request_limit");
    expect(state.retryEntryId).toBe(entry.id);
    expect(labels.failureView(entry.end!.failure!, state.retryEntryId === entry.id).action).toBe("try_again");
    expect(h.timers.pending.size).toBe(0);
  });
});

describe("Try again and Ask again", () => {
  it("Try again resends the identical request when the failure offers it, and the question goes on", async () => {
    const h = await harness({ replies: [{ error: errors.overloaded }, { script: "text" }] });
    const failed = await h.service.ask(QUESTION, false);
    const entry = failed.entries[0]!;
    expect(entry.end?.failure?.code).toBe("overloaded");
    expect(failed.retryEntryId).toBe(entry.id);
    expect((await savedFile(h.files))?.entries[0]?.end?.failure?.code).toBe("overloaded");

    const state = await h.service.retry();
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.sent[1]).toBe(h.sent[0]);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]!.end).toMatchObject({ status: "answered", committed: true });
    expect(state.entries[0]!.usage.requests).toBe(2);
    expect(state.retryEntryId).toBeNull();
    expect((await savedFile(h.files))?.pending).toBeNull();
  });

  it("does not resend a failure that offers no Try again", async () => {
    const h = await harness({ replies: [{ error: errors.rejected }, { script: "text" }] });
    const failed = await h.service.ask(QUESTION, false);
    expect(failed.entries[0]!.end?.failure?.code).toBe("anthropic_key_rejected");
    expect(failed.retryEntryId).toBeNull();
    const writes = (h.files as RecordingFiles).written.length;

    const state = await h.service.retry();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(state.entries[0]!.end?.status).toBe("failed");
    // The question was never reopened: no pending marker was saved, so ask.json was not rewritten.
    expect((h.files as RecordingFiles).written.length).toBe(writes);
  });

  it("does not resend on a key that changed or was removed after the failure", async () => {
    const changed = await harness({ replies: [{ error: errors.overloaded }, { script: "text" }] });
    await changed.service.ask(QUESTION, false);
    await changed.anthropicKeys.set("sk-ant-api03-a-different-key-DO_NOT_LEAK");
    const afterChange = await changed.service.retry();
    expect(afterChange.notice).toEqual({ kind: "keys_changed", message: labels.KEYS_CHANGED });
    expect(changed.send).toHaveBeenCalledTimes(1);
    expect(afterChange.entries[0]!.end?.status).toBe("failed");
    expect(afterChange.retryEntryId).toBeNull();

    const removed = await harness({ replies: [{ error: errors.overloaded }, { script: "text" }] });
    await removed.service.ask(QUESTION, false);
    await removed.seatsKeys.clear();
    expect((await removed.service.retry()).notice).toEqual({ kind: "no_seats_key", message: labels.NO_SEATS_KEY });
    expect(removed.send).toHaveBeenCalledTimes(1);
  });

  it("a key missing when Try again is tapped keeps the offer, and Try again resends once that same key is back", async () => {
    const h = await harness({ replies: [{ error: errors.overloaded }, { script: "text" }] });
    const failed = await h.service.ask(QUESTION, false);
    const entryId = failed.entries[0]!.id;

    await h.anthropicKeys.clear();
    const missing = await h.service.retry();
    expect(missing.notice).toEqual({ kind: "no_anthropic_key", message: labels.NO_ANTHROPIC_KEY });
    expect(missing.retryEntryId).toBe(entryId);
    expect(missing.entries[0]!.end?.failure?.code).toBe("overloaded");
    expect(h.send).toHaveBeenCalledTimes(1);

    await h.anthropicKeys.set(ANTHROPIC_KEY);
    const state = await h.service.retry();
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.sent[1]).toBe(h.sent[0]);
    expect(state.entries[0]!.end).toMatchObject({ status: "answered", committed: true });
  });

  it("Stop while Try again reads the keys resends nothing, keeps the failure, and leaves Ask again", async () => {
    const h = await harness({ replies: [{ error: errors.overloaded }, { script: "text" }] });
    const failed = await h.service.ask(QUESTION, false);
    const read = h.anthropicKeys.get.bind(h.anthropicKeys);
    const reading = deferred<void>();
    let asked = false;
    h.anthropicKeys.get = async () => {
      asked = true;
      await reading.promise;
      return read();
    };

    const retrying = h.service.retry();
    await until(() => asked, "the key read");
    h.service.stop();
    reading.resolve();
    const state = await retrying;

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(state.entries[0]!.end?.failure?.code).toBe("overloaded");
    // Stop aborted the one signal the question's loop listens to, so a resend would end at once: none is offered.
    expect(state.retryEntryId).toBeNull();
    h.anthropicKeys.get = read;
    const again = await h.service.askAgain(failed.entries[0]!.id);
    expect(again.entries[1]!.end?.status).toBe("answered");
  });

  it("Stop while Try again finds a key missing keeps no offer, since a resend would end at once", async () => {
    const h = await harness({ replies: [{ error: errors.overloaded }, { script: "text" }] });
    await h.service.ask(QUESTION, false);
    const reading = deferred<void>();
    let asked = false;
    h.anthropicKeys.get = async () => {
      asked = true;
      await reading.promise;
      return null;
    };

    const retrying = h.service.retry();
    await until(() => asked, "the key read");
    h.service.stop();
    reading.resolve();
    const state = await retrying;

    expect(state.notice).toEqual({ kind: "no_anthropic_key", message: labels.NO_ANTHROPIC_KEY });
    expect(state.retryEntryId).toBeNull();
    expect(state.entries[0]!.end?.failure?.code).toBe("overloaded");
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("a new question moves the conversation on, so an earlier failure is no longer resent", async () => {
    const h = await harness({ replies: [{ error: errors.overloaded }, { script: "text" }, { script: "text" }] });
    await h.service.ask(QUESTION, false);
    const next = await h.service.ask("What about first class?", false);
    expect(next.retryEntryId).toBeNull();
    await h.service.retry();
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("Ask again asks an ended entry's question again, with the same context choice", async () => {
    const h = await harness({ replies: [{ script: "refusal" }, { script: "text" }] });
    const search = await h.engine.search(GRID_QUERY, SEATS_KEY);
    if (!search.ok) throw new Error("the grid search should have succeeded");
    h.lastSearch.set({ text: GRID_QUERY, value: search.value });

    const refused = await h.service.ask(QUESTION, true);
    expect(refused.entries[0]!.end?.status).toBe("refused");

    const state = await h.service.askAgain(refused.entries[0]!.id);
    expect(state.entries).toHaveLength(2);
    expect(state.entries[1]).toMatchObject({ question: QUESTION, includeSearch: true });
    expect(state.entries[1]!.end?.status).toBe("answered");
  });
});

describe("the conversation on disk", () => {
  it("New conversation forgets the conversation and removes ask.json, and the next question starts with no history", async () => {
    const h = await harness({ replies: [{ script: "text" }, { script: "text" }] });
    await h.service.ask(QUESTION, false);
    expect(await h.files.read(ASK_FILE)).not.toBeNull();

    const cleared = await h.service.newConversation();
    expect(cleared.entries).toEqual([]);
    expect(cleared.notice).toEqual({ kind: "cleared", message: "Conversation cleared." });
    expect(await h.files.read(ASK_FILE)).toBeNull();

    const next = await h.service.ask("First class LHR to JFK next month?", false);
    expect(next.entries).toHaveLength(1);
    expect(h.sent[1]!.messages).toHaveLength(1);
  });

  it("persist() saves ask.json when there is a conversation, and writes nothing before there is one", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    await h.service.persist();
    await h.service.restore();
    await h.service.persist();
    expect(await h.files.read(ASK_FILE)).toBeNull();

    await h.service.ask(QUESTION, false);
    const saved = await h.files.read(ASK_FILE);
    await h.files.remove(ASK_FILE);
    await h.service.persist();
    expect(await h.files.read(ASK_FILE)).toBe(saved);
  });

  it("restore() turns a question the app was closed during into an unfinished entry, and saves that", async () => {
    const files = new RecordingFiles();
    const left = newConversation({ id: "conv-left", now: () => NOW });
    left.committed.push({ role: "user", content: [{ type: "text", text: "Earlier question" }] }, { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] });
    left.entries.push({ ...answered("entry-1", "Earlier question"), end: { status: "answered", committed: true, failure: null, stoppedDuring: null, at: NOW.toISOString() } });
    left.entries.push({ ...answered("entry-2", QUESTION), texts: [], end: null });
    left.pending = { entryId: "entry-2", startedAt: NOW.toISOString() };
    await new AskStore(files).write(left);

    const h = await harness({ files, replies: [{ script: "text" }] });
    const state = await h.service.restore();

    const unfinished = state.entries[1]!;
    expect(unfinished.end).toMatchObject({ status: "unfinished", committed: false });
    expect(labels.endLabel(unfinished)).toBe("This question did not finish because awardgrid was closed while it ran. Requests already sent may have been billed.");
    expect(state.retryEntryId).toBeNull();
    const saved = await savedFile(files);
    expect(saved?.pending).toBeNull();
    expect(saved?.entries[1]?.end?.status).toBe("unfinished");

    // The history is what the committed question left, so the next question resends exactly that.
    await h.service.ask("What about first class?", false);
    expect(h.sent[0]!.messages.slice(0, 2)).toEqual(left.committed);
  });

  it("reads ask.json once: a later restore does not overwrite what has happened since", async () => {
    const h = await harness({ replies: [{ script: "text" }] });
    await h.service.restore();
    await h.service.ask(QUESTION, false);
    await h.files.write(ASK_FILE, "{ garbage");
    expect((await h.service.restore()).entries).toHaveLength(1);
  });

  it.each([
    ["a corrupt file", "{ this is not json"],
    ["another version's file", serializeConversation(newConversation({ id: "c", now: () => NOW })).replace('"version":1', '"version":2')],
  ])("starts empty from %s and never throws, then saves a readable one", async (_name, text) => {
    const files = new RecordingFiles();
    await files.write(ASK_FILE, text);
    const h = await harness({ files, replies: [{ script: "text" }] });
    expect((await h.service.restore()).entries).toEqual([]);
    await h.service.ask(QUESTION, false);
    expect((await savedFile(files))?.entries).toHaveLength(1);
  });

  it("New conversation pressed while ask.json is still being read does not bring the old conversation back", async () => {
    const reading = deferred<string | null>();
    const files = new RecordingFiles();
    await new AskStore(files).write(Object.assign(newConversation({ id: "old", now: () => NOW }), { entries: [answered("entry-1", QUESTION)] }));
    const text = await files.read(ASK_FILE);
    files.read = async () => reading.promise;
    const h = await harness({ files });

    const restoring = h.service.restore();
    await h.service.newConversation();
    reading.resolve(text);
    expect((await restoring).entries).toEqual([]);
  });
});

describe("a question the process is killed during (docs/PHASE5.md §2.9, E8)", () => {
  /** A relaunch: a new service over a Data directory holding exactly `disk`, the ask.json a killed process left. */
  async function relaunch(disk: string | undefined): Promise<AskEntry[]> {
    const files = new RecordingFiles();
    if (disk !== undefined) await files.write(ASK_FILE, disk);
    const h = await harness({ files });
    return [...(await h.service.restore()).entries];
  }

  it("counts a request on disk as it goes out, so a relaunch after the kill reads at least that request", async () => {
    const files = new HeldFiles();
    const h = await harness({ files, replies: [{ hang: true }] });
    const run = h.service.ask(QUESTION, false);
    await until(() => files.held === 1, "the save that marks the question pending");
    files.release();

    // The request is out, and a save of its count is on its way to disk while the request waits for Anthropic.
    await until(() => h.send.mock.calls.length === 1 && files.held === 1, "the request, and the save that counts it");
    files.release();
    await until(() => files.onDisk()?.entries[0]?.usage.requests === 1, "the count on disk");
    expect(files.onDisk()?.pending).toEqual({ entryId: "id-2", startedAt: NOW.toISOString() });

    // The process dies here, the request still out.
    const [unfinished] = await relaunch(files.files.get(ASK_FILE));
    expect(unfinished!.end).toMatchObject({ status: "unfinished", committed: false });
    expect(unfinished!.usage.requests).toBe(1);
    expect(labels.entryMetaLine(unfinished!)).toBe(`Claude Opus 5 · at least 1 request · ${labels.UNFINISHED_COUNTS}`);

    files.hold = false;
    h.service.stop();
    expect((await run).entries[0]!.end?.status).toBe("stopped");
  });

  it("killed before that count lands, the relaunched entry never says fewer requests than were sent", async () => {
    const files = new RecordingFiles();
    const atSend: Array<string | undefined> = [];
    // What is on disk at the moment the request is handed to the transport: the kill lands before the count's write.
    const h = await harness({ files, replies: [{ hang: true }], onSend: () => atSend.push(files.files.get(ASK_FILE)) });
    const run = h.service.ask(QUESTION, false);
    await until(() => h.send.mock.calls.length === 1, "the request");

    const [unfinished] = await relaunch(atSend[0]);
    expect(unfinished!.end).toMatchObject({ status: "unfinished", committed: false });
    // The race lost: the file says no request, though one was sent.
    expect(unfinished!.usage.requests).toBe(0);
    const line = labels.entryMetaLine(unfinished!);
    expect(line).toBe(`Claude Opus 5 · ${labels.UNFINISHED_COUNTS}`);
    expect(line).not.toMatch(/No requests|\b0 requests/);

    h.service.stop();
    await run;
  });

  it("killed while a search's step is on its way to disk, the relaunched entry never says fewer seats.aero calls than were made", async () => {
    const files = new HeldFiles();
    const h = await harness({ files, replies: [{ script: "tool_use_search" }, { script: "text" }] });
    const run = h.service.ask(QUESTION, false);
    for (const save of ["the pending marker", "the first request's count", "the first response"]) {
      await until(() => files.held === 1, save);
      files.release();
    }
    await until(() => h.seatsFetch.calls.length === 1 && files.held === 1, "the search, and the save of its step");
    expect(files.onDisk()?.entries[0]?.usage).toMatchObject({ requests: 1, seatsCalls: 0 });

    const [unfinished] = await relaunch(files.files.get(ASK_FILE));
    expect(unfinished!.end?.status).toBe("unfinished");
    const line = labels.entryMetaLine(unfinished!);
    // The first response's usage was saved; the search's one call was made and not yet saved, so no call count is stated.
    expect(line).toBe(`Claude Opus 5 · at least 1 request · at least 3,968 input tokens · at least 142 output tokens · ${labels.UNFINISHED_COUNTS}`);
    expect(line).not.toContain("seats.aero calls");

    files.hold = false;
    files.release();
    expect((await run).entries[0]!.end?.status).toBe("answered");
  });
});

// ---------------------------------------------------------------------------
// The Settings key check
// ---------------------------------------------------------------------------

/** api.anthropic.com for GET /v1/models/{id}: a status, or a rejection as URLSession delivers one. */
function modelsEndpoint(respond: () => Response | Promise<Response>) {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ method: (init.method ?? "GET").toUpperCase(), url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, body: init.body, headers });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const modelBody = () =>
  new Response(JSON.stringify({ type: "model", id: "claude-opus-5", display_name: "Claude Opus 5", created_at: "2026-01-01T00:00:00Z" }), {
    status: 200,
    headers: { "content-type": "application/json", "request-id": "req_synthetic_models" },
  });

describe("checkKey", () => {
  const realClient: AskServiceDeps["createClient"] = (options) => createAskClient(options);

  it("accepts a key Anthropic returns the model for, with a GET that carries no question", async () => {
    const endpoint = modelsEndpoint(modelBody);
    const h = await harness({ anthropicFetch: endpoint.fetchImpl, createClient: realClient });
    const result = await h.service.checkKey();

    expect(result).toEqual({ outcome: "accepted", ok: true, message: "Anthropic accepted this key for Claude Opus 5. Checking sends no question.", requestId: null });
    expect(endpoint.calls).toHaveLength(1);
    expect(endpoint.calls[0]).toMatchObject({ method: "GET", url: "https://api.anthropic.com/v1/models/claude-opus-5", body: undefined });
    expect(endpoint.calls[0]!.headers["x-api-key"]).toBe(ANTHROPIC_KEY);
    expect(JSON.stringify(endpoint.calls)).not.toContain(SEATS_KEY);
  });

  it.each([
    [401, "authentication_error", "rejected", "Anthropic rejected this key."],
    [403, "permission_error", "cannot_use", "Anthropic accepted this key, but it cannot use Claude Opus 5."],
    [404, "not_found_error", "cannot_use", "Anthropic accepted this key, but it cannot use Claude Opus 5."],
  ] as const)("maps a %i to %s", async (status, type, outcome, message) => {
    const endpoint = modelsEndpoint(errorBody(status, type, "scripted"));
    const h = await harness({ anthropicFetch: endpoint.fetchImpl, createClient: realClient });
    expect(await h.service.checkKey()).toEqual({ outcome, ok: false, message, requestId: `req_synthetic_${status}` });
  });

  it("says Anthropic could not be reached when the connection fails, and that the key is saved", async () => {
    const endpoint = modelsEndpoint(() => Promise.reject(Object.assign(new Error("The Internet connection appears to be offline."), { code: "NSURLErrorDomain" })));
    const h = await harness({ anthropicFetch: endpoint.fetchImpl, createClient: realClient });
    expect(await h.service.checkKey()).toEqual({
      outcome: "unreachable",
      ok: false,
      message: "Could not reach Anthropic. The key is saved; check it again when you are online.",
      requestId: null,
    });
  });

  it("saves a pasted key first, then checks that key", async () => {
    const endpoint = modelsEndpoint(modelBody);
    const h = await harness({ anthropicKey: null, anthropicFetch: endpoint.fetchImpl, createClient: realClient });
    const pasted = "sk-ant-api03-pasted-in-settings-DO_NOT_LEAK";
    const result = await h.service.checkKey(`  ${pasted} `);
    expect(result.outcome).toBe("accepted");
    expect(await h.anthropicKeys.get()).toBe(pasted);
    expect(endpoint.calls[0]!.headers["x-api-key"]).toBe(pasted);
    expect(h.createClient).toHaveBeenCalledWith({ apiKey: pasted, fetch: endpoint.fetchImpl });
  });

  it("shows a Keychain failure on save as a failure, and sends nothing", async () => {
    const endpoint = modelsEndpoint(modelBody);
    const h = await harness({ anthropicFetch: endpoint.fetchImpl, createClient: realClient });
    const keys: KeyStore = h.anthropicKeys;
    keys.set = async () => {
      throw new Error("OSStatus -34018");
    };
    expect(await h.service.checkKey("sk-ant-api03-will-not-save-DO_NOT_LEAK")).toEqual({
      outcome: "keychain",
      ok: false,
      message: "Could not save the key: OSStatus -34018",
      requestId: null,
    });
    expect(endpoint.calls).toHaveLength(0);
  });

  it("shows a Keychain failure on read masked of the key just saved, and sends nothing", async () => {
    const endpoint = modelsEndpoint(modelBody);
    const h = await harness({ anthropicKey: null, anthropicFetch: endpoint.fetchImpl, createClient: realClient });
    const pasted = "sk-ant-api03-saved-then-unreadable-DO_NOT_LEAK";
    h.anthropicKeys.get = async () => {
      throw new Error(`item ${pasted} could not be read (OSStatus -25308)`);
    };
    expect(await h.service.checkKey(pasted)).toEqual({
      outcome: "keychain",
      ok: false,
      message: "Could not read the key from the Keychain: item •••• could not be read (OSStatus -25308)",
      requestId: null,
    });
    expect(endpoint.calls).toHaveLength(0);
  });

  it("with no key on file, or no native HTTP, sends nothing", async () => {
    const noKey = modelsEndpoint(modelBody);
    const h = await harness({ anthropicKey: null, anthropicFetch: noKey.fetchImpl, createClient: realClient });
    expect(await h.service.checkKey()).toEqual({ outcome: "no_key", ok: false, message: "No Anthropic key on file.", requestId: null });
    expect(noKey.calls).toHaveLength(0);

    const noNative = modelsEndpoint(modelBody);
    const wired = await harness({
      anthropicFetch: noNative.fetchImpl,
      createClient: realClient,
      assertNative: () => {
        throw new NativeHttpUnavailableError("CapacitorHttp is not registered on the native side.");
      },
    });
    expect(await wired.service.checkKey()).toEqual({ outcome: "wiring", ok: false, message: labels.WIRING, requestId: null });
    expect(noNative.calls).toHaveLength(0);
  });
});
