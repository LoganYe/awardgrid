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

const CABIN_NAME: Record<string, string> = { Y: "economy", W: "premium", J: "business", F: "first" };

function segment(id: string, n: number, flight: string, origin: string, dest: string, departs: string, arrives: string) {
  return { ID: `${id}-s${n}`, FlightNumber: flight, OriginAirport: origin, DestinationAirport: dest, DepartsAt: departs, ArrivesAt: arrives, AircraftName: "Synthetic 787", FareClass: "I", Order: n };
}

/**
 * Get Trips for one synthetic source id (T10): obviously synthetic itineraries — carrier "XX", flights "XX 1xx" —
 * for each cabin the rows hold. Times are airport-local with seats.aero's "Z" (not UTC): HKG 10:30 → SEA 07:40 the
 * same calendar day. The second option also has a one-stop itinerary with mixed cabins (MixedCabinPct 20: seats.aero's
 * share of the distance flown BELOW the cabin); the zero-fees option has none. Booking links are on the reserved
 * `.example` domain: the first option's primary link is its program's page, with another program's "Book via …" link
 * after it that the app must not use; the second option's primary link is an unsafe `javascript:` one the app must
 * refuse, leaving it no way out but "Copy search details".
 */
function trips(rows: readonly SyntheticRow[], id: string): Record<string, unknown> {
  const mine = rows.filter((r) => r.source_id === id);
  if (mine.length === 0 || id.endsWith("zero-fees")) return { data: [], booking_links: [] };
  const data = mine.flatMap((row, i) => {
    const base = {
      AvailabilityID: id,
      Cabin: CABIN_NAME[row.cabin],
      MileageCost: row.miles,
      TotalTaxes: row.fees_cents ?? 5840,
      TaxesCurrency: row.currency ?? "USD",
      RemainingSeats: row.seats_left,
      Source: row.program,
    };
    const nonstop = {
      ...base,
      ID: `${id}-${row.cabin}-1`,
      Stops: 0,
      Carriers: "XX",
      FlightNumbers: `XX ${120 + i}`,
      DepartsAt: `${row.date}T10:30:00Z`,
      ArrivesAt: `${row.date}T07:40:00Z`,
      TotalDuration: 730,
      AvailabilitySegments: [segment(`${id}-${row.cabin}-1`, 0, `XX ${120 + i}`, row.origin, row.dest, `${row.date}T10:30:00Z`, `${row.date}T07:40:00Z`)],
    };
    if (!id.endsWith("second")) return [nonstop];
    const oneStop = {
      ...base,
      ID: `${id}-${row.cabin}-2`,
      MileageCost: row.miles + 5000,
      Stops: 1,
      Carriers: "XX",
      FlightNumbers: "XX 150, XX 151",
      DepartsAt: `${row.date}T08:05:00Z`,
      ArrivesAt: `${row.date}T09:55:00Z`,
      TotalDuration: 890,
      MixedCabinPct: 20,
      AvailabilitySegments: [
        segment(`${id}-${row.cabin}-2`, 0, "XX 150", row.origin, "TPE", `${row.date}T08:05:00Z`, `${row.date}T09:55:00Z`),
        segment(`${id}-${row.cabin}-2`, 1, "XX 151", "TPE", row.dest, `${row.date}T12:20:00Z`, `${row.date}T09:55:00Z`),
      ],
    };
    return [nonstop, oneStop];
  });
  const other = { label: "Book via another program", link: "https://united.example/other-program-synthetic", primary: false };
  return {
    data,
    booking_links: id.endsWith("second")
      ? [{ label: "Synthetic unsafe link", link: "javascript:alert(1)", primary: true }, other]
      : [{ label: "Synthetic program page", link: `https://${mine[0]!.program}.example/redeem-synthetic`, primary: true }, other],
  };
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
 * (a pair it omits is unmonitored); Get Trips answers from `trips` below (T10), and fails with the search in
 * failed-old.
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
    // A key the stand-in refuses, as seats.aero refuses a wrong or non-Pro key (T11's key check).
    if (headers.get("partner-authorization") === "fixture-invalid-key") return json({ error: "invalid key" }, 401);

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
    if (path.startsWith("trips/")) {
      if (searchMode === "fail") return json({ error: "synthetic outage" }, 500);
      return json(trips(rows, decodeURIComponent(path.slice("trips/".length))));
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

const ANSWER_DELAY_MS = 400;

/** The one answer the scripted Anthropic gives: synthetic, and about the attached results only by their names. */
export const FIXTURE_AI_ANSWER = "R1 needs fewer miles than R2. Confirm on the program's own site before transferring points.";

/**
 * A scripted Anthropic for `ai=1` (plan 03 T15): every request is counted, its context's shape recorded (never its
 * text, key or headers), and answered with one short synthetic text, streamed as the Messages API streams. Nothing
 * leaves the page.
 */
export function scriptedAnthropicFetch(log: FixtureRequestLog): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    log.anthropic += 1;
    const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
    const context = contextOf(body);
    if (context) log.anthropicContext.push(context);
    // A moment, as a real answer takes: long enough for a test to scroll or leave while it is out.
    await new Promise((resolve) => setTimeout(resolve, ANSWER_DELAY_MS));
    return new Response(sseAnswer(FIXTURE_AI_ANSWER), { status: 200, headers: { "content-type": "text/event-stream", "request-id": `req_fixture_${log.anthropic}` } });
  }) as typeof fetch;
}

/** The shape of a question's context, from its last user turn; null for a request that is not a question (a key check). */
function contextOf(body: string): FixtureRequestLog["anthropicContext"][number] | null {
  let parsed: { messages?: Array<{ role: string; content: unknown }> };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return null;
  }
  const messages = parsed.messages ?? [];
  const last = messages[messages.length - 1];
  const first = Array.isArray(last?.content) ? (last.content[0] as { type?: string; text?: string } | undefined) : undefined;
  if (last?.role !== "user" || first?.type !== "text" || !first.text?.startsWith("Context from awardgrid")) return null;
  const text = first.text;
  return {
    search: text.includes("The person's last search"),
    attached: [...text.matchAll(/"ref":"(R\d+)"/g)].map((m) => m[1]!),
    // Questions, not turns: a tool round's user turn of results is not a question.
    earlier: messages.filter((m) => m.role === "user" && (typeof m.content === "string" || (Array.isArray(m.content) && (m.content[0] as { type?: string } | undefined)?.type === "text"))).length - 1,
    partial: text.includes("are incomplete"),
  };
}

function sseAnswer(text: string): string {
  const usage = { input_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 24 };
  const events: Array<Record<string, unknown>> = [
    {
      type: "message_start",
      message: { id: "msg_fixture", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
    { type: "message_stop" },
  ];
  return events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}
