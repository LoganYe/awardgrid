/**
 * TEST-ONLY transports the fixture host hands to bootstrap() in place of the native adapters.
 *
 * They sit exactly where createNativeFetch() sits in production: below bootstrap's rate-limit observer and
 * below Ask's budget guard, which still see https://seats.aero/partnerapi/ URLs. So the app's own planner,
 * quota, cache and normalisation run unchanged; only the bytes are synthetic. Nothing here opens a socket.
 */
import type { FixtureRequestLog } from "./protocol";
import type { SyntheticRoute, SyntheticRow } from "./scenarios";

const SEATS_PREFIX = "https://seats.aero/partnerapi/";
const CABINS = ["Y", "W", "J", "F"] as const;
const CABIN_BY_NAME: Record<string, (typeof CABINS)[number]> = { economy: "Y", premium: "W", business: "J", first: "F" };

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A comma list or repeated params, as the core client's encoder may send either. */
function list(params: URLSearchParams, name: string): string[] {
  return params
    .getAll(name)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

/** One seats.aero Availability per (program, source id, date), with every cabin's fields present. */
function toAvailability(group: SyntheticRow[]): Record<string, unknown> {
  const base = group[0]!;
  const routeId = `${base.program}-${base.origin}-${base.dest}`;
  const out: Record<string, unknown> = {
    ID: base.source_id,
    RouteID: routeId,
    Route: {
      ID: routeId,
      OriginAirport: base.origin,
      OriginRegion: "Asia",
      DestinationAirport: base.dest,
      DestinationRegion: "North America",
      Source: base.program,
    },
    Date: base.date,
    ParsedDate: `${base.date}T00:00:00Z`,
    Source: base.program,
    TaxesCurrency: group.find((r) => r.currency)?.currency ?? "",
  };
  // Only the timestamp the synthetic data actually has. CreatedAt/UpdatedAt are left out rather than invented:
  // core falls back to UpdatedAt as a provider time, so making one up would hide a "provider time missing" case.
  if (base.computed_last_seen !== null) out.ComputedLastSeen = base.computed_last_seen;
  for (const cabin of CABINS) {
    out[`${cabin}Available`] = false;
    out[`${cabin}MileageCost`] = "0";
    out[`${cabin}RemainingSeats`] = 0;
    out[`${cabin}Airlines`] = "";
    out[`${cabin}Direct`] = false;
    out[`${cabin}TotalTaxes`] = null;
  }
  for (const row of group) {
    out[`${row.cabin}Available`] = true;
    out[`${row.cabin}MileageCost`] = String(row.miles);
    out[`${row.cabin}RemainingSeats`] = row.seats_left;
    out[`${row.cabin}Airlines`] = row.airlines.join(", ");
    out[`${row.cabin}Direct`] = row.direct;
    out[`${row.cabin}TotalTaxes`] = row.fees_cents;
  }
  return out;
}

function availabilities(rows: SyntheticRow[]): Record<string, unknown>[] {
  const groups = new Map<string, SyntheticRow[]>();
  for (const row of rows) {
    const key = `${row.program}|${row.source_id}|${row.date}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(toAvailability);
}

function matchesSearch(row: SyntheticRow, params: URLSearchParams): boolean {
  const origins = list(params, "origin_airport");
  const dests = list(params, "destination_airport");
  const sources = [...list(params, "sources"), ...list(params, "source")];
  const cabins = [...list(params, "cabins"), ...list(params, "cabin")].map((name) => CABIN_BY_NAME[name] ?? name);
  const from = params.get("start_date");
  const to = params.get("end_date");
  if (origins.length && !origins.includes(row.origin)) return false;
  if (dests.length && !dests.includes(row.dest)) return false;
  if (sources.length && !sources.includes(row.program)) return false;
  if (cabins.length && !cabins.includes(row.cabin as (typeof CABINS)[number])) return false;
  if (from && row.date < from) return false;
  if (to && row.date > to) return false;
  if (params.get("only_direct_flights") === "true" && !row.direct) return false;
  return true;
}

/**
 * A seats.aero Partner API stand-in. Search and Bulk Availability answer from `rows`; Get Routes lists `routes`
 * (a pair it omits is unmonitored); Get Trips answers 404 until a task adds synthetic itineraries (plan 02 T10).
 * A request without the Partner-Authorization header gets 401, as the real API and scripts/mock-seatsaero.ts do.
 */
export function syntheticSeatsFetch(
  rows: readonly SyntheticRow[],
  routes: readonly SyntheticRoute[],
  log: FixtureRequestLog,
  searchMode: "answer" | "hold" | "fail" = "answer",
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (!url.startsWith(SEATS_PREFIX)) throw new Error(`The synthetic seats.aero transport only answers ${SEATS_PREFIX}…`);
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/partnerapi\//, "");
    log.seats += 1;
    log.seatsPaths.push(`${init?.method ?? "GET"} ${path}`);
    if (path.startsWith("trips/")) log.trips += 1;

    const headers = new Headers(init?.headers);
    if (!headers.get("partner-authorization")) return json({}, 401);

    if (path === "search" || path === "availability") {
      // inflight-old: the request stays open, as a slow network would keep it. failed-old: the provider errors.
      if (searchMode === "hold") return new Promise<Response>(() => {});
      if (searchMode === "fail") return json({ error: "synthetic outage" }, 500);
      const data = availabilities(rows.filter((row) => matchesSearch(row, parsed.searchParams)));
      return json({ data, count: data.length, hasMore: false, cursor: 1_700_000_000 });
    }
    if (path === "routes") {
      const source = parsed.searchParams.get("source");
      return json(
        routes
          .filter((route) => route.program === source)
          .map((route) => ({
            ID: `${route.program}-${route.origin}-${route.dest}`,
            OriginAirport: route.origin,
            OriginRegion: "Asia",
            DestinationAirport: route.dest,
            DestinationRegion: "North America",
            NumDaysOut: 330,
            Distance: 6480,
            Source: route.program,
          })),
      );
    }
    return json({}, 404);
  }) as typeof fetch;
}

export class FixtureAnthropicRefusedError extends Error {
  constructor() {
    super("This fixture scenario gives the app no Anthropic transport; nothing was sent.");
    this.name = "FixtureAnthropicRefusedError";
  }
}

/** Counts and refuses every Anthropic request. AI scenarios replace it with a scripted transport (plan 03 T15). */
export function refusingAnthropicFetch(log: FixtureRequestLog): typeof fetch {
  return (async () => {
    log.anthropic += 1;
    throw new FixtureAnthropicRefusedError();
  }) as typeof fetch;
}
