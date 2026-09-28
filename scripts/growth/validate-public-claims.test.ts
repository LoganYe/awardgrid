/**
 * The public-claims gate (scripts/growth/validate-public-claims.mjs), rule by rule: every rule fails on a positive
 * example and passes on a negative one, in English and, where the rule has Chinese, in Chinese. The status modes, the
 * page reading (the same as `landingTexts` in apps/ios/src/honesty.test.ts), the registry checks and the CLI are
 * pinned too. The regression on 2026-09-28's pages is in fixtures-2026-09-28.test.ts; the current tree in
 * current-tree.test.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  PROGRAM_BRANDS,
  RULE_IDS,
  checkEvidenceRef,
  checkRegistry,
  htmlDocument,
  isNegated,
  markdownDocument,
  parseArgs,
  programList,
  scanContent,
  trademarkTerms,
  validate,
} from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(import.meta.dirname, "validate-public-claims.mjs");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, "growth", "product-facts.json"), "utf8"));
type Status = "submitted" | "released" | "withdrawn";

/** The rules a piece of copy trips, as `RULE "match"`, read as the given file in the given status. */
function hits(text: string, opts: { status?: Status; logical?: string; dist?: boolean; registry?: unknown } = {}): string[] {
  const { status = "submitted", logical = "draft.md", dist = false, registry = REGISTRY } = opts;
  return scanContent(text, { logical, dist, status, registry, root: ROOT }).map((f) => `${f.rule} ${JSON.stringify(f.match)}`);
}
const rules = (text: string, opts: Parameters<typeof hits>[1] = {}) => [...new Set(hits(text, opts).map((h) => h.split(" ")[0]))];
const html = (body: string) => `<!doctype html><html><head><title>t</title></head><body><main>${body}</main></body></html>`;
const PAGE = "sites/landing/ios/index.html";

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "public-claims-"));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------
// Content rules: a positive and a negative example each, English and Chinese
// ---------------------------------------------------------------------------------------------------------------

const CASES: ReadonlyArray<{ rule: string; lang: "en" | "zh"; fail: string[]; pass: string[] }> = [
  {
    rule: "LIVE",
    lang: "en",
    fail: [
      "Real-time award availability.",
      "Live award availability for your routes.",
      "Results arrive instantly.",
      // A stray negation elsewhere in the sentence negates nothing here.
      "AwardGrid has no ads and sends real-time alerts for every airline.",
      "Set up in no time and get instant alerts on every route.",
      "Not just a search tool — live alerts around the clock.",
      "Real-time alerts are not a luxury anymore.",
      "AwardGrid, with no ads, sends real-time alerts.",
      "With no ads, sends real-time alerts or push notifications.",
      "No more spreadsheets — real-time award alerts.",
      "No spreadsheets – live award availability.",
      "No spreadsheets - live award availability.",
      // A question that does not ask is a claim.
      "Looking for real-time award alerts?",
      "Get real-time alerts — why wait?",
      "AwardGrid sends real-time alerts for every airline, right?",
      "Why not get real-time alerts?",
    ],
    pass: [
      "Results are seats.aero's cached availability, not a live search.",
      "Live Search is never used.",
      "Are the results live?",
      "No live search",
      "It isn’t a live search.",
      "If you live in mainland China, the app is not offered there.",
    ],
  },
  {
    rule: "LIVE",
    lang: "zh",
    // 非常 (very), 特别 (especially) and 不同 (different) are not negations.
    fail: ["实时查询里程票。", "即时更新。", "非常方便的实时查询。", "特别适合实时查票。", "不同航线实时推送。"],
    pass: ["结果不是实时的。", "结果是实时的吗？", "不提供实时查询、提醒或推送。"],
  },
  {
    rule: "ALERT",
    lang: "en",
    fail: [
      "We alert you when seats open up.",
      "Get push notifications.",
      "AwardGrid monitors your routes.",
      "It keeps checking in the background.",
      "Never miss a seat.",
      "No more refreshing — AwardGrid alerts you the moment seats open.",
      "No sign-up required and AwardGrid sends you alerts.",
    ],
    pass: [
      "There is no background check and no notification.",
      "No alerts or notifications.",
      "It covers the programs seats.aero lists, where seats.aero monitors the route.",
      'A route it does not monitor is marked "not monitored".',
      "Will it alert me when award seats open up?",
      "AwardGrid doesn’t send alerts.",
      "Watches aren’t checked in the background.",
      "The app does not send you alerts or push notifications.",
      "AwardGrid has no ads, alerts or tracking.",
    ],
  },
  {
    rule: "ALERT",
    lang: "zh",
    fail: ["有座位时提醒你。", "后台监控航线。", "不错过任何座位。", "不断推送最新余票。", "不用刷新，实时提醒你。", "有新座位时会通知你。", "AwardGrid 帮你监控余票。", "未来会有实时提醒。"],
    pass: ["没有提醒，也没有推送。", "应用不会在后台检查。", "“未监控”是什么意思？", "数据源未监测这些机场对。"],
  },
  {
    rule: "AFFILIATION",
    lang: "en",
    fail: [
      "The official seats.aero app for iPhone.",
      "Built in partnership with seats.aero.",
      "Powered by seats.aero.",
      "Endorsed by seats.aero.",
      "AwardGrid is seats.aero for iPhone.",
      "Seats.aero’s app for iPhone, finally.",
    ],
    pass: [
      "AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero, Anthropic, any airline, or any loyalty program.",
      "It gets availability from the seats.aero Partner API.",
      "Is AwardGrid affiliated with seats.aero?",
    ],
  },
  {
    rule: "AFFILIATION",
    lang: "zh",
    fail: ["seats.aero 官方授权的应用。", "AwardGrid 与 seats.aero 有关联。", "已获 seats.aero 认可。"],
    pass: ["AwardGrid 与 seats.aero、Anthropic、任何航空公司或任何里程计划均无关联，也未获其认可或赞助。", "转点前请先在里程计划官网确认。"],
  },
  {
    rule: "COMPETITOR_FRAME",
    lang: "en",
    fail: [
      "A seats.aero alternative for iPhone.",
      "AwardGrid vs seats.aero",
      "Cheaper than seats.aero.",
      // Denying the prerequisite.
      "Free to use — no seats.aero Pro subscription needed.",
      "You don't need a seats.aero Pro subscription.",
      "A seats.aero Pro subscription is optional.",
    ],
    pass: [
      "Its data comes from seats.aero.",
      "It is not a seats.aero alternative.",
      "It needs your own paid seats.aero Pro subscription with API access; without that key it searches nothing.",
    ],
  },
  { rule: "COMPETITOR_FRAME", lang: "zh", fail: ["seats.aero 平替", "seats.aero 的替代品", "AwardGrid 免费，不需要 Pro 订阅。"], pass: ["数据来自 seats.aero。", "免费应用，但需要你自己的 seats.aero Pro 订阅。"] },
  {
    rule: "BOOKING",
    lang: "en",
    fail: ["AwardGrid books your award ticket.", "Auto-book the cheapest seat."],
    pass: ["It never books.", "For an option it opens seats.aero's booking link when there is one.", "Does it book tickets?", "You book the seat yourself, on the program's own site."],
  },
  { rule: "BOOKING", lang: "zh", fail: ["自动出票。", "一键预订座位。"], pass: ["它从不预订任何东西。"] },
  {
    rule: "ALL_COVERAGE",
    lang: "en",
    fail: ["Covers all airlines.", "Every program, in one table.", "Deep links to each program.", "AwardGrid has no ads and sends alerts for every airline."],
    pass: ["It covers the 26 programs seats.aero lists.", "The app makes every seats.aero call itself.", "Not every program is covered."],
  },
  { rule: "ALL_COVERAGE", lang: "zh", fail: ["覆盖所有航司。", "每个项目直达。"], pass: ["不是所有航空公司都有。", "任何航空公司或任何里程计划"] },
  {
    rule: "AI_SEARCH",
    lang: "en",
    fail: ["AI search for award seats.", "The AI understands your question.", "AI-powered award search for your iPhone."],
    pass: ["The search parser is deterministic; Ask answers with Claude.", "Search is not AI search.", "Claude-powered answers about your search results."],
  },
  { rule: "AI_SEARCH", lang: "zh", fail: ["AI 搜索里程票。", "智能搜索。"], pass: ["查票不是 AI 搜索。", "AI 辅助是可选功能。"] },
  {
    rule: "PLATFORM_OVERCLAIM",
    lang: "en",
    fail: ["Available for iPad and Android.", "A Traditional Chinese interface."],
    pass: ["Not available on iPad or Android.", "An iPhone app in English or Simplified Chinese."],
  },
  { rule: "PLATFORM_OVERCLAIM", lang: "zh", fail: ["支持安卓。", "繁体中文界面。"], pass: ["没有安卓版。", "界面是简体中文和英文。"] },
  {
    rule: "SCRAPING",
    lang: "en",
    fail: ["It scrapes airline sites for you.", "A crawler reads the programs' pages."],
    pass: ["No scraping of airline or bank sites.", "awardgrid never automates, crawls or scrapes any airline, alliance or bank website."],
  },
  { rule: "SCRAPING", lang: "zh", fail: ["抓取航司网站。"], pass: ["不抓取航司网站。"] },
  {
    rule: "EXCLUSIVITY",
    lang: "en",
    fail: [
      "The only app that shows a grid.",
      "The best award search.",
      "The first iPhone app for award grids.",
      "An industry-leading grid.",
      "The only award grid app.",
      "The first award search tool on iPhone.",
      "AwardGrid is the first-ever award grid for iPhone.",
    ],
    pass: [
      "Only for Ask, which is optional.",
      "The app shows only a key's last four characters.",
      "The leading @ is stripped from a bot name.",
      "Before the first question the app asks your permission.",
    ],
  },
  { rule: "EXCLUSIVITY", lang: "zh", fail: ["唯一的里程票表格应用。", "首款里程票应用。"], pass: ["应用只显示密钥的末四位。"] },
  {
    rule: "FREE_WITHOUT_PRO",
    lang: "en",
    fail: [
      "AwardGrid is a free app.",
      "No subscription fees.",
      "Free of charge, no strings attached.",
      // "seats.aero Pro" nearby, but denied: it does not make "free" true.
      "Free to use — no seats.aero Pro subscription needed.",
      "AwardGrid is a free app, and you don't need a seats.aero Pro subscription.",
      "Totally free: no seats.aero Pro needed.",
      "Free to use. You do not need seats.aero Pro.",
    ],
    pass: [
      "AwardGrid for iPhone has been submitted as a free app, with no in-app purchase. It needs your own paid seats.aero Pro subscription with API access; without that key it searches nothing.",
      "Is AwardGrid free?",
      "A free-text query.",
      "Questions? Feel free to write to support.",
      "Delete old searches to free up space on your iPhone.",
    ],
  },
  {
    rule: "FREE_WITHOUT_PRO",
    lang: "zh",
    fail: ["AwardGrid 是免费应用。", "无广告，完全免费。", "AwardGrid 免费，不需要 Pro 订阅。"],
    pass: ["免费应用，但需要你自己的 seats.aero Pro 订阅。"],
  },
  {
    rule: "PRICE_UNSOURCED",
    lang: "en",
    fail: [
      "seats.aero Pro costs $9.99 a month.",
      "Each Ask question costs about $0.05.",
      "seats.aero Pro costs €9.99 a month.",
      "Each Ask question costs about 2 cents on your Anthropic key.",
      "A seats.aero Pro subscription is 10 bucks a month.",
    ],
    pass: ["Anthropic bills each question to that key.", "A fare of $450 on the program's own site."],
  },
  { rule: "PRICE_UNSOURCED", lang: "zh", fail: ["Pro 每月 9.99 美元。", "seats.aero Pro 每月约 70 元。"], pass: ["Anthropic 按每次提问向该密钥计费。", "Pro 密钥每天允许 1,000 次，应用在 950 次时停止。"] },
  {
    rule: "PRIVATE_WEBAPP",
    lang: "en",
    fail: [
      "AwardGrid is a private, invite-only app.",
      "A friends-only tool.",
      "The earlier private web app at this address has been shut down.",
      "AwardGrid is a members-only web app.",
      "AwardGrid is in closed beta, by invite.",
    ],
    pass: [
      "AwardGrid began as a private, invite-only web app for its developer and a small group of friends. The iPhone app has been submitted to the App Store as a separate public release.",
      "This repo also holds a private, invite-only web app, separate from the iPhone app.",
      "The web app at this address is private and invite-only; it is separate from the iPhone app.",
      "Read the privacy policy.",
      "Keep your key private.",
      "Never paste a private key.",
      "Your Anthropic key stays private on this iPhone.",
    ],
  },
  { rule: "PRIVATE_WEBAPP", lang: "zh", fail: ["私人应用，邀请制。", "AwardGrid 是一个私有的网页应用。", "AwardGrid 是一个网页应用，仅供受邀用户使用。"], pass: ["隐私政策", "私有密钥不会离开设备。"] },
  {
    rule: "NO_SERVER_SUBJECT",
    lang: "en",
    fail: ["No accounts. No server.", "There is no server to collect any of it.", "AwardGrid (App ID 6816321841) has no accounts and no server."],
    pass: ["The AwardGrid iPhone app has no accounts and no server of its own.", "There is no shared key and no server key.", "The app needs no account."],
  },
  {
    rule: "NO_SERVER_SUBJECT",
    lang: "zh",
    fail: ["AwardGrid 没有账号，也没有自己的服务器。", "这个网页版没有帐号。", "Web App 没有账号。"],
    pass: ["AwardGrid iPhone App 没有账户，也没有自己的服务器。", "App 没有账号，也没有自己的服务器。"],
  },
];

describe("content rules: each fails on a claim and passes on the honest sentence", () => {
  it("covers every content rule, in English, and in Chinese where the rule has Chinese", () => {
    const covered = new Set(CASES.map((c) => `${c.rule}/${c.lang}`));
    const contentRules = RULE_IDS.filter((r: string) => !["STALE_STATUS", "PREMATURE_STATUS", "WITHDRAWN_STATUS", "PENDING_CLAIM_TEXT", "HTML_COMMENT_IN_DIST", "SCRIPT_NOT_LD_JSON", "ATTRIBUTION_LINK", "SCHEMA_JSON", "TRADEMARK_ASO"].includes(r));
    for (const rule of contentRules) {
      expect(covered.has(`${rule}/en`), rule).toBe(true);
      expect(covered.has(`${rule}/zh`), rule).toBe(true);
    }
  });

  for (const { rule, lang, fail, pass } of CASES) {
    it.each(fail)(`${rule} (${lang}) fails %j`, (text) => {
      expect(rules(text)).toContain(rule);
    });
    it.each(pass)(`${rule} (${lang}) passes %j`, (text) => {
      expect(rules(text)).not.toContain(rule);
    });
  }

  it.each(["not live", "no alerts", "never books", "does not monitor your routes", "没有提醒", "不是实时"])("the negation guard lets %j pass", (text) => {
    expect(hits(`It is ${text}.`)).toEqual([]);
  });

  it("a negation does not reach past the end of its clause", () => {
    expect(rules("It is not cached. It sends real-time alerts.")).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules("No. It books for you.")).toContain("BOOKING");
    // A comma, "and", a dash or "but" end a clause.
    expect(rules("No setup required, get real-time alerts.")).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules("No signup needed, and it books your flight.")).toContain("BOOKING");
    expect(rules("Nothing to install, just live results.")).toContain("LIVE");
    expect(rules("AwardGrid has no ads and sends real-time alerts.")).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules("No more spreadsheets — real-time award alerts.")).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules("No spreadsheets – live award availability.")).toContain("LIVE");
    expect(rules("No spreadsheets - live award availability.")).toContain("LIVE");
    expect(hits("It never opens an airline site for you, and it never asks for an airline or bank password.")).toEqual([]);
    expect(hits("No live search, no booking, no round trips, no alerts or notifications.")).toEqual([]);
    // A negation after the match counts only when the match is the subject of a negated "used/offered/available…".
    expect(isNegated("AwardGrid sends alerts, not emails", 16, 22)).toBe(false);
    expect(isNegated("Live Search is never used", 0, 4)).toBe(true);
    expect(isNegated("Real-time alerts are not a luxury anymore.", 0, 9)).toBe(false);
  });

  it("a negation governs only the words right after it, and idioms negate nothing", () => {
    // Too far from the match: a determiner reaches two words, a negated verb four.
    expect(hits("It does not send you alerts.")).toEqual([]);
    expect(hits("It doesn't check for new seats in the background.")).toEqual([]);
    expect(rules("With no setup whatsoever you get real-time alerts.")).toContain("LIVE");
    // "no time", "no more", "not just", "not only", "nothing but", "why not" negate nothing.
    for (const text of ["Set up in no time and get instant results.", "No more refreshing: live results.", "Not only live results.", "Nothing but live results.", "Why not get live results?"]) {
      expect(rules(text), text).toContain("LIVE");
    }
  });

  it("a negation carries through a list: after a negated match, or over a comma list the match is an item of", () => {
    expect(hits("AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero.")).toEqual([]);
    expect(hits("awardgrid never automates, crawls or scrapes any airline, alliance, loyalty-program, or bank website.")).toEqual([]);
    expect(hits("AwardGrid has no ads, alerts or tracking.")).toEqual([]);
    expect(hits("The app does not send you alerts or push notifications.")).toEqual([]);
    expect(hits("不提供实时查询、提醒或推送。")).toEqual([]);
    // Not a list: the match does not start its item, or something new starts before it.
    expect(rules("AwardGrid, with no ads, sends real-time alerts.")).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules("With no ads, sends real-time alerts or push notifications.")).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules("No alerts, just instant results.")).toContain("LIVE");
    expect(rules("Not a subscription, real-time alerts included.")).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules("不会推送，而是实时查询。")).toContain("LIVE");
  });

  it("a table row's header is negated by a cell that only says no", () => {
    expect(hits("| Feature | In the app |\n|---|---|\n| Alerts | Not offered |\n| Live search | No |\n")).toEqual([]);
    expect(hits(html("<table><tr><th>Alerts</th><td>Not offered</td></tr><tr><th>Live search</th><td>No</td></tr></table>"), { logical: PAGE })).toEqual([]);
    expect(hits("Alerts: not offered.")).toEqual([]);
    // A heading followed by a sentence that starts with "No" is not a table row.
    expect(rules(html("<h2>Real-time alerts</h2><p>No setup needed: AwardGrid does it.</p>"), { logical: PAGE })).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules(html("<table><tr><th>Alerts</th><td>Yes, instantly</td></tr></table>"), { logical: PAGE })).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
  });

  it("a question passes only when it asks: it starts with is/does/can/what/… (or asks with 吗/是否 …) and ends in ?", () => {
    for (const q of ["Are the results live?", "Will it alert me when award seats open up?", "Q: Is AwardGrid free?", "Does it book tickets?", "结果是实时的吗？", "它会提醒我吗？", "是否支持实时查询？"]) {
      expect(hits(q), q).toEqual([]);
    }
    for (const q of ["Looking for real-time award alerts?", "Get real-time alerts — why wait?", "AwardGrid sends real-time alerts for every airline, right?", "实时查询，还等什么？"]) {
      expect(rules(q), q).toContain("LIVE");
    }
  });

  it("reads typographic apostrophes as plain ones, so doesn’t, isn’t and aren’t negate", () => {
    expect(hits("AwardGrid doesn’t send alerts. It isn’t a live search. Watches aren’t checked in the background.")).toEqual([]);
    expect(hits("It’s not available on the App Store yet.")).toEqual([]);
  });

  it('NO_SERVER_SUBJECT takes "the app", "iPhone app" or Chinese copy\'s "App" as the subject, never "Web App", "App ID" or "App Store"', () => {
    expect(rules(html("<h2>Web App</h2><p>AwardGrid has no accounts and no server of its own.</p>"), { logical: PAGE })).toEqual(["NO_SERVER_SUBJECT"]);
    expect(rules(html("<p>AwardGrid (App ID 6816321841) has no accounts and no server.</p>"), { logical: PAGE })).toEqual(["NO_SERVER_SUBJECT"]);
    expect(rules(html("<p>The Web App has no accounts.</p>"), { logical: PAGE })).toEqual(["NO_SERVER_SUBJECT"]);
    expect(rules("Web App 没有账号。")).toEqual(["NO_SERVER_SUBJECT"]);
    expect(hits(html("<h2>The iPhone app</h2><p>AwardGrid has no accounts and no server of its own.</p>"), { logical: PAGE })).toEqual([]);
    expect(hits("App 没有账号，也没有自己的服务器。")).toEqual([]);
  });

  it("NO_SERVER_SUBJECT reads a table row's header, or a heading, as the subject of the text right after it", () => {
    const cell = "No telemetry, no advertising, no tracking. There is no server to collect any of it.";
    const row = (header: string) => html(`<table><tbody><tr><th scope="row">${header}</th><td>${cell}</td></tr></tbody></table>`);
    // The /ios/ row as the analytics-disclosure change words it: the header names the app, for itself and its cell.
    expect(hits(row("No accounts, no analytics in the app"), { logical: PAGE })).toEqual([]);
    // The row as it was on 2026-09-28: neither the header nor the cell names a subject.
    expect(hits(row("No accounts, no analytics"), { logical: PAGE })).toEqual(['NO_SERVER_SUBJECT "No accounts"', 'NO_SERVER_SUBJECT "no server"']);
    expect(hits(html("<h3>The iPhone app</h3><p>No accounts. No server.</p>"), { logical: PAGE })).toEqual([]);
    // Only a short run counts, and only the one right before: a paragraph about the app does not name the subject
    // of the next paragraph, nor does a heading two runs back.
    expect(rules(html(`<p>The app keeps every result on your device, and it deletes them when you ask.</p><p>${cell}</p>`), { logical: PAGE })).toEqual(["NO_SERVER_SUBJECT"]);
    expect(rules(html(`<h3>The iPhone app</h3><p>It keeps every result on your device, and it deletes them when you ask.</p><p>${cell}</p>`), { logical: PAGE })).toEqual(["NO_SERVER_SUBJECT"]);
  });

  it("the same rules read the same words in a page's text, its attributes and its JSON-LD", () => {
    expect(rules(html('<p>Real-time alerts.</p>'), { logical: PAGE })).toEqual(expect.arrayContaining(["LIVE", "ALERT"]));
    expect(rules(html('<img alt="Real-time seats">'), { logical: PAGE })).toContain("LIVE");
    expect(rules(html('<script type="application/ld+json">{"@type":"WebPage","description":"We alert you when seats open."}</script>'), { logical: PAGE })).toContain("ALERT");
    expect(rules(html("<p>Cached availability, <em>not</em> live.</p>"), { logical: PAGE })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Status modes
// ---------------------------------------------------------------------------------------------------------------

describe("status modes", () => {
  const inEach = (text: string, logical = "draft.md") =>
    Object.fromEntries((["submitted", "released", "withdrawn"] as const).map((s) => [s, rules(text, { status: s, logical })]));

  it('"not on the App Store" fails in released mode and passes in submitted mode', () => {
    const r = inEach("AwardGrid is not on the App Store yet.");
    expect(r.released).toContain("STALE_STATUS");
    expect(r.submitted).toEqual([]);
    expect(inEach("AwardGrid 尚未上架。").released).toContain("STALE_STATUS");
    expect(inEach("AwardGrid 尚未上架。").submitted).toEqual([]);
  });

  it('"testing it privately" fails in submitted and released mode (and once withdrawn)', () => {
    const r = inEach("Its developer is testing it privately, through TestFlight.");
    expect(r.submitted).toContain("STALE_STATUS");
    expect(r.released).toContain("STALE_STATUS");
    expect(r.withdrawn).toContain("STALE_STATUS");
    expect(inEach("The iOS app is tested privately through Apple's TestFlight and is not on the App Store.").submitted).toEqual(["STALE_STATUS"]);
  });

  it("the privacy policy's TestFlight disclosure (crash reports Apple may pass on) passes in every status, so it needs no exemption", () => {
    // sites/landing/privacy/index.html, "Nothing else" and 其他: a disclosure that stays true, not a release status.
    const en =
      "If you choose, in iOS, to share analytics with app developers, or you test the app through TestFlight, Apple may pass crash reports or the feedback you send to the developer; those are Apple's features, under your device's settings and Apple's policies.";
    const zh = "如果你在 iOS 中选择与应用开发者共享分析数据，或通过 TestFlight 测试本应用，Apple 可能会把崩溃报告或你提交的反馈转交给开发者；这些是 Apple 的功能，受你的设备设置和 Apple 的政策约束。";
    expect(inEach(en)).toEqual({ submitted: [], released: [], withdrawn: [] });
    expect(inEach(zh)).toEqual({ submitted: [], released: [], withdrawn: [] });
  });

  it('"AwardGrid is free on the App Store" fails in submitted and withdrawn mode and passes in released mode', () => {
    const text = "AwardGrid is free on the App Store. It needs your own paid seats.aero Pro subscription with API access.";
    const r = inEach(text);
    expect(r.submitted).toContain("PREMATURE_STATUS");
    expect(r.withdrawn).toContain("WITHDRAWN_STATUS");
    expect(r.released).toEqual([]);
    // Without the prerequisite next to it, "free" fails in every mode.
    expect(inEach("AwardGrid is free on the App Store.").released).toEqual(["FREE_WITHOUT_PRO"]);
  });

  it("apple-itunes-app and a store link fail in submitted and withdrawn mode and pass in released mode", () => {
    const page = html('<meta name="apple-itunes-app" content="app-id=6816321841"><p><a href="https://apps.apple.com/app/id6816321841">View the listing</a></p>');
    const r = inEach(page, PAGE);
    expect(hits(page, { status: "submitted", logical: PAGE })).toEqual([
      'PREMATURE_STATUS "apple-itunes-app"',
      'PREMATURE_STATUS "apps.apple.com/app/id6816321841"',
    ]);
    expect(r.withdrawn).toEqual(["WITHDRAWN_STATUS"]);
    expect(r.released).toEqual([]);
  });

  it('"removed from the App Store" passes in withdrawn mode', () => {
    const r = inEach("AwardGrid for iPhone was removed from the App Store on 1 November 2026.");
    expect(r.withdrawn).toEqual([]);
    // The withdrawn copy is premature before it happens.
    expect(r.submitted).toContain("PREMATURE_STATUS");
    expect(r.released).toContain("PREMATURE_STATUS");
  });

  it("the submitted wording passes in submitted mode and is stale once Apple has decided", () => {
    const text = "AwardGrid for iPhone has been submitted to the App Store and is waiting for Apple's review.";
    const r = inEach(text);
    expect(r.submitted).toEqual([]);
    expect(r.released).toEqual(["STALE_STATUS"]);
    expect(r.withdrawn).toEqual(["STALE_STATUS"]);
    expect(inEach("AwardGrid 已提交到 App Store，正在等待苹果审核。").released).toContain("STALE_STATUS");
  });

  it("each claim's copy for another status is caught: earlier is stale, later is premature", () => {
    const willBe = "AwardGrid for iPhone will be offered in 174 countries or regions; not in mainland China.";
    expect(inEach(willBe).submitted).toEqual([]);
    expect(inEach(willBe).released).toEqual(["STALE_STATUS"]);
    const available = "Available in 174 countries or regions; not in mainland China.";
    expect(inEach(available).submitted).toEqual(["PREMATURE_STATUS"]);
    expect(inEach(available).released).toEqual([]);
    expect(inEach(available).withdrawn).toEqual(["WITHDRAWN_STATUS"]);
    expect(inEach("The iPhone app is a separate, public release.").submitted).toEqual(["PREMATURE_STATUS"]);
    // A sentence the claim uses in every status (history's first) never depends on it.
    const began = "AwardGrid began as a private, invite-only web app for its developer and a small group of friends.";
    expect(inEach(began)).toEqual({ submitted: [], released: [], withdrawn: [] });
  });

  it("Chinese store wording follows the status too", () => {
    expect(inEach("AwardGrid 已上架 App Store。").submitted).toContain("PREMATURE_STATUS");
    expect(inEach("AwardGrid 已上架 App Store。").withdrawn).toContain("WITHDRAWN_STATUS");
    expect(inEach("AwardGrid 已上架 App Store。").released).toEqual([]);
  });

  it("a claim's Chinese for another status is caught like its English (allowed_copy_zh_by_status)", () => {
    // Pinned by a registry of its own, so the test does not depend on today's wording.
    const registry = structuredClone(REGISTRY);
    const availability = registry.claims.find((c: { claim_id: string }) => c.claim_id === "availability");
    availability.allowed_copy_zh_by_status = { submitted_not_live: "它将在 174 个国家或地区提供，中国大陆除外。", released: "已在 174 个国家或地区提供，中国大陆除外。" };
    const inEachZh = (text: string) =>
      Object.fromEntries((["submitted", "released", "withdrawn"] as const).map((s) => [s, rules(text, { status: s, registry })]));
    // The submitted Chinese: no explicit pattern knows "将在 174 …", so only the registry's sentence catches it.
    expect(inEachZh("它将在 174 个国家或地区提供，中国大陆除外。")).toEqual({ submitted: [], released: ["STALE_STATUS"], withdrawn: ["STALE_STATUS"] });
    // The released Chinese is premature before the release, and passes once released.
    expect(inEachZh("已在 174 个国家或地区提供，中国大陆除外。").submitted).toEqual(["PREMATURE_STATUS"]);
    expect(inEachZh("已在 174 个国家或地区提供，中国大陆除外。").released).toEqual([]);
    // Without the registry's Chinese, the submitted sentence would pass in every status.
    delete availability.allowed_copy_zh_by_status;
    expect(inEachZh("它将在 174 个国家或地区提供，中国大陆除外。").released).toEqual([]);
  });

  // Paraphrases of a listing, not only the registry's own sentences.
  const LISTING = [
    "Download AwardGrid from the App Store today.",
    "AwardGrid is now available for iPhone.",
    "AwardGrid is a free app for iPhone; it needs your own seats.aero Pro subscription.",
    "AwardGrid is now available in the App Store.",
    "Install AwardGrid from the App Store.",
    "Get AwardGrid in the App Store.",
    "AwardGrid is now in the App Store.",
    "AwardGrid is available in 174 countries or regions.",
    "AwardGrid is free to download; it needs a seats.aero Pro subscription.",
    "在 App Store 下载 AwardGrid。",
    "AwardGrid 已在 App Store 提供下载。",
  ];
  it.each(LISTING)("a listing paraphrase is premature before release and untrue once withdrawn: %j", (text) => {
    const r = inEach(text);
    expect(r.submitted).toContain("PREMATURE_STATUS");
    expect(r.withdrawn).toContain("WITHDRAWN_STATUS");
    expect((r.released ?? []).filter((rule) => rule === "PREMATURE_STATUS" || rule === "WITHDRAWN_STATUS")).toEqual([]);
  });

  it.each(["It’s not available on the App Store yet.", "AwardGrid isn’t on the App Store yet.", "AwardGrid is not yet on the App Store."])(
    "honest not-yet wording passes in submitted mode and is stale once released: %j",
    (text) => {
      const r = inEach(text);
      expect(r.submitted).toEqual([]);
      expect(r.released).toContain("STALE_STATUS");
    },
  );

  it.each(["AwardGrid is no longer available on the App Store.", "AwardGrid isn't on the App Store anymore.", "AwardGrid for iPhone was removed from the App Store on 2026-12-01."])(
    "honest withdrawn wording passes in withdrawn mode: %j",
    (text) => {
      expect(inEach(text).withdrawn).toEqual([]);
    },
  );

  it.each([
    "AwardGrid 1.0 is in App Review.",
    "AwardGrid is awaiting review.",
    "AwardGrid for iPhone will be offered in 174 countries or regions.",
    "AwardGrid for iPhone has been submitted as a free app, with no in-app purchase.",
    "AwardGrid isn't on the App Store.",
    "AwardGrid 正在审核中。",
  ])("submission and not-yet wording is stale once released: %j", (text) => {
    expect(inEach(text).released).toContain("STALE_STATUS");
  });

  it("the CLI takes the status as submitted, released or withdrawn", () => {
    expect(parseArgs(["--status", "submitted"]).status).toBe("submitted_not_live");
    expect(parseArgs(["--status", "released", "--file", "a.md", "--file", "b.md"])).toMatchObject({ status: "released", files: ["a.md", "b.md"] });
    expect(() => parseArgs(["--status", "live"])).toThrow(/Unknown status/);
    expect(() => parseArgs(["--dist"])).toThrow(/needs a value/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Registry-driven and page-structure rules
// ---------------------------------------------------------------------------------------------------------------

describe("PENDING_CLAIM_TEXT", () => {
  // The registry's own pending claims change as the owner approves wording, so these tests hold one pending on a copy.
  const PENDING = structuredClone(REGISTRY);
  const dependency = PENDING.claims.find((c: { claim_id: string }) => c.claim_id === "dependency");
  dependency.public_use = "pending_owner";

  it("fails when copy the owner has not approved appears, and passes once it is approved", () => {
    const text = `Before you subscribe: ${dependency.allowed_copy}`;
    expect(rules(text, { registry: PENDING })).toContain("PENDING_CLAIM_TEXT");
    const approved = structuredClone(PENDING);
    approved.claims.find((c: { claim_id: string }) => c.claim_id === "dependency").public_use = "approved";
    expect(rules(text, { registry: approved })).not.toContain("PENDING_CLAIM_TEXT");
  });

  it("passes approved copy", () => {
    const affiliation = REGISTRY.claims.find((c: { claim_id: string }) => c.claim_id === "affiliation");
    expect(hits(affiliation.allowed_copy)).toEqual([]);
    expect(hits(affiliation.allowed_copy_zh)).toEqual([]);
  });

  it("finds pending copy without its final stop (a list item, a table cell), with typographic quotes, and clause by clause", () => {
    const items = [
      "AwardGrid depends on seats.aero’s Partner API, which seats.aero licenses for non-commercial use and can limit or withdraw",
      "AwardGrid depends on seats.aero's Partner API, which seats.aero licenses for non-commercial use.",
      "Check your seats.aero settings show an API tab before you subscribe",
    ];
    for (const item of items) {
      expect(rules(html(`<ul><li>${item}</li></ul>`), { logical: PAGE, registry: PENDING }), item).toContain("PENDING_CLAIM_TEXT");
      expect(rules(`| ${item} |`, { registry: PENDING }), item).toContain("PENDING_CLAIM_TEXT");
    }
    // One finding per place: the longest piece that matches there.
    expect(hits(dependency.allowed_copy, { registry: PENDING }).filter((h) => h.startsWith("PENDING_CLAIM_TEXT"))).toHaveLength(2);
  });

  it("fails retired wording, whole or by the clause, while the clause it shares with the new copy passes", () => {
    const grid = REGISTRY.claims.find((c: { claim_id: string }) => c.claim_id === "grid");
    expect(grid.public_use).toBe("approved");
    for (const retired of grid.retired_copy as string[]) expect(rules(retired), retired).toContain("PENDING_CLAIM_TEXT");
    expect(rules("One table, with the cheapest award seat in each cell and its miles, fees, seats left, program and data age")).toContain("PENDING_CLAIM_TEXT");
    expect(rules("The pages at /ios/, /privacy/ and /support/ run no scripts.")).toContain("PENDING_CLAIM_TEXT");
    expect(hits(grid.allowed_copy)).toEqual([]);
    const shared = "It puts seats.aero's cached award availability for several origins, several destinations and up to 92 days into one table.";
    expect(rules(shared)).not.toContain("PENDING_CLAIM_TEXT");
  });

  it("rejects a retired_copy that is not a list of sentences", () => {
    const bad = structuredClone(REGISTRY);
    bad.claims.find((c: { claim_id: string }) => c.claim_id === "grid").retired_copy = "one sentence";
    const problems = checkRegistry(bad, { root: ROOT }).map((f: { rule: string; match: string }) => `${f.rule} ${f.match}`);
    expect(problems.some((p: string) => p.startsWith("REGISTRY") && p.includes("retired_copy"))).toBe(true);
  });
});

describe("page structure (HTML)", () => {
  it("HTML_COMMENT_IN_DIST: a comment fails in a built page, not in the source", () => {
    const page = html("<!-- a note --><p>Text</p>");
    expect(rules(page, { logical: PAGE, dist: true })).toEqual(["HTML_COMMENT_IN_DIST"]);
    expect(rules(page, { logical: PAGE })).toEqual([]);
    expect(rules(html("<p>Text</p>"), { logical: PAGE, dist: true })).toEqual([]);
  });

  it.each([
    "<script>document.title = 'x'</script>",
    '<script src="/x.js"></script>',
    '<script type="module">import "./x.js"</script>',
    "<SCRIPT TYPE=text/javascript>1</SCRIPT>",
    '<script type="application/ld+json" src="/data.json"></script>',
    '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token":"REDACTED"}\'></script>',
  ])("SCRIPT_NOT_LD_JSON fails %j", (tag) => {
    expect(rules(html(`<p>Text</p>${tag}`), { logical: PAGE })).toEqual(["SCRIPT_NOT_LD_JSON"]);
  });

  it.each([
    '<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>',
    "<script type='application/ld+json'>{}</script>",
    "<script type=application/ld+json>{}</script>",
  ])("SCRIPT_NOT_LD_JSON passes JSON-LD without src: %j", (tag) => {
    expect(rules(html(`<p>Text</p>${tag}`), { logical: PAGE })).toEqual([]);
  });

  it.each([
    ["<p>Data: seats.aero.</p>", "en"],
    ["<p>数据：seats.aero。</p>", "zh"],
    ['<p>Data: <a href="https://seats.aero/pricing">seats.aero</a>.</p>', "a link to another seats.aero page"],
    ['<p><a href="https://seats.aero">seats.aero</a> Data: seats.aero</p>', "a link beside it, not around it"],
  ])("ATTRIBUTION_LINK fails %j (%s)", (body) => {
    expect(rules(html(body), { logical: PAGE })).toEqual(["ATTRIBUTION_LINK"]);
  });

  it.each([
    ['<p>Data: <a href="https://seats.aero">seats.aero</a>.</p>', "en"],
    ['<p>数据：<a href="https://seats.aero">seats.aero</a>。</p>', "zh"],
    ['<p><a href="https://seats.aero/">Data: seats.aero</a></p>', "the link wraps the whole attribution"],
  ])("ATTRIBUTION_LINK passes %j (%s)", (body) => {
    expect(rules(html(body), { logical: PAGE })).toEqual([]);
  });

  it("ATTRIBUTION_LINK is a page rule: Markdown keeps its plain attribution", () => {
    expect(rules("**Data: seats.aero.**")).toEqual([]);
  });

  it.each([
    ["<p>Data:&nbsp;seats.aero</p>", "a non-breaking space"],
    ["<p>数据来源：seats.aero</p>", "数据来源"],
    ["<p>Data from seats.aero.</p>", "Data from"],
    ["<p>Source: seats.aero</p>", "Source"],
  ])("ATTRIBUTION_LINK reads every way an attribution is spaced or worded: %j (%s)", (body) => {
    expect(rules(html(body), { logical: PAGE })).toEqual(["ATTRIBUTION_LINK"]);
    const linked = body.replace("seats.aero", '<a href="https://seats.aero">seats.aero</a>');
    expect(rules(html(linked), { logical: PAGE })).toEqual([]);
  });

  it.each([
    ['<body onload="fetch(\'https://example.com/beacon\')">', "an event handler"],
    ['<img src="x.png" alt="" onerror="fetch(1)">', "an event handler"],
    ['<a href="javascript:void(navigator.sendBeacon(\'/b\'))">AwardGrid for iPhone</a>', "a javascript: URL"],
    ['<a href="jav&#x61;script:void(0)">AwardGrid</a>', "an encoded javascript: URL"],
    ['<iframe srcdoc="<p>x</p>"></iframe>', "an iframe srcdoc"],
  ])("SCRIPT_NOT_LD_JSON fails script that runs without a <script> tag: %j (%s)", (tag) => {
    expect(rules(html(`<p>Text</p>${tag}`), { logical: PAGE })).toEqual(["SCRIPT_NOT_LD_JSON"]);
  });

  it("SCRIPT_NOT_LD_JSON passes ordinary links and attributes that only look like handlers", () => {
    expect(rules(html('<p><a href="https://seats.aero">seats.aero</a> <span data-on="x" class="online">Text</span></p>'), { logical: PAGE })).toEqual([]);
  });

  const ld = (value: unknown) => html(`<script type="application/ld+json">${typeof value === "string" ? value : JSON.stringify(value)}</script>`);
  const app = (url: string) => ({
    "@context": "https://schema.org",
    "@graph": [{ "@type": "Organization", name: "Curastone CORP." }, { "@type": "MobileApplication", name: "AwardGrid", offers: { "@type": "Offer", price: "0", url } }],
  });

  it("SCHEMA_JSON: JSON-LD must parse", () => {
    expect(rules(ld('{"@type": "WebPage",}'), { logical: PAGE })).toEqual(["SCHEMA_JSON"]);
    expect(rules(ld({ "@type": "WebPage", name: "AwardGrid for iPhone" }), { logical: PAGE })).toEqual([]);
  });

  it("SCHEMA_JSON: MobileApplication only once released, with the store link that has no slug", () => {
    const good = ld(app("https://apps.apple.com/app/id6816321841"));
    expect(rules(good, { logical: PAGE, status: "submitted" })).toEqual(expect.arrayContaining(["SCHEMA_JSON"]));
    expect(rules(good, { logical: PAGE, status: "withdrawn" })).toEqual(expect.arrayContaining(["SCHEMA_JSON"]));
    expect(rules(good, { logical: PAGE, status: "released" })).toEqual([]);
    expect(rules(ld(app("https://apps.apple.com/us/app/awardgrid/id6816321841")), { logical: PAGE, status: "released" })).toEqual(["SCHEMA_JSON"]);
  });
});

describe("TRADEMARK_ASO", () => {
  const field = (name: string) => `apps/ios/store-metadata/en-US/${name}.txt`;

  it.each([
    ["keywords", "award,seats aero,miles"],
    ["keywords", "award,AAdvantage,business class"],
    ["subtitle", "Award seats, with Claude"],
    ["name", "AwardGrid for seats.aero"],
    ["keywords", "award,pointsyeah,grid"],
    ["keywords", "award,miles & more,grid"],
    ["keywords", "award,velocity,points"],
  ])("fails a third-party name in %s: %j", (name, text) => {
    expect(rules(text, { logical: field(name) })).toContain("TRADEMARK_ASO");
  });

  it.each([
    ["keywords", "award seats,points,miles,business class,grid"],
    ["name", "AwardGrid"],
    ["subtitle", "Award seats in one table"],
  ])("passes %s: %j", (name, text) => {
    expect(rules(text, { logical: field(name) })).toEqual([]);
  });

  it("applies only to the name, subtitle and keywords", () => {
    expect(rules("Needs your own seats.aero Pro key.", { logical: field("description") })).not.toContain("TRADEMARK_ASO");
    expect(rules("Needs your own seats.aero Pro key.", { logical: "apps/ios/store-metadata/next/en-US/description.txt" })).not.toContain("TRADEMARK_ASO");
  });

  it.each([
    "apps/ios/store-metadata/next/en-US/keywords.txt",
    "apps/ios/store-metadata/next/en-GB/subtitle.txt",
    "apps/ios/store-metadata/next/zh-Hans/name.txt",
    "apps/ios/store-metadata/next/zh-Hans/keywords_fallback.txt",
  ])("applies to the next version's drafts too: %s", (logical) => {
    expect(rules("award,seats aero,miles", { logical })).toContain("TRADEMARK_ASO");
    expect(rules("award,points,miles", { logical })).toEqual([]);
  });

  it("knows every program in packages/core, so a new program cannot slip into the keywords", () => {
    const { sources, names } = programList(ROOT);
    expect(sources).toHaveLength(26);
    expect(Object.keys(PROGRAM_BRANDS).sort()).toEqual([...sources].sort());
    expect(names).toHaveLength(26);
    expect(trademarkTerms(ROOT)).toEqual(expect.arrayContaining(names));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Reading pages and Markdown
// ---------------------------------------------------------------------------------------------------------------

describe("reading a page like landingTexts in apps/ios/src/honesty.test.ts", () => {
  const runs = (raw: string) => htmlDocument(raw).stream.split("\n");

  it("reads text runs and the attributes a browser or a search result shows", () => {
    const raw = '<meta name="description" content="Checks every 3 hours"><p>No <em>guaranteed</em> schedule</p>';
    expect(runs(raw).sort()).toEqual(["Checks every 3 hours", "No guaranteed schedule"]);
  });

  it("drops comments, the doctype, style and executable scripts; keeps JSON-LD strings, not its keys", () => {
    const raw =
      "<!doctype html><!-- hidden note --><style>p { color: red }</style><p>Seen</p>" +
      '<script>var alertMe = 1;</script><script type="application/ld+json">{"@type":"FAQPage","acceptedAnswer":{"text":"When you open the app, and at <b>no</b> other time."}}</script>';
    // Runs come in document order; every string of a JSON-LD block sits where the block does.
    expect(runs(raw)).toEqual(["Seen", "FAQPage", "When you open the app, and at no other time."]);
  });

  it("decodes entities, so seats.aero&apos;s reads as a reader sees it", () => {
    expect(runs("<p>seats.aero&apos;s cached data &amp; more&#8230;</p>")).toEqual(["seats.aero's cached data & more…"]);
  });

  it("reads a shown attribute however it is quoted, and the label of a submit or button input", () => {
    const raw =
      "<meta name=\"description\" content='Real-time award alerts for every airline.'><meta property=\"og:description\" content=Instant>" +
      '<img alt=\'Live alerts\' src=x.png><input type="submit" value="Get live alerts"><input type=button value=Search><input type="text" value="live">';
    expect(runs(raw).sort()).toEqual(["Get live alerts", "Instant", "Live alerts", "Real-time award alerts for every airline.", "Search"]);
    expect(rules(raw, { logical: PAGE })).toEqual(expect.arrayContaining(["LIVE", "ALERT", "ALL_COVERAGE"]));
  });

  it("reads through phrasing tags, and reads soft hyphens, zero-width spaces and Unicode hyphens as a reader sees them", () => {
    expect(runs("<p>Get <u>real</u>-time results.</p><p>Award <ins>alerts</ins> <q>now</q>.</p>")).toEqual(["Get real-time results.", 'Award alerts now.']);
    expect(runs("<p>Re&shy;al-time</p><p>Real&#8209;time</p><p>Real–time</p><p>Re​al-time</p><p>Real &ndash; time</p>")).toEqual([
      "Real-time",
      "Real-time",
      "Real-time",
      "Real-time",
      "Real – time",
    ]);
    expect(runs("<p>It doesn’t send “alerts”.</p>")).toEqual(["It doesn't send \"alerts\"."]);
  });

  it("keeps a > inside a quoted attribute in its tag", () => {
    expect(runs('<p title="a > b">Text</p>').sort()).toEqual(["Text", "a > b"]);
  });

  it("reports the source line of a finding", () => {
    const raw = "<main>\n<p>One</p>\n<p>\n  Real-time\n</p>\n</main>";
    expect(scanContent(raw, { logical: PAGE, registry: REGISTRY, root: ROOT }).map((f: { line: number }) => f.line)).toEqual([4]);
  });
});

describe("reading Markdown", () => {
  it("reads only the public-claims section of a file that has one, with the file's own line numbers", () => {
    const raw = ["# Title", "", "Real-time outside.", "<!-- public-claims:start -->", "## For iPhone", "", "Live inside.", "<!-- public-claims:end -->", "Alerts outside."].join("\n");
    const found = scanContent(raw, { logical: "README.md", section: true, registry: REGISTRY, root: ROOT });
    expect(found.map((f: { rule: string; line: number }) => `${f.rule}:${f.line}`)).toEqual(["LIVE:7"]);
    expect(markdownDocument(raw, { section: true }).stream).toBe("For iPhone\nLive inside.");
  });

  it("says when the markers are missing", () => {
    expect(markdownDocument("# Title\n\nText.", { section: true }).markersMissing).toBe(true);
  });

  it("joins a paragraph's lines and reads through emphasis, code and links", () => {
    const doc = markdownDocument("**Live Search\nis never used.** See [`LEGAL.md`](LEGAL.md).\n\n- one\n- two");
    expect(doc.stream.split("\n")).toEqual(["Live Search is never used. See LEGAL.md LEGAL.md).", "one", "two"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------------------------

describe("registry checks", () => {
  it("resolves a repo ref only when the file and its lines exist and its snippet starts on the first line it cites", () => {
    const root = tempDir();
    writeFileSync(path.join(root, "a.md"), "# Title\n\nLive Search is never used (it requires\na commercial agreement).\n");
    expect(checkEvidenceRef('a.md:1 "# Title"', root)).toBeNull();
    expect(checkEvidenceRef('a.md:3-4 "Live Search is never used"', root)).toBeNull();
    // A snippet may run on into the next line, whitespace-normalized.
    expect(checkEvidenceRef('a.md:3-4 "(it requires a commercial agreement)"', root)).toBeNull();
    expect(checkEvidenceRef('a.md:9 "x"', root)).toMatch(/has 4 lines/);
    expect(checkEvidenceRef('a.md:4-3 "x"', root)).toMatch(/bad line range/);
    expect(checkEvidenceRef('NOPE.md:1 "# Title"', root)).toMatch(/does not exist/);
    expect(checkEvidenceRef("a.md", root)).toMatch(/not "path:line/);
    expect(checkEvidenceRef("a.md:1", root)).toMatch(/needs a quoted snippet/);
    expect(checkEvidenceRef('a.md:1 "# T"', root)).toMatch(/too short/);
    expect(checkEvidenceRef("[external] https://seats.aero/terms (read 2026-08-12)", root)).toBeNull();
    expect(checkEvidenceRef("[external] https://seats.aero/terms", root)).toMatch(/read YYYY-MM-DD/);
  });

  it("fails a ref whose lines moved, and says where its snippet is now", () => {
    const root = tempDir();
    writeFileSync(path.join(root, "LEGAL.md"), "# Legal\n\nOne line.\nLive Search is never used.\nMore.\n");
    expect(checkEvidenceRef('LEGAL.md:4 "Live Search is never used"', root)).toBeNull();
    // A line inserted above: the same ref now cites the line before the snippet.
    writeFileSync(path.join(root, "LEGAL.md"), "# Legal\n\nOne line,\nnow two.\nLive Search is never used.\nMore.\n");
    expect(checkEvidenceRef('LEGAL.md:4 "Live Search is never used"', root)).toMatch(/does not start on line 4 of LEGAL\.md \(it starts on line 5\)/);
    // A range that still contains the snippet, one line down, fails too: the snippet must start on the first line.
    expect(checkEvidenceRef('LEGAL.md:4-5 "Live Search is never used"', root)).toMatch(/it starts on line 5/);
    expect(checkEvidenceRef('LEGAL.md:4 "Nothing like this"', root)).toMatch(/it is not in the file/);
  });

  it("flags missing fields, bad enums, duplicate ids and a missing general limitation", () => {
    const bad = structuredClone(REGISTRY);
    bad.released.status = "live";
    bad.claims[0].evidence_level = "vibes";
    bad.claims[1].claim_id = bad.claims[0].claim_id;
    bad.claims[2].limitations = [];
    delete bad.claims[3].public_use;
    const problems = checkRegistry(bad, { root: ROOT }).map((f: { match: string }) => f.match);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/released\.status "live"/),
        expect.stringMatching(/evidence_level "vibes"/),
        expect.stringMatching(/is not unique/),
        expect.stringMatching(/general limitation/),
        expect.stringMatching(/public_use is missing/),
      ]),
    );
  });

  it("checks the Chinese copy's shape: a sentence, a list, and the Chinese of a status only where the English has it", () => {
    const bad = structuredClone(REGISTRY);
    const byId = (id: string) => bad.claims.find((c: { claim_id: string }) => c.claim_id === id);
    byId("scope").allowed_copy_zh = "";
    byId("views").allowed_copy_zh_extra = "一句话";
    byId("watches").allowed_copy_zh_by_status = { submitted_not_live: "句子。" };
    byId("availability").allowed_copy_zh_by_status = { released: "句子。", live: "句子。" };
    const problems = checkRegistry(bad, { root: ROOT }).map((f: { match: string }) => f.match);
    expect(problems).toEqual(
      expect.arrayContaining([
        "claim scope: allowed_copy_zh must be a sentence",
        "claim views: allowed_copy_zh_extra must be a list of sentences",
        "claim watches: allowed_copy_zh_by_status needs allowed_copy_by_status",
        "claim availability: allowed_copy_zh_by_status needs submitted_not_live",
        'claim availability: allowed_copy_zh_by_status key "live" is not a status of allowed_copy_by_status',
      ]),
    );
    expect(checkRegistry(REGISTRY, { root: ROOT }).filter((f: { match: string }) => /allowed_copy_zh/.test(f.match))).toEqual([]);
  });

  it("fails an unregistered public surface, and skips build output and dependencies", () => {
    const root = tempDir();
    const put = (rel: string, text = "<p>Text</p>") => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
    };
    put("sites/landing/index.html");
    put("sites/landing/new-page/index.html");
    put("sites/landing/dist/ios/index.html");
    put("sites/landing/node_modules/x/index.html");
    put("sites/landing/public/sitemap.xml", "<urlset/>");
    // Vite copies public/'s dot-directories into the built site.
    put("sites/landing/public/.well-known/llms-full.txt", "Text.");
    put("growth/geo/draft.md", "Text.");
    put("growth/geo/zh/answers.md", "Text.");
    put("growth/geo/accuracy-answer.md", "Text.");
    put("apps/ios/store-metadata/en-US/name.txt", "AwardGrid");
    const registry = {
      ...structuredClone(REGISTRY),
      claims: [],
      exact_copy_exempt_claims: [],
      historical_allowlist: [],
      public_files: [
        { path: "sites/landing/index.html" },
        { glob: "sites/landing/**/index.html", discovery: true },
        { path: "growth/geo/accuracy-answer.md" },
        { glob: "apps/ios/store-metadata/**", reserved: true },
        { path: "sites/landing/public/llms.txt", reserved: true },
      ],
      nonmarketing_files: [],
    };
    registry.released.evidence_ref = [];
    const unregistered = checkRegistry(registry, { root })
      .filter((f: { rule: string }) => f.rule === "UNREGISTERED_SURFACE")
      .map((f: { match: string }) => f.match.split(" ")[0]);
    expect(unregistered.sort()).toEqual([
      "growth/geo/draft.md",
      "growth/geo/zh/answers.md",
      "sites/landing/new-page/index.html",
      "sites/landing/public/.well-known/llms-full.txt",
      "sites/landing/public/sitemap.xml",
    ]);
    // Registering them (as public or as not marketing) clears it.
    registry.public_files.push(
      { path: "sites/landing/new-page/index.html" },
      { path: "growth/geo/draft.md" },
      { path: "growth/geo/zh/answers.md" },
      { path: "sites/landing/public/.well-known/llms-full.txt" },
    );
    (registry.nonmarketing_files as Array<{ path: string; reason: string }>).push({ path: "sites/landing/public/sitemap.xml", reason: "URLs only" });
    expect(checkRegistry(registry, { root }).filter((f: { rule: string }) => f.rule === "UNREGISTERED_SURFACE")).toEqual([]);
    // A registered file that is missing fails unless it is reserved.
    expect(checkRegistry(registry, { root }).filter((f: { rule: string }) => f.rule === "PUBLIC_FILE_MISSING")).toEqual([]);
    registry.public_files.push({ path: "sites/landing/public/robots.txt" });
    expect(checkRegistry(registry, { root }).map((f: { rule: string }) => f.rule)).toContain("PUBLIC_FILE_MISSING");
  });

  it("applies an exemption by file, exact text and rule, in built pages too, and fails one that matches nothing", () => {
    const root = tempDir();
    mkdirSync(path.join(root, "sites/landing/ios"), { recursive: true });
    mkdirSync(path.join(root, "dist/ios"), { recursive: true });
    const page = html("<p>No accounts, no analytics</p><p>Real-time data.</p>");
    writeFileSync(path.join(root, "sites/landing/ios/index.html"), page);
    writeFileSync(path.join(root, "dist/ios/index.html"), page);
    const registry = {
      ...structuredClone(REGISTRY),
      exact_copy_exempt_claims: [],
      public_files: [{ path: "sites/landing/ios/index.html" }],
      nonmarketing_files: [],
      historical_allowlist: [
        { file: "sites/landing/ios/index.html", text: "No accounts, no analytics", rules: ["NO_SERVER_SUBJECT"], reason: "test" },
        { file: "sites/landing/ios/index.html", text: "Real-time data.", rules: ["ALERT"], reason: "wrong rule: must not exempt LIVE" },
      ],
    };
    registry.released.evidence_ref = [];
    registry.claims = [];
    const result = validate({ root, registry, dist: path.join(root, "dist") });
    const summary = result.findings.map((f: { rule: string; file: string }) => `${f.rule} ${path.relative(root, path.resolve(root, f.file))}`);
    // NO_SERVER_SUBJECT is exempt in the source and in the built page; LIVE is not exempt; the ALERT entry is unused.
    expect(summary.sort()).toEqual(["EXEMPTION_UNUSED growth/product-facts.json", "LIVE dist/ios/index.html", "LIVE sites/landing/ios/index.html"]);
    expect(result.exemptions.map((e: { used: number }) => e.used)).toEqual([2, 0]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------------------------------------------

describe("the CLI", () => {
  const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });

  it("prints one line per finding and a summary, and exits 1, for a draft with a claim", () => {
    const dir = tempDir();
    const draft = path.join(dir, "draft.md");
    writeFileSync(draft, "# Draft\n\nAwardGrid sends real-time alerts.\n");
    const out = run(["--file", draft]);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/^LIVE .*draft\.md:3 ".*real-time.*"$/m);
    expect(out.stdout).toMatch(/^ALERT .*draft\.md:3 /m);
    expect(out.stdout).toMatch(/^public-claims: status=submitted_not_live files=1 findings=2 /m);
    expect(out.stdout).toMatch(/^public-claims: rules .*LIVE=1 .*ALERT=1 /m);
    expect(out.stdout).toMatch(/^public-claims: scanned .*draft\.md$/m);
  });

  it("exits 0 on a clean draft, in any status, and prints JSON on --json", () => {
    const dir = tempDir();
    const draft = path.join(dir, "draft.md");
    writeFileSync(draft, "AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero, Anthropic, any airline, or any loyalty program.\n");
    expect(run(["--file", draft]).status).toBe(0);
    expect(run(["--file", draft, "--status", "released"]).status).toBe(0);
    const json = JSON.parse(run(["--file", draft, "--json"]).stdout);
    expect(json).toMatchObject({ status: "submitted_not_live", findings: [] });
  });

  it("scans every page and every text file of a built site with --dist, in dot-directories too", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, "ios"), { recursive: true });
    mkdirSync(path.join(dir, "_site"), { recursive: true });
    mkdirSync(path.join(dir, ".well-known"), { recursive: true });
    writeFileSync(path.join(dir, "ios", "index.html"), html("<!-- note --><p>Text</p>"));
    writeFileSync(path.join(dir, "llms.txt"), "AwardGrid monitors award seats around the clock.\n");
    writeFileSync(path.join(dir, "_site", "notes.txt"), "Real-time.\n");
    writeFileSync(path.join(dir, ".well-known", "llms-full.txt"), "Instant results.\n");
    writeFileSync(path.join(dir, "_site", "styles.css"), "p { color: red } /* live */\n");
    const draft = path.join(dir, "clean.md");
    writeFileSync(draft, "Text.\n");
    const out = run(["--file", draft, "--dist", dir, "--json"]);
    const rulesByFile = JSON.parse(out.stdout).findings.map((f: { rule: string; file: string }) => `${f.rule} ${path.basename(f.file)}`);
    expect(rulesByFile.sort()).toEqual(["ALERT llms.txt", "ALERT llms.txt", "HTML_COMMENT_IN_DIST index.html", "LIVE llms-full.txt", "LIVE notes.txt"]);
  });

  it("runs when reached through a symlink, so a gate called by another path cannot pass without running", () => {
    const dir = tempDir();
    const link = path.join(dir, "gate.mjs");
    symlinkSync(SCRIPT, link);
    const draft = path.join(dir, "bad.md");
    writeFileSync(draft, "Real-time alerts for every airline.\n");
    const out = spawnSync(process.execPath, [link, "--file", draft], { cwd: dir, encoding: "utf8" });
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/^public-claims: status=submitted_not_live files=1 findings=3 /m);
  });

  it("exits 2 on a usage error", () => {
    expect(run(["--nope"]).status).toBe(2);
  });
});
