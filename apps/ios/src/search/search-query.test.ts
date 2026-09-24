/**
 * The structured entry (UI/UX v1 plan 01 T05; acceptance A09): `searchQuery(query, key)` and `search(text, key)` run
 * the same executor against the same quota and cache, and neither sends anything but seats.aero requests.
 */
import { describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { QueryObject } from "@awardgrid/core/query/schema";
import { DeviceQuotaStore } from "../store/quota-store";
import { SearchEngine } from "./search";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const KEY = "pro_test_key_ABC123xyz_DO_NOT_LEAK";
const TEXT = "HKG to SEA next 30 days business";

function availability(date: string) {
  return {
    ID: `id-${date}`,
    RouteID: "r1",
    Route: { ID: "r1", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "alaska" },
    Date: date,
    ParsedDate: `${date}T00:00:00Z`,
    Source: "alaska",
    JAvailable: true,
    JMileageCost: "80000",
    JRemainingSeats: 2,
    JAirlines: "AS",
    JDirect: true,
    YAvailable: false,
    WAvailable: false,
    FAvailable: false,
  };
}

/** A fake seats.aero that records every URL it is asked for. */
function seatsAero() {
  const urls: string[] = [];
  const fetchImpl = fakeFetch((req) => {
    urls.push(req.url.href);
    return req.url.pathname.endsWith("/routes") ? jsonResponse([]) : jsonResponse({ data: [availability("2026-10-05")], hasMore: false });
  });
  return { fetchImpl, urls };
}

function engine(fetchImpl: typeof fetch) {
  return new SearchEngine({ fetchImpl, quota: new Quota({ store: new DeviceQuotaStore(), now: () => NOW }), now: () => NOW });
}

/** The query the text parses to, so the two entries can be compared on the same scope. */
async function parsedQuery(e: SearchEngine): Promise<QueryObject> {
  const parsed = await e.parseText(TEXT, KEY);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value.query;
}

describe("SearchEngine.searchQuery", () => {
  it("answers the same as the text entry for the same query, from the same cache and quota", async () => {
    const { fetchImpl, urls } = seatsAero();
    const e = engine(fetchImpl);
    const query = await parsedQuery(e);
    expect(urls).toHaveLength(0); // parsing sends nothing

    const byText = await e.search(TEXT, KEY);
    expect(byText.ok).toBe(true);
    const callsAfterText = urls.length;
    expect(callsAfterText).toBeGreaterThan(0);
    const usedAfterText = (await e.quotaView()).used;

    const byQuery = await e.searchQuery(query, KEY);
    expect(byQuery.ok).toBe(true);
    if (!byText.ok || !byQuery.ok) return;
    // Same executor, same cache: the structured run is a cache hit, no request, no quota spent.
    expect(urls).toHaveLength(callsAfterText);
    expect(byQuery.value.served_from_cache).toBe(true);
    expect(byQuery.value.api_calls_used).toBe(0);
    expect((await e.quotaView()).used).toBe(usedAfterText);
    // Same answer: rows, grid and coverage scope.
    expect(byQuery.value.rows).toEqual(byText.value.rows);
    // The grid's generated_at is buildGrid's own wall-clock stamp (it is not given the injected clock), so it is
    // the one field that may differ by a millisecond between two builds.
    const unstamped = (g: typeof byText.value.grid) => ({ ...g, meta: { ...g.meta, generated_at: null } });
    expect(unstamped(byQuery.value.grid)).toEqual(unstamped(byText.value.grid));
    expect(byQuery.value.coverage?.scopeKey).toBe(byText.value.coverage?.scopeKey);
    expect(byQuery.value.query).toEqual(byText.value.query);
  });

  it("the text entry reads the cache the structured entry filled", async () => {
    const { fetchImpl, urls } = seatsAero();
    const e = engine(fetchImpl);
    const query = await parsedQuery(e);
    expect((await e.searchQuery(query, KEY)).ok).toBe(true);
    const calls = urls.length;
    const byText = await e.search(TEXT, KEY);
    expect(byText.ok && byText.value.served_from_cache).toBe(true);
    expect(urls).toHaveLength(calls);
  });

  it("carries the rows and their coverage for the workspace", async () => {
    const { fetchImpl } = seatsAero();
    const e = engine(fetchImpl);
    const res = await e.searchQuery(await parsedQuery(e), KEY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.rows?.length).toBeGreaterThan(0);
    expect(res.value.coverage?.state).toBe("complete");
  });

  it("sends nothing but seats.aero requests: no Anthropic client, no other host", async () => {
    const { fetchImpl, urls } = seatsAero();
    const e = engine(fetchImpl);
    await e.searchQuery(await parsedQuery(e), KEY);
    await e.search("SFO to NRT next 60 days business", KEY);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith("https://seats.aero/")).toBe(true);
  });

  it("an invalid query sends nothing: schema failures and dates that are not on the calendar", async () => {
    const { fetchImpl, urls } = seatsAero();
    const e = engine(fetchImpl);
    const query = await parsedQuery(e);
    for (const bad of [{ ...query, date_from: "2026-02-30" }, { ...query, origins: [] }, { ...query, date_to: "2025-01-01" }, { nonsense: true }]) {
      const res = await e.searchQuery(bad as QueryObject, KEY);
      expect(res).toMatchObject({ ok: false, error: "invalid_body" });
    }
    expect(urls).toHaveLength(0);
  });

  it("no key is no_key, before anything else, from both entries", async () => {
    const { fetchImpl, urls } = seatsAero();
    const e = engine(fetchImpl);
    const query = await parsedQuery(e);
    expect(await e.searchQuery(query, null)).toMatchObject({ ok: false, error: "no_key" });
    expect(await e.search(TEXT, null)).toMatchObject({ ok: false, error: "no_key" });
    expect(await e.parseText(TEXT, "")).toMatchObject({ ok: false, error: "no_key" });
    expect(urls).toHaveLength(0);
  });
});
