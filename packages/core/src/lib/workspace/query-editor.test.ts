/**
 * The query editor's rules (UI/UX v1 plan 02 T06; acceptance A10, A11): calendar-day dates, the core span cap,
 * relative days on an explicit UTC clock, field errors named per field, and place options from the places seed.
 */
import { describe, expect, it } from "vitest";
import cases from "../../../test/fixtures/uiux/query-cases.json";
import { parseQuery } from "../query/parse";
import { QueryObject } from "../query/schema";
import {
  cabinName,
  describeQuery,
  draftFromQuery,
  placeOptions,
  placeName,
  resolveDraft,
  sameDraft,
  spanDays,
  textReproducesQuery,
  validateDraft,
} from "./query-editor";
import type { QueryDraft } from "./types";

describe("calendar-day rules", () => {
  for (const c of cases.cases) {
    it(c.id, () => {
      const draft = { query: c.query, dates: c.dates } as QueryDraft;
      if ("error" in c.expected) expect(() => resolveDraft(draft, c.today)).toThrow();
      else {
        const result = resolveDraft(draft, c.today);
        expect([result.date_from, result.date_to]).toEqual([c.expected.from, c.expected.to]);
      }
    });
  }

  it("names the rule a draft breaks, as the fixtures do", () => {
    for (const c of cases.cases) {
      if (!("error" in c.expected)) continue;
      expect(() => resolveDraft({ query: c.query, dates: c.dates } as QueryDraft, c.today), c.id).toThrow(c.expected.error);
    }
  });

  const base = cases.cases[0]!;
  const draft = (dates: QueryDraft["dates"]): QueryDraft => ({ query: QueryObject.parse(base.query), dates });

  it("the 92-day cap counts both ends: 92 days pass, 93 do not", () => {
    expect(resolveDraft(draft({ kind: "fixed", from: "2026-10-01", to: "2026-12-31" }), "2026-09-23").date_to).toBe("2026-12-31");
    expect(() => resolveDraft(draft({ kind: "fixed", from: "2026-10-01", to: "2027-01-01" }), "2026-09-23")).toThrow("span_exceeds_core_limit");
  });

  it("an end before the start, a date that is not a date, and a non-leap 29 February are refused", () => {
    expect(() => resolveDraft(draft({ kind: "fixed", from: "2026-10-05", to: "2026-10-01" }), "2026-09-23")).toThrow("end_before_start");
    expect(() => resolveDraft(draft({ kind: "fixed", from: "2026-13-01", to: "2026-13-02" }), "2026-09-23")).toThrow("invalid_calendar_date");
    expect(() => resolveDraft(draft({ kind: "fixed", from: "2027-02-29", to: "2027-03-01" }), "2026-09-23")).toThrow("invalid_calendar_date");
  });

  it("relative days start today on the UTC clock and include today; 1 day is today only; 0 or more than 92 are refused", () => {
    expect(resolveDraft(draft({ kind: "relative_days", days: 1, clock: "UTC" }), "2026-12-31")).toMatchObject({ date_from: "2026-12-31", date_to: "2026-12-31" });
    expect(resolveDraft(draft({ kind: "relative_days", days: 92, clock: "UTC" }), "2026-12-31").date_to).toBe("2027-04-01");
    expect(() => resolveDraft(draft({ kind: "relative_days", days: 0, clock: "UTC" }), "2026-09-23")).toThrow("invalid_relative_days");
    expect(() => resolveDraft(draft({ kind: "relative_days", days: 93, clock: "UTC" }), "2026-09-23")).toThrow("span_exceeds_core_limit");
    expect(() => resolveDraft(draft({ kind: "relative_days", days: 30, clock: "UTC" }), "2026-02-30")).toThrow("invalid_calendar_date");
  });

  it("the result is a schema-valid QueryObject with the draft's other fields untouched", () => {
    const result = resolveDraft(draft({ kind: "fixed", from: "2026-10-01", to: "2026-10-30" }), "2026-09-23");
    expect(QueryObject.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ origins: ["HKG"], destinations: ["SEA"], cabins: ["J", "F"], programs: ["aeroplan"], min_cabin_pct: 100 });
  });
});

describe("drafts", () => {
  const query = QueryObject.parse(cases.cases[0]!.query);

  it("a draft from a query keeps its dates as a fixed rule", () => {
    expect(draftFromQuery(query)).toEqual({ query, dates: { kind: "fixed", from: "2026-10-01", to: "2026-10-30" } });
  });

  it("sameDraft ignores airport order and duplicate codes but not a changed cabin or date", () => {
    const a = draftFromQuery(query);
    expect(sameDraft(a, { ...a, query: { ...a.query, origins: ["HKG", "HKG"] } })).toBe(true);
    expect(sameDraft(a, { ...a, query: { ...a.query, cabins: ["F", "J"] } })).toBe(true);
    expect(sameDraft(a, { ...a, query: { ...a.query, cabins: ["J"] } })).toBe(false);
    expect(sameDraft(a, { ...a, dates: { kind: "fixed", from: "2026-10-02", to: "2026-10-30" } })).toBe(false);
    expect(sameDraft(a, { ...a, dates: { kind: "relative_days", days: 30, clock: "UTC" } })).toBe(false);
  });

  it("validateDraft names each broken field, in the editor's field order, and says nothing for a good draft", () => {
    expect(validateDraft(draftFromQuery(query), "2026-09-23")).toEqual([]);
    const broken: QueryDraft = {
      query: { ...query, origins: [], destinations: [], cabins: [] },
      dates: { kind: "fixed", from: "2026-02-30", to: "2026-03-02" },
    };
    expect(validateDraft(broken, "2026-01-01").map((e) => [e.field, e.code])).toEqual([
      ["origins", "required"],
      ["destinations", "required"],
      ["dates", "invalid_calendar_date"],
      ["cabins", "required"],
    ]);
  });

  it("a route whose every pair is one airport to itself is refused; a route with a real pair is core's to run", () => {
    const errors = validateDraft({ ...draftFromQuery(query), query: { ...query, destinations: ["HKG"] } }, "2026-09-23");
    expect(errors.map((e) => [e.field, e.code])).toEqual([["destinations", "same_as_origin"]]);
    expect(validateDraft({ ...draftFromQuery(query), query: { ...query, origins: ["HKG", "SEA"], destinations: ["SEA"] } }, "2026-09-23")).toEqual([]);
  });

  it("a range that has already ended is refused; one that started earlier but runs on is not", () => {
    expect(validateDraft({ ...draftFromQuery(query), dates: { kind: "fixed", from: "2026-09-01", to: "2026-09-10" } }, "2026-09-23").map((e) => e.code)).toEqual([
      "ends_in_past",
    ]);
    expect(validateDraft({ ...draftFromQuery(query), dates: { kind: "fixed", from: "2026-09-20", to: "2026-10-10" } }, "2026-09-23")).toEqual([]);
  });

  it("a mileage cap must be a positive whole number", () => {
    for (const bad of [0, -5, 1.5]) {
      expect(validateDraft({ ...draftFromQuery(query), query: { ...query, max_miles: bad } }, "2026-09-23").map((e) => [e.field, e.code]), String(bad)).toEqual([
        ["max_miles", "invalid_miles"],
      ]);
    }
    expect(validateDraft({ ...draftFromQuery(query), query: { ...query, max_miles: 80000 } }, "2026-09-23")).toEqual([]);
  });

  it("no programs and an empty program list both mean all programs; a changed mileage cap is a change", () => {
    const a = draftFromQuery({ ...query, programs: undefined });
    expect(sameDraft(a, { ...a, query: { ...a.query, programs: [] } })).toBe(true);
    expect(sameDraft(a, { ...a, query: { ...a.query, max_miles: 70000 } })).toBe(false);
  });

  it("years 0–99 are counted as themselves, not as 1900–1999", () => {
    expect(spanDays("0050-01-01", "0050-01-31")).toBe(31);
    expect(spanDays("2028-02-28", "2028-03-01")).toBe(3);
  });
});

describe("places", () => {
  it("offers a metro with its airports spelled out, and its airports on their own", () => {
    const tokyo = placeOptions("tok", "en");
    expect(tokyo[0]).toMatchObject({ code: "TYO", kind: "metro", airports: ["NRT", "HND"], name: "Tokyo" });
    expect(tokyo.map((o) => o.code)).toEqual(expect.arrayContaining(["NRT", "HND"]));
  });

  it("matches codes, English and Chinese names, without case", () => {
    expect(placeOptions("hkg", "en")[0]).toMatchObject({ code: "HKG", airports: ["HKG"], name: "Hong Kong" });
    expect(placeOptions("香港", "zh")[0]).toMatchObject({ code: "HKG", name: "香港" });
    expect(placeOptions("西雅", "zh")[0]).toMatchObject({ code: "SEA", name: "西雅图" });
    expect(placeOptions("", "en")).toEqual([]);
    expect(placeOptions("zzzz", "en")).toEqual([]);
  });

  it("a city whose code is also one of its airports is offered as the city AND as that airport alone", () => {
    const sha = placeOptions("sha", "en");
    expect(sha.find((o) => o.kind === "metro" && o.code === "SHA")).toMatchObject({ airports: ["PVG", "SHA"], name: "Shanghai" });
    expect(sha.find((o) => o.kind === "airport" && o.code === "SHA")).toMatchObject({ airports: ["SHA"], name: "Hongqiao" });
    const bkk = placeOptions("bangkok", "en");
    expect(bkk.find((o) => o.kind === "airport" && o.code === "BKK")).toMatchObject({ airports: ["BKK"] });
    expect(placeName("SHA", "zh", undefined, "airport")).toBe("虹桥");
    expect(placeName("SHA", "en")).toBe("Shanghai");
  });

  it("an airport is named by its own alias, else by its metro; an unknown code is its own name", () => {
    expect(placeName("NRT", "en")).toBe("Narita");
    expect(placeName("PVG", "zh")).toBe("浦东");
    expect(placeName("JFK", "en")).toBe("New York");
    expect(placeName("SEA", "en")).toBe("Seattle");
    expect(placeName("XYZ", "en")).toBe("XYZ");
  });

  it("cabins have names in both languages", () => {
    expect(["J", "F", "W", "Y"].map((c) => cabinName(c as "J", "en"))).toEqual(["Business", "First", "Premium economy", "Economy"]);
    expect(["J", "F", "W", "Y"].map((c) => cabinName(c as "J", "zh"))).toEqual(["商务舱", "头等舱", "超经舱", "经济舱"]);
  });
});

describe("describeQuery", () => {
  it("reads back through the deterministic parser as the same airports, dates and cabins", async () => {
    const shapes = [
      { origins: ["HKG", "PVG"], destinations: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J", "F"] },
      { origins: ["NRT"], destinations: ["JFK", "EWR"], date_from: "2026-11-15", date_to: "2026-11-15", cabins: ["W"] },
      { origins: ["SFO"], destinations: ["HND"], date_from: "2027-01-01", date_to: "2027-03-01", cabins: ["Y", "J"] },
    ] as const;
    for (const shape of shapes) {
      const text = describeQuery({ ...shape, origins: [...shape.origins], destinations: [...shape.destinations], cabins: [...shape.cabins] });
      const parsed = await parseQuery(text, { today: "2026-09-23" });
      expect(parsed.query.origins, text).toEqual(shape.origins);
      expect(parsed.query.destinations, text).toEqual(shape.destinations);
      expect([parsed.query.date_from, parsed.query.date_to], text).toEqual([shape.date_from, shape.date_to]);
      expect([...parsed.query.cabins].sort(), text).toEqual([...shape.cabins].sort());
    }
  });
});

describe("textReproducesQuery", () => {
  const base = QueryObject.parse({ origins: ["HKG", "PVG"], destinations: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], raw_text: "", language: "en" });

  it("the editor's sentence reads back exactly, with nonstop, programs, a mileage cap and a rolling window", () => {
    const withAll = { ...base, direct_only: true, programs: ["aeroplan", "united"], max_miles: 80000 };
    expect(textReproducesQuery(describeQuery(withAll), withAll, "2026-09-23")).toBe(true);
    const rolling = { ...base, date_from: "2026-09-23", date_to: "2026-11-06" };
    const text = describeQuery(rolling, { kind: "relative_days", days: 45, clock: "UTC" });
    expect(text).toContain("next 45 days");
    expect(textReproducesQuery(text, rolling, "2026-09-23")).toBe(true);
    // Read on another day, "next 45 days" is another window: that is the point of a rolling rule.
    expect(textReproducesQuery(text, rolling, "2026-09-24")).toBe(false);
  });

  it("text a person typed reads back as the query it produced, on the day it was made", async () => {
    const typed = "HKG to SEA next 30 days business";
    const parsed = await parseQuery(typed, { today: "2026-10-18" });
    expect(textReproducesQuery(typed, parsed.query, "2026-10-18")).toBe(true);
  });

  it("what the words cannot say is caught: mixed cabin, dynamic pricing, a lone airport with its city's code, an unknown code", () => {
    expect(textReproducesQuery(describeQuery(base), { ...base, min_cabin_pct: 75 }, "2026-09-23")).toBe(false);
    expect(textReproducesQuery(describeQuery(base), { ...base, include_filtered: true }, "2026-09-23")).toBe(false);
    const sha = { ...base, origins: ["SHA"] };
    expect(textReproducesQuery(describeQuery(sha), sha, "2026-09-23")).toBe(false);
    const unknown = { ...base, origins: ["QQQ"] };
    expect(textReproducesQuery(describeQuery(unknown), unknown, "2026-09-23")).toBe(false);
    expect(textReproducesQuery("", base, "2026-09-23")).toBe(false);
  });
});
