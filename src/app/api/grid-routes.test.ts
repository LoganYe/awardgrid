/**
 * Route-handler tests for /api/parse, /api/find, /api/trips/[id] and /api/export against an
 * in-memory SQLite (openTestDb) injected through getServerDb(). No network: global fetch is
 * stubbed with the synthetic fixture; no env keys except a test MASTER_KEY set here.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { seedUsers } from "@/lib/db/stores/testing";
import { resetMasterKeyCache, setKey } from "@/lib/keys";
import { QueryObject } from "@awardgrid/core/query/schema";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS, generateSynthetic } from "@awardgrid/core/test-fixtures/seatsaero/generate-synthetic";
import type { Route, TripsResponse } from "@awardgrid/core/seatsaero/types";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

const { POST: parse } = await import("./parse/route");
const { POST: find } = await import("./find/route");
const { GET: trips } = await import("./trips/[id]/route");
const { POST: exportCsv } = await import("./export/route");

const MASTER_HEX = "0f".repeat(32);
const ALICE_KEY = "alice_pro_key_SECRET_a1b2c3";
const synthetic = generateSynthetic();
const tripsFixture = loadFixture<TripsResponse>("trips__id.json");

function syntheticRoutes(source: string): Route[] {
  return SYNTHETIC_ORIGINS.filter((o) => o !== "GMP").map((o) => ({
    ID: `${source}-${o}`,
    OriginAirport: o,
    OriginRegion: "Asia",
    DestinationAirport: "SEA",
    DestinationRegion: "North America",
    NumDaysOut: 330,
    Distance: 5000,
    Source: source,
  }));
}

const QUERY = QueryObject.parse({
  origins: [...SYNTHETIC_ORIGINS],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"],
  programs: [...SYNTHETIC_PROGRAMS],
  raw_text: "test",
  language: "en",
});

function post(path: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });
}

let fetchStub: ReturnType<typeof fakeFetch>;
let aliceToken: string;
let carolToken: string;

beforeEach(() => {
  db = openTestDb();
  seedUsers(db, ["alice", "carol"]);
  process.env.MASTER_KEY = MASTER_HEX;
  resetMasterKeyCache();
  setKey(db, "alice", "seats_aero", ALICE_KEY, { masterKey: Buffer.from(MASTER_HEX, "hex") });
  aliceToken = createSession(db, "alice").token;
  carolToken = createSession(db, "carol").token;
  fetchStub = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    if (req.url.pathname.startsWith("/partnerapi/trips/")) return jsonResponse(tripsFixture);
    return textResponse("not found", 404);
  });
  vi.stubGlobal("fetch", fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.MASTER_KEY;
  resetMasterKeyCache();
});

describe("POST /api/parse", () => {
  it("401 without a session", async () => {
    const res = await parse(post("/api/parse", { text: "HKG to SEA next month" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("parses the canonical Chinese query deterministically into chips", async () => {
    const res = await parse(post("/api/parse", { text: "香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱", today: "2026-10-01" }, aliceToken));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { query: QueryObject; used_llm: boolean; provenance: Record<string, string> };
    expect(body.used_llm).toBe(false);
    expect(body.query.origins).toEqual(["HKG", "PVG", "SHA", "NRT", "HND", "ICN", "GMP"]);
    expect(body.query.destinations).toEqual(["SEA"]);
    expect(body.query.cabins).toEqual(["F"]);
    expect(body.query.date_from).toBe("2026-10-01");
    expect(body.provenance.origins).toBe("deterministic");
    expect(fetchStub.calls).toHaveLength(0); // parsing never calls seats.aero
  });

  it("422 with the missing fields when the text cannot be parsed and no LLM is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await parse(post("/api/parse", { text: "somewhere nice", today: "2026-10-01" }, aliceToken));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; missing: string[]; message: string; notice?: { code: string; vars?: Record<string, unknown> } };
    expect(body.error).toBe("parse");
    expect(body.missing).toContain("origins");
    // The structured form travels with the message so the UI can translate it.
    expect(body.notice).toMatchObject({ code: "parse.missing", vars: { text: "somewhere nice" } });
  });

  it("400 on a malformed body", async () => {
    const res = await parse(post("/api/parse", "{not json", aliceToken));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});

describe("POST /api/find", () => {
  it("401 without a cookie", async () => {
    const res = await find(post("/api/find", { query: QUERY }));
    expect(res.status).toBe(401);
  });

  it("409 no_key for a user without a seats.aero key", async () => {
    const res = await find(post("/api/find", { query: QUERY }, carolToken));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_key", provider: "seats_aero" });
    expect(fetchStub.calls).toHaveLength(0);
  });

  it("400 on an invalid QueryObject", async () => {
    const res = await find(post("/api/find", { query: { ...QUERY, origins: ["hong kong"] } }, aliceToken));
    expect(res.status).toBe(400);
  });

  it("200 with the grid, warnings and quota; the response never contains the key", async () => {
    const res = await find(post("/api/find", { query: QUERY, orientation: "routes" }, aliceToken));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(ALICE_KEY);
    const body = JSON.parse(text) as {
      grid: { orientation: string; rows: string[]; meta: { api_calls_used: number } };
      warnings: string[];
      notices: unknown[];
      quota: { used: number; limit: number };
    };
    expect(body.warnings).toEqual([]);
    expect(body.notices).toEqual([]);
    expect(body.grid.orientation).toBe("routes");
    expect(body.grid.rows).toHaveLength(SYNTHETIC_ORIGINS.length);
    expect(body.grid.meta.api_calls_used).toBe(1 + SYNTHETIC_PROGRAMS.length);
    expect(body.quota.used).toBe(1 + SYNTHETIC_PROGRAMS.length);
    expect(fetchStub.calls.every((c) => c.headers["partner-authorization"] === ALICE_KEY)).toBe(true);
  });
});

describe("GET /api/trips/[id]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("401 without a cookie; 400 on a bad id or cabin", async () => {
    expect((await trips(get("/api/trips/abc"), ctx("abc"))).status).toBe(401);
    expect((await trips(get("/api/trips/x", aliceToken), ctx("bad id!"))).status).toBe(400);
    expect((await trips(get("/api/trips/abc?cabin=Z", aliceToken), ctx("abc"))).status).toBe(400);
    // min_cabin_pct is the documented 0-100 integer or nothing at all — never a silent clamp.
    expect((await trips(get("/api/trips/abc?min_cabin_pct=101", aliceToken), ctx("abc"))).status).toBe(400);
    expect((await trips(get("/api/trips/abc?min_cabin_pct=-1", aliceToken), ctx("abc"))).status).toBe(400);
    expect((await trips(get("/api/trips/abc?min_cabin_pct=70.5", aliceToken), ctx("abc"))).status).toBe(400);
    // The raw string is checked before Number() sees it. Every one of these used to coerce to a
    // number in range — "" and a bare key to 0, the most permissive value there is (issue #18).
    for (const q of ["min_cabin_pct=", "min_cabin_pct", "min_cabin_pct=0x10", "min_cabin_pct=1e1", "min_cabin_pct=%20", "min_cabin_pct=%2B70", "min_cabin_pct=70.0"]) {
      expect((await trips(get(`/api/trips/abc?${q}`, aliceToken), ctx("abc"))).status, q).toBe(400);
    }
  });

  it("carries min_cabin_pct upstream so the drawer asks in the grid's own scope (issue #18)", async () => {
    const id = "2PPrELk9WcfJaNREWEPXypvhXAD";
    // Absent, and an explicit 100, both leave the wire untouched: 100 is the API's default.
    await trips(get(`/api/trips/${id}?cabin=J`, aliceToken), ctx(id));
    expect(fetchStub.calls[0]!.url.searchParams.has("min_cabin_pct")).toBe(false);
    await trips(get(`/api/trips/${id}?cabin=J&min_cabin_pct=100`, aliceToken), ctx(id));
    expect(fetchStub.calls[1]!.url.searchParams.has("min_cabin_pct")).toBe(false);
    // A non-default value reaches Get Trips, or the flight list contradicts the grid.
    await trips(get(`/api/trips/${id}?cabin=J&min_cabin_pct=70`, aliceToken), ctx(id));
    expect(fetchStub.calls[2]!.url.searchParams.get("min_cabin_pct")).toBe("70");
    await trips(get(`/api/trips/${id}?cabin=J&min_cabin_pct=0`, aliceToken), ctx(id));
    expect(fetchStub.calls[3]!.url.searchParams.get("min_cabin_pct")).toBe("0");
  });

  it("200 with trips and fees, spending one call", async () => {
    const res = await trips(get("/api/trips/2PPrELk9WcfJaNREWEPXypvhXAD?cabin=J", aliceToken), ctx("2PPrELk9WcfJaNREWEPXypvhXAD"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(ALICE_KEY);
    const body = JSON.parse(text) as { trips: unknown[]; api_calls_used: number; booking_links: unknown[] };
    expect(body.api_calls_used).toBe(1);
    expect(body.trips.length).toBeGreaterThan(0);
    expect(fetchStub.calls).toHaveLength(1);
  });
});

describe("POST /api/export", () => {
  it("401 without a cookie", async () => {
    expect((await exportCsv(post("/api/export", { query: QUERY }))).status).toBe(401);
  });

  it("returns a UTF-8 BOM CSV attachment with the expected header", async () => {
    const res = await exportCsv(post("/api/export", { query: QUERY }, aliceToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="awardgrid_HKG+PVG+SHA_SEA_2026-10-01_2026-10-30.csv"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM (Response.text() would strip it)
    const text = new TextDecoder().decode(bytes);
    expect(text.split("\r\n")[0]).toMatch(/^date,origin/);
    expect(text).not.toContain(ALICE_KEY);
  });
});
