import { describe, expect, it } from "vitest";
import {
  SeatsAeroClient,
  SeatsAeroHttpError,
  SeatsAeroNetworkError,
  SeatsAeroResponseError,
  bulkAvailabilityQuery,
  cachedSearchQuery,
  encodeQuery,
  getTripsQuery,
  paginate,
  type SeatsAeroCallInfo,
} from "@/lib/seatsaero/client";
import { RoutesResponse, SearchResponse, TripsResponse, type Availability } from "@/lib/seatsaero/types";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";

const KEY = "pro_test_key_ABC123xyz_DO_NOT_LEAK";
const search = loadFixture<SearchResponse>("search.json");

function availability(id: string, overrides: Partial<Availability> = {}): Availability {
  return { ...search.data[0]!, ID: id, ...overrides };
}

describe("query-string encoding", () => {
  it("uses the documented names, comma-joins arrays, encodes booleans, omits undefined", () => {
    const qs = cachedSearchQuery({
      origin_airport: ["HKG", "PVG"],
      destination_airport: ["SEA"],
      start_date: "2026-10-01",
      end_date: "2026-10-30",
      take: 1000,
      order_by: "lowest_mileage",
      only_direct_flights: true,
      include_trips: false,
      sources: ["american", "alaska"],
      cabins: ["business", "first"],
      carriers: undefined,
      min_cabin_pct: 75,
    });
    expect(qs).toBe(
      "origin_airport=HKG,PVG&destination_airport=SEA&start_date=2026-10-01&end_date=2026-10-30" +
        "&take=1000&order_by=lowest_mileage&include_trips=false&only_direct_flights=true" +
        "&sources=american,alaska&cabins=business,first&min_cabin_pct=75",
    );
    expect(qs).not.toContain("carriers");
    expect(qs).not.toContain("cabin=");
  });

  it("encodes cursor and skip for pagination", () => {
    const qs = cachedSearchQuery({
      origin_airport: ["SFO"],
      destination_airport: ["JFK"],
      cursor: 1689009958,
      skip: 1000,
      take: 1000,
    });
    expect(qs).toBe("origin_airport=SFO&destination_airport=JFK&cursor=1689009958&take=1000&skip=1000");
  });

  it("bulk availability uses singular `cabin` and percent-encodes region names", () => {
    const qs = bulkAvailabilityQuery({
      source: "united",
      cabin: "business",
      start_date: "2026-08-01",
      end_date: "2026-09-30",
      origin_region: "North America",
      destination_region: "Europe",
      take: 500,
      include_filtered: true,
    });
    expect(qs).toBe(
      "source=united&cabin=business&start_date=2026-08-01&end_date=2026-09-30" +
        "&origin_region=North%20America&destination_region=Europe&take=500&include_filtered=true",
    );
    expect(qs).not.toContain("cabins=");
  });

  it("drops empty arrays entirely", () => {
    expect(encodeQuery({ sources: [], a: "1" })).toBe("a=1");
  });

  it("clamps `take` to the documented 10..1000 range on every endpoint and omits it when unset", () => {
    const base = { origin_airport: ["SFO"], destination_airport: ["JFK"] };
    expect(cachedSearchQuery({ ...base, take: 5000 })).toContain("take=1000");
    expect(cachedSearchQuery({ ...base, take: 1 })).toContain("take=10");
    expect(cachedSearchQuery({ ...base, take: 250.7 })).toContain("take=250");
    expect(cachedSearchQuery(base)).not.toContain("take=");
    expect(bulkAvailabilityQuery({ source: "united", take: 99999 })).toBe("source=united&take=1000");
    expect(bulkAvailabilityQuery({ source: "united" })).toBe("source=united");
    expect(getTripsQuery({ include_filtered: true, min_cabin_pct: 75 })).toBe("include_filtered=true&min_cabin_pct=75");
    expect(getTripsQuery({})).toBe("");
  });
});

describe("SeatsAeroClient transport", () => {
  it("sends Partner-Authorization (no Bearer) to the documented base URL and reports the call", async () => {
    const fetch = fakeFetch(() => jsonResponse(search));
    const calls: SeatsAeroCallInfo[] = [];
    const client = new SeatsAeroClient({ apiKey: KEY, fetch, onCall: (i) => calls.push(i) });
    const res = await client.cachedSearch({ origin_airport: ["SFO"], destination_airport: ["JFK"] });
    expect(res.data).toHaveLength(42);
    expect(fetch.calls[0]!.url.href).toBe("https://seats.aero/partnerapi/search?origin_airport=SFO&destination_airport=JFK");
    expect(fetch.calls[0]!.headers["partner-authorization"]).toBe(KEY);
    // Partner-Authorization is the only documented request header; nothing else is sent (§0.2 #7).
    expect(Object.keys(fetch.calls[0]!.headers)).toEqual(["partner-authorization"]);
    expect(calls).toEqual([expect.objectContaining({ endpoint: "search", status: 200 })]);
    expect(JSON.stringify(calls)).not.toContain(KEY);
  });

  it("validates the official fixtures against the zod schemas", async () => {
    expect(SearchResponse.safeParse(search).success).toBe(true);
    expect(TripsResponse.safeParse(loadFixture("trips__id.json")).success).toBe(true);
    expect(RoutesResponse.safeParse(loadFixture("routes.json")).success).toBe(true);

    const fetch = fakeFetch((req) => {
      if (req.url.pathname.startsWith("/partnerapi/trips/")) return jsonResponse(loadFixture("trips__id.json"));
      if (req.url.pathname === "/partnerapi/routes") return jsonResponse(loadFixture("routes.json"));
      return jsonResponse(search);
    });
    const client = new SeatsAeroClient({ apiKey: KEY, fetch });
    const trips = await client.getTrips("2PPrELk9WcfJaNREWEPXypvhXAD", { include_filtered: true });
    expect(trips.data).toHaveLength(3);
    expect(trips.booking_links.find((l) => l.primary)?.link).toBe("https://www.lifemiles.com/fly/find");
    expect(fetch.calls[0]!.url.href).toBe(
      "https://seats.aero/partnerapi/trips/2PPrELk9WcfJaNREWEPXypvhXAD?include_filtered=true",
    );
    const routes = await client.getRoutes("aeroplan");
    expect(routes[0]?.OriginAirport).toBe("TPE");
    expect(fetch.calls[1]!.url.href).toBe("https://seats.aero/partnerapi/routes?source=aeroplan");
  });

  it("paginates with cursor + skip, dedupes by ID and reports pages", async () => {
    const page1 = { data: [availability("a"), availability("b")], count: 3, hasMore: true, cursor: 1689009958 };
    const page2 = { data: [availability("b"), availability("c")], count: 3, hasMore: false, cursor: 1689009958 };
    const fetch = fakeFetch((_req, i) => jsonResponse(i === 0 ? page1 : page2));
    const client = new SeatsAeroClient({ apiKey: KEY, fetch });
    const res = await client.cachedSearchAll({ origin_airport: ["SFO"], destination_airport: ["JFK"] });
    expect(res.pages).toBe(2);
    expect(res.truncated).toBe(false);
    expect(res.data.map((a) => a.ID)).toEqual(["a", "b", "c"]);
    const first = fetch.calls[0]!.url.searchParams;
    const second = fetch.calls[1]!.url.searchParams;
    expect(first.get("take")).toBe("1000");
    expect(first.has("cursor")).toBe(false);
    expect(first.has("skip")).toBe(false);
    expect(second.get("cursor")).toBe("1689009958");
    expect(second.get("skip")).toBe("2");
  });

  it("stops at maxPages and flags truncation", async () => {
    const fetch = fakeFetch((_req, i) =>
      jsonResponse({ data: [availability(`id${i}`)], hasMore: true, cursor: 1 }),
    );
    const client = new SeatsAeroClient({ apiKey: KEY, fetch });
    const res = await client.cachedSearchAll({ origin_airport: ["SFO"], destination_airport: ["JFK"] }, { maxPages: 3 });
    expect(res.pages).toBe(3);
    expect(res.truncated).toBe(true);
    expect(fetch.calls).toHaveLength(3);
  });

  it("bulk availability accepts the envelope or a bare array", async () => {
    const fetch = fakeFetch((_req, i) => jsonResponse(i === 0 ? [availability("x")] : { data: [availability("y")], hasMore: false }));
    const client = new SeatsAeroClient({ apiKey: KEY, fetch });
    const bare = await client.bulkAvailability({ source: "alaska", take: 10 });
    expect(bare.data.map((a) => a.ID)).toEqual(["x"]);
    expect(bare.hasMore).toBe(false);
    const enveloped = await client.bulkAvailability({ source: "alaska" });
    expect(enveloped.data.map((a) => a.ID)).toEqual(["y"]);
    expect(fetch.calls[0]!.url.searchParams.get("source")).toBe("alaska");
  });

  it("paginate() handles a bare-array page stream via skip only", async () => {
    let n = 0;
    const res = await paginate(5, async (_cursor, skip) => {
      n += 1;
      return { data: skip < 2 ? [availability(`k${skip}`), availability(`k${skip + 1}`)] : [], hasMore: skip < 2, cursor: undefined };
    });
    expect(n).toBe(2);
    expect(res.data).toHaveLength(2);
  });
});

describe("SeatsAeroClient errors", () => {
  it("maps 401/403 to invalid key, 429 to rate limited, 5xx to unavailable", async () => {
    for (const [status, kind, text] of [
      [401, "invalid_key", "invalid key"],
      [403, "invalid_key", "invalid key"],
      [429, "rate_limited", "rate limited"],
      [503, "unavailable", "seats.aero unavailable"],
    ] as const) {
      const client = new SeatsAeroClient({ apiKey: KEY, fetch: fakeFetch(() => textResponse("nope", status)) });
      const err = await client.getRoutes("united").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SeatsAeroHttpError);
      expect((err as SeatsAeroHttpError).status).toBe(status);
      expect((err as SeatsAeroHttpError).kind).toBe(kind);
      expect((err as Error).message).toContain(text);
    }
  });

  it("truncates the body snippet to 200 characters", async () => {
    const client = new SeatsAeroClient({ apiKey: KEY, fetch: fakeFetch(() => textResponse("x".repeat(1000), 500)) });
    const err = (await client.getRoutes("united").catch((e: unknown) => e)) as SeatsAeroHttpError;
    expect(err.bodySnippet).toHaveLength(200);
  });

  it("throws SeatsAeroResponseError with the zod path on a malformed payload", async () => {
    const bad = { data: [{ ...availability("z"), Route: { ID: 1 } }] };
    const client = new SeatsAeroClient({ apiKey: KEY, fetch: fakeFetch(() => jsonResponse(bad)) });
    const err = await client.cachedSearch({ origin_airport: ["SFO"], destination_airport: ["JFK"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeatsAeroResponseError);
    expect((err as SeatsAeroResponseError).path).toBe("data.0.Route.ID");
  });

  it("never leaks an OAuth access token either, even when the upstream echoes only the token", async () => {
    const token = "seats:ota:31cDaqd4jLYjeozSECRET";
    const fetch = fakeFetch(() => textResponse(`token ${token} is not valid`, 401));
    const client = new SeatsAeroClient({ apiKey: `Bearer ${token}`, fetch });
    const err = await client.getRoutes("united").catch((e: unknown) => e);
    expect(fetch.calls[0]!.headers["partner-authorization"]).toBe(`Bearer ${token}`);
    expect(String(err)).not.toContain(token);
    expect((err as SeatsAeroHttpError).bodySnippet).toBe("token [redacted] is not valid");
  });

  it("never leaks the key — even when the upstream echoes it", async () => {
    const fetch = fakeFetch(() => textResponse(`forbidden for key ${KEY}`, 403));
    const client = new SeatsAeroClient({ apiKey: KEY, fetch });
    const err = await client.getRoutes("united").catch((e: unknown) => e);
    expect(String(err)).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(JSON.stringify(Object.getOwnPropertyNames(err))).not.toContain("apiKey");
    expect((err as SeatsAeroHttpError).bodySnippet).toContain("[redacted]");
    expect(JSON.stringify(client)).not.toContain(KEY);

    const netFetch = fakeFetch(() => {
      throw new Error(`ECONNRESET while sending ${KEY}`);
    });
    const err2 = await new SeatsAeroClient({ apiKey: KEY, fetch: netFetch }).getRoutes("united").catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(SeatsAeroNetworkError);
    expect(String(err2)).not.toContain(KEY);
  });

  it("times out via AbortSignal", async () => {
    const fetch = fakeFetch((_req) => new Promise<Response>(() => undefined));
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const p = fetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        void p;
      });
    }) as typeof fetch;
    const client = new SeatsAeroClient({ apiKey: KEY, fetch: slow, timeoutMs: 10 });
    const err = await client.getRoutes("united").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeatsAeroNetworkError);
    expect((err as SeatsAeroNetworkError).timedOut).toBe(true);
  });

  it("refuses to construct without a key (no default key exists)", () => {
    expect(() => new SeatsAeroClient({ apiKey: "" })).toThrow(/API key is required/);
  });
});
