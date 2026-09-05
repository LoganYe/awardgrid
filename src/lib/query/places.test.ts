import { describe, expect, it } from "vitest";
import {
  buildPlaces,
  DEFAULT_PLACES,
  expandMentions,
  expandPlace,
  findPlaceMentions,
  resolveAlias,
  splitPlaces,
} from "@/lib/query/places";

describe("seed", () => {
  it("contains the kickoff's required metros and aliases", () => {
    expect(DEFAULT_PLACES.cities.TYO).toEqual(["NRT", "HND"]);
    expect(DEFAULT_PLACES.cities.SEL).toEqual(["ICN", "GMP"]);
    expect(DEFAULT_PLACES.cities.SHA).toEqual(["PVG", "SHA"]);
    expect(DEFAULT_PLACES.cities.BJS).toEqual(["PEK", "PKX"]);
    expect(DEFAULT_PLACES.cities.NYC).toEqual(["JFK", "EWR", "LGA"]);
    expect(DEFAULT_PLACES.cities.LON).toEqual(["LHR", "LGW", "LCY", "STN"]);
    expect(DEFAULT_PLACES.cities.BKK).toEqual(["BKK", "DMK"]);
  });
  it("maps every kickoff §4.2 alias to exactly the code the spec names", () => {
    const table: Record<string, string> = {
      香港: "HKG", 上海: "SHA", 东京: "TYO", 首尔: "SEL", 西雅图: "SEA", 旧金山: "SFO", 洛杉矶: "LAX", 纽约: "NYC",
      台北: "TPE", 北京: "BJS", 大阪: "OSA", 新加坡: "SIN", 温哥华: "YVR", 芝加哥: "ORD", 波士顿: "BOS", 伦敦: "LON",
    };
    for (const [alias, code] of Object.entries(table)) expect(resolveAlias(alias), alias).toBe(code);
    expect(expandMentions(findPlaceMentions("东京"))).toEqual(["NRT", "HND"]);
    expect(expandMentions(findPlaceMentions("上海"))).toEqual(["PVG", "SHA"]);
    expect(expandMentions(findPlaceMentions("首尔"))).toEqual(["ICN", "GMP"]);
  });
  it("zh and en spellings of one city resolve to the same code (same query → same grid)", () => {
    const pairs: Array<[string, string]> = [
      ["芝加哥", "chicago"], ["香港", "hong kong"], ["上海", "shanghai"], ["东京", "tokyo"], ["首尔", "seoul"],
      ["西雅图", "seattle"], ["旧金山", "san francisco"], ["洛杉矶", "los angeles"], ["纽约", "new york"],
      ["台北", "taipei"], ["北京", "beijing"], ["大阪", "osaka"], ["新加坡", "singapore"], ["温哥华", "vancouver"],
      ["波士顿", "boston"], ["伦敦", "london"],
    ];
    for (const [zh, en] of pairs) expect(resolveAlias(en), `${zh}/${en}`).toBe(resolveAlias(zh));
    expect(expandMentions(findPlaceMentions("Chicago to Tokyo"))).toEqual(["ORD", "NRT", "HND"]);
  });
  it("rejects a malformed seed", () => {
    expect(() => buildPlaces({ cities: { tyo: ["NRT"] }, aliases: {} })).toThrow();
    expect(() => buildPlaces({ cities: { TYO: [] }, aliases: {} })).toThrow();
  });
});

describe("expandPlace / resolveAlias", () => {
  it("expands metros and passes airports through", () => {
    expect(expandPlace("TYO")).toEqual(["NRT", "HND"]);
    expect(expandPlace("HND")).toEqual(["HND"]);
    expect(expandPlace("hkg")).toEqual(["HKG"]);
    expect(expandPlace("XYZ")).toEqual(["XYZ"]);
    expect(expandPlace("Tokyo")).toEqual([]);
  });
  it("aliases are case-insensitive, simplified and traditional", () => {
    expect(resolveAlias("Hong Kong")).toBe("HKG");
    expect(resolveAlias("  san   francisco ")).toBe("SFO");
    expect(resolveAlias("首尔")).toBe("SEL");
    expect(resolveAlias("首爾")).toBe("SEL");
    expect(resolveAlias("西雅圖")).toBe("SEA");
    expect(resolveAlias("羽田")).toBe("HND");
  });
  it("raw codes only when upper-case and known", () => {
    expect(resolveAlias("SEA")).toBe("SEA");
    expect(resolveAlias("sea")).toBeNull();
    expect(resolveAlias("ZZZ")).toBeNull();
  });
});

describe("findPlaceMentions", () => {
  it("returns mentions in order with offsets", () => {
    const text = "香港、上海、东京、首尔到西雅图";
    const m = findPlaceMentions(text);
    expect(m.map((x) => x.code)).toEqual(["HKG", "SHA", "TYO", "SEL", "SEA"]);
    expect(m[0]).toEqual({ code: "HKG", matched: "香港", start: 0, end: 2 });
    expect(text.slice(m[4]!.start, m[4]!.end)).toBe("西雅图");
  });
  it("longest alias wins and codes need word boundaries", () => {
    expect(findPlaceMentions("San Francisco to San Diego").map((x) => x.code)).toEqual(["SFO", "SAN"]);
    expect(findPlaceMentions("SEATTLE").map((x) => x.code)).toEqual(["SEA"]);
    expect(findPlaceMentions("the sea is calm").map((x) => x.code)).toEqual([]);
    expect(findPlaceMentions("HKG-SEA").map((x) => x.code)).toEqual(["HKG", "SEA"]);
  });
  it("airport-level aliases resolve to airports", () => {
    expect(expandMentions(findPlaceMentions("成田到虹桥"))).toEqual(["NRT", "PVG", "SHA"]);
    expect(expandMentions(findPlaceMentions("羽田到仁川"))).toEqual(["HND", "ICN"]);
  });
});

describe("splitPlaces", () => {
  const codes = (r: { origins: { code: string }[]; destinations: { code: string }[] }) => ({
    o: r.origins.map((x) => x.code),
    d: r.destinations.map((x) => x.code),
  });
  it("zh list with 到", () => {
    expect(codes(splitPlaces("香港、上海、东京、首尔到西雅图"))).toEqual({ o: ["HKG", "SHA", "TYO", "SEL"], d: ["SEA"] });
  });
  it("from … to … with list separators", () => {
    expect(codes(splitPlaces("from HKG, SHA to SEA / LAX"))).toEqual({ o: ["HKG", "SHA"], d: ["SEA", "LAX"] });
  });
  it("only a to-marker → origins empty", () => {
    expect(codes(splitPlaces("去西雅图"))).toEqual({ o: [], d: ["SEA"] });
    expect(codes(splitPlaces("to Seattle please"))).toEqual({ o: [], d: ["SEA"] });
  });
  it("from after to", () => {
    expect(codes(splitPlaces("to SEA from HKG"))).toEqual({ o: ["HKG"], d: ["SEA"] });
  });
  it("arrows and dashes between places, but not date dashes", () => {
    expect(codes(splitPlaces("HKG → SEA"))).toEqual({ o: ["HKG"], d: ["SEA"] });
    expect(codes(splitPlaces("HKG -> SEA"))).toEqual({ o: ["HKG"], d: ["SEA"] });
    expect(codes(splitPlaces("HKG SEA Oct 1 - Oct 15"))).toEqual({ o: ["HKG", "SEA"], d: [] });
  });
  it("a 到 in a date range before the places does not flip the bucket", () => {
    expect(codes(splitPlaces("10月1日到10月15日 香港到西雅图"))).toEqual({ o: ["HKG"], d: ["SEA"] });
  });
  it("no places at all", () => {
    expect(codes(splitPlaces("next month business"))).toEqual({ o: [], d: [] });
  });
});
