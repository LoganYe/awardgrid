/**
 * Queries typed in Traditional Chinese characters. These tests record what the parser does today; they do not
 * change it, and every expected value is the parser's own output for `today` = 2026-09-06.
 *
 * The iPhone app calls parseQuery with no LLM client (apps/ios/src/search/search.ts, parseText), so a form the
 * deterministic pass cannot read is, in the app, a parse failure that names the missing fields. The whole-query
 * cases below call parseQuery the same way.
 *
 * Read: the place names 臺北 and 台北, 東京, 倫敦, 紐約, 香港 (and the other Traditional aliases in
 * data/places.json); the cabins 頭等, 商務, 公務艙, 經濟, with or without 艙; the dates 10月, 下個月,
 * 12月1日到12月15日 and the other forms in "dates" below; the direction words 到, 至, 往, 飛往, 前往, 從, 由.
 *
 * Not read (the last describe block): 飛 on its own as a direction word (the simplified 飞 is read), 兩周 written
 * with 周 (兩週 is read), 兩週之內, 下禮拜, the place names 伊斯坦堡, 伊斯坦布爾, 西貢, 休士頓, 蒙特利爾,
 * 卡爾加里, 巴塞羅那 and 希思羅, and 哩程 as a sort word; 桃園, 松山, 高雄 and 澳門 are in neither script's place list.
 * When the parser learns one of these, move its case up.
 */
import { describe, expect, it } from "vitest";
import { parseDates } from "./dates";
import { parseCabins, parseDirectOnly, parseMaxMiles, parseSortBy } from "./deterministic";
import { detectLanguage } from "./language";
import { ParseError } from "./llm";
import { parseQuery } from "./parse";
import { expandMentions, findPlaceMentions, resolveAlias, splitPlaces } from "./places";

const today = "2026-09-06";

const codes = (text: string) => {
  const r = splitPlaces(text);
  return { o: r.origins.map((m) => m.code), d: r.destinations.map((m) => m.code) };
};

describe("Traditional Chinese: place names", () => {
  it.each([
    ["臺北", "TPE"],
    ["台北", "TPE"],
    ["東京", "TYO"],
    ["倫敦", "LON"],
    ["紐約", "NYC"],
    ["香港", "HKG"],
    ["首爾", "SEL"],
    ["西雅圖", "SEA"],
    ["舊金山", "SFO"],
    ["洛杉磯", "LAX"],
    ["溫哥華", "YVR"],
    ["多倫多", "YYZ"],
    ["雪梨", "SYD"],
    ["墨爾本", "MEL"],
    ["杜拜", "DXB"],
    ["法蘭克福", "FRA"],
    ["蒙特婁", "YUL"],
    ["巴塞隆納", "BCN"],
    ["希斯路", "LHR"],
    ["休斯頓", "IAH"],
    ["關西", "KIX"],
    ["浦東", "PVG"],
  ])("%s → %s", (alias, code) => {
    expect(resolveAlias(alias)).toBe(code);
  });

  it("the Traditional and simplified spellings of a city resolve to the same code", () => {
    const pairs: Array<[string, string]> = [
      ["臺北", "台北"],
      ["東京", "东京"],
      ["倫敦", "伦敦"],
      ["紐約", "纽约"],
      ["首爾", "首尔"],
      ["西雅圖", "西雅图"],
      ["洛杉磯", "洛杉矶"],
      ["雪梨", "悉尼"],
      ["杜拜", "迪拜"],
    ];
    for (const [hant, other] of pairs)
      expect(resolveAlias(hant), `${hant}/${other}`).toBe(resolveAlias(other));
  });

  it("metros expand to their airports", () => {
    expect(expandMentions(findPlaceMentions("東京"))).toEqual(["NRT", "HND"]);
    expect(expandMentions(findPlaceMentions("倫敦"))).toEqual(["LHR", "LGW", "LCY", "STN"]);
    expect(expandMentions(findPlaceMentions("紐約"))).toEqual(["JFK", "EWR", "LGA"]);
    expect(expandMentions(findPlaceMentions("臺北"))).toEqual(["TPE"]);
    expect(expandMentions(findPlaceMentions("香港"))).toEqual(["HKG"]);
  });
});

describe("Traditional Chinese: direction words", () => {
  it.each([
    ["臺北到東京", ["TPE"], ["TYO"]],
    ["台北到倫敦", ["TPE"], ["LON"]],
    ["臺北至倫敦", ["TPE"], ["LON"]],
    ["台北往東京", ["TPE"], ["TYO"]],
    ["香港飛往東京", ["HKG"], ["TYO"]],
    ["香港前往倫敦", ["HKG"], ["LON"]],
    ["香港到達紐約", ["HKG"], ["NYC"]],
    ["從臺北到紐約", ["TPE"], ["NYC"]],
    ["由香港去倫敦", ["HKG"], ["LON"]],
    ["臺北、香港到東京、倫敦", ["TPE", "HKG"], ["TYO", "LON"]],
    ["臺北 → 紐約", ["TPE"], ["NYC"]],
    ["飛往倫敦", [], ["LON"]],
  ])("%s", (text, o, d) => {
    expect(codes(text)).toEqual({ o, d });
  });
});

describe("Traditional Chinese: cabins", () => {
  it.each([
    ["頭等", ["F"]],
    ["頭等艙", ["F"]],
    ["商務", ["J"]],
    ["商務艙", ["J"]],
    ["公務艙", ["J"]],
    ["經濟", ["Y"]],
    ["經濟艙", ["Y"]],
    ["豪華經濟艙", ["W"]],
    ["超級經濟艙", ["W"]],
    ["超經", ["W"]],
    ["頭等艙或商務艙", ["J", "F"]],
    ["經濟艙和豪華經濟艙", ["Y", "W"]],
  ])("%s → %j", (text, cabins) => {
    expect(parseCabins(text)).toEqual(cabins);
  });

  it("the Traditional and simplified cabin words give the same cabins", () => {
    for (const [hant, hans] of [
      ["頭等", "头等"],
      ["商務", "商务"],
      ["公務艙", "公务舱"],
      ["經濟", "经济"],
      ["豪華經濟", "豪华经济"],
    ] as const) {
      expect(parseCabins(hant), `${hant}/${hans}`).toEqual(parseCabins(hans));
    }
  });
});

describe("Traditional Chinese: dates", () => {
  it.each([
    ["10月", "2026-10-01", "2026-10-31"],
    ["十月", "2026-10-01", "2026-10-31"],
    ["十一月", "2026-11-01", "2026-11-30"],
    ["2026年11月", "2026-11-01", "2026-11-30"],
    // 下個月 is the same window as 下个月 and "next month": 30 days from today, not the calendar month.
    ["下個月", "2026-09-06", "2026-10-05"],
    ["接下來一個月", "2026-09-06", "2026-10-05"],
    ["一個月內", "2026-09-06", "2026-10-05"],
    ["12月1日到12月15日", "2026-12-01", "2026-12-15"],
    ["12月1日至12月15日", "2026-12-01", "2026-12-15"],
    ["12月1日至15日", "2026-12-01", "2026-12-15"],
    ["十二月一日到十二月十五日", "2026-12-01", "2026-12-15"],
    ["2026年12月1日到2026年12月15日", "2026-12-01", "2026-12-15"],
    ["12月1號", "2026-12-01", "2026-12-01"],
    ["十二月十五號", "2026-12-15", "2026-12-15"],
    ["未來兩週", "2026-09-06", "2026-09-19"],
    ["接下來兩週", "2026-09-06", "2026-09-19"],
    ["兩週內", "2026-09-06", "2026-09-19"],
    ["未來一週", "2026-09-06", "2026-09-12"],
    ["一週內", "2026-09-06", "2026-09-12"],
    ["下週", "2026-09-06", "2026-09-12"],
    ["下星期", "2026-09-06", "2026-09-12"],
    ["未來兩個月", "2026-09-06", "2026-11-04"],
    ["未來三個月", "2026-09-06", "2026-12-04"],
    ["今後兩個月", "2026-09-06", "2026-11-04"],
    ["未來30天", "2026-09-06", "2026-10-05"],
    ["30天內", "2026-09-06", "2026-10-05"],
    ["三十天之內", "2026-09-06", "2026-10-05"],
    ["這個月", "2026-09-06", "2026-09-30"],
  ])("%s", (text, from, to) => {
    expect(parseDates(text, today)).toEqual({ date_from: from, date_to: to, capped: false });
  });

  it("Traditional holiday words, like the simplified ones, are not read as dates", () => {
    for (const text of ["十月國慶", "春節", "聖誕"])
      expect(parseDates(text, today), text).toBeNull();
    // An explicit range next to a holiday word is still exact.
    expect(parseDates("國慶 10月1日到10月7日", today)).toEqual({
      date_from: "2026-10-01",
      date_to: "2026-10-07",
      capped: false,
    });
  });
});

describe("Traditional Chinese: other query words", () => {
  it("direct, a miles cap in 萬, the fees sort, and the language", () => {
    expect(parseDirectOnly("直飛")).toBe(true);
    expect(parseMaxMiles("8萬以內")).toBe(80_000);
    expect(parseMaxMiles("不超過10萬")).toBe(100_000);
    expect(parseSortBy("稅費最低")).toBe("fees_asc");
    expect(detectLanguage("臺北到東京")).toBe("zh");
  });
});

describe("Traditional Chinese: whole queries, parsed as the iPhone app parses them (no LLM client)", () => {
  it.each([
    {
      text: "臺北到東京 10月 頭等",
      origins: ["TPE"],
      destinations: ["NRT", "HND"],
      date_from: "2026-10-01",
      date_to: "2026-10-31",
      cabins: ["F"],
    },
    {
      text: "臺北到東京 下個月 商務艙",
      origins: ["TPE"],
      destinations: ["NRT", "HND"],
      date_from: "2026-09-06",
      date_to: "2026-10-05",
      cabins: ["J"],
    },
    {
      text: "台北到倫敦 下個月 商務艙",
      origins: ["TPE"],
      destinations: ["LHR", "LGW", "LCY", "STN"],
      date_from: "2026-09-06",
      date_to: "2026-10-05",
      cabins: ["J"],
    },
    {
      text: "香港到紐約 12月1日到12月15日 公務艙",
      origins: ["HKG"],
      destinations: ["JFK", "EWR", "LGA"],
      date_from: "2026-12-01",
      date_to: "2026-12-15",
      cabins: ["J"],
    },
    {
      text: "臺北到紐約 12月1日到12月15日 經濟艙",
      origins: ["TPE"],
      destinations: ["JFK", "EWR", "LGA"],
      date_from: "2026-12-01",
      date_to: "2026-12-15",
      cabins: ["Y"],
    },
  ])("$text", async ({ text, ...want }) => {
    const res = await parseQuery(text, { today });
    expect(res.used_llm).toBe(false);
    expect(res.warnings).toEqual([]);
    expect(res.query).toMatchObject({ ...want, language: "zh", raw_text: text });
  });

  it("several places, both cabins, direct, a miles cap and the fees sort in one query", async () => {
    const res = await parseQuery(
      "從臺北、香港到東京、倫敦 未來兩週 頭等或商務 直飛 8萬以內 稅費最低",
      { today },
    );
    expect(res.used_llm).toBe(false);
    expect(res.query).toMatchObject({
      origins: ["TPE", "HKG"],
      destinations: ["NRT", "HND", "LHR", "LGW", "LCY", "STN"],
      date_from: "2026-09-06",
      date_to: "2026-09-19",
      cabins: ["J", "F"],
      direct_only: true,
      max_miles: 80_000,
      sort_by: "fees_asc",
      language: "zh",
    });
  });
});

describe("Traditional Chinese: forms the parser does not read today", () => {
  it("飛 on its own is not a direction word (飞 is), so both places become origins", async () => {
    expect(codes("香港飞东京")).toEqual({ o: ["HKG"], d: ["TYO"] });
    expect(codes("香港飛東京")).toEqual({ o: ["HKG", "TYO"], d: [] });
    expect(codes("臺北飛紐約")).toEqual({ o: ["TPE", "NYC"], d: [] });
    const err = await parseQuery("香港飛東京 下個月 商務", { today }).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(ParseError);
    expect((err as ParseError).missing).toEqual(["destinations"]);
  });

  it("兩周 written with 周, 兩週之內 and 下禮拜 are not read as dates", async () => {
    for (const text of ["未來兩周", "兩周內", "兩週之內", "下禮拜", "下個禮拜"])
      expect(parseDates(text, today), text).toBeNull();
    // The forms beside them that are read.
    expect(parseDates("未來兩週", today)).toEqual({
      date_from: "2026-09-06",
      date_to: "2026-09-19",
      capped: false,
    });
    expect(parseDates("两周之内", today)).toEqual({
      date_from: "2026-09-06",
      date_to: "2026-09-19",
      capped: false,
    });
    const err = await parseQuery("臺北到東京 未來兩周 經濟", { today }).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(ParseError);
    expect((err as ParseError).missing).toEqual(["date_from", "date_to"]);
  });

  it("some Traditional or Taiwan spellings of a city in the list are missing", () => {
    for (const alias of [
      "伊斯坦堡",
      "伊斯坦布爾",
      "西貢",
      "休士頓",
      "蒙特利爾",
      "卡爾加里",
      "巴塞羅那",
      "希思羅",
    ]) {
      expect(resolveAlias(alias), alias).toBeNull();
    }
    // The spellings of the same cities that are read.
    expect(resolveAlias("伊斯坦布尔")).toBe("IST");
    expect(resolveAlias("西贡")).toBe("SGN");
    expect(resolveAlias("休斯頓")).toBe("IAH");
    expect(resolveAlias("蒙特婁")).toBe("YUL");
    expect(resolveAlias("卡加利")).toBe("YYC");
    expect(resolveAlias("巴塞隆納")).toBe("BCN");
    expect(resolveAlias("希斯路")).toBe("LHR");
  });

  it("Taiwan and Macau airports outside the 70 metros are not in the list in either script", () => {
    for (const alias of ["桃園", "松山", "高雄", "澳門", "桃园", "澳门"])
      expect(resolveAlias(alias), alias).toBeNull();
  });

  it("哩程 is not a sort word (里程 is); the sort still defaults to miles_asc", async () => {
    expect(parseSortBy("哩程最低")).toBeNull();
    expect(parseSortBy("里程最低")).toBe("miles_asc");
    const res = await parseQuery("臺北到東京 10月 商務 哩程最低", { today });
    expect(res.query.sort_by).toBe("miles_asc");
    expect(res.provenance.sort_by).toBe("default");
  });
});
