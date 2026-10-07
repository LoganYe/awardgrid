/**
 * The planner's parse (release plan step 18): free text, in English or Chinese, read by the deterministic parser with
 * no key and nothing sent. `parsePlan` has no key gate; `parseText`, a search's first half, keeps it. What the parser
 * says — a notice on a plan, or why a text could not be read — comes back structured, so the planner says it in the
 * screen's language, in the words core's dictionaries give it.
 */
import { describe, expect, it, vi } from "vitest";
import { zh as ZH_DICTIONARY } from "@awardgrid/core/i18n/dictionaries/zh";
import { NOTICES_EN } from "@awardgrid/core/i18n/dictionaries/notices-en";
import { InMemoryQuotaStore, Quota } from "@awardgrid/core/seatsaero/quota";
import { bootstrap } from "../app/bootstrap";
import { PARSE_NOTICES_ZH, planNoticeText } from "../components/plan/plan-copy";
import { planFailureText } from "../components/plan/PlanSearch";
import { MemoryKeyStore } from "../native/keychain";
import { MemoryFileStore, SnapshotStore } from "../store/persistence";
import { SearchEngine } from "./search";

const NOW = new Date("2026-10-18T08:30:00.000Z");

function engine() {
  const fetchImpl = vi.fn(async () => new Response("{}"));
  const quota = new Quota({ store: new InMemoryQuotaStore(), now: () => NOW });
  return { engine: new SearchEngine({ fetchImpl: fetchImpl as unknown as typeof fetch, quota, now: () => NOW }), fetchImpl, quota };
}

describe("parsePlan: the deterministic parse with no key", () => {
  it("reads an English trip with no key, and sends nothing", async () => {
    const { engine: e, fetchImpl, quota } = engine();
    const plan = await e.parsePlan("HKG to SEA next 30 days business");
    expect(plan).toMatchObject({ ok: true, value: { notices: [], warnings: [] } });
    expect(plan.ok && plan.value.query).toMatchObject({ origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-18", date_to: "2026-11-16", cabins: ["J"], language: "en" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await quota.used("local")).toBe(0);
  });

  it("reads the same trip in Chinese as the same search, and expands a city to its airports", async () => {
    const { engine: e, fetchImpl } = engine();
    const en = await e.parsePlan("HKG, SHA to SEA, next 30 days, business and first");
    const zh = await e.parsePlan("香港、上海到西雅图 未来30天 商务舱和头等舱");
    expect(en.ok && zh.ok).toBe(true);
    if (!en.ok || !zh.ok) return;
    expect(zh.value.query.language).toBe("zh");
    for (const field of ["origins", "destinations", "date_from", "date_to"] as const) expect(zh.value.query[field]).toEqual(en.value.query[field]);
    expect([...zh.value.query.cabins].sort()).toEqual([...en.value.query.cabins].sort());
    // 上海 is the Shanghai metro in the places seed: both its airports.
    expect(zh.value.query.origins).toEqual(["HKG", "PVG", "SHA"]);
    const tokyo = await e.parsePlan("东京到纽约 下个月 头等舱");
    expect(tokyo.ok && tokyo.value.query).toMatchObject({ origins: ["NRT", "HND"], destinations: ["JFK", "EWR", "LGA"], cabins: ["F"] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps what the parser said about the text, and says it in either language", async () => {
    const { engine: e } = engine();
    const past = await e.parsePlan("LAX to Tokyo 2026-09-01 to 2026-09-10");
    expect(past.ok && past.value.notices).toEqual([{ code: "parse.start_in_past", vars: { date_from: "2026-09-01", today: "2026-10-18" } }]);
    if (!past.ok) return;
    const notice = past.value.notices[0]!;
    expect(planNoticeText(notice, "en")).toEqual({ text: "Start date 2026-09-01 is before today (2026-10-18)." });
    expect(planNoticeText(notice, "zh")).toEqual({ text: "开始日期 2026-09-01 早于今天（2026-10-18）。" });
    const long = await e.parsePlan("NRT to LHR 2026-11-01 to 2027-03-01 business");
    expect(long.ok && long.value.notices.map((n) => n.code)).toEqual(["parse.range_truncated"]);
    if (long.ok) expect(planNoticeText(long.value.notices[0]!, "zh").text).toBe("日期范围已缩短为 92 天（2026-11-01 至 2027-01-31）。更长的范围请分多次搜索。");
  });

  it("a text it cannot read fails with the fields it missed and the parser's notice, said in English or Chinese", async () => {
    const { engine: e, fetchImpl } = engine();
    for (const text of ["HKG to SEA", "香港到西雅图"]) {
      const failure = await e.parsePlan(text);
      expect(failure).toMatchObject({ ok: false, status: 422, error: "parse", missing: ["date_from", "date_to"], notice: { code: "parse.missing", vars: { text } } });
      if (failure.ok) continue;
      expect(planFailureText(failure, "en")).toEqual({ text: failure.message });
      expect(planFailureText(failure, "en").text).toContain("next month");
      expect(planFailureText(failure, "zh")).toEqual({ text: `无法从“${text}”中识别开始日期、结束日期。请写明城市（如 香港到西雅图 或 HKG to SEA）和日期范围（如 未来一个月 或 next month）。` });
    }
    const empty = await e.parsePlan("   ");
    expect(empty).toMatchObject({ ok: false, status: 400, error: "invalid_body", notice: { code: "parse.empty" } });
    if (!empty.ok) {
      expect(planFailureText(empty, "zh")).toEqual({ text: "请先输入查询。" });
      expect(planFailureText(empty, "en")).toEqual({ text: "Enter a query first." });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a failure without a notice is said in the engine's English words, marked as English on a Chinese screen", () => {
    const failure = { ok: false as const, status: 500, error: "internal" as const, message: "Something broke." };
    expect(planFailureText(failure, "en")).toEqual({ text: "Something broke." });
    expect(planFailureText(failure, "zh")).toEqual({ text: "Something broke.", lang: "en" });
    // A notice with no Chinese here (a language model's, which the planner never calls) stays English, marked so.
    expect(planNoticeText({ code: "parse.llm_retry" }, "zh")).toEqual({ text: NOTICES_EN["notice.parse.llm_retry"], lang: "en" });
  });

  it("the key gate stays for searches: parseText without a key is no_key, with one it reads exactly as parsePlan", async () => {
    const { engine: e } = engine();
    expect(await e.parseText("HKG to SEA next 30 days business", null)).toMatchObject({ ok: false, error: "no_key" });
    expect(await e.parseText("HKG to SEA next 30 days business", "")).toMatchObject({ ok: false, error: "no_key" });
    expect(await e.parseText("HKG to SEA next 30 days business", "key")).toEqual(await e.parsePlan("HKG to SEA next 30 days business"));
    expect(await e.search("HKG to SEA next 30 days business", null)).toMatchObject({ ok: false, error: "no_key" });
  });

  it("the services read a plan with no key on the device, sending nothing, while a typed search still needs one", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const services = await bootstrap({
      keys: new MemoryKeyStore(),
      anthropicKeys: new MemoryKeyStore(),
      snapshots: new SnapshotStore(new MemoryFileStore()),
      now: () => NOW,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      anthropicFetch: fetchImpl as unknown as typeof fetch,
      assertNative: () => {},
    });
    const plan = await services.parsePlan("香港到西雅图 未来30天 商务舱");
    expect(plan.ok && plan.value.query).toMatchObject({ origins: ["HKG"], destinations: ["SEA"], cabins: ["J"] });
    expect(await services.prepareText("香港到西雅图 未来30天 商务舱")).toMatchObject({ ok: false, error: "no_key" });
    expect(await services.searchText("香港到西雅图 未来30天 商务舱")).toMatchObject({ ok: false, error: "no_key" });
    expect(services.workspace.getState().revision).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the parser's notices in Chinese", () => {
  it("are core's dictionary sentences, word for word, for every notice the deterministic parser gives", () => {
    const codes = Object.keys(PARSE_NOTICES_ZH);
    expect(codes.sort()).toEqual(["parse.empty", "parse.end_before_start", "parse.invalid", "parse.missing", "parse.range_end_first", "parse.range_truncated", "parse.start_far_out", "parse.start_in_past"]);
    for (const code of codes) expect(PARSE_NOTICES_ZH[code as keyof typeof PARSE_NOTICES_ZH], code).toBe(ZH_DICTIONARY[`notice.${code}` as keyof typeof ZH_DICTIONARY]);
  });

  it("name the missing fields as core's dictionary does", () => {
    const said = planNoticeText({ code: "parse.missing", vars: { fields: "origin airport(s), destination airport(s)", text: "next month" } }, "zh", ["origins", "destinations"]);
    expect(said.text).toContain(`识别${ZH_DICTIONARY["grid.missing.origins"]}、${ZH_DICTIONARY["grid.missing.destinations"]}。`);
    // Without the field list, the sentence cannot be said in Chinese: it stays English, marked so.
    expect(planNoticeText({ code: "parse.missing", vars: { fields: "start date", text: "x" } }, "zh", [])).toMatchObject({ lang: "en" });
  });
});
