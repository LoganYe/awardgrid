/**
 * runQuestion over a scripted AskModel, a scripted tool runner and fake timers.
 *
 * The model's replies are real SDK messages: before any test, each script in test/fixtures/ask/streams.json is run
 * through createAskClient over a fake fetch, and each test gets a copy of the Message the SDK built, thinking blocks
 * and signatures included. The model records every request twice: the object the loop passed, to prove assistant
 * content goes back as the same object, and its JSON, which is what the wire carries, to prove nothing sent was
 * changed afterwards. Timers and the clock are vitest's fake ones, passed in through deps, and nothing reaches the
 * network.
 */
import Anthropic, { APIConnectionError, APIUserAbortError } from "@anthropic-ai/sdk";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StreamEvent, toSse } from "../../../test/fixtures/ask/sse";
import streams from "../../../test/fixtures/ask/streams.json";
import { createAskClient } from "./client";
import { newConversation, type AskEntry, type Conversation } from "./conversation";
import { ASK_QUESTION_LIMIT_MS, ASK_REQUEST_LIMIT_MS, MAX_MODEL_REQUESTS, MAX_QUESTIONS_PER_CONVERSATION } from "./limits";
import { runQuestion, type AskEvent, type AskOutcome, type LoopDeps } from "./loop";
import { ASK_CLOSING_TEXT, ASK_SYSTEM_PROMPT } from "./prompt";
import { ASK_TOOLS, type ToolRunner, type ToolUsage } from "./tools";

const KEY = "sk-ant-api03-loop-test-key-DO_NOT_LEAK";
const SEATS_KEY = "pro_seats_key_for_loop_tests_SECRET";
const START = new Date("2026-09-10T15:00:00Z");
const QUESTION = "Cheapest business class from SEA to Tokyo in October?";

type ScriptName = Exclude<keyof typeof streams, `_${string}`>;
type Block = { type: string; [field: string]: unknown };

const messages = new Map<ScriptName, Anthropic.Message>();
const errors: Record<"overloaded529" | "rejectedKey" | "overloadedMid", unknown> = { overloaded529: null, rejectedKey: null, overloadedMid: null };

/** A copy of what the SDK built from a script, as a fresh object for each request. */
const scripted = (name: ScriptName): Anthropic.Message => JSON.parse(JSON.stringify(messages.get(name)!)) as Anthropic.Message;

async function viaClient(respond: () => Response): Promise<{ message?: Anthropic.Message; error?: unknown }> {
  const fetchImpl = (async () => respond()) as typeof fetch;
  const params: Anthropic.MessageStreamParams = { model: "claude-opus-5", max_tokens: 16000, messages: [{ role: "user", content: QUESTION }] };
  try {
    return { message: await createAskClient({ apiKey: KEY, fetch: fetchImpl }).send(params, { signal: new AbortController().signal }) };
  } catch (error) {
    return { error };
  }
}

const sse = (name: ScriptName) => () =>
  new Response(toSse(streams[name] as unknown as StreamEvent[], { pingEvery: 2 }), { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_synthetic_stream" } });
const errorBody = (status: number, type: string, message: string) => () =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "content-type": "application/json", "request-id": `req_synthetic_${status}` } });

beforeAll(async () => {
  for (const name of Object.keys(streams).filter((key) => !key.startsWith("_")) as ScriptName[]) {
    const { message, error } = await viaClient(sse(name));
    if (name === "overloaded_mid") errors.overloadedMid = error;
    else messages.set(name, message!);
  }
  errors.overloaded529 = (await viaClient(errorBody(529, "overloaded_error", "Overloaded"))).error;
  errors.rejectedKey = (await viaClient(errorBody(401, "authentication_error", "invalid x-api-key"))).error;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
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

type Reply = { script: ScriptName; edit?: (message: Anthropic.Message) => void } | { error: () => unknown } | { hang: true } | { later: Deferred<Anthropic.Message> };

function scriptedModel(replies: Reply[]) {
  const raw: Anthropic.MessageStreamParams[] = [];
  const wire: Anthropic.MessageStreamParams[] = [];
  const signals: AbortSignal[] = [];
  const returned: Anthropic.Message[] = [];
  const send = vi.fn((params: Anthropic.MessageStreamParams, { signal }: { signal: AbortSignal }) => {
    raw.push(params);
    wire.push(JSON.parse(JSON.stringify(params)) as Anthropic.MessageStreamParams);
    signals.push(signal);
    const reply = replies.shift();
    return new Promise<Anthropic.Message>((resolve, reject) => {
      // What the SDK does when the loop aborts its controller: the wait ends with APIUserAbortError.
      signal.addEventListener("abort", () => reject(new APIUserAbortError()), { once: true });
      const give = (message: Anthropic.Message) => {
        returned.push(message);
        resolve(message);
      };
      if (reply === undefined) reject(new Error(`no scripted reply for request ${raw.length}`));
      else if ("script" in reply) {
        const message = scripted(reply.script);
        reply.edit?.(message);
        give(message);
      } else if ("error" in reply) reject(reply.error());
      else if ("later" in reply) reply.later.promise.then(give, reject);
    });
  });
  return { model: { send }, raw, wire, signals, returned };
}

/** A tool runner that answers every block, in order, spending 2 calls each. `during` runs while a block is under way. */
function fakeTools(during?: (index: number) => void | Promise<void>) {
  const ran: string[] = [];
  const used: ToolUsage = { toolCalls: 0, searches: 0, flights: 0, seatsCalls: 0 };
  const runner: ToolRunner = {
    async run(block) {
      ran.push(block.id);
      used.toolCalls += 1;
      used.searches += 1;
      used.seatsCalls += 2;
      await during?.(ran.length - 1);
      return {
        result: { type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ rows_total: 1, for: block.id }) },
        step: { tool: block.name, outcome: "ok", calls: 2, fromCache: false, fromMemo: false, search: null, program: null, estimate: null },
      };
    },
    usage: () => ({ ...used }),
  };
  return { runner, ran };
}

/** The app around the loop: visibility the test flips, and a watch runner whose idle signal it controls. */
function appState() {
  let hidden = false;
  let shown = deferred<void>();
  let watchesIdle: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const log: string[] = [];
  const deps: LoopDeps = {
    now: () => new Date(),
    setTimer: (ms, fire) => setTimeout(fire, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    isHidden: () => hidden,
    onHidden: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    waitUntilVisible: () => {
      log.push("waitUntilVisible");
      return hidden ? shown.promise : Promise.resolve();
    },
    whenWatchesIdle: () => {
      log.push("whenWatchesIdle");
      return watchesIdle;
    },
    secrets: [SEATS_KEY, KEY],
  };
  return {
    deps,
    log,
    hide() {
      hidden = true;
      shown = deferred();
      listeners.forEach((listener) => listener());
    },
    show() {
      hidden = false;
      shown.resolve();
    },
    watchesIdleAfter(promise: Promise<void>) {
      watchesIdle = promise;
    },
  };
}

interface StartOptions {
  conversation?: Conversation;
  tools?: ToolRunner;
  app?: ReturnType<typeof appState>;
  question?: string;
  signal?: AbortSignal;
  onEvent?: (event: AskEvent) => void;
}

function start(replies: Reply[], opts: StartOptions = {}) {
  const model = scriptedModel(replies);
  const app = opts.app ?? appState();
  const conversation = opts.conversation ?? newConversation({ id: "conv-loop", now: () => START });
  const events: AskEvent[] = [];
  const done = runQuestion({
    model: model.model,
    tools: opts.tools ?? fakeTools().runner,
    conversation,
    question: opts.question ?? QUESTION,
    lastSearch: null,
    deps: app.deps,
    onEvent: (event) => {
      events.push(event);
      opts.onEvent?.(event);
    },
    signal: opts.signal,
  });
  return { ...model, app, conversation, events, done };
}

/** Let the loop run its pending microtasks until `condition` holds. No timer moves. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error(`the loop never reached: ${what}`);
}

const idleTurns = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};

const json = (value: unknown) => JSON.stringify(value);
const contentOf = (message: Anthropic.MessageParam | undefined) => (message?.content ?? []) as unknown as Block[];

function failedOf(outcome: AskOutcome) {
  if (outcome.status !== "failed") throw new Error(`expected a failed outcome, got ${outcome.status}`);
  return outcome;
}

const toolUseSearch = (): Reply => ({ script: "tool_use_search" });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("a question that needs no tool", () => {
  it("end_turn answers in one request and commits the question", async () => {
    const h = start([{ script: "text" }]);
    const outcome = await h.done;

    expect(outcome).toMatchObject({ status: "answered", committed: true, texts: [(messages.get("text")!.content[0] as Anthropic.TextBlock).text] });
    expect(h.raw).toHaveLength(1);
    expect(h.events.map((e) => e.type)).toEqual(["question_started", "request_started", "request_finished", "ended"]);
    expect(json(h.conversation.committed)).toBe(json([...h.wire[0]!.messages, { role: "assistant", content: h.returned[0]!.content }]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pins the request shape: the model, 16,000 tokens, medium effort, top-level caching, and nothing the design leaves out", async () => {
    const h = start([{ script: "text" }]);
    await h.done;
    const params = h.wire[0]!;

    expect(Object.keys(params)).toEqual(["model", "max_tokens", "output_config", "cache_control", "system", "tools", "tool_choice", "messages"]);
    expect(params).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: ASK_SYSTEM_PROMPT,
      tool_choice: { type: "auto" },
    });
    expect(json(params.tools)).toBe(json(ASK_TOOLS));
    for (const omitted of ["thinking", "temperature", "top_p", "top_k", "fallbacks", "metadata", "stop_sequences", "service_tier", "inference_geo"]) {
      expect(params, omitted).not.toHaveProperty(omitted);
    }
    expect(params.messages).toHaveLength(1);
    expect(contentOf(params.messages[0]).map((b) => b.text)).toEqual([expect.stringContaining("Today's date is 2026-09-10 (UTC)."), QUESTION]);
  });

  it("refuses a question that is empty or too long, or a full conversation, before anything is sent", async () => {
    const tooLong = start([{ script: "text" }], { question: "x".repeat(1001) });
    expect(await tooLong.done).toEqual({ status: "not_started", reason: "too_long", message: "A question may be at most 1,000 characters, and this one has 1,001." });
    expect(tooLong.model.send).not.toHaveBeenCalled();
    expect(tooLong.events).toEqual([]);

    const conversation = newConversation({ id: "full", now: () => START });
    for (let i = 0; i < MAX_QUESTIONS_PER_CONVERSATION; i++) conversation.entries.push({ id: `e${i}` } as AskEntry);
    const full = start([{ script: "text" }], { conversation });
    expect(await full.done).toMatchObject({ status: "not_started", reason: "question_limit" });
    expect(full.model.send).not.toHaveBeenCalled();
  });
});

describe("the tool loop", () => {
  it("appends assistant content unchanged, then one user message with every tool_result first, in tool_use order", async () => {
    const tools = fakeTools();
    const h = start([{ script: "tool_use_two_searches" }, { script: "text" }], { tools: tools.runner });
    const outcome = await h.done;

    expect(outcome).toMatchObject({ status: "answered", committed: true });
    expect(tools.ran).toEqual(["toolu_synthetic_two_searches_sea", "toolu_synthetic_two_searches_pdx"]);
    const second = h.raw[1]!.messages;
    expect(second[1]).toEqual({ role: "assistant", content: h.returned[0]!.content });
    expect(second[1]!.content).toBe(h.returned[0]!.content);
    expect(contentOf(second[2])).toEqual([
      { type: "tool_result", tool_use_id: "toolu_synthetic_two_searches_sea", content: json({ rows_total: 1, for: "toolu_synthetic_two_searches_sea" }) },
      { type: "tool_result", tool_use_id: "toolu_synthetic_two_searches_pdx", content: json({ rows_total: 1, for: "toolu_synthetic_two_searches_pdx" }) },
    ]);
    expect(h.events.map((e) => e.type)).toEqual([
      "question_started",
      "request_started",
      "request_finished",
      "tool_started",
      "tool_finished",
      "tool_started",
      "tool_finished",
      "request_started",
      "request_finished",
      "ended",
    ]);
    expect(h.events.find((e) => e.type === "tool_started")).toMatchObject({ request: 1, name: "search_awards", input: { origins: ["SEA"], destinations: ["TYO"] } });
  });

  it("within a question, each request's messages are a strict prefix of the next, and system and tools never change", async () => {
    const h = start([{ script: "thinking_tool_use_search" }, toolUseSearch(), { script: "thinking_text" }]);
    const outcome = await h.done;

    expect(outcome).toMatchObject({ status: "answered", committed: true });
    expect(h.wire).toHaveLength(3);
    for (let n = 0; n + 1 < h.wire.length; n++) {
      const earlier = h.wire[n]!.messages.map(json);
      const later = h.wire[n + 1]!.messages.map(json);
      expect(later.length).toBeGreaterThan(earlier.length);
      expect(later.slice(0, earlier.length)).toEqual(earlier);
    }
    for (const params of h.wire) {
      expect(json(params.system)).toBe(json(h.wire[0]!.system));
      expect(json(params.tools)).toBe(json(h.wire[0]!.tools));
    }
  });

  it("sends a thinking block back exactly as returned, signature included, and commits it", async () => {
    const h = start([{ script: "thinking_tool_use_search" }, { script: "thinking_text" }]);
    await h.done;

    expect(h.raw[1]!.messages[1]!.content).toBe(h.returned[0]!.content);
    expect(contentOf(h.wire[1]!.messages[1])[0]).toEqual({ type: "thinking", thinking: "", signature: "synthetic_signature_not_from_anthropic_thinking_tool_use_search" });
    expect(json(h.conversation.committed)).toBe(json([...h.wire[1]!.messages, { role: "assistant", content: h.returned[1]!.content }]));
    expect(contentOf(h.conversation.committed.at(-1))[0]).toMatchObject({ type: "thinking", signature: "synthetic_signature_not_from_anthropic_thinking_text" });
  });

  it("across questions, the next question starts with the committed messages, and an uncommitted question leaves no trace", async () => {
    const conversation = newConversation({ id: "conv-across", now: () => START });
    const q1 = start([{ script: "thinking_tool_use_search" }, { script: "thinking_text" }], { conversation });
    expect(await q1.done).toMatchObject({ status: "answered", committed: true });
    const afterQ1 = json(conversation.committed);
    expect(afterQ1).toBe(json([...q1.wire[1]!.messages, { role: "assistant", content: q1.returned[1]!.content }]));

    const q2 = start([{ script: "text" }], { conversation, question: "Which program was cheapest?" });
    expect(await q2.done).toMatchObject({ status: "answered", committed: true });
    const first = q2.wire[0]!.messages;
    expect(json(first.slice(0, conversation.committed.length - 2))).toBe(afterQ1);
    expect(first).toHaveLength(JSON.parse(afterQ1).length + 1);
    const afterQ2 = json(conversation.committed);

    // A refusal after a tool call, and a Stop mid-request: neither joins the history.
    const refused = start([toolUseSearch(), { script: "refusal" }], { conversation, question: "And in first class?" });
    expect(await refused.done).toMatchObject({ status: "refused", committed: false, texts: ["I'll search seats.aero for business class from Seattle to Tokyo in October."] });
    const stop = new AbortController();
    const stopped = start([{ hang: true }], { conversation, question: "What about premium economy?", signal: stop.signal });
    await until(() => stopped.raw.length === 1, "the stopped question's request is out");
    stop.abort();
    expect(await stopped.done).toMatchObject({ status: "stopped", committed: false });
    expect(json(conversation.committed)).toBe(afterQ2);

    const q3 = start([{ script: "text" }], { conversation, question: "Summarize the cheapest option." });
    await q3.done;
    const q3First = q3.wire[0]!.messages;
    expect(json(q3First.slice(0, JSON.parse(afterQ2).length))).toBe(afterQ2);
    expect(q3First).toHaveLength(JSON.parse(afterQ2).length + 1);
    expect(json(q3First)).not.toContain("And in first class?");
    expect(json(q3First)).not.toContain("What about premium economy?");
  });

  it("request 6 goes out with tool_choice none and the closing text, and there is never a 7th", async () => {
    const tools = fakeTools();
    const h = start(Array.from({ length: MAX_MODEL_REQUESTS + 1 }, toolUseSearch), { tools: tools.runner });
    const outcome = await h.done;

    expect(outcome).toMatchObject({ status: "request_limit", committed: false, usage: { requests: 6 } });
    expect(h.raw).toHaveLength(MAX_MODEL_REQUESTS);
    expect(h.wire.map((p) => p.tool_choice)).toEqual([...Array.from({ length: 5 }, () => ({ type: "auto" })), { type: "none" }]);
    const lastUser = contentOf(h.wire[5]!.messages.at(-1));
    expect(lastUser.at(-1)).toEqual({ type: "text", text: ASK_CLOSING_TEXT });
    expect(lastUser.slice(0, -1).map((b) => b.type)).toEqual(["tool_result"]);
    expect(json(h.wire.slice(0, 5))).not.toContain(ASK_CLOSING_TEXT);
    // The sixth response's tool call is never run.
    expect(tools.ran).toHaveLength(5);
  });

  it("sums usage over requests: all three input fields, cache reads, output, and the tools' spend", async () => {
    const h = start([toolUseSearch(), { script: "text" }]);
    const outcome = await h.done;

    expect(h.events.filter((e) => e.type === "request_finished").map((e) => e.usage)).toEqual([
      { inputTokens: 12 + 3956 + 0, cacheCreationTokens: 3956, cacheReadTokens: 0, outputTokens: 142 },
      { inputTokens: 12 + 424 + 3956, cacheCreationTokens: 424, cacheReadTokens: 3956, outputTokens: 96 },
    ]);
    expect(outcome.status !== "not_started" && outcome.usage).toEqual({
      requests: 2,
      inputTokens: 3968 + 4392,
      cacheReadTokens: 3956,
      outputTokens: 238,
      lastRequestInputTokens: 4392,
      toolCalls: 1,
      seatsCalls: 2,
    });
  });

  it("awaits whenWatchesIdle before each tool, after waiting to be visible", async () => {
    const app = appState();
    const idle = deferred<void>();
    app.watchesIdleAfter(idle.promise);
    const tools = fakeTools();
    const h = start([{ script: "tool_use_two_searches" }, { script: "text" }], { app, tools: tools.runner });

    await until(() => app.log.includes("whenWatchesIdle"), "waiting for the watch runner");
    await idleTurns();
    expect(tools.ran).toEqual([]);
    idle.resolve();
    expect(await h.done).toMatchObject({ status: "answered" });
    expect(tools.ran).toHaveLength(2);
    expect(app.log).toEqual(["waitUntilVisible", "waitUntilVisible", "whenWatchesIdle", "waitUntilVisible", "whenWatchesIdle", "waitUntilVisible"]);
  });

  it("a listener that throws does not stop the question or its commit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = start([{ script: "text" }], {
      onEvent: () => {
        throw new Error("render failed");
      },
    });
    expect(await h.done).toMatchObject({ status: "answered", committed: true });
  });
});

describe("stop reasons", () => {
  const withStop = (script: ScriptName, stopReason: string | null): Reply => ({
    script,
    edit: (message) => {
      message.stop_reason = stopReason as Anthropic.StopReason | null;
    },
  });

  it.each<[string, Reply, Partial<Record<string, unknown>>]>([
    ["stop_sequence", withStop("text", "stop_sequence"), { status: "answered", committed: true }],
    ["max_tokens with text only", { script: "max_tokens_text" }, { status: "truncated", committed: true }],
    ["max_tokens with a trailing tool_use", { script: "max_tokens_tool_use" }, { status: "truncated", committed: false }],
    ["refusal", { script: "refusal" }, { status: "refused", committed: false, texts: [] }],
    ["model_context_window_exceeded", withStop("text", "model_context_window_exceeded"), { status: "too_long", committed: false }],
    ["end_turn with no content", { script: "empty" }, { status: "empty", committed: false }],
  ])("%s", async (_label, reply, expected) => {
    const tools = fakeTools();
    const h = start([reply], { tools: tools.runner });
    expect(await h.done).toMatchObject(expected);
    expect(tools.ran).toEqual([]);
    expect(h.raw).toHaveLength(1);
    if (expected.committed === false) expect(h.conversation.committed).toEqual([]);
  });

  it("a refusal's partial text is never reported", async () => {
    const h = start([{ script: "refusal" }]);
    await h.done;
    expect(h.events.find((e) => e.type === "request_finished")).toMatchObject({ stopReason: "refusal", texts: [] });
  });

  it.each([
    ["pause_turn", withStop("text", "pause_turn")],
    ["no stop reason", withStop("text", null)],
    ["tool_use with no tool_use block", withStop("text", "tool_use")],
  ])("%s fails as unexpected_stop, with no Try again", async (_label, reply) => {
    const h = start([reply]);
    const outcome = failedOf(await h.done);
    expect(outcome).toMatchObject({ canRetry: false, committed: false, failure: { code: "unexpected_stop", retryable: false } });
    expect(outcome.failure.message).toMatch(/^Claude's response ended in a way awardgrid does not handle \(stop reason: \w+\)\. The request was processed and may be billed to your key\.$/);
  });
});

describe("Stop", () => {
  it("before a request: nothing is sent", async () => {
    const stop = new AbortController();
    stop.abort();
    const h = start([{ script: "text" }], { signal: stop.signal });
    expect(await h.done).toMatchObject({ status: "stopped", during: "between", committed: false });
    expect(h.model.send).not.toHaveBeenCalled();
    expect(h.events.map((e) => e.type)).toEqual(["question_started", "ended"]);
  });

  it("during a request: the wait is aborted with reason stop, and no further request goes out", async () => {
    const stop = new AbortController();
    const tools = fakeTools();
    const h = start([{ hang: true }, { script: "text" }], { signal: stop.signal, tools: tools.runner });
    await until(() => h.raw.length === 1, "request 1 is out");
    stop.abort();

    expect(await h.done).toMatchObject({ status: "stopped", during: "request", committed: false });
    expect(h.signals[0]!.reason).toBe("stop");
    expect(h.model.send).toHaveBeenCalledTimes(1);
    expect(tools.ran).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("during a tool call: that call finishes, and the remaining blocks and requests do not run", async () => {
    const stop = new AbortController();
    const tools = fakeTools((index) => {
      if (index === 0) stop.abort();
    });
    const h = start([{ script: "tool_use_two_searches" }, { script: "text" }], { signal: stop.signal, tools: tools.runner });

    expect(await h.done).toMatchObject({ status: "stopped", during: "tool", committed: false, usage: { toolCalls: 1, seatsCalls: 2 } });
    expect(tools.ran).toEqual(["toolu_synthetic_two_searches_sea"]);
    expect(h.events.map((e) => e.type)).toContain("tool_finished");
    expect(h.raw).toHaveLength(1);
  });

  it("while waiting for a watch run: the question ends without waiting further", async () => {
    const app = appState();
    app.watchesIdleAfter(new Promise<void>(() => {}));
    const stop = new AbortController();
    const tools = fakeTools();
    const h = start([toolUseSearch()], { app, signal: stop.signal, tools: tools.runner });
    await until(() => app.log.includes("whenWatchesIdle"), "waiting for the watch runner");
    stop.abort();
    expect(await h.done).toMatchObject({ status: "stopped", during: "between" });
    expect(tools.ran).toEqual([]);
  });
});

describe("leaving the app", () => {
  it("hidden before a request: waits, records the pause, and sends once visible", async () => {
    const app = appState();
    app.hide();
    const h = start([{ script: "text" }], { app });
    await until(() => h.events.some((e) => e.type === "paused"), "the pause is recorded");
    await idleTurns();
    expect(h.model.send).not.toHaveBeenCalled();

    app.show();
    expect(await h.done).toMatchObject({ status: "answered" });
    expect(h.events.map((e) => e.type)).toEqual(["question_started", "paused", "request_started", "request_finished", "ended"]);
    expect(h.events[1]).toEqual({ type: "paused", before: "request" });
  });

  it("hidden before a tool: the tool waits until the app is visible", async () => {
    const app = appState();
    const reply = deferred<Anthropic.Message>();
    const tools = fakeTools();
    const h = start([{ later: reply }, { script: "text" }], { app, tools: tools.runner });
    await until(() => h.raw.length === 1, "request 1 is out");
    app.hide();
    reply.resolve(scripted("tool_use_search"));
    await until(() => h.events.some((e) => e.type === "paused"), "the pause is recorded");
    await idleTurns();
    expect(tools.ran).toEqual([]);

    app.show();
    expect(await h.done).toMatchObject({ status: "answered" });
    expect(h.events.find((e) => e.type === "paused")).toEqual({ type: "paused", before: "tool" });
    expect(tools.ran).toHaveLength(1);
  });

  it("a connection failure after the app was hidden and shown again during the request says so", async () => {
    const app = appState();
    const reply = deferred<Anthropic.Message>();
    const h = start([{ later: reply }], { app });
    await until(() => h.raw.length === 1, "request 1 is out");
    app.hide();
    app.show();
    reply.reject(new APIConnectionError({ cause: new Error("The network connection was lost.") }));

    expect(failedOf(await h.done).failure).toMatchObject({ code: "connection_failed_left_app", retryable: true });
  });
});

describe("bounds", () => {
  it("the 300 s question bound never aborts a request in flight, and stops the next step", async () => {
    const reply = deferred<Anthropic.Message>();
    const tools = fakeTools();
    const h = start([{ later: reply }, { script: "text" }], { tools: tools.runner });
    await until(() => h.raw.length === 1, "request 1 is out");
    await vi.advanceTimersByTimeAsync(ASK_QUESTION_LIMIT_MS + 60_000);
    expect(h.signals[0]!.aborted).toBe(false);

    reply.resolve(scripted("tool_use_search"));
    expect(await h.done).toMatchObject({ status: "deadline", committed: false });
    expect(tools.ran).toEqual([]);
    expect(h.raw).toHaveLength(1);
  });

  it("the 300 s question bound stops a request from starting, and a step just inside it still starts", async () => {
    const late = fakeTools(() => {
      vi.setSystemTime(START.getTime() + ASK_QUESTION_LIMIT_MS);
    });
    const ended = start([toolUseSearch(), { script: "text" }], { tools: late.runner });
    expect(await ended.done).toMatchObject({ status: "deadline" });
    expect(ended.raw).toHaveLength(1);

    vi.setSystemTime(START);
    const inTime = fakeTools(() => {
      vi.setSystemTime(START.getTime() + ASK_QUESTION_LIMIT_MS - 1);
    });
    const answered = start([toolUseSearch(), { script: "text" }], { tools: inTime.runner });
    expect(await answered.done).toMatchObject({ status: "answered" });
    expect(answered.raw).toHaveLength(2);
  });

  it("the 450 s timer aborts the wait with reason request_limit, a failure Try again may resend", async () => {
    const h = start([{ hang: true }]);
    await until(() => h.raw.length === 1, "request 1 is out");
    await vi.advanceTimersByTimeAsync(ASK_REQUEST_LIMIT_MS - 1);
    expect(h.signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const outcome = failedOf(await h.done);
    expect(h.signals[0]!.reason).toBe("request_limit");
    expect(outcome).toMatchObject({ canRetry: true, failure: { code: "request_limit", retryable: true } });
  });

  it("a connection failure quotes the measured seconds and masks both keys", async () => {
    const reply = deferred<Anthropic.Message>();
    const h = start([{ later: reply }]);
    await until(() => h.raw.length === 1, "request 1 is out");
    await vi.advanceTimersByTimeAsync(12_000);
    reply.reject(new APIConnectionError({ cause: new Error(`The network connection was lost. key=${KEY} seats=${SEATS_KEY}`) }));

    const { failure } = failedOf(await h.done);
    expect(failure.code).toBe("connection_failed");
    expect(failure.message).toContain("failed after 12 seconds");
    expect(failure.message).not.toContain(KEY);
    expect(failure.message).not.toContain(SEATS_KEY);
  });

  it("a mid-answer overload is a retryable failure", async () => {
    const h = start([{ error: () => errors.overloadedMid }]);
    expect(failedOf(await h.done)).toMatchObject({ canRetry: true, failure: { code: "overloaded_mid_answer", requestId: "req_synthetic_stream" } });
  });
});

describe("retryLastRequest", () => {
  it("resends the identical request and carries on from it", async () => {
    const tools = fakeTools();
    const h = start([toolUseSearch(), { error: () => errors.overloaded529 }, { script: "text" }], { tools: tools.runner });
    const failed = failedOf(await h.done);
    expect(failed).toMatchObject({ canRetry: true, committed: false, failure: { code: "overloaded", requestId: "req_synthetic_529" }, usage: { requests: 2 } });

    const outcome = await failed.retryLastRequest();
    expect(outcome).toMatchObject({ status: "answered", committed: true, usage: { requests: 3 } });
    expect(h.raw[2]).toBe(h.raw[1]);
    expect(json(h.wire[2])).toBe(json(h.wire[1]));
    expect(h.events.filter((e) => e.type === "request_started").map((e) => e.resend)).toEqual([false, false, true]);
    expect(json(h.conversation.committed)).toBe(json([...h.wire[2]!.messages, { role: "assistant", content: h.returned[1]!.content }]));
    expect(tools.ran).toHaveLength(1);
    await expect(failed.retryLastRequest()).rejects.toThrow("retryLastRequest was already used for this failure.");
  });

  it("does not count the time before Try again toward the question bound", async () => {
    const h = start([{ error: () => errors.overloaded529 }, { script: "text" }]);
    const failed = failedOf(await h.done);
    vi.setSystemTime(START.getTime() + ASK_QUESTION_LIMIT_MS * 2);
    expect(await failed.retryLastRequest()).toMatchObject({ status: "answered" });
  });

  it("is refused once six requests have been sent, and sends nothing", async () => {
    const replies: Reply[] = [...Array.from({ length: MAX_MODEL_REQUESTS - 1 }, toolUseSearch), { error: () => errors.overloaded529 }, { script: "text" }];
    const h = start(replies);
    const failed = failedOf(await h.done);
    expect(failed).toMatchObject({ canRetry: false, usage: { requests: 6 }, failure: { retryable: true } });

    expect(await failed.retryLastRequest()).toMatchObject({ status: "request_limit", committed: false });
    expect(h.raw).toHaveLength(MAX_MODEL_REQUESTS);
  });

  it("sends nothing for a failure resending cannot fix", async () => {
    const h = start([{ error: () => errors.rejectedKey }, { script: "text" }]);
    const failed = failedOf(await h.done);
    expect(failed).toMatchObject({ canRetry: false, failure: { code: "anthropic_key_rejected" } });
    expect(await failed.retryLastRequest()).toBe(failed);
    expect(h.raw).toHaveLength(1);
  });

  it("refuses to resend once another question has changed the history", async () => {
    const conversation = newConversation({ id: "conv-moved", now: () => START });
    const first = failedOf(await start([{ error: () => errors.overloaded529 }], { conversation }).done);
    await start([{ script: "text" }], { conversation, question: "Something else?" }).done;
    await expect(first.retryLastRequest()).rejects.toThrow("The conversation has moved on");
  });
});
