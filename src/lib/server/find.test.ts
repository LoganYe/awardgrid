/**
 * findGridForUser / getTripsForUser / parseForUser over an in-memory SQLite with a seeded user,
 * an encrypted key (test master key) and a fake fetch over the synthetic fixture. No network,
 * no env keys. Also asserts that the decrypted key only ever appears in the
 * Partner-Authorization header of requests made on that user's behalf.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestDb, type Db } from "@/lib/db/client";
import { apiUsage, availabilityCache } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { setKey } from "@/lib/keys";
import { QueryObject, type QueryObjectInput } from "@/lib/query/schema";
import type { Route, TripsResponse } from "@/lib/seatsaero/types";
import {
  NOT_FETCHED_REASON,
  NoKeyError,
  ParseError,
  QuotaExceededError,
  exportFilename,
  findGridForUser,
  getTripsForUser,
  gridErrorResponse,
  llmAvailable,
  notFetchedPairsFrom,
  parseForUser,
  summarizeTrip,
  utcToday,
} from "@/lib/server/find";
import { notice } from "@/lib/notices";
import { enumeratePairs } from "@/lib/grid/pivot";
import { SeatsAeroHttpError } from "@/lib/seatsaero/client";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS, generateSynthetic } from "../../../test/fixtures/seatsaero/generate-synthetic";

const MASTER = Buffer.from("0f".repeat(32), "hex");
const ALICE_KEY = "alice_pro_key_SECRET_a1b2c3";
const BOB_KEY = "bob_pro_key_SECRET_z9y8x7";
const NOW = new Date("2026-10-01T12:00:00Z");
const now = () => NOW;

const synthetic = generateSynthetic();
const tripsFixture = loadFixture<TripsResponse>("trips__id.json");

function query(overrides: Partial<QueryObjectInput> = {}): QueryObject {
  return QueryObject.parse({
    origins: [...SYNTHETIC_ORIGINS],
    destinations: ["SEA"],
    date_from: "2026-10-01",
    date_to: "2026-10-30",
    cabins: ["J", "F"],
    programs: [...SYNTHETIC_PROGRAMS],
    raw_text: "test",
    language: "en",
    ...overrides,
  });
}

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

function harness() {
  const db: Db = openTestDb();
  seedUsers(db, ["alice", "bob", "carol"]);
  setKey(db, "alice", "seats_aero", ALICE_KEY, { masterKey: MASTER, now: NOW });
  setKey(db, "bob", "seats_aero", BOB_KEY, { masterKey: MASTER, now: NOW });
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    if (req.url.pathname.startsWith("/partnerapi/trips/")) return jsonResponse(tripsFixture);
    return textResponse("not found", 404);
  });
  return { db, fetch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findGridForUser", () => {
  it("builds a grid with the user's own key; the second call within the TTL is served from cache", async () => {
    const { db, fetch } = harness();
    const q = query();
    const first = await findGridForUser(db, { id: "alice" }, q, { now, fetch, masterKey: MASTER });
    expect(first.grid.orientation).toBe("dates");
    expect(first.grid.rows).toHaveLength(30);
    expect(first.grid.cols).toHaveLength(SYNTHETIC_ORIGINS.length);
    expect(first.grid.meta.served_from_cache).toBe(false);
    const N = 1 + SYNTHETIC_PROGRAMS.length; // one search page + Get Routes per program (GMP empty)
    expect(first.grid.meta.api_calls_used).toBe(N);
    expect(first.grid.meta.unmonitored_pairs).toEqual([{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }]);
    expect(first.grid.cells.flat().some((c) => c.status === "ok")).toBe(true);
    expect(first.grid.cells.flat().filter((c) => c.origin === "GMP").every((c) => c.status === "unmonitored")).toBe(true);
    expect(first.quota).toEqual({ used: N, limit: 950, resetAt: "2026-10-02T00:00:00.000Z" });
    expect(first.warnings).toEqual([]);

    // Every request carried alice's key and nothing else.
    expect(fetch.calls).toHaveLength(N);
    expect(fetch.calls.every((c) => c.headers["partner-authorization"] === ALICE_KEY)).toBe(true);

    // Quota accounting rows were written for alice only.
    expect(db.select().from(apiUsage).all()).toEqual([{ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: N }]);
    expect(db.select().from(availabilityCache).all().every((r) => r.userId === "alice")).toBe(true);

    const second = await findGridForUser(db, { id: "alice" }, q, {
      now: () => new Date(NOW.getTime() + 20 * 60_000),
      fetch,
      masterKey: MASTER,
      orientation: "routes",
    });
    expect(second.grid.meta.served_from_cache).toBe(true);
    expect(second.grid.meta.api_calls_used).toBe(0);
    // The web facade wires a fresh RoutesCatalog per request: a cached render must still
    // hydrate it from routes_cache (zero calls) and keep the §4.3 "not monitored" state.
    expect(second.grid.meta.unmonitored_pairs).toEqual([{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }]);
    expect(second.grid.cells.flat().filter((c) => c.origin === "GMP").every((c) => c.status === "unmonitored")).toBe(true);
    // Program counts from the routes catalog (loaded on the first run, hydrated from the store on
    // the second): every program monitors every synthetic pair except GMP.
    for (const res of [first, second]) {
      const byPair = res.programs_by_pair;
      expect(byPair).not.toBeNull();
      for (const p of enumeratePairs(query())) expect(byPair?.[p.key]).toBe(p.origin === "GMP" ? 0 : SYNTHETIC_PROGRAMS.length);
      expect(res.programs_checked).toBe(SYNTHETIC_PROGRAMS.length);
    }
    expect(second.grid.orientation).toBe("routes");
    expect(second.grid.rows).toHaveLength(SYNTHETIC_ORIGINS.length);
    expect(fetch.calls).toHaveLength(N);
    expect(second.quota.used).toBe(N);
  });

  it("two users with two keys have independent caches and quotas; each request carries only its owner's key", async () => {
    const { db, fetch } = harness();
    const q = query();
    await findGridForUser(db, { id: "alice" }, q, { now, fetch, masterKey: MASTER });
    const aliceCalls = fetch.calls.length;
    const bob = await findGridForUser(db, { id: "bob" }, q, { now, fetch, masterKey: MASTER });
    expect(bob.grid.meta.served_from_cache).toBe(false); // alice's cache must not serve bob
    const bobCalls = fetch.calls.slice(aliceCalls);
    expect(bobCalls.length).toBeGreaterThan(0);
    expect(bobCalls.every((c) => c.headers["partner-authorization"] === BOB_KEY)).toBe(true);
    expect(fetch.calls.slice(0, aliceCalls).every((c) => c.headers["partner-authorization"] === ALICE_KEY)).toBe(true);
    const usage = db.select().from(apiUsage).all();
    expect(usage.map((u) => u.userId).sort()).toEqual(["alice", "bob"]);
  });

  it("throws NoKeyError for a user without a key before touching the master key or the network", async () => {
    const { db, fetch } = harness();
    await expect(findGridForUser(db, { id: "carol" }, query(), { now, fetch })).rejects.toBeInstanceOf(NoKeyError);
    expect(fetch.calls).toHaveLength(0);
    expect(db.select().from(apiUsage).all()).toEqual([]);
  });

  it("maps upstream failures to a SeatsAeroError whose text never contains the key", async () => {
    const { db } = harness();
    const fetch = fakeFetch(() => textResponse(`unauthorized ${ALICE_KEY}`, 401));
    let caught: unknown;
    try {
      await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SeatsAeroHttpError);
    expect((caught as Error).message).not.toContain(ALICE_KEY);
    const res = gridErrorResponse(caught);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind: string; message: string };
    expect(body.error).toBe("seatsaero");
    expect(body.kind).toBe("invalid_key");
    expect(JSON.stringify(body)).not.toContain(ALICE_KEY);
  });
});

describe("getTripsForUser", () => {
  it("spends exactly one call, returns trips + fees + booking links, and records the call", async () => {
    const { db, fetch } = harness();
    const res = await getTripsForUser(db, { id: "alice" }, "2PPrELk9WcfJaNREWEPXypvhXAD", { now, fetch, masterKey: MASTER, cabin: "J" });
    expect(res.api_calls_used).toBe(1);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.url.pathname).toBe("/partnerapi/trips/2PPrELk9WcfJaNREWEPXypvhXAD");
    expect(fetch.calls[0]!.headers["partner-authorization"]).toBe(ALICE_KEY);
    expect(res.trips.length).toBeGreaterThan(0);
    expect(res.trips[0]!.segments.length).toBeGreaterThan(0);
    expect(res.fees_cents).not.toBeNull();
    expect(res.booking_links.length).toBeGreaterThan(0);
    expect(res.quota.used).toBe(1);
    expect(db.select().from(apiUsage).all()).toEqual([{ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: 1 }]);
    expect(JSON.stringify(res)).not.toContain(ALICE_KEY);
  });

  it("refuses with QuotaExceededError (reset time attached) when the soft limit is reached", async () => {
    const { db, fetch } = harness();
    db.insert(apiUsage).values({ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: 950 }).run();
    let caught: unknown;
    try {
      await getTripsForUser(db, { id: "alice" }, "abc", { now, fetch, masterKey: MASTER });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QuotaExceededError);
    expect((caught as QuotaExceededError).resetAt.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(fetch.calls).toHaveLength(0);
    const res = gridErrorResponse(caught);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "quota", resetAt: "2026-10-02T00:00:00.000Z" });
    // Nothing was charged.
    expect(db.select().from(apiUsage).all()[0]!.calls).toBe(950);
  });

  it("summarizeTrip orders segments and normalises empty currency to null", () => {
    const trip = tripsFixture.data[0]!;
    const s = summarizeTrip({ ...trip, TaxesCurrency: "" });
    expect(s.currency).toBeNull();
    expect(s.segments.map((x) => x.flight_number)).toEqual(
      [...trip.AvailabilitySegments].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0)).map((x) => x.FlightNumber),
    );
  });
});

describe("parseForUser", () => {
  it("parses the canonical Chinese query deterministically without any LLM", async () => {
    const result = await parseForUser("香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱", { today: "2026-10-01", env: {} });
    expect(result.used_llm).toBe(false);
    expect(result.query.origins).toEqual(["HKG", "PVG", "SHA", "NRT", "HND", "ICN", "GMP"]);
    expect(result.query.destinations).toEqual(["SEA"]);
    expect(result.query.cabins).toEqual(["F"]);
    expect(result.query.date_from).toBe("2026-10-01");
    expect(result.query.date_to).toBe("2026-10-31");
    expect(result.query.sort_by).toBe("miles_asc");
    expect(result.query.language).toBe("zh");
    expect(result.provenance.origins).toBe("deterministic");
  });

  it("without ANTHROPIC_API_KEY an ambiguous query fails with a ParseError listing the missing fields (→ 422)", async () => {
    let caught: unknown;
    try {
      await parseForUser("first class over Thanksgiving", { today: "2026-10-01", env: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ParseError);
    expect((caught as ParseError).missing.length).toBeGreaterThan(0);
    const res = gridErrorResponse(caught);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; missing: string[]; message: string };
    expect(body.error).toBe("parse");
    expect(body.missing).toEqual((caught as ParseError).missing);
  });

  it("uses an injected LLM client only when the deterministic pass is incomplete", async () => {
    const parse = vi.fn(async () => ({
      parsed_output: {
        origins: ["HKG"],
        destinations: ["SEA"],
        date_from: "2026-11-26",
        date_to: "2026-11-30",
        cabins: ["F"] as ["F"],
        programs: null,
        direct_only: false,
        max_miles: null,
        sort_by: "miles_asc" as const,
      },
      stop_reason: "end_turn" as const,
    }));
    const llmClient = { messages: { parse } };
    const r = await parseForUser("HKG to SEA over Thanksgiving, first", { today: "2026-10-01", env: {}, llmClient });
    expect(r.used_llm).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(r.query.date_from).toBe("2026-11-26");
    const d = await parseForUser("HKG to SEA next month", { today: "2026-10-01", env: {}, llmClient });
    expect(d.used_llm).toBe(false);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("llmAvailable reflects ANTHROPIC_API_KEY without exposing it", () => {
    expect(llmAvailable({})).toBe(false);
    expect(llmAvailable({ ANTHROPIC_API_KEY: "  " })).toBe(false);
    expect(llmAvailable({ ANTHROPIC_API_KEY: "sk-test" })).toBe(true);
  });
});

describe("helpers", () => {
  it("exportFilename and utcToday", () => {
    expect(exportFilename(query())).toBe("awardgrid_HKG+PVG+SHA_SEA_2026-10-01_2026-10-30.csv");
    expect(utcToday(NOW)).toBe("2026-10-01");
  });

  it("gridErrorResponse maps NoKeyError → 409 and unknown errors → 500 logging only the name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await gridErrorResponse(new NoKeyError("seats_aero")).json())).toEqual({ error: "no_key", provider: "seats_aero" });
    const res = gridErrorResponse(new Error(`boom ${ALICE_KEY}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(ALICE_KEY);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 additive: dynamic rows from the cached include_filtered scope, not-fetched pairs,
// per-program Get Routes failures.
// ---------------------------------------------------------------------------

type SyntheticObject = Record<string, unknown> & { ID: string; Source: string; Date: string; Route: { OriginAirport: string } };

/**
 * Three dynamic-priced objects on (origin, date) cells the plain fixture leaves EMPTY for every
 * program, so they can only ever come from the include_filtered scope and each one is the
 * sole occupant of its cell.
 */
function dynamicObjects(): SyntheticObject[] {
  const data = synthetic.data as SyntheticObject[];
  const taken = new Set(data.map((o) => `${o.Route.OriginAirport}:${o.Date}`));
  const out: SyntheticObject[] = [];
  const template = data.find((o) => o.JAvailable === true)!;
  for (const program of SYNTHETIC_PROGRAMS) {
    for (const origin of SYNTHETIC_ORIGINS) {
      if (origin === "GMP") continue;
      for (let day = 0; day < 30 && out.length < 3; day += 1) {
        const date = `2026-10-${String(day + 1).padStart(2, "0")}`;
        if (taken.has(`${origin}:${date}`)) continue;
        const route = { ...(template.Route as Record<string, unknown>), OriginAirport: origin, Source: program, ID: `route-dyn-${out.length}` };
        out.push({
          ...template,
          ID: `DYN${out.length}`,
          RouteID: route.ID,
          Route: route as SyntheticObject["Route"],
          Date: date,
          ParsedDate: `${date}T00:00:00Z`,
          Source: program,
          JAvailable: true,
          JMileageCost: "42500",
          JRemainingSeats: 3,
          JAirlines: "JL",
          JDirect: true,
          FAvailable: false,
          FMileageCost: "0",
          FRemainingSeats: 0,
          FAirlines: "",
          FDirect: false,
        });
        taken.add(`${origin}:${date}`);
        break;
      }
      if (out.length >= 3) return out;
    }
  }
  return out;
}

function dynamicHarness() {
  const db: Db = openTestDb();
  seedUsers(db, ["alice"]);
  setKey(db, "alice", "seats_aero", ALICE_KEY, { masterKey: MASTER, now: NOW });
  const extra = dynamicObjects();
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") {
      const filtered = req.url.searchParams.get("include_filtered") === "true";
      return jsonResponse(filtered ? { ...synthetic, data: [...synthetic.data, ...extra], count: synthetic.count + extra.length } : synthetic);
    }
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    return textResponse("not found", 404);
  });
  return { db, fetch, extra };
}

describe("findGridForUser — dynamic rows (Phase 6)", () => {
  it("appends cached include_filtered rows flagged dynamic to the plain query only, without any fetch", async () => {
    const { db, fetch, extra } = dynamicHarness();
    expect(extra).toHaveLength(3);
    const plainQ = query({ include_filtered: false });
    const filteredQ = query({ include_filtered: true });

    // 1. Warm the include_filtered scope. Its own result never carries the flag.
    const first = await findGridForUser(db, { id: "alice" }, filteredQ, { now, fetch, masterKey: MASTER });
    expect(first.dynamic_rows_available).toBe(false);
    expect(first.grid.cells.flat().flatMap((c) => c.all).some((r) => r.dynamic)).toBe(false);
    expect(first.grid.cells.flat().every((c) => c.status !== "filtered")).toBe(true);
    const warm = fetch.calls.length;

    // 2. The plain query fetches its own scope (one search page; routes already cached) and
    //    then reads the filtered scope from SQLite: no extra request.
    const plain = await findGridForUser(db, { id: "alice" }, plainQ, { now, fetch, masterKey: MASTER });
    expect(fetch.calls.length).toBe(warm + 1);
    expect(fetch.calls[warm]!.url.searchParams.get("include_filtered")).toBeNull();
    expect(plain.dynamic_rows_available).toBe(true);
    const rows = plain.grid.cells.flat().flatMap((c) => c.all);
    const dynamic = rows.filter((r) => r.dynamic === true);
    expect(dynamic).toHaveLength(3);
    expect(dynamic.map((r) => r.miles)).toEqual([42_500, 42_500, 42_500]);
    expect(dynamic.every((r) => r.include_filtered === true)).toBe(true);
    // Every dynamic row sits in a cell of its own → the "filtered" state with the dynamic row as best.
    const filteredCells = plain.grid.cells.flat().filter((c) => c.status === "filtered");
    expect(filteredCells).toHaveLength(3);
    expect(filteredCells.every((c) => c.best?.dynamic === true && c.all.every((r) => r.dynamic))).toBe(true);
    // Nothing that the plain scope already had is duplicated.
    expect(rows.filter((r) => !r.dynamic)).toHaveLength(first.grid.cells.flat().flatMap((c) => c.all).length - 3);
    expect(JSON.stringify(plain)).not.toContain(ALICE_KEY);

    // 3. Served from cache within the TTL: same answer, still no request.
    const again = await findGridForUser(db, { id: "alice" }, plainQ, { now: () => new Date(NOW.getTime() + 10 * 60_000), fetch, masterKey: MASTER });
    expect(again.grid.meta.served_from_cache).toBe(true);
    expect(again.dynamic_rows_available).toBe(true);
    expect(again.grid.cells.flat().filter((c) => c.status === "filtered")).toHaveLength(3);
    expect(fetch.calls.length).toBe(warm + 1);

    // 4. Opt-out (standing queries): the plain answer only.
    const strict = await findGridForUser(db, { id: "alice" }, plainQ, { now, fetch, masterKey: MASTER, dynamic_rows: false });
    expect(strict.dynamic_rows_available).toBe(false);
    expect(strict.grid.cells.flat().flatMap((c) => c.all).some((r) => r.dynamic)).toBe(false);
    expect(fetch.calls.length).toBe(warm + 1);

    // 5. With the toggle on, the same rows are ordinary "ok" rows again (from cache).
    const on = await findGridForUser(db, { id: "alice" }, filteredQ, { now, fetch, masterKey: MASTER });
    expect(on.grid.meta.served_from_cache).toBe(true);
    expect(on.grid.cells.flat().every((c) => c.status !== "filtered")).toBe(true);
    expect(on.grid.cells.flat().flatMap((c) => c.all).filter((r) => r.miles === 42_500)).toHaveLength(3);
  });

  it("without a cached include_filtered scope the plain query has no dynamic rows and says so", async () => {
    const { db, fetch } = dynamicHarness();
    const plain = await findGridForUser(db, { id: "alice" }, query({ include_filtered: false }), { now, fetch, masterKey: MASTER });
    expect(plain.dynamic_rows_available).toBe(false);
    expect(plain.grid.cells.flat().some((c) => c.status === "filtered")).toBe(false);
    expect(plain.grid.cells.flat().flatMap((c) => c.all).some((r) => r.dynamic)).toBe(false);
    expect(fetch.calls.every((c) => c.url.searchParams.get("include_filtered") === null)).toBe(true);
  });

  it("a stale include_filtered scope (older than the TTL) is not appended", async () => {
    const { db, fetch } = dynamicHarness();
    await findGridForUser(db, { id: "alice" }, query({ include_filtered: true }), { now, fetch, masterKey: MASTER });
    const later = () => new Date(NOW.getTime() + 3 * 60 * 60_000); // beyond the 45-minute TTL
    const plain = await findGridForUser(db, { id: "alice" }, query({ include_filtered: false }), { now: later, fetch, masterKey: MASTER });
    expect(plain.dynamic_rows_available).toBe(false);
    expect(plain.grid.cells.flat().flatMap((c) => c.all).some((r) => r.dynamic)).toBe(false);
  });
});

describe("findGridForUser — not fetched pairs (Phase 6)", () => {
  it("marks monitored pairs without rows as not fetched when the search was truncated", async () => {
    const db: Db = openTestDb();
    seedUsers(db, ["alice"]);
    setKey(db, "alice", "seats_aero", ALICE_KEY, { masterKey: MASTER, now: NOW });
    const page = (synthetic.data as SyntheticObject[]).filter((o) => o.Route.OriginAirport === "HKG").slice(0, 5);
    const fetch = fakeFetch((req) => {
      // Every page claims there is more: the run stops at the page cap and warns.
      if (req.url.pathname === "/partnerapi/search") return jsonResponse({ ...synthetic, data: page, count: page.length, hasMore: true, cursor: 1 });
      if (req.url.pathname === "/partnerapi/routes") {
        const source = req.url.searchParams.get("source")!;
        return jsonResponse([...syntheticRoutes(source), { ...syntheticRoutes(source)[0]!, ID: `${source}-TPE`, OriginAirport: "TPE" }]);
      }
      return textResponse("not found", 404);
    });
    const q = query({ origins: [...SYNTHETIC_ORIGINS, "TPE"] });
    const res = await findGridForUser(db, { id: "alice" }, q, { now, fetch, masterKey: MASTER });
    expect(res.notices.map((n) => n.code)).toContain("find.truncated_search");
    const cells = res.grid.cells.flat();
    const status = (origin: string) => new Set(cells.filter((c) => c.origin === origin).map((c) => c.status));
    expect(status("GMP")).toEqual(new Set(["unmonitored"]));
    expect(status("TPE")).toEqual(new Set(["not_fetched"]));
    expect(status("PVG")).toEqual(new Set(["not_fetched"]));
    expect(status("HKG").has("ok")).toBe(true);
    expect(status("HKG").has("not_fetched")).toBe(false);
    expect(cells.find((c) => c.origin === "TPE")?.reason).toBe("grid.cell.not_fetched");
    expect(res.grid.meta.not_fetched_pairs.map((p) => p.pair.origin).sort()).toEqual(["HND", "ICN", "NRT", "PVG", "SHA", "TPE"]);
    expect(res.programs_failed).toEqual([]);
  });

  it("notFetchedPairsFrom: quota headroom wins over truncation; pairs with rows or unmonitored are left alone", () => {
    const q = query({ origins: ["HKG", "PVG", "GMP"] });
    const pairs = enumeratePairs(q);
    const row = { origin: "HKG", dest: "SEA" } as never;
    const base = { rows: [row], unmonitored_pairs: [{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }] };
    expect(notFetchedPairsFrom({ ...base, notices: [] }, pairs)).toEqual([]);
    expect(notFetchedPairsFrom({ ...base, notices: [notice("find.truncated_bulk", { pages: 2, source: "alaska" })] }, pairs)).toEqual([
      { pair: { origin: "PVG", dest: "SEA" }, reason: "grid.cell.not_fetched" },
    ]);
    expect(
      notFetchedPairsFrom({ ...base, notices: [notice("find.truncated_search", { pages: 3 }), notice("find.quota_headroom")] }, pairs),
    ).toEqual([{ pair: { origin: "PVG", dest: "SEA" }, reason: "grid.cell.not_fetched_quota" }]);
    expect(notFetchedPairsFrom({ ...base, notices: [notice("find.routes_skipped", { pairs: 1, skipped: 2 })] }, pairs)).toEqual([]);
  });
});

describe("findGridForUser — one program's Get Routes failing (Phase 6)", () => {
  function failingHarness(status: number) {
    const db: Db = openTestDb();
    seedUsers(db, ["alice"]);
    setKey(db, "alice", "seats_aero", ALICE_KEY, { masterKey: MASTER, now: NOW });
    const fetch = fakeFetch((req) => {
      if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
      if (req.url.pathname === "/partnerapi/routes") {
        const source = req.url.searchParams.get("source")!;
        if (source === "aeroplan") return textResponse(`upstream failure ${ALICE_KEY}`, status);
        return jsonResponse(syntheticRoutes(source));
      }
      return textResponse("not found", 404);
    });
    return { db, fetch };
  }

  it("a 500 on one program's route list keeps the grid, reports the program and never claims not monitored", async () => {
    const { db, fetch } = failingHarness(500);
    const res = await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    expect(res.programs_failed).toEqual(["aeroplan"]);
    expect(res.notices.map((n) => n.code)).toContain("find.routes_skipped");
    expect(res.grid.meta.unmonitored_pairs).toEqual([]);
    // A pair with no rows that none of the LOADED programs monitors may belong to the failed
    // one: it is "not fetched (upstream error)", neither "no availability" nor "not monitored".
    const gmp = res.grid.cells.flat().filter((c) => c.origin === "GMP");
    expect(gmp.length).toBeGreaterThan(0);
    expect(gmp.every((c) => c.status === "not_fetched" && c.reason === NOT_FETCHED_REASON.upstream)).toBe(true);
    expect(res.grid.meta.not_fetched_pairs.map((p) => `${p.pair.origin}-${p.pair.dest}`)).toContain("GMP-SEA");
    // Pairs a loaded program monitors keep their own states.
    expect(res.grid.cells.flat().some((c) => c.status === "ok")).toBe(true);
    expect(res.grid.cells.flat().some((c) => c.status === "none")).toBe(true);
    // one search page + one Get Routes per program (the failed one included; seats.aero charged for it)
    expect(fetch.calls).toHaveLength(1 + SYNTHETIC_PROGRAMS.length);
    expect(res.grid.meta.api_calls_used).toBe(1 + SYNTHETIC_PROGRAMS.length);
    expect(JSON.stringify(res)).not.toContain(ALICE_KEY);
    // With one route list missing the header cannot claim a monitoring count.
    expect(res.programs_by_pair).toBeNull();
    expect(res.programs_checked).toBe(SYNTHETIC_PROGRAMS.length);
  });

  it("the cached grid after that failure still marks the unresolved pair not fetched (generic reason, zero calls)", async () => {
    const { db, fetch } = failingHarness(500);
    await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    const calls = fetch.calls.length;
    // A new request builds a fresh catalog: the failure is not stored, only the loaded lists are.
    const again = await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    expect(fetch.calls).toHaveLength(calls);
    expect(again.grid.meta.served_from_cache).toBe(true);
    expect(again.programs_failed).toEqual([]);
    expect(again.grid.meta.unmonitored_pairs).toEqual([]);
    const gmp = again.grid.cells.flat().filter((c) => c.origin === "GMP");
    expect(gmp.length).toBeGreaterThan(0);
    expect(gmp.every((c) => c.status === "not_fetched" && c.reason === NOT_FETCHED_REASON.truncated)).toBe(true);
    expect(again.programs_by_pair).toBeNull();
  });

  it("a key rejection on a route list still fails the request", async () => {
    const { db, fetch } = failingHarness(401);
    await expect(findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER })).rejects.toBeInstanceOf(SeatsAeroHttpError);
  });
});
