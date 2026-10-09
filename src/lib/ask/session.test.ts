import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getAskUsage, settleAsk } from "./budget";
import { PLUGIN_NAME } from "./skills";
import { type AskDeps, type AskQueryParams, checkInit, runAsk } from "./session";
import type { AskEvent } from "./types";

const T0 = new Date("2026-09-06T10:00:00Z");
const KEY = "pro_alice_SECRET_KEY_ABCDEF";
const DUFFEL = "duffel_live_alice_XYZ";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];
function fakePlugin(skillDirs = ["seats-aero", "duffel", "alliances"]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awardgrid-plugin-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: PLUGIN_NAME }),
  );
  for (const d of skillDirs) {
    fs.mkdirSync(path.join(root, "skills", d), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", d, "SKILL.md"), `# ${d}\n`);
  }
  return root;
}
function tmpBase(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "awardgrid-tmpbase-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function seedDb() {
  const db = openTestDb();
  db.insert(users)
    .values({ id: "alice", username: "alice", passwordHash: "x", createdAt: T0.toISOString() })
    .run();
  return db;
}

const m = (o: Record<string, unknown>): SDKMessage => o as unknown as SDKMessage;
const init = (pluginRoot: string, over: Record<string, unknown> = {}): SDKMessage =>
  m({
    type: "system",
    subtype: "init",
    session_id: "s1",
    uuid: "u0",
    cwd: pluginRoot,
    model: "claude-sonnet-5",
    permissionMode: "default",
    tools: ["Bash", "Read", "Skill"],
    mcp_servers: [
      { name: "kiwi", status: "pending" },
      { name: "skiplagged", status: "connected" },
    ],
    skills: ["travel-hacker:seats-aero", "travel-hacker:duffel", "travel-hacker:alliances"],
    plugins: [{ name: "travel-hacker", path: pluginRoot, version: "1.1.0" }],
    slash_commands: ["travel-hacker:seats-aero"],
    apiKeySource: "ANTHROPIC_API_KEY",
    claude_code_version: "2.1.260",
    output_style: "default",
    ...over,
  });
const textDelta = (text: string, parent: string | null = null): SDKMessage =>
  m({
    type: "stream_event",
    session_id: "s1",
    uuid: "u1",
    parent_tool_use_id: parent,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  });
const toolStart = (id: string, name: string): SDKMessage =>
  m({
    type: "stream_event",
    session_id: "s1",
    uuid: "u2",
    parent_tool_use_id: null,
    event: {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id, name, input: {} },
    },
  });
const assistantToolUse = (id: string, name: string, input: unknown): SDKMessage =>
  m({
    type: "assistant",
    session_id: "s1",
    uuid: "u3",
    parent_tool_use_id: null,
    message: {
      id: "msg",
      role: "assistant",
      model: "x",
      content: [{ type: "tool_use", id, name, input }],
      stop_reason: null,
      usage: {},
    },
  });
const result = (over: Record<string, unknown> = {}): SDKMessage =>
  m({
    type: "result",
    subtype: "success",
    session_id: "s1",
    uuid: "u9",
    is_error: false,
    duration_ms: 4200,
    duration_api_ms: 4000,
    num_turns: 3,
    result: "Book with Alaska.\n\nData: seats.aero",
    stop_reason: "end_turn",
    total_cost_usd: 0.0731,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    ...over,
  });

interface FakeQuery {
  fn: AskDeps["query"];
  calls: AskQueryParams[];
  closed: number;
}

/** A scripted query(): yields `messages`, then throws `throwAfter` if given. */
function scripted(
  messages: SDKMessage[],
  opts: { throwAfter?: Error; throwBefore?: Error } = {},
): FakeQuery {
  const fake: FakeQuery = { calls: [], closed: 0, fn: undefined as never };
  fake.fn = (params) => {
    fake.calls.push(params);
    async function* gen(): AsyncGenerator<SDKMessage, void, undefined> {
      if (opts.throwBefore) throw opts.throwBefore;
      for (const msg of messages) {
        if (params.options.abortController?.signal.aborted) return;
        yield msg;
      }
      if (opts.throwAfter) throw opts.throwAfter;
    }
    const g = gen() as AsyncGenerator<SDKMessage, void, undefined> & { close: () => void };
    g.close = () => {
      fake.closed++;
    };
    return g;
  };
  return fake;
}

/** A query() that yields init and then hangs until the abort signal fires (then throws AbortError). */
function hanging(pluginRoot: string): FakeQuery {
  const fake: FakeQuery = { calls: [], closed: 0, fn: undefined as never };
  fake.fn = (params) => {
    fake.calls.push(params);
    async function* gen(): AsyncGenerator<SDKMessage, void, undefined> {
      yield init(pluginRoot);
      const signal = params.options.abortController!.signal;
      await new Promise<void>((_, reject) => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        if (signal.aborted) reject(err);
        signal.addEventListener("abort", () => reject(err), { once: true });
      });
    }
    const g = gen() as AsyncGenerator<SDKMessage, void, undefined> & { close: () => void };
    g.close = () => {
      fake.closed++;
    };
    return g;
  };
  return fake;
}

async function collect(gen: AsyncGenerator<AskEvent>): Promise<AskEvent[]> {
  const out: AskEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function deps(pluginRoot: string, query: FakeQuery, over: Partial<AskDeps> = {}): Partial<AskDeps> {
  return {
    query: query.fn,
    now: () => T0,
    pluginRoot,
    model: "claude-sonnet-5",
    hostEnv: { PATH: "/usr/bin:/bin", ANTHROPIC_API_KEY: "sk-ant-test", CANARY: "leak" },
    tmpBase: tmpBase(),
    log: () => undefined,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("runAsk", () => {
  it("streams init → text deltas → tool names → result, settles the cost, and cleans up the session dir", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q = scripted([
      init(root),
      toolStart("tu1", "Skill"),
      assistantToolUse("tu1", "Skill", { skill: "travel-hacker:seats-aero" }),
      assistantToolUse("tu2", "Bash", {
        command: `curl -H "Partner-Authorization: ${KEY}" https://seats.aero/x`,
      }),
      textDelta("Book "),
      textDelta("ignored subagent text", "tu2"),
      textDelta("with Alaska."),
      result(),
    ]);
    const d = deps(root, q);
    const events = await collect(
      runAsk({
        db,
        user: { id: "alice", locale: "en" },
        prompt: "  which program for the cheapest SEA→NRT F cell?  ",
        context: { query: null, cell: { origin: "SEA", dest: "NRT" }, lang: "en" },
        keys: { seats_aero: KEY, duffel: DUFFEL },
        deps: d,
      }),
    );
    expect(events).toEqual([
      {
        type: "init",
        plugins: [{ name: "travel-hacker", path: root }],
        skills: ["travel-hacker:seats-aero", "travel-hacker:duffel", "travel-hacker:alliances"],
        mcp_servers: [
          { name: "kiwi", status: "pending" },
          { name: "skiplagged", status: "connected" },
        ],
        model: "claude-sonnet-5",
      },
      { type: "tool", name: "Skill" },
      { type: "tool", name: "Bash" },
      { type: "text", delta: "Book " },
      { type: "text", delta: "with Alaska." },
      { type: "result", cost_usd: 0.0731, num_turns: 3, duration_ms: 4200, subtype: "success" },
    ]);
    // never a key, never a tool input, in any event
    const json = JSON.stringify(events);
    expect(json).not.toContain(KEY);
    expect(json).not.toContain(DUFFEL);
    expect(json).not.toContain("Partner-Authorization");
    expect(json).not.toContain("sk-ant");

    // the SDK got the right prompt + isolated options
    expect(q.calls).toHaveLength(1);
    const { prompt, options } = q.calls[0]!;
    expect(prompt).toBe("which program for the cheapest SEA→NRT F cell?");
    const o = options as Options;
    expect(o.cwd).toBe(root);
    expect(o.plugins).toEqual([{ type: "local", path: root, skipMcpDiscovery: true }]);
    expect(o.skills).toEqual([
      "travel-hacker:alliances",
      "travel-hacker:duffel",
      "travel-hacker:seats-aero",
    ]);
    expect(o.persistSession).toBe(false);
    expect(o.maxBudgetUsd).toBe(0.5);
    const env = o.env as Record<string, string>;
    const home = env.HOME!;
    expect(env.SEATS_AERO_API_KEY).toBe(KEY);
    expect(env.DUFFEL_API_KEY_LIVE).toBe(DUFFEL);
    expect(env.CANARY).toBeUndefined();
    expect(home.startsWith(d.tmpBase!)).toBe(true);
    expect(o.systemPrompt).toContain('"origin":"SEA"');

    // budget settled, session dir removed
    expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({
      costMicroUsd: 73100,
      requests: 1,
    });
    expect(fs.existsSync(home)).toBe(false);
    expect(fs.readdirSync(d.tmpBase!)).toEqual([]);
  });

  it("aborts with plugin_missing when the init message lists a pruned skill (kickoff §9 Phase 4)", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q = scripted([
      init(root, { skills: ["travel-hacker:seats-aero", "travel-hacker:southwest"] }),
      textDelta("should not arrive"),
      result(),
    ]);
    const events = await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q),
      }),
    );
    expect(events).toEqual([
      {
        type: "error",
        code: "plugin_missing",
        message: "Plugin check failed: pruned skill travel-hacker:southwest is loaded",
      },
    ]);
    expect(q.calls[0]!.options.abortController!.signal.aborted).toBe(true);
    expect(q.closed).toBe(1);
    expect(getAskUsage(db, "alice", "2026-09-06").requests).toBe(0);
  });

  it("checkInit: wrong plugin path, missing seats-aero, pruned slash command", () => {
    const root = fakePlugin();
    const ok = init(root) as Extract<SDKMessage, { type: "system"; subtype: "init" }>;
    expect(checkInit(ok, root)).toBeNull();
    expect(checkInit(ok, `${root}/../elsewhere`)).toMatch(/was not loaded from/);
    expect(checkInit({ ...ok, plugins: [] }, root)).toMatch(/was not loaded/);
    expect(checkInit({ ...ok, skills: ["travel-hacker:duffel"] }, root)).toMatch(
      /seats-aero is not loaded/,
    );
    expect(checkInit({ ...ok, slash_commands: ["travel-hacker:chase-travel"] }, root)).toMatch(
      /pruned skill travel-hacker:chase-travel/,
    );
    expect(
      checkInit({ ...ok, skills: [...ok.skills, "travel-hacker:google-flights"] }, root),
    ).toMatch(/google-flights/);
    // a same-named skill from ANOTHER plugin is not ours to judge
    expect(checkInit({ ...ok, skills: [...ok.skills, "other:southwest"] }, root)).toBeNull();
  });

  it("denies with `budget` before spawning when today's spend is at the cap", async () => {
    const db = seedDb();
    settleAsk(db, "alice", 2, { now: T0 });
    const root = fakePlugin();
    const q = scripted([init(root), result()]);
    const events = await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q),
      }),
    );
    expect(events).toEqual([
      {
        type: "error",
        code: "budget",
        message: "Daily ask budget ($2.00) is used up for 2026-09-06; it resets at 00:00 UTC.",
      },
    ]);
    expect(q.calls).toHaveLength(0);
    expect(getAskUsage(db, "alice", "2026-09-06").requests).toBe(1); // unchanged
  });

  it("caps maxBudgetUsd at what is left today", async () => {
    const db = seedDb();
    settleAsk(db, "alice", 1.8, { now: T0 });
    const root = fakePlugin();
    const q = scripted([init(root), result({ total_cost_usd: 0.2 })]);
    await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q),
      }),
    );
    expect(q.calls[0]!.options.maxBudgetUsd).toBeCloseTo(0.2, 6);
    expect(getAskUsage(db, "alice", "2026-09-06").costUsd).toBeCloseTo(2, 6);
  });

  it("no_key / plugin_missing / unconfigured / empty prompt short-circuit without spawning", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q = scripted([init(root), result()]);
    const run = (over: {
      keys?: { seats_aero: string } | null;
      prompt?: string;
      deps?: Partial<AskDeps>;
    }) =>
      collect(
        runAsk({
          db,
          user: { id: "alice" },
          prompt: over.prompt ?? "hi",
          keys: over.keys === undefined ? { seats_aero: KEY } : over.keys,
          deps: { ...deps(root, q), ...over.deps },
        }),
      );

    expect(await run({ keys: null })).toEqual([
      {
        type: "error",
        code: "no_key",
        message: "No seats.aero account is connected. Connect seats.aero in Settings.",
      },
    ]);
    expect(await run({ keys: { seats_aero: "" } })).toMatchObject([
      { type: "error", code: "no_key" },
    ]);
    expect(await run({ deps: { pluginRoot: path.join(root, "nope") } })).toMatchObject([
      { type: "error", code: "plugin_missing" },
    ]);
    expect(await run({ deps: { hostEnv: { PATH: "/bin" } } })).toMatchObject([
      { type: "error", code: "sdk", message: expect.stringContaining("ANTHROPIC_API_KEY") },
    ]);
    expect(await run({ prompt: "   " })).toMatchObject([{ type: "error", code: "sdk" }]);
    expect(await run({ prompt: "x".repeat(5000) })).toMatchObject([
      { type: "error", code: "sdk", message: expect.stringContaining("too long") },
    ]);
    expect(q.calls).toHaveLength(0);
  });

  it("times out after 120 s: aborts the SDK and yields `timeout` (fake timers)", async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      const db = seedDb();
      const root = fakePlugin();
      const q = hanging(root);
      const gen = runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q),
      });
      const first = await gen.next();
      expect(first.value).toMatchObject({ type: "init" });
      const pending = gen.next();
      await vi.advanceTimersByTimeAsync(119_000);
      expect(q.calls[0]!.options.abortController!.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      const ev = await pending;
      expect(ev.value).toEqual({
        type: "error",
        code: "timeout",
        message: "Timed out after 120 s.",
      });
      expect(q.calls[0]!.options.abortController!.signal.aborted).toBe(true);
      expect((await gen.next()).done).toBe(true);
      // No result message → no cost readout from the SDK. The per-request ceiling ($0.50) that
      // holdAsk charged up front stays charged, and the request stays counted.
      expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({
        costMicroUsd: 500000,
        requests: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours a custom timeout and the caller's abort signal", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q1 = hanging(root);
    const ev1 = await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q1, { timeoutMs: 30 }),
      }),
    );
    expect(ev1).toMatchObject([
      { type: "init" },
      { type: "error", code: "timeout", message: "Timed out after 0 s." },
    ]);

    const ac = new AbortController();
    const q2 = hanging(root);
    const gen = runAsk({
      db,
      user: { id: "alice" },
      prompt: "hi",
      keys: { seats_aero: KEY },
      deps: deps(root, q2, { signal: ac.signal }),
    });
    await gen.next();
    const pending = gen.next();
    ac.abort();
    expect((await pending).value).toEqual({
      type: "error",
      code: "sdk",
      message: "The session was cancelled.",
    });
    expect(q2.calls[0]!.options.abortController!.signal.aborted).toBe(true);

    const q3 = scripted([init(root), result()]);
    const pre = new AbortController();
    pre.abort();
    expect(
      await collect(
        runAsk({
          db,
          user: { id: "alice" },
          prompt: "hi",
          keys: { seats_aero: KEY },
          deps: deps(root, q3, { signal: pre.signal }),
        }),
      ),
    ).toMatchObject([{ type: "error", code: "sdk" }]);
    expect(q3.calls).toHaveLength(0);
    // q1 (timeout) and q2 (caller abort) each keep the $0.50 ceiling charged and count a
    // request; q3 (pre-aborted) never held anything.
    expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({
      costMicroUsd: 1_000_000,
      requests: 2,
    });
  });

  it("holds the per-request ceiling up front so concurrent sessions cannot each get the full remainder", async () => {
    const db = seedDb();
    const root = fakePlugin();
    settleAsk(db, "alice", 1.2, { now: T0 }); // $0.80 left
    const q1 = hanging(root);
    const q2 = hanging(root);
    const q3 = hanging(root);
    const g1 = runAsk({ db, user: { id: "alice" }, prompt: "a", keys: { seats_aero: KEY }, deps: deps(root, q1) });
    const g2 = runAsk({ db, user: { id: "alice" }, prompt: "b", keys: { seats_aero: KEY }, deps: deps(root, q2) });
    const g3 = runAsk({ db, user: { id: "alice" }, prompt: "c", keys: { seats_aero: KEY }, deps: deps(root, q3) });
    expect((await g1.next()).value).toMatchObject({ type: "init" });
    expect((await g2.next()).value).toMatchObject({ type: "init" });
    // 0.80 → hold 0.50 → 0.30 left → hold 0.30 → 0 left → third is denied before spawning
    expect(q1.calls[0]!.options.maxBudgetUsd).toBeCloseTo(0.5, 6);
    expect(q2.calls[0]!.options.maxBudgetUsd).toBeCloseTo(0.3, 6);
    expect((await g3.next()).value).toMatchObject({ type: "error", code: "budget" });
    expect(q3.calls).toHaveLength(0);
    expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({ costMicroUsd: 2_000_000, requests: 3 });
    await g1.return(undefined);
    await g2.return(undefined);
    await g3.return(undefined);
    // early consumer return = no result: the holds stay charged
    expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({ costMicroUsd: 2_000_000, requests: 3 });
  });

  it("an error-subtype result followed by the SDK throw yields the result (not an error) and still settles", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q = scripted(
      [
        init(root),
        textDelta("partial"),
        result({
          subtype: "error_max_budget_usd",
          total_cost_usd: 0.5,
          errors: ["budget"],
          result: undefined,
        }),
      ],
      {
        throwAfter: new Error("Claude Code process exited with code 1"),
      },
    );
    const events = await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q),
      }),
    );
    expect(events.map((e) => e.type)).toEqual(["init", "text", "result"]);
    expect(events[2]).toMatchObject({
      type: "result",
      subtype: "error_max_budget_usd",
      cost_usd: 0.5,
    });
    expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({
      costMicroUsd: 500000,
      requests: 1,
    });
  });

  it("falls back to the final result text when nothing was streamed; ends-without-result is an sdk error", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q = scripted([init(root), result({ result: "Only the final text." })]);
    const events = await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q),
      }),
    );
    expect(events.map((e) => e.type)).toEqual(["init", "text", "result"]);
    expect(events[1]).toEqual({ type: "text", delta: "Only the final text." });

    const q2 = scripted([init(root), textDelta("x")]);
    const ev2 = await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q2),
      }),
    );
    expect(ev2.at(-1)).toEqual({
      type: "error",
      code: "sdk",
      message: "The session ended without a result.",
    });
  });

  it("scrubs key material out of SDK error messages and removes the session dir even on failure", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q = scripted([], {
      throwBefore: new Error(`spawn failed; env SEATS_AERO_API_KEY=${KEY} DUFFEL=${DUFFEL}`),
    });
    const d = deps(root, q);
    const logs: string[] = [];
    const events = await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY, duffel: DUFFEL },
        deps: { ...d, log: (l) => logs.push(l) },
      }),
    );
    expect(events).toEqual([
      {
        type: "error",
        code: "sdk",
        message: "Agent error: spawn failed; env SEATS_AERO_API_KEY=[redacted] DUFFEL=[redacted]",
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain(KEY);
    expect(fs.readdirSync(d.tmpBase!)).toEqual([]);
  });

  it("stops the subprocess when the consumer stops iterating early (client disconnect)", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q = scripted([init(root), textDelta("a"), textDelta("b"), result()]);
    const d = deps(root, q);
    const gen = runAsk({
      db,
      user: { id: "alice" },
      prompt: "hi",
      keys: { seats_aero: KEY },
      deps: d,
    });
    await gen.next();
    await gen.next();
    await gen.return();
    expect(q.calls[0]!.options.abortController!.signal.aborted).toBe(true);
    expect(q.closed).toBe(1);
    expect(fs.readdirSync(d.tmpBase!)).toEqual([]);
  });
});

describe("API-error result (subtype success + is_error)", () => {
  it("is reported as an sdk error, never as answer text, with the key scrubbed", async () => {
    const db = seedDb();
    const root = fakePlugin();
    const q = scripted([
      init(root),
      result({
        is_error: true,
        num_turns: 1,
        total_cost_usd: 0,
        result: `Failed to authenticate. API Error: 403 Request not allowed (${KEY})`,
      }),
    ]);
    const log: string[] = [];
    const events = await collect(
      runAsk({
        db,
        user: { id: "alice" },
        prompt: "hi",
        keys: { seats_aero: KEY },
        deps: deps(root, q, { log: (l) => log.push(l) }),
      }),
    );
    expect(events.map((e) => e.type)).toEqual(["init", "error", "result"]);
    const err = events[1] as Extract<AskEvent, { type: "error" }>;
    expect(err.code).toBe("sdk");
    expect(err.message).toContain("403 Request not allowed");
    expect(JSON.stringify(events)).not.toContain(KEY);
    expect(log.join("\n")).not.toContain(KEY);
    expect(events.at(-1)).toMatchObject({ type: "result", subtype: "success", cost_usd: 0 });
  });
});

describe("live smoke (needs ANTHROPIC_API_KEY and AWARDGRID_LIVE_SMOKE=1)", () => {
  const live = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AWARDGRID_LIVE_SMOKE === "1";
  beforeEach(() => {
    if (!live) return;
  });
  it.skipIf(!live)(
    "runs one real session against the built plugin",
    async () => {
      const db = seedDb();
      const root = path.resolve(process.cwd(), "build", "plugin");
      const events = await collect(
        runAsk({
          db,
          user: { id: "alice" },
          prompt: "Reply with the single word OK and nothing else. Do not use any tools.",
          keys: { seats_aero: process.env.SEATS_AERO_API_KEY ?? "smoke-placeholder-key-0000" },
          deps: { pluginRoot: root, now: () => new Date(), tmpBase: tmpBase() },
        }),
      );
      const initEv = events.find((e) => e.type === "init");
      expect(initEv).toBeDefined();
      expect(events.at(-1)).toMatchObject({ type: "result" });
    },
    150_000,
  );
});
