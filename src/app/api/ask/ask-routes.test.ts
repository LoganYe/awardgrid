/**
 * Route-handler tests for POST /api/ask and GET /api/ask/usage. runAsk / reserveAsk are
 * vi.mock'ed with scripted events, so nothing spawns the SDK and no network is touched; the
 * database is an in-memory openTestDb() injected through getServerDb().
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { seedUsers } from "@/lib/db/stores/testing";
import { resetMasterKeyCache, setKey } from "@/lib/keys";
import { connectForTests } from "@/lib/seats-oauth/testing";
import { parseSse } from "@/components/ask/sse";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

type Scripted = Array<Record<string, unknown> | { throw: Error }>;
const script: { events: Scripted; calls: unknown[]; usage: unknown; finished: number } = { events: [], calls: [], usage: null, finished: 0 };

vi.mock("@/lib/ask", () => ({
  runAsk: async function* (args: unknown) {
    script.calls.push(args);
    try {
      for (const ev of script.events) {
        if ("throw" in ev && ev.throw instanceof Error) throw ev.throw;
        await new Promise((r) => setTimeout(r, 1));
        yield ev;
      }
    } finally {
      script.finished += 1; // runAsk's real finally aborts the SDK subprocess
    }
  },
  reserveAsk: () => script.usage,
  getAskUsage: vi.fn(),
}));

const { POST } = await import("./route");
const { GET: usage } = await import("./usage/route");

const MASTER_HEX = "0f".repeat(32);
/** Alice's seats.aero access token (a fake), and the Partner-Authorization value the Ask session gets for it. */
const ALICE_TOKEN = "seats:ota:alice_pro_key_SECRET_a1b2c3";
const ALICE_KEY = `Bearer ${ALICE_TOKEN}`;
const ALICE_DUFFEL = "duffel_live_SECRET_zz99";

function post(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });
}

async function readAll(res: Response): Promise<string> {
  return new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
}

let aliceToken: string;
let carolToken: string;

beforeEach(() => {
  db = openTestDb();
  seedUsers(db, ["alice", "carol"]);
  process.env.MASTER_KEY = MASTER_HEX;
  resetMasterKeyCache();
  const masterKey = Buffer.from(MASTER_HEX, "hex");
  connectForTests(db, "alice", { masterKey, access: ALICE_TOKEN });
  setKey(db, "alice", "duffel", ALICE_DUFFEL, { masterKey });
  aliceToken = createSession(db, "alice").token;
  carolToken = createSession(db, "carol").token;
  script.events = [];
  script.calls = [];
  script.finished = 0;
  script.usage = { allowed: true, spentUsd: 0.25, capUsd: 2, remainingUsd: 1.75, day: "2026-09-06", requests: 3 };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MASTER_KEY;
  resetMasterKeyCache();
});

describe("POST /api/ask", () => {
  it("401 without a session", async () => {
    const res = await POST(post({ prompt: "hi" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(script.calls).toHaveLength(0);
  });

  it("409 no_key (JSON, not a stream) when the user has no seats.aero key", async () => {
    const res = await POST(post({ prompt: "hi" }, carolToken));
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "no_key", provider: "seats_aero" });
    expect(script.calls).toHaveLength(0);
  });

  it("400 invalid_body for an empty or oversized prompt", async () => {
    expect((await POST(post({ prompt: "" }, aliceToken))).status).toBe(400);
    expect((await POST(post({ prompt: "x".repeat(2001) }, aliceToken))).status).toBe(400);
    expect((await POST(post("not json", aliceToken))).status).toBe(400);
    expect(script.calls).toHaveLength(0);
  });

  it("streams scripted events as SSE frames with the right headers", async () => {
    script.events = [
      { type: "init", model: "claude-sonnet-5", skills: ["travel-hacker:seats-aero"] },
      { type: "text", delta: "Book it with " },
      { type: "tool", name: "Skill" },
      { type: "text", delta: "**Alaska**." },
      { type: "result", cost_usd: 0.0123, num_turns: 3, duration_ms: 1200, subtype: "success" },
    ];
    const res = await POST(post({ prompt: "which program?", context: { cell: cellCtx() } }, aliceToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const raw = await readAll(res);
    // Framing: every message is `event: <type>\ndata: <json>\n\n`.
    expect(raw).toMatch(/^event: init\ndata: \{.*\}\n\n/);
    const msgs = parseSse(raw);
    expect(msgs.map((m) => m.event)).toEqual(["init", "text", "tool", "text", "result"]);
    const texts = msgs.filter((m) => m.event === "text").map((m) => (JSON.parse(m.data) as { delta: string }).delta);
    expect(texts.join("")).toBe("Book it with **Alaska**.");
    expect(JSON.parse(msgs[4]!.data)).toMatchObject({ type: "result", cost_usd: 0.0123, num_turns: 3 });
  });

  it("hands runAsk the caller's decrypted keys, prompt and context — and only that user's keys", async () => {
    script.events = [{ type: "result", costUsd: 0 }];
    const ctx = { cell: cellCtx() };
    const res = await POST(post({ prompt: "  hello  ", context: ctx }, aliceToken));
    await readAll(res);
    expect(script.calls).toHaveLength(1);
    const call = script.calls[0] as { user: { id: string }; prompt: string; context: unknown; keys: Record<string, string> };
    expect(call.user.id).toBe("alice");
    expect(call.prompt).toBe("hello");
    expect(call.context).toEqual({ ...ctx, lang: "en" });
    expect(call.keys).toEqual({ seats_aero: ALICE_KEY, duffel: ALICE_DUFFEL });
  });

  it("never streams a key even if an event carries one", async () => {
    script.events = [
      { type: "text", text: `my key is ${ALICE_KEY}, bare ${ALICE_TOKEN}, and duffel ${ALICE_DUFFEL}` },
      { type: "error", code: "internal", message: ALICE_TOKEN },
    ];
    const res = await POST(post({ prompt: "leak?" }, aliceToken));
    const raw = await readAll(res);
    expect(raw).not.toContain(ALICE_TOKEN);
    expect(raw).not.toContain(ALICE_DUFFEL);
    expect(raw).toContain("••••");
  });

  it("emits a terminal error event (no key material) when runAsk throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    script.events = [{ type: "text", text: "partial" }, { throw: new Error(`boom ${ALICE_KEY}`) }];
    const res = await POST(post({ prompt: "x" }, aliceToken));
    const raw = await readAll(res);
    const msgs = parseSse(raw);
    expect(msgs.map((m) => m.event)).toEqual(["text", "error"]);
    expect(JSON.parse(msgs[1]!.data)).toEqual({ type: "error", code: "sdk" });
    expect(raw).not.toContain(ALICE_TOKEN);
  });

  it("aborts runAsk when the client disconnects", async () => {
    script.events = Array.from({ length: 50 }, (_, i) => ({ type: "text", text: `chunk${i} ` }));
    const controller = new AbortController();
    const req = new NextRequest("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${aliceToken}` },
      body: JSON.stringify({ prompt: "long" }),
      signal: controller.signal,
    });
    const res = await POST(req);
    const reader = res.body!.getReader();
    await reader.read(); // first frame arrived
    controller.abort();
    // The stream ends promptly instead of draining all 50 chunks, and the generator is finished
    // (its finally block — which aborts the SDK subprocess in the real runAsk — has run).
    let frames = 1;
    while (true) {
      const { done } = await reader.read();
      if (done) break;
      frames += 1;
    }
    expect(frames).toBeLessThan(50);
    expect(script.finished).toBe(1);
    // runAsk got a caller signal (wired to the SDK abortController) and it fired on disconnect,
    // so the subprocess dies immediately even while the generator is parked in a long tool call.
    const args = script.calls[0] as { deps?: { signal?: AbortSignal } };
    expect(args.deps?.signal).toBeInstanceOf(AbortSignal);
    expect(args.deps!.signal!.aborted).toBe(true);
  });
});

describe("GET /api/ask/usage", () => {
  it("401 without a session", async () => {
    const res = await usage(get("/api/ask/usage"));
    expect(res.status).toBe(401);
  });

  it("returns today's spend against the cap with a UTC-midnight reset", async () => {
    const res = await usage(get("/api/ask/usage", aliceToken));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { spentUsd: number; capUsd: number; remainingUsd: number; resetAt: string };
    expect(body).toMatchObject({ spentUsd: 0.25, capUsd: 2, remainingUsd: 1.75 });
    expect(body.resetAt).toMatch(/T00:00:00\.000Z$/);
  });
});

function cellCtx() {
  return { origin: "SEA", dest: "NRT", date: "2026-10-15", cabin: "F", program: "american", miles: 80000, fees_cents: 1250, seats_left: 2, source_id: "abc123" };
}
