import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n";
import { QueryObject } from "@/lib/query/schema";
import { SEATS_SOURCES } from "@/lib/seatsaero/types";
import {
  CHIPS,
  CHIP_ORDER,
  capNote,
  chipAriaLabel,
  chipLabel,
  chipSummary,
  isAllPrograms,
  isModified,
  mixedCabinHint,
  modifiedChips,
  programCount,
  programsList,
  resetToParsed,
  selectedPrograms,
  summarizeAirports,
  toggleProgram,
  validateQuery,
  type ChipContext,
  type QueryDraft,
} from "./chips-model";

const canonical = QueryObject.parse({
  origins: ["HKG", "PVG", "SHA", "NRT", "HND", "ICN"],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"],
  raw_text: "香港,上海,东京,首尔到西雅图 未来一个月 头等",
  language: "zh",
});

const en: ChipContext = { locale: "en", t: translator("en"), programsTotal: 24 };
const zh: ChipContext = { locale: "zh", t: translator("zh"), programsTotal: 24 };
const draft = (patch: Partial<QueryDraft> = {}): QueryDraft => ({ ...canonical, ...patch });

describe("the eight chips", () => {
  it("are the spec's list in the spec's order", () => {
    // Mixed cabin (issue #18) sits at index 6: after Direct only, keeping the two
    // search-shaping toggles together, and before Sort, the only display-only chip.
    expect(CHIP_ORDER).toEqual(["origins", "destinations", "dates", "cabins", "programs", "direct_only", "min_cabin_pct", "sort"]);
    expect(CHIPS.map((c) => c.id)).toEqual([...CHIP_ORDER]);
    expect(chipLabel("origins", en.t)).toBe("Origins");
    expect(chipLabel("direct_only", zh.t)).toBe("仅直飞");
    expect(chipLabel("min_cabin_pct", en.t)).toBe("Mixed cabin");
    expect(chipLabel("min_cabin_pct", zh.t)).toBe("混舱");
    expect(CHIPS.find((c) => c.id === "dates")!.fields).toEqual(["date_from", "date_to"]);
    expect(CHIPS.find((c) => c.id === "min_cabin_pct")!.fields).toEqual(["min_cabin_pct"]);
  });
});

describe("the Mixed cabin chip (issue #18)", () => {
  it("reads 100 as a state, 0 as 'any' and anything else as a floor", () => {
    // Never "off": that is what Direct only next to it says for the OPPOSITE meaning (#18).
    expect(chipSummary("min_cabin_pct", draft(), en)).toBe("not allowed");
    expect(chipSummary("min_cabin_pct", draft({ min_cabin_pct: 100 }), en)).toBe("not allowed");
    expect(chipSummary("min_cabin_pct", draft({ min_cabin_pct: 100 }), zh)).toBe("不允许");
    expect(chipSummary("min_cabin_pct", draft(), en)).not.toBe(en.t("grid.chips.off"));
    expect(chipSummary("min_cabin_pct", draft({ min_cabin_pct: 75 }), en)).toBe("75% and up");
    expect(chipSummary("min_cabin_pct", draft({ min_cabin_pct: 0 }), en)).toBe("any");
    expect(chipSummary("min_cabin_pct", draft({ min_cabin_pct: 63 }), en)).toBe("63% and up");
    expect(chipSummary("min_cabin_pct", draft({ min_cabin_pct: 75 }), zh)).toBe("75% 及以上");
    expect(chipSummary("min_cabin_pct", draft({ min_cabin_pct: 0 }), zh)).toBe("不限");
    // A draft parsed from a pre-#18 payload has no such key: it must read as "off", at rest.
    const legacy = draft();
    delete (legacy as { min_cabin_pct?: number }).min_cabin_pct;
    expect(chipSummary("min_cabin_pct", legacy, en)).toBe("not allowed");
    expect(chipAriaLabel("min_cabin_pct", draft({ min_cabin_pct: 75 }), en)).toBe("Mixed cabin 75% and up");
  });

  it("takes the outline only when the value really changed — absent equals an explicit 100", () => {
    const legacy = draft();
    delete (legacy as { min_cabin_pct?: number }).min_cabin_pct;
    expect(modifiedChips(draft({ min_cabin_pct: 100 }), legacy)).toEqual([]);
    expect(isModified(draft({ min_cabin_pct: 100 }), legacy)).toBe(false);
    // ...and it comes from CHIP_ORDER, so no hand-written clause in isModified is needed.
    expect(modifiedChips(draft({ min_cabin_pct: 70 }), legacy)).toEqual(["min_cabin_pct"]);
    expect(isModified(draft({ min_cabin_pct: 70 }), canonical)).toBe(true);
  });

  it("gives every value a hint that is true at that value", () => {
    expect(mixedCabinHint(100, en)).toBe("Keeps only itineraries flown entirely in the chosen cabin.");
    expect(mixedCabinHint(75, en)).toBe("Keeps itineraries flying at least 75% of the distance in the chosen cabin.");
    // At 0 nothing is dropped, so a sentence about dropping itineraries would be false.
    expect(mixedCabinHint(0, en)).toBe("Keeps every itinerary, whatever share of the distance is in the chosen cabin.");
    expect(mixedCabinHint(0, zh)).toBe("保留全部行程，不限所选舱位的飞行距离占比。");
    expect(new Set([100, 75, 0].map((pct) => mixedCabinHint(pct, zh))).size).toBe(3);
  });
});

describe("value summaries, English", () => {
  it("groups airports of one city with a slash, cities in query order", () => {
    expect(chipSummary("origins", canonical, en)).toBe("HKG, PVG/SHA, NRT/HND, ICN");
    expect(chipSummary("destinations", canonical, en)).toBe("SEA");
    expect(summarizeAirports(["NRT", "HKG", "HND"])).toBe("NRT/HND, HKG"); // city order follows first mention
    expect(summarizeAirports(["ZZZ"])).toBe("ZZZ");
    expect(summarizeAirports([])).toBe("");
  });

  it("writes the date range with an en dash and an inclusive day count", () => {
    expect(chipSummary("dates", canonical, en)).toBe("Oct 1 – Oct 30 (30 days)");
    expect(chipSummary("dates", draft({ date_from: "2026-12-20", date_to: "2027-01-05" }), en)).toBe(
      "Dec 20, 2026 – Jan 5, 2027 (17 days)",
    );
    expect(chipSummary("dates", draft({ date_to: "2026-10-01" }), en)).toBe("Oct 1 – Oct 1 (1 day)");
    expect(chipSummary("dates", draft({ date_to: "2026-10-01" }), zh)).toBe("10月1日 – 10月1日（1 天）");
  });

  it("writes cabins, direct only and sort", () => {
    expect(chipSummary("cabins", canonical, en)).toBe("J, F");
    expect(chipSummary("cabins", draft({ cabins: ["J"] }), en)).toBe("J");
    expect(chipSummary("direct_only", canonical, en)).toBe("off");
    expect(chipSummary("direct_only", draft({ direct_only: true }), en)).toBe("on");
    expect(chipSummary("sort", canonical, en)).toBe("Fewest miles");
    expect(chipSummary("sort", draft({ sort_by: "seats_desc" }), en)).toBe("Most seats");
  });

  it("counts programs, naming them while there are at most two", () => {
    expect(chipSummary("programs", canonical, en)).toBe("all 24");
    expect(chipSummary("programs", draft({ programs: [] }), en)).toBe("all 24");
    expect(chipSummary("programs", draft({ programs: ["alaska"] }), en)).toBe("Alaska");
    expect(chipSummary("programs", draft({ programs: ["alaska", "american"] }), en)).toBe("Alaska, American");
    expect(chipSummary("programs", draft({ programs: ["alaska", "american", "aeroplan"] }), en)).toBe("3 of 24");
    expect(chipSummary("programs", draft({ programs: ["alaska"] }), { ...en, programsTotal: undefined })).toBe("Alaska");
  });

  it("pairs the label with the summary for the aria label", () => {
    expect(chipAriaLabel("dates", canonical, en)).toBe("Dates Oct 1 – Oct 30 (30 days)");
  });

  // The Dates editor renders this same string under its calendar, on the same clamped range, so
  // a 176-day pick reads "92 days" in both places.
  it("reports the clamped span, never the raw pick", () => {
    expect(chipSummary("dates", draft({ date_from: "2026-09-06", date_to: "2027-02-28" }), en)).toBe("Sep 6 – Dec 6 (92 days)");
    expect(chipSummary("dates", draft({ date_from: "2026-09-20", date_to: "2026-09-20" }), en)).toBe("Sep 20 – Sep 20 (1 day)");
  });
});

describe("value summaries, Chinese", () => {
  it("uses Intl months and full-width parentheses", () => {
    expect(chipSummary("dates", canonical, zh)).toBe("10月1日 – 10月30日（30 天）");
    expect(chipSummary("dates", draft({ date_from: "2026-12-20", date_to: "2027-01-05" }), zh)).toBe(
      "2026年12月20日 – 2027年1月5日（17 天）",
    );
  });

  it("translates the switch, the sort label and the program count", () => {
    expect(chipSummary("direct_only", canonical, zh)).toBe("关");
    expect(chipSummary("direct_only", draft({ direct_only: true }), zh)).toBe("开");
    expect(chipSummary("sort", canonical, zh)).toBe("里程最少");
    expect(chipSummary("programs", canonical, zh)).toBe("全部 24 个");
    expect(chipSummary("programs", draft({ programs: ["alaska", "american", "aeroplan"] }), zh)).toBe("3 / 24 个");
    // Airport codes and cabin letters are the same in both languages.
    expect(chipSummary("origins", canonical, zh)).toBe("HKG, PVG/SHA, NRT/HND, ICN");
    expect(chipSummary("cabins", canonical, zh)).toBe("J, F");
  });
});

describe("modified state", () => {
  it("ignores raw_text, language and key order", () => {
    expect(isModified(canonical, canonical)).toBe(false);
    expect(isModified(draft({ raw_text: "different text", language: "en" }), canonical)).toBe(false);
    const reordered = Object.fromEntries(Object.entries(canonical).reverse()) as unknown as QueryDraft;
    expect(isModified(reordered, canonical)).toBe(false);
    expect(isModified(canonical, null)).toBe(false);
  });

  it("names the chips that changed, in chip order", () => {
    const edited = draft({ origins: ["HKG"], date_to: "2026-11-30", direct_only: true });
    expect(modifiedChips(edited, canonical)).toEqual(["origins", "dates", "direct_only"]);
    expect(isModified(edited, canonical)).toBe(true);
    expect(modifiedChips(canonical, canonical)).toEqual([]);
  });

  it("compares airports in order but cabins and programs as sets", () => {
    expect(modifiedChips(draft({ origins: ["PVG", "HKG", "SHA", "NRT", "HND", "ICN"] }), canonical)).toEqual(["origins"]);
    expect(modifiedChips(draft({ cabins: ["F", "J"] }), canonical)).toEqual([]);
    expect(modifiedChips(draft({ cabins: ["J"] }), canonical)).toEqual(["cabins"]);
    const three = draft({ programs: ["alaska", "american"] });
    expect(modifiedChips(draft({ programs: ["american", "alaska"] }), three)).toEqual([]);
    expect(modifiedChips(three, canonical)).toEqual(["programs"]);
    expect(modifiedChips(draft({ programs: [] }), canonical)).toEqual([]); // empty means All, as does absent
  });

  it("counts the toolbar switch and the miles cap even though they are not chips", () => {
    expect(isModified(draft({ include_filtered: true }), canonical)).toBe(true);
    expect(modifiedChips(draft({ include_filtered: true }), canonical)).toEqual([]);
    expect(isModified(draft({ max_miles: 80_000 }), canonical)).toBe(true);
  });

  it("resetToParsed returns an independent copy of the baseline", () => {
    const restored = resetToParsed(canonical);
    expect(restored).toEqual(canonical);
    restored.origins.push("GMP");
    expect(canonical.origins).toHaveLength(6);
    expect(QueryObject.safeParse(restored).success).toBe(true);
  });
});

describe("validation", () => {
  it("requires at least one origin, destination and cabin", () => {
    const empty = validateQuery(draft({ origins: [], destinations: [], cabins: [] }), en.t);
    expect(empty.valid).toBe(false);
    expect(empty.errors.origins).toBe("Add at least one airport");
    expect(empty.errors.destinations).toBe("Add at least one airport");
    expect(empty.errors.cabins).toBe("Choose at least one cabin");
    expect(validateQuery(canonical, en.t)).toEqual({ valid: true, errors: {}, notes: {} });
  });

  it("reports an inverted range as an error", () => {
    const bad = validateQuery(draft({ date_from: "2026-10-30", date_to: "2026-10-01" }), en.t);
    expect(bad.valid).toBe(false);
    expect(bad.errors.dates).toContain("end date");
  });

  it("treats the 92-day cap as a note, not an error", () => {
    const capped = draft({ date_from: "2026-10-01", date_to: "2026-12-31" });
    expect(capNote(capped, en.t)).toBe("Searches cover at most 92 days.");
    expect(capNote(canonical, en.t)).toBeNull();
    const v = validateQuery(capped, en.t);
    expect(v.valid).toBe(true);
    expect(v.errors.dates).toBeUndefined();
    expect(v.notes.dates).toBe("Searches cover at most 92 days.");
    expect(capNote(capped, zh.t)).toBe("每次搜索最多 92 天。");
  });
});

describe("programs model", () => {
  it("lists every source with its long and short name", () => {
    const all = programsList();
    expect(all).toHaveLength(SEATS_SOURCES.length);
    expect(all[0]!.code).toBe(SEATS_SOURCES[0]);
    expect(all.find((p) => p.code === "alaska")).toEqual({
      code: "alaska",
      name: "Alaska Mileage Plan",
      short: "Alaska",
      selected: false,
    });
    expect(all.every((p) => p.selected === false)).toBe(true);
  });

  it("filters by code, long name or short name and flags the selection", () => {
    expect(programsList({ search: "alask" }).map((p) => p.code)).toEqual(["alaska"]);
    expect(programsList({ search: "mileage plan" }).map((p) => p.code)).toEqual(["alaska"]);
    expect(programsList({ search: "flyingblue" }).map((p) => p.code)).toEqual(["flyingblue"]);
    expect(programsList({ search: "zzz" })).toEqual([]);
    expect(programsList({ selected: ["alaska"] }).find((p) => p.code === "alaska")!.selected).toBe(true);
  });

  it("collapses empty and complete selections to All", () => {
    expect(toggleProgram(null, "alaska")).toEqual(["alaska"]);
    expect(toggleProgram(["alaska"], "alaska")).toBeNull();
    expect(toggleProgram(["alaska"], "american")).toEqual(["alaska", "american"]);
    expect(toggleProgram([...SEATS_SOURCES].slice(0, -1), SEATS_SOURCES.at(-1)!)).toBeNull();
    expect(selectedPrograms({ programs: [] })).toBeNull();
    expect(selectedPrograms({ programs: ["alaska"] })).toEqual(["alaska"]);
  });

  it("counts what the query covers", () => {
    expect(programCount(canonical, 24)).toBe(24);
    expect(programCount({ programs: ["alaska", "american"] }, 24)).toBe(2);
    expect(isAllPrograms(canonical)).toBe(true);
    expect(isAllPrograms({ programs: ["alaska"] })).toBe(false);
    expect(isAllPrograms({ programs: [...SEATS_SOURCES] })).toBe(true);
  });
});
