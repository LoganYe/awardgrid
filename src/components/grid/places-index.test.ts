import { describe, expect, it } from "vitest";
import { buildPlaces } from "@awardgrid/core/query/places";
import {
  DEFAULT_PLACES_INDEX,
  MAX_SEARCH_RESULTS,
  buildPlacesIndex,
  groupForEditor,
  placeLabel,
  searchPlaces,
  toggleAirport,
  toggleMetro,
  validateFreeEntry,
} from "./places-index";

const index = DEFAULT_PLACES_INDEX;
const codes = (list: readonly { code: string }[]) => list.map((e) => e.code);

describe("index shape", () => {
  it("knows every seed code exactly once", () => {
    expect(index.byCode.size).toBe(index.entries.length);
    for (const code of ["HKG", "PVG", "SHA", "NRT", "HND", "ICN", "GMP", "SEA", "ORD", "MDW", "CHI", "TYO", "SEL"]) {
      expect(index.byCode.has(code), code).toBe(true);
    }
  });

  it("marks multi-airport cities as metros and everything else as airports", () => {
    expect(index.byCode.get("TYO")).toMatchObject({ kind: "metro" });
    expect(index.byCode.get("SHA")).toMatchObject({ kind: "metro" });
    expect(index.byCode.get("NRT")).toMatchObject({ kind: "airport", metro: "TYO" });
    expect(index.byCode.get("PVG")).toMatchObject({ kind: "airport", metro: "SHA" });
    expect(index.byCode.get("HKG")).toMatchObject({ kind: "airport", metro: "HKG" });
    // ORD is both a single-airport city key and a member of CHI: the multi-airport city wins.
    expect(index.byCode.get("ORD")).toMatchObject({ kind: "airport", metro: "CHI" });
    expect(index.metroAirports.get("CHI")).toEqual(["ORD", "MDW"]);
    expect(index.metroAirports.get("TYO")).toEqual(["NRT", "HND"]);
    expect(index.metroAirports.get("HKG")).toEqual(["HKG"]);
  });

  it("lists Latin aliases before Chinese ones and labels per locale", () => {
    const hkg = index.byCode.get("HKG")!;
    expect(hkg.names[0]).toBe("hong kong");
    expect(hkg.names).toContain("香港");
    expect(placeLabel(hkg, "en")).toBe("Hong Kong");
    expect(placeLabel(hkg, "zh")).toBe("香港");
    expect(placeLabel(index.byCode.get("SFO"), "en")).toBe("San Francisco");
    expect(placeLabel(index.byCode.get("PVG"), "en")).toBe("Pudong");
    expect(placeLabel(index.byCode.get("PVG"), "zh")).toBe("浦东");
    expect(placeLabel({ code: "ZZZ", kind: "airport", names: [] }, "en")).toBe("ZZZ"); // no alias
    expect(placeLabel(undefined, "en")).toBe("");
  });

  it("accepts an alternate seed", () => {
    const alt = buildPlacesIndex(buildPlaces({ cities: { XXX: ["AAA", "BBB"] }, aliases: { "test city": "XXX" } }));
    expect(codes(alt.entries)).toEqual(["XXX", "AAA", "BBB"]);
    expect(alt.airportMetro.get("BBB")).toBe("XXX");
  });
});

describe("searchPlaces", () => {
  it("puts an exact IATA code first", () => {
    expect(searchPlaces("SEA")[0]!.code).toBe("SEA");
    expect(searchPlaces("sea")[0]!.code).toBe("SEA"); // the editor is case-insensitive
    expect(searchPlaces("PVG")[0]!.code).toBe("PVG");
  });

  it("matches aliases in both languages, prefix before substring", () => {
    expect(searchPlaces("shanghai")[0]!.code).toBe("SHA");
    expect(searchPlaces("上海")[0]!.code).toBe("SHA");
    expect(searchPlaces("东京")[0]!.code).toBe("TYO");
    expect(searchPlaces("Hong Kong")[0]!.code).toBe("HKG");
    expect(codes(searchPlaces("san "))).toContain("SFO");
    expect(codes(searchPlaces("francisco"))).toContain("SFO");
  });

  it("returns nothing for an empty query and caps the result count", () => {
    expect(searchPlaces("")).toEqual([]);
    expect(searchPlaces("   ")).toEqual([]);
    expect(searchPlaces("zzzzz")).toEqual([]);
    expect(searchPlaces("s").length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS);
    expect(searchPlaces("a", index, 3).length).toBeLessThanOrEqual(3);
  });
});

describe("groupForEditor", () => {
  it("groups the canonical query into city rows in query order", () => {
    const rows = groupForEditor(["HKG", "PVG", "SHA", "NRT", "HND", "ICN"]);
    expect(rows.map((r) => r.metro)).toEqual(["HKG", "SHA", "TYO", "SEL"]);
    expect(rows[1]!.airports).toEqual([
      { code: "PVG", selected: true },
      { code: "SHA", selected: true },
    ]);
    expect(rows[1]!.state).toBe("all");
    // Seoul with only ICN selected still offers GMP in the row.
    expect(rows[3]!.airports).toEqual([
      { code: "ICN", selected: true },
      { code: "GMP", selected: false },
    ]);
    expect(rows[3]!.state).toBe("some");
    expect(rows[0]!.airports).toHaveLength(1); // single-airport city, its own row
  });

  it("gives an unknown code its own flagged row", () => {
    const rows = groupForEditor(["HKG", "ZZZ"]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ metro: "ZZZ", airports: [{ code: "ZZZ", selected: true }], state: "all", unknown: true });
    expect(rows[0]!.unknown).toBe(false);
  });

  it("returns no rows for an empty selection", () => {
    expect(groupForEditor([])).toEqual([]);
  });
});

describe("toggles", () => {
  it("toggleMetro adds every missing airport, then removes them all", () => {
    const added = toggleMetro(["HKG"], "TYO");
    expect(added).toEqual(["HKG", "NRT", "HND"]);
    expect(toggleMetro(added, "TYO")).toEqual(["HKG"]);
    expect(toggleMetro(["HKG", "NRT"], "TYO")).toEqual(["HKG", "NRT", "HND"]); // partial → complete
    expect(toggleMetro(["HKG"], "ZZZ")).toEqual(["HKG", "ZZZ"]); // unknown city is its own airport
  });

  it("toggleAirport adds and removes one code without touching the input", () => {
    const before = ["HKG", "NRT"];
    expect(toggleAirport(before, "HND")).toEqual(["HKG", "NRT", "HND"]);
    expect(toggleAirport(before, "NRT")).toEqual(["HKG"]);
    expect(before).toEqual(["HKG", "NRT"]);
  });
});

describe("free IATA entry", () => {
  it("upper-cases three letters and rejects anything else", () => {
    expect(validateFreeEntry(" hnd ")).toEqual({ code: "HND", error: null, unknown: false, duplicate: false });
    expect(validateFreeEntry("Tokyo").error).toBe("format");
    expect(validateFreeEntry("HN").error).toBe("format");
    expect(validateFreeEntry("H1D").error).toBe("format");
    expect(validateFreeEntry("").code).toBeNull();
  });

  it("allows an unknown code but flags it, and spots duplicates", () => {
    expect(validateFreeEntry("ZZZ")).toEqual({ code: "ZZZ", error: null, unknown: true, duplicate: false });
    expect(validateFreeEntry("hkg", ["HKG"])).toEqual({ code: "HKG", error: null, unknown: false, duplicate: true });
  });
});
