/**
 * Local mock of the seats.aero Partner API for development, demos and the e2e suite — serves
 * fixtures so the whole app can be tried without a real key or a single quota call.
 *
 *   pnpm mock:seats                                   # recorded synthetic fixture, 127.0.0.1:3999
 *   pnpm demo                                         # DEMO=1: fixtures/demo (Phase 6 §7 dataset)
 *   pnpm exec tsx scripts/mock-seatsaero.ts --demo    # same as DEMO=1
 *   SEATS_AERO_BASE_URL=http://127.0.0.1:3999/partnerapi/ pnpm dev
 *
 * Any non-empty Partner-Authorization header is accepted (so seeded fake keys "work"). Dates in
 * the fixture are shifted so that the fixture's first date == today, making "next month"
 * queries land on data. Endpoints: /partnerapi/search, /availability, /trips/{id}, /routes.
 * GET /healthz answers 200 without a key (liveness probe for the Playwright webServer check).
 *
 * DEMO mode additionally routes SCENARIOS by the header VALUE (see DEMO_KEYS), so an e2e
 * harness seeds users with different fake keys and never touches the app:
 *   demo-key-normal   full dataset (as does any other non-empty value)
 *   demo-key-empty    /search and /availability answer 200 with no rows
 *   demo-key-error    /search answers HTTP 500 {}
 *   demo-key-invalid  every endpoint answers HTTP 401 {} (a key seats.aero rejects)
 *   demo-key-slow     normal, but every response is delayed 1 500 ms (loading screenshots)
 *   demo-key-partial  /search omits every "aeroplan" row; /routes?source=aeroplan (and
 *                     /availability?source=aeroplan) answer 500 — "one program not fetched"
 * Rows flagged `_demo_dynamic` are served only when include_filtered=true. `UpdatedAt` is
 * rebuilt at serve time from `_demo_updated_minutes_ago` so freshness is always relative to now.
 *
 * Never use this in production; it is not reachable from the image. Logs one line per request
 * and never prints header values.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEMO_KEYS = {
  normal: "demo-key-normal",
  empty: "demo-key-empty",
  error: "demo-key-error",
  invalid: "demo-key-invalid",
  slow: "demo-key-slow",
  partial: "demo-key-partial",
} as const;
export type DemoScenario = keyof typeof DEMO_KEYS;
/** The program the "partial" scenario pretends was not fetched. */
export const DEMO_PARTIAL_PROGRAM = "aeroplan";
export const DEMO_SLOW_MS = 1500;
export const DEFAULT_PORT = 3999;

export interface MockOptions {
  /** Serve fixtures/demo with scenario routing instead of the recorded synthetic fixture. */
  demo?: boolean;
  /** 0 (default) picks an ephemeral port; the CLI uses MOCK_SEATS_PORT or 3999. */
  port?: number;
  host?: string;
  /** Delay for the "slow" scenario; tests may shorten it. */
  slowMs?: number;
  /** Clock, injectable for tests. */
  now?: () => Date;
  /** One line per request; defaults to console.log. Pass () => {} to silence. */
  log?: (line: string) => void;
}
export interface MockHandle {
  server: Server;
  port: number;
  /** e.g. http://127.0.0.1:3999/partnerapi/ — the value for SEATS_AERO_BASE_URL. */
  baseUrl: string;
  demo: boolean;
  shiftDays: number;
  rowCount: number;
  close(): Promise<void>;
}

type Row = Record<string, unknown> & {
  ID: string;
  Date: string;
  Source: string;
  Route: { ID: string; OriginAirport: string; DestinationAirport: string };
  _demo_dynamic?: boolean;
  _demo_updated_minutes_ago?: number;
};
type Json = Record<string, unknown>;

const root = path.resolve(import.meta.dirname, "..");
const readJson = (...segments: string[]) => JSON.parse(readFileSync(path.join(root, ...segments), "utf8"));
const dayMs = 86_400_000;

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
function list(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}
/** Shift the YYYY-MM-DD prefix of an ISO date or date-time by n days, keeping the time part. */
function shiftIso(value: string, days: number): string {
  const date = value.slice(0, 10);
  const rest = value.slice(10);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10) + rest;
}

interface Dataset {
  rows: Row[];
  shiftDays: number;
  trips: (id: string, now: Date) => Json | undefined;
  routes: (source: string | null) => unknown[];
}

function loadSynthetic(now: Date): Dataset {
  const synthetic = readJson("packages/core/test/fixtures/seatsaero", "synthetic-example-query.json") as { data: Row[] };
  const tripsFixture = readJson("packages/core/test/fixtures/seatsaero", "trips__id.json") as { data: Json[] };
  const todayIso = now.toISOString().slice(0, 10);
  const firstFixtureDate = [...new Set(synthetic.data.map((r) => String(r.Date)))].sort()[0]!;
  const shiftDays = Math.round((Date.parse(todayIso) - Date.parse(firstFixtureDate)) / dayMs);
  const nowIso = now.toISOString();
  const rows: Row[] = synthetic.data.map((r) => ({
    ...r,
    Date: shiftIso(String(r.Date), shiftDays),
    ParsedDate: `${shiftIso(String(r.Date), shiftDays)}T00:00:00Z`,
    // keep freshness spread realistic: 30 min .. 8 h before now
    UpdatedAt: new Date(now.getTime() - (30 + (hash(String(r.ID)) % 450)) * 60_000).toISOString(),
    CreatedAt: nowIso,
  }));
  return {
    rows,
    shiftDays,
    trips(id) {
      const row = rows.find((r) => r.ID === id);
      if (!row) return undefined;
      const route = row.Route;
      const data = tripsFixture.data.map((t, i) => ({
        ...t,
        AvailabilityID: id,
        Source: row.Source,
        Cabin: "first",
        MileageCost: Number(row.FMileageCost ?? row.JMileageCost ?? 70000) + i * 5000,
        RemainingSeats: Number(row.FRemainingSeats ?? 1),
        DepartsAt: `${row.Date}T13:00:00Z`,
        ArrivesAt: `${row.Date}T22:00:00Z`,
        AvailabilitySegments: [
          { ...(t.AvailabilitySegments as Json[])[0], OriginAirport: route.OriginAirport, DestinationAirport: route.DestinationAirport, FlightNumber: "XX123", DepartsAt: `${row.Date}T13:00:00Z`, ArrivesAt: `${row.Date}T22:00:00Z`, Order: 0 },
        ],
        Stops: 0,
        FlightNumbers: "XX123",
        Carriers: String(row.FAirlines ?? row.JAirlines ?? "XX").split(",")[0]?.trim() ?? "XX",
      }));
      return { data, booking_links: [{ label: `Book via ${row.Source}`, link: "https://example.com/mock-booking", primary: true }] };
    },
    routes(source) {
      const seen = new Map<string, unknown>();
      for (const r of rows) {
        if (source && r.Source !== source) continue;
        seen.set(r.Route.ID, r.Route);
      }
      return [...seen.values()];
    },
  };
}

function loadDemo(now: Date): Dataset {
  const availability = readJson("fixtures/demo", "availability.json") as { _anchor: string; data: Row[] };
  const tripsById = readJson("fixtures/demo", "trips.json") as Record<string, { data: Json[]; booking_links: unknown[] } & Json>;
  const routesBySource = readJson("fixtures/demo", "routes.json") as Record<string, unknown[]>;
  const todayIso = now.toISOString().slice(0, 10);
  const shiftDays = Math.round((Date.parse(todayIso) - Date.parse(availability._anchor)) / dayMs);
  const rows: Row[] = availability.data.map((r) => ({
    ...r,
    Date: shiftIso(String(r.Date), shiftDays),
    ParsedDate: `${shiftIso(String(r.Date), shiftDays)}T00:00:00Z`,
    CreatedAt: shiftIso(String(r.CreatedAt), shiftDays),
  }));
  const shiftTimes = <T extends Json>(o: T, at: Date): T => ({
    ...o,
    DepartsAt: shiftIso(String(o.DepartsAt), shiftDays),
    ArrivesAt: shiftIso(String(o.ArrivesAt), shiftDays),
    CreatedAt: shiftIso(String(o.CreatedAt), shiftDays),
    UpdatedAt: at.toISOString(),
  });
  return {
    rows,
    shiftDays,
    trips(id, at) {
      const payload = tripsById[id];
      const row = rows.find((r) => r.ID === id);
      if (!payload || !row) return undefined;
      const updatedAt = new Date(at.getTime() - Number(row._demo_updated_minutes_ago ?? 60) * 60_000);
      return {
        ...payload,
        data: payload.data.map((t) => ({
          ...shiftTimes(t, updatedAt),
          AvailabilitySegments: ((t.AvailabilitySegments as Json[] | undefined) ?? []).map((s) => shiftTimes(s, updatedAt)),
        })),
      };
    },
    routes(source) {
      if (!source) return Object.values(routesBySource).flat();
      return routesBySource[source] ?? [];
    },
  };
}

function scenarioOf(auth: string, demo: boolean): DemoScenario {
  if (!demo) return "normal";
  const found = (Object.keys(DEMO_KEYS) as DemoScenario[]).find((k) => DEMO_KEYS[k] === auth);
  return found ?? "normal";
}

/** Build the request handler without binding a socket (createMockServer wraps it). */
export function createMockHandler(opts: MockOptions = {}): { handle: (req: IncomingMessage, res: ServerResponse) => void; dataset: Dataset; demo: boolean } {
  const demo = opts.demo ?? false;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((line: string) => console.log(line));
  const slowMs = opts.slowMs ?? DEMO_SLOW_MS;
  const dataset = demo ? loadDemo(now()) : loadSynthetic(now());
  // Freshness is relative to one instant per server, not per request: a row's UpdatedAt must be
  // identical in /search and in /trips/{id} (the app pairs them), which a per-request Date.now()
  // breaks by a few milliseconds.
  const startedAt = now();
  const { rows } = dataset;

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const p = url.pathname;
    const auth = String(req.headers["partner-authorization"] ?? "").trim();
    const scenario = scenarioOf(auth, demo);
    const send = (status: number, body: unknown) => {
      const finish = () => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
        log(`${req.method} ${p}${url.search} ${status} ${Date.now() - started}ms`);
      };
      if (scenario === "slow") setTimeout(finish, slowMs);
      else finish();
    };
    // Keyless liveness probe for harnesses (Playwright's webServer.url is a plain GET with no headers).
    if (p === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      return send(200, { ok: true, demo, rows: rows.length, shiftDays: dataset.shiftDays });
    }
    if (!auth) return send(401, {});
    // A key seats.aero rejects: 401 on every endpoint, which is what /api/keys reports as
    // "seats.aero rejected this key" when someone pastes a bad one (e2e/settings.spec.ts).
    if (scenario === "invalid") return send(401, {});
    const at = startedAt;
    const stamp = (r: Row): Row => (r._demo_updated_minutes_ago === undefined ? r : { ...r, UpdatedAt: new Date(at.getTime() - r._demo_updated_minutes_ago * 60_000).toISOString() });

    if (p === "/partnerapi/search" || p === "/partnerapi/availability") {
      const isSearch = p === "/partnerapi/search";
      const source = url.searchParams.get("source");
      if (scenario === "error" && isSearch) return send(500, {});
      if (scenario === "partial" && !isSearch && source === DEMO_PARTIAL_PROGRAM) return send(500, {});
      if (scenario === "empty") return send(200, { data: [], count: 0, hasMore: false, cursor: Math.floor(at.getTime() / 1000) });
      const origins = list(url.searchParams.get("origin_airport"));
      const dests = list(url.searchParams.get("destination_airport"));
      const sources = list(url.searchParams.get("sources")).map((s) => s.toLowerCase());
      const from = url.searchParams.get("start_date");
      const to = url.searchParams.get("end_date");
      const cabins = list(url.searchParams.get("cabins")).map((c) => c.toLowerCase());
      const cabin = url.searchParams.get("cabin");
      const direct = url.searchParams.get("only_direct_flights") === "true";
      const includeFiltered = url.searchParams.get("include_filtered") === "true";
      const take = Math.min(1000, Math.max(10, Number(url.searchParams.get("take") ?? 500)));
      const skip = Number(url.searchParams.get("skip") ?? 0);
      const letter: Record<string, string> = { economy: "Y", premium: "W", business: "J", first: "F" };
      const wanted = (cabin ? [cabin] : cabins).map((c) => letter[c]).filter(Boolean);
      const out = rows.filter((r) => {
        const route = r.Route;
        if (scenario === "partial" && isSearch && r.Source === DEMO_PARTIAL_PROGRAM) return false;
        if (r._demo_dynamic && !includeFiltered) return false;
        if (origins.length && !origins.includes(route.OriginAirport)) return false;
        if (dests.length && !dests.includes(route.DestinationAirport)) return false;
        if (source && r.Source !== source) return false;
        if (sources.length && !sources.includes(String(r.Source))) return false;
        if (from && String(r.Date) < from) return false;
        if (to && String(r.Date) > to) return false;
        if (wanted.length && !wanted.some((L) => r[`${L}Available`] === true && (!direct || r[`${L}Direct`] === true))) return false;
        return true;
      });
      const page = out.slice(skip, skip + take).map(stamp);
      return send(200, { data: page, count: page.length, hasMore: skip + take < out.length, cursor: 1700000000 });
    }
    if (p.startsWith("/partnerapi/trips/")) {
      const id = p.slice("/partnerapi/trips/".length);
      const payload = dataset.trips(id, at);
      return payload ? send(200, payload) : send(404, {});
    }
    if (p === "/partnerapi/routes") {
      const source = url.searchParams.get("source");
      if (scenario === "partial" && source === DEMO_PARTIAL_PROGRAM) return send(500, {});
      return send(200, dataset.routes(source));
    }
    send(404, {});
  };
  return { handle, dataset, demo };
}

/** Start the mock on `opts.port` (0 = ephemeral) and resolve once it is listening. */
export function createMockServer(opts: MockOptions = {}): Promise<MockHandle> {
  const { handle, dataset, demo } = createMockHandler(opts);
  const host = opts.host ?? "127.0.0.1";
  const server = createServer(handle);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
      resolve({
        server,
        port,
        baseUrl: `http://${host}:${port}/partnerapi/`,
        demo,
        shiftDays: dataset.shiftDays,
        rowCount: dataset.rows.length,
        close: () => new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      });
    });
  });
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const demo = process.env.DEMO === "1" || process.argv.includes("--demo");
  const port = Number(process.env.MOCK_SEATS_PORT ?? DEFAULT_PORT);
  createMockServer({ demo, port }).then((h) => {
    const source = demo ? "fixtures/demo (DEMO mode, scenario keys demo-key-normal|empty|error|invalid|slow|partial)" : "packages/core/test/fixtures/seatsaero/synthetic-example-query.json";
    console.log(`mock seats.aero on ${h.baseUrl} — ${source}; dates shifted by ${h.shiftDays} days; ${h.rowCount} rows`);
  });
}
