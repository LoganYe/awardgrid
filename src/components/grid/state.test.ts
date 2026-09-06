import { describe, expect, it } from "vitest";
import { QueryObject } from "@/lib/query/schema";
import { SEATS_SOURCES } from "@/lib/seatsaero/types";
import {
  applyChipAction,
  clampDates,
  decodeQueryParam,
  encodeQueryParam,
  gridHref,
  isCommittableDate,
  localToday,
  mergeTripsIntoGrid,
  normalizeIata,
  sameQuery,
  siblingAirports,
} from "./state";

const base = QueryObject.parse({
  origins: ["HKG", "PVG"],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"],
  raw_text: "香港、上海到西雅图 未来一个月 商务或头等",
  language: "zh",
});

describe("chip reducers", () => {
  it("adds upper-cased, validated, de-duplicated airports and never removes the last one", () => {
    const a = applyChipAction(base, { type: "add_origin", code: " hnd " });
    expect(a.origins).toEqual(["HKG", "PVG", "HND"]);
    expect(applyChipAction(a, { type: "add_origin", code: "HND" }).origins).toEqual(["HKG", "PVG", "HND"]);
    expect(applyChipAction(a, { type: "add_origin", code: "Tokyo" }).origins).toEqual(["HKG", "PVG", "HND"]);
    const r = applyChipAction(a, { type: "remove_origin", code: "PVG" });
    expect(r.origins).toEqual(["HKG", "HND"]);
    const only = applyChipAction(base, { type: "remove_destination", code: "SEA" });
    expect(only.destinations).toEqual(["SEA"]);
    expect(base.origins).toEqual(["HKG", "PVG"]); // input untouched
    expect(QueryObject.safeParse(r).success).toBe(true);
  });

  it("toggles cabins in canonical F/J/W/Y order and keeps at least one", () => {
    const y = applyChipAction(base, { type: "toggle_cabin", cabin: "Y" });
    expect(y.cabins).toEqual(["F", "J", "Y"]);
    const noJ = applyChipAction(y, { type: "toggle_cabin", cabin: "J" });
    expect(noJ.cabins).toEqual(["F", "Y"]);
    const single = applyChipAction(QueryObject.parse({ ...base, cabins: ["F"] }), { type: "toggle_cabin", cabin: "F" });
    expect(single.cabins).toEqual(["F"]);
  });

  it("clamps dates to the 92-day cap, the edited bound winning", () => {
    expect(clampDates(base, { date_to: "2027-03-01" })).toEqual({ date_from: "2026-11-30", date_to: "2027-03-01" });
    expect(clampDates(base, { date_from: "2026-11-15" })).toEqual({ date_from: "2026-11-15", date_to: "2026-11-15" });
    expect(clampDates(base, { date_from: "2026-01-01" })).toEqual({ date_from: "2026-01-01", date_to: "2026-04-02" });
    expect(clampDates(base, { date_to: "garbage" })).toEqual({ date_from: "2026-10-01", date_to: "2026-10-30" });
    const q = applyChipAction(base, { type: "set_dates", date_to: "2027-03-01" });
    expect(QueryObject.safeParse(q).success).toBe(true);
  });

  it("max miles, sort, direct-only and include-filtered", () => {
    const m = applyChipAction(base, { type: "set_max_miles", value: 80000.7 });
    expect(m.max_miles).toBe(80000);
    expect("max_miles" in applyChipAction(m, { type: "set_max_miles", value: null })).toBe(false);
    expect("max_miles" in applyChipAction(m, { type: "set_max_miles", value: -5 })).toBe(false);
    expect(applyChipAction(base, { type: "set_sort", value: "fees_asc" }).sort_by).toBe("fees_asc");
    expect(applyChipAction(base, { type: "set_direct_only", value: true }).direct_only).toBe(true);
    expect(applyChipAction(base, { type: "set_include_filtered", value: true }).include_filtered).toBe(true);
  });

  it("programs: toggling from 'all' selects one; selecting every program or none means 'all'", () => {
    const one = applyChipAction(base, { type: "toggle_program", program: "united" });
    expect(one.programs).toEqual(["united"]);
    const two = applyChipAction(one, { type: "toggle_program", program: "aeroplan" });
    expect(two.programs).toEqual(["united", "aeroplan"]);
    const none = applyChipAction(applyChipAction(two, { type: "toggle_program", program: "united" }), { type: "toggle_program", program: "aeroplan" });
    expect(none.programs).toBeUndefined();
    expect(applyChipAction(base, { type: "set_programs", programs: [...SEATS_SOURCES] }).programs).toBeUndefined();
    expect(applyChipAction(base, { type: "set_programs", programs: ["made_up"] }).programs).toBeUndefined();
  });

  it("isCommittableDate rejects the partial values a date input emits while typing", () => {
    expect(isCommittableDate("2026-10-15")).toBe(true);
    expect(isCommittableDate("0002-10-15")).toBe(false);
    expect(isCommittableDate("0202-10-15")).toBe(false);
    expect(isCommittableDate("2026-13-01")).toBe(false);
    expect(isCommittableDate("")).toBe(false);
  });

  it("siblingAirports suggests the rest of an expanded metro, never duplicates or unknown airports", () => {
    expect(siblingAirports(["NRT", "SEA"])).toEqual(["HND"]);
    expect(siblingAirports(["NRT", "HND"])).toEqual([]);
    expect(siblingAirports(["ICN", "JFK"])).toEqual(["GMP", "EWR", "LGA"]);
    expect(siblingAirports(["SEA"])).toEqual([]); // single-airport city
    expect(siblingAirports(["XYZ"])).toEqual([]); // not in the seed
    expect(siblingAirports(["PVG"])).toEqual(["SHA"]);
  });

  it("sameQuery ignores raw_text/language and ordering of cabins/programs", () => {
    expect(sameQuery(base, { ...base, raw_text: "x", language: "en" })).toBe(true);
    expect(sameQuery(base, { ...base, cabins: ["F", "J"] })).toBe(true);
    expect(sameQuery(base, { ...base, direct_only: true })).toBe(false);
    expect(sameQuery(null, null)).toBe(true);
    expect(sameQuery(base, null)).toBe(false);
  });
});

describe("URL codec", () => {
  it("round-trips a QueryObject with Chinese text through base64url", () => {
    const encoded = encodeQueryParam(base);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeQueryParam(encoded)).toEqual(base);
    expect(gridHref(base)).toBe(`/grid?q=${encoded}`);
    expect(gridHref(null)).toBe("/grid");
  });

  it("rejects garbage, invalid JSON and invalid QueryObjects without throwing", () => {
    expect(decodeQueryParam(null)).toBeNull();
    expect(decodeQueryParam("")).toBeNull();
    expect(decodeQueryParam("!!!")).toBeNull();
    expect(decodeQueryParam(Buffer.from("{not json").toString("base64url"))).toBeNull();
    expect(decodeQueryParam(Buffer.from(JSON.stringify({ ...base, origins: [] })).toString("base64url"))).toBeNull();
    expect(decodeQueryParam(Buffer.from(JSON.stringify({ ...base, date_to: "2027-06-01" })).toString("base64url"))).toBeNull();
  });
});

describe("formatting", () => {
  it("iata, local date", () => {
    expect(normalizeIata(" sea")).toBe("SEA");
    expect(normalizeIata("SEAT")).toBeNull();
    expect(localToday(new Date(2026, 9, 1, 23, 30))).toBe("2026-10-01");
  });
});

describe("mergeTripsIntoGrid", () => {
  it("patches fees/currency/booking link on every row with that Availability ID + cabin, nothing else", () => {
    const row = (over: Partial<import("@/lib/grid/types").AvailabilityRow>): import("@/lib/grid/types").AvailabilityRow => ({
      program: "american",
      origin: "HKG",
      dest: "SEA",
      date: "2026-10-02",
      cabin: "F",
      miles: 62000,
      fees_cents: null,
      currency: null,
      seats_left: 1,
      direct: false,
      airlines: ["AA"],
      computed_last_seen: "2026-10-01T10:00:00Z",
      source_id: "AV1",
      booking_url: null,
      fetched_at: "2026-10-01T12:00:00Z",
      ...over,
    });
    const a = row({});
    const b = row({ cabin: "J", miles: 50000 });
    const c = row({ source_id: "AV2", program: "united" });
    const grid: import("@/lib/grid/types").Grid = {
      orientation: "dates",
      rows: ["2026-10-02"],
      cols: ["HKG-SEA"],
      cells: [[{ origin: "HKG", dest: "SEA", date: "2026-10-02", status: "ok", best: b, all: [b, a, c] }]],
      pairs: [{ origin: "HKG", dest: "SEA", key: "HKG-SEA" }],
      dates: ["2026-10-02"],
      query: base,
      meta: { generated_at: "2026-10-01T12:00:00Z", unmonitored_pairs: [], not_fetched_pairs: [], oldest_seen: null, newest_seen: null, api_calls_used: 0, served_from_cache: false },
    };
    const out = mergeTripsIntoGrid(grid, a, { fees_cents: 1290, currency: "USD", booking_url: "https://example.test/book" });
    const cell = out.cells[0]![0]!;
    expect(cell.all[1]).toMatchObject({ source_id: "AV1", cabin: "F", fees_cents: 1290, currency: "USD", booking_url: "https://example.test/book" });
    expect(cell.all[0]).toEqual(b); // same id, other cabin untouched
    expect(cell.all[2]).toEqual(c);
    expect(cell.best).toEqual(b);
    expect(grid.cells[0]![0]!.all[1]!.fees_cents).toBeNull(); // input not mutated
    expect(mergeTripsIntoGrid(grid, c, { fees_cents: null, currency: null, booking_url: null }).cells[0]![0]!.all[2]).toEqual(c);
  });
});
