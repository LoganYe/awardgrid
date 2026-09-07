import { describe, expect, it } from "vitest";
import { QueryObject } from "@/lib/query/schema";
import { SEATS_SOURCES } from "@/lib/seatsaero/types";
import {
  applyChipAction,
  clampDates,
  decodeQueryParam,
  encodeQueryParam,
  gridHref,
  localToday,
  mergeTripsIntoGrid,
  normalizeIata,
  sameQuery,
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

  it("toggles cabins in the canonical J/F/W/Y order (spec §3.2) and keeps at least one", () => {
    const y = applyChipAction(base, { type: "toggle_cabin", cabin: "Y" });
    expect(y.cabins).toEqual(["J", "F", "Y"]);
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
    // set_min_cabin_pct always writes the number — it never deletes the key, so the field stays
    // a concrete number and 100 stays representable as an explicit choice.
    expect(applyChipAction(base, { type: "set_min_cabin_pct", value: 70 }).min_cabin_pct).toBe(70);
    expect(applyChipAction(base, { type: "set_min_cabin_pct", value: 0 }).min_cabin_pct).toBe(0);
    const back = applyChipAction(applyChipAction(base, { type: "set_min_cabin_pct", value: 70 }), { type: "set_min_cabin_pct", value: 100 });
    expect(back.min_cabin_pct).toBe(100);
    expect("min_cabin_pct" in back).toBe(true);
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

  it("sameQuery ignores raw_text/language and ordering of cabins/programs", () => {
    expect(sameQuery(base, { ...base, raw_text: "x", language: "en" })).toBe(true);
    expect(sameQuery(base, { ...base, cabins: ["F", "J"] })).toBe(true);
    expect(sameQuery(base, { ...base, direct_only: true })).toBe(false);
    expect(sameQuery(null, null)).toBe(true);
    expect(sameQuery(base, null)).toBe(false);
  });

  it("sameQuery: a 70 % draft differs from the 100 % run, but absent and explicit 100 do not", () => {
    // Without min_cabin_pct in canonicalJson the Run affordance never appears and the user keeps
    // looking at 100 % results — the same invisible failure issue #18 is about.
    expect(sameQuery(base, { ...base, min_cabin_pct: 70 })).toBe(false);
    expect(sameQuery({ ...base, min_cabin_pct: 70 }, { ...base, min_cabin_pct: 50 })).toBe(false);
    expect(sameQuery({ ...base, min_cabin_pct: 70 }, { ...base, min_cabin_pct: 70 })).toBe(true);
    // A query parsed from a pre-#18 payload and one that says 100 out loud are one query: a user
    // who opens the editor and leaves it alone must not see the modified state.
    const legacyJson = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    delete legacyJson.min_cabin_pct;
    const legacy = QueryObject.parse(legacyJson);
    expect(sameQuery(legacy, { ...base, min_cabin_pct: 100 })).toBe(true);
    // And the same holds for a raw object that never went through the schema at all.
    expect(sameQuery(legacyJson as never, { ...base, min_cabin_pct: 100 })).toBe(true);
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

  it("a ?q= link written before min_cabin_pct existed decodes to exactly 100 (issue #18)", async () => {
    const legacy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    delete legacy.min_cabin_pct;
    const link = Buffer.from(JSON.stringify(legacy)).toString("base64url");
    const decoded = decodeQueryParam(link);
    expect(decoded).not.toBeNull();
    expect(decoded!.min_cabin_pct).toBe(100);
    // The link's meaning — and its cache scope — is unchanged: it equals the query we hold.
    expect(sameQuery(decoded, base)).toBe(true);
    // A shared link carrying a non-preset value round-trips it exactly.
    const odd = decodeQueryParam(encodeQueryParam({ ...base, min_cabin_pct: 63 }));
    expect(odd!.min_cabin_pct).toBe(63);
  });

  it("rejects garbage, invalid JSON and invalid QueryObjects without throwing", () => {
    expect(decodeQueryParam(null)).toBeNull();
    expect(decodeQueryParam("")).toBeNull();
    expect(decodeQueryParam("!!!")).toBeNull();
    expect(decodeQueryParam(Buffer.from("{not json").toString("base64url"))).toBeNull();
    expect(decodeQueryParam(Buffer.from(JSON.stringify({ ...base, origins: [] })).toString("base64url"))).toBeNull();
    expect(decodeQueryParam(Buffer.from(JSON.stringify({ ...base, date_to: "2027-06-01" })).toString("base64url"))).toBeNull();
    // min_cabin_pct outside the documented 0-100 integer range is garbage, not a clamp.
    expect(decodeQueryParam(Buffer.from(JSON.stringify({ ...base, min_cabin_pct: 101 })).toString("base64url"))).toBeNull();
    expect(decodeQueryParam(Buffer.from(JSON.stringify({ ...base, min_cabin_pct: -1 })).toString("base64url"))).toBeNull();
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

