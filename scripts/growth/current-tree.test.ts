/**
 * The facts registry (growth/product-facts.json) and this branch's public files, as they stand.
 *
 *   - The registry is well formed and every evidence ref resolves to lines that exist.
 *   - Every approved sentence passes the gate in its own status, so the registry cannot hold copy the gate refuses.
 *   - The registered public files pass in the registry's status, with the registered exemptions, and every exemption
 *     is used: one that matches nothing any more fails here, so it gets removed.
 *   - The registry says withdrawn (the template for the app's removal from the App Store): in released and in
 *     submitted mode the same files fail on exactly the withdrawn wording, all of it PREMATURE_STATUS, so the change is
 *     true only once the app is gone. The removal's date (withdrawn_at_utc, and the <date> of every withdrawn sentence)
 *     is recorded on the day by set-withdrawn.mjs; until then the gate defers WITHDRAWN_UNRECORDED (t0-switch.test.ts).
 *     The removal follows the release, so the gate defers T0_UNRECORDED too until the change sits on a tree whose T0
 *     set-t0.mjs has recorded.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { t0Date } from "./set-t0.mjs";
import { dateEn, dateZh, fillWithdrawnDates, placeholderLines } from "./set-withdrawn.mjs";
import { DEFERRED_RULE_IDS, GENERAL_LIMITATION, checkRegistry, formatFinding, markdownDocument, scanContent, validate } from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY_TEXT = readFileSync(path.join(ROOT, "growth", "product-facts.json"), "utf8");
const REGISTRY = JSON.parse(REGISTRY_TEXT);

interface Claim {
  claim_id: string;
  public_use: string;
  evidence_ref: string[];
  limitations: string[];
  allowed_copy?: string;
  allowed_copy_zh?: string;
  allowed_copy_extra?: string[];
  allowed_copy_zh_extra?: string[];
  allowed_copy_by_status?: Record<string, string>;
  allowed_copy_zh_by_status?: Record<string, string>;
  allowed_copy_extra_by_status?: Record<string, string[]>;
  allowed_copy_zh_extra_by_status?: Record<string, string[]>;
  allowed_copy_variants?: Record<string, string>;
  in_use?: string[];
  retired_copy?: string[];
}
const CLAIMS: Claim[] = REGISTRY.claims;
const claim = (id: string) => CLAIMS.find((c) => c.claim_id === id)!;
const MODE: Record<string, "submitted" | "released" | "withdrawn"> = { submitted_not_live: "submitted", released: "released", withdrawn: "withdrawn" };
/** Sentences: an English one ends at . ! or ? and a space, a Chinese one at 。！？ with or without one. */
const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+|(?<=[。！？])\s*/).filter(Boolean);
/** A claim's status-dependent sentences as [status, sentence]: by status, and the extra sentences per status. */
const byStatus = (c: Claim): Array<[string, string]> => [
  ...Object.entries(c.allowed_copy_by_status ?? {}),
  ...Object.entries(c.allowed_copy_zh_by_status ?? {}),
  ...Object.entries(c.allowed_copy_extra_by_status ?? {}).flatMap(([status, list]) => list.map((s): [string, string] => [status, s])),
  ...Object.entries(c.allowed_copy_zh_extra_by_status ?? {}).flatMap(([status, list]) => list.map((s): [string, string] => [status, s])),
];
/** T0 is recorded: released_at_utc and t0_lookup_receipt are set (scripts/growth/set-t0.mjs does it on T0 day). */
const T0_RECORDED = Boolean(REGISTRY.released.released_at_utc && REGISTRY.released.t0_lookup_receipt);
/** The removal is recorded: withdrawn_at_utc is set (scripts/growth/set-withdrawn.mjs, with the pages' <date>). */
const WITHDRAWAL_RECORDED = Boolean(REGISTRY.released.withdrawn_at_utc);
const STATUS: string = REGISTRY.released.status;
/**
 * The deferred findings this tree's registry should give: T0's while a released or withdrawn registry has not recorded
 * it (a removal follows the release), and the removal's while a withdrawn one has not recorded that.
 */
const DEFERRED_NOW = [
  ...((STATUS === "released" || STATUS === "withdrawn") && !T0_RECORDED ? ["T0_UNRECORDED"] : []),
  ...(STATUS === "withdrawn" && !WITHDRAWAL_RECORDED ? ["WITHDRAWN_UNRECORDED"] : []),
];

describe("the facts registry", () => {
  it("passes every registry check: fields, enums, evidence refs, public files, markers, surfaces, exemptions", () => {
    // T0_UNRECORDED and WITHDRAWN_UNRECORDED are the gate's deferred findings until the moment of their status is
    // recorded (t0-switch.test.ts); anything else fails here.
    const found = checkRegistry(REGISTRY, { root: ROOT, registryText: REGISTRY_TEXT });
    expect(found.filter((f: { rule: string }) => !DEFERRED_RULE_IDS.includes(f.rule)).map(formatFinding)).toEqual([]);
    expect(found.filter((f: { rule: string }) => DEFERRED_RULE_IDS.includes(f.rule)).map((f: { rule: string }) => f.rule)).toEqual(DEFERRED_NOW);
  });

  it("holds exactly the claims the public copy is built from", () => {
    expect(CLAIMS.map((c) => c.claim_id)).toEqual([
      "identity", "domain_collision", "release_status", "history", "webapp_note", "dependency", "prerequisite", "price", "grid",
      "query_input", "query_zh_hant", "filters", "views", "cell_fields", "scope", "programs", "data_cached", "watches", "quota",
      "ask", "privacy", "developer_data", "keys", "program_link", "not_offered", "affiliation", "availability",
    ]);
  });

  it("holds only the pending claims listed here, and approves the rest", () => {
    // dependency, grid (reworded for the iPhone app's Matrix), developer_data (the owner's PR #104 wording) and
    // domain_collision were approved on 2026-09-28; a claim set back to pending_owner must be listed here on purpose.
    // filters and cell_fields were registered on 2026-09-28 for /ios/award-grid/, from the app's source and its copy;
    // filters was reworded the same day (cabins are always asked, business and first by default), for the owner to see.
    // query_zh_hant: 1.0 does not read 飛 on its own, 下禮拜 or 桃園 (its limitations), so its sentence waits.
    expect(CLAIMS.filter((c) => c.public_use === "pending_owner").map((c) => c.claim_id)).toEqual(["query_zh_hant"]);
    expect(CLAIMS.filter((c) => c.public_use !== "pending_owner").every((c) => c.public_use === "approved")).toBe(true);
  });

  it("gives every claim the general limitation", () => {
    for (const c of CLAIMS) expect(c.limitations, c.claim_id).toContain(GENERAL_LIMITATION);
  });

  it("words the status-dependent claims per status, and the web app note per decision", () => {
    for (const id of ["release_status", "history", "price", "availability"]) {
      expect(Object.keys(claim(id).allowed_copy_by_status ?? {}), id).toContain("submitted_not_live");
      expect(claim(id).allowed_copy, id).toBeUndefined();
    }
    expect(claim("release_status").allowed_copy_by_status?.withdrawn).toBe("AwardGrid for iPhone was removed from the App Store on <date>.");
    // No space between the date and 从: Chinese puts one only between Chinese and Latin letters or digits.
    expect(claim("release_status").allowed_copy_zh_by_status?.withdrawn).toBe("AwardGrid iPhone 版已于 <date>从 App Store 下架。");
    // The history, in the past tense and with no date of its own; price and availability have no withdrawn wording (their
    // sentences come off the pages once the app is removed, as their limitations say).
    expect(claim("history").allowed_copy_by_status?.withdrawn).toMatch(/ The iPhone app was a separate, public release until it was removed from the App Store\.$/);
    for (const id of ["price", "availability"]) expect(Object.keys(claim(id).allowed_copy_by_status ?? {}), id).toEqual(["submitted_not_live", "released"]);
    expect(Object.keys(claim("webapp_note").allowed_copy_variants ?? {})).toEqual(["kept_host", "kept_named_host", "kept_repo", "retired"]);
    expect(claim("webapp_note").in_use).toEqual(["kept_host", "kept_named_host", "kept_repo"]);
    expect(REGISTRY.exact_copy_exempt_claims).toEqual(["history", "webapp_note"]);
  });

  it("words the released status of /ios/ as released copy: extra sentences for the released status only", () => {
    expect(claim("release_status").allowed_copy_extra_by_status).toEqual({
      released: ["AwardGrid is free on the App Store for iPhone (iOS 18 or later).", "View AwardGrid on the App Store"],
    });
    expect(Object.keys(claim("prerequisite").allowed_copy_extra_by_status ?? {})).toEqual(["released"]);
    expect(CLAIMS.filter((c) => c.allowed_copy_extra_by_status || c.allowed_copy_zh_extra_by_status).map((c) => c.claim_id)).toEqual(["release_status", "prerequisite"]);
  });

  it("registers Q6's sentence under ask, with its evidence", () => {
    expect(claim("ask").allowed_copy_extra).toContain("Search runs on your seats.aero key alone.");
    expect(claim("ask").limitations.join(" ")).toMatch(/seats\.aero key alone.*search\.ts/);
  });

  it("records the removal (status withdrawn), with its time empty until set-withdrawn.mjs records it", () => {
    expect(REGISTRY.released).toMatchObject({
      status: "withdrawn",
      app_id: "6816321841",
      bundle_id: "com.dowhiz.awardgrid",
      seller: "Curastone CORP.",
      version: "1.0",
      build: "3",
      platforms: ["iPhone"],
      minimum_ios: "18.0",
      interface_languages: ["en", "zh-Hans"],
      territories: { count: 174, excluded: ["China mainland"] },
    });
    // The template is prepared before T0 is recorded; applied later, it sits on a registry whose T0 is, and the removal
    // is recorded only after it.
    if (T0_RECORDED) expect(REGISTRY.released.released_at_utc > REGISTRY.released.submitted_at_utc).toBe(true);
    if (WITHDRAWAL_RECORDED) {
      expect(T0_RECORDED).toBe(true);
      expect(REGISTRY.released.withdrawn_at_utc > REGISTRY.released.released_at_utc).toBe(true);
    } else expect(REGISTRY.released.withdrawn_at_utc).toBeNull();
    expect(REGISTRY.candidate).toBeNull();
  });

  it("every approved sentence passes the gate in its own status (price and the listing next to the prerequisite)", () => {
    const prerequisite = claim("prerequisite").allowed_copy!;
    const prerequisiteZh = claim("prerequisite").allowed_copy_zh!;
    const offenders: string[] = [];
    for (const c of CLAIMS.filter((x) => x.public_use === "approved")) {
      const versions: Array<[string, string]> = [];
      for (const s of [c.allowed_copy, c.allowed_copy_zh, ...(c.allowed_copy_extra ?? []), ...(c.allowed_copy_zh_extra ?? [])]) if (s) versions.push([REGISTRY.released.status, s]);
      for (const [status, s] of byStatus(c)) versions.push([status, s.replace("<date>", /[㐀-鿿]/.test(s) ? "2026 年 11 月 1 日" : "1 November 2026")]);
      for (const key of c.in_use ?? []) versions.push([REGISTRY.released.status, c.allowed_copy_variants![key]!]);
      for (const [status, text] of versions) {
        const withPrerequisite = /\bfree\b/.test(text) ? `${text} ${prerequisite}` : /免费/.test(text) ? `${text}${prerequisiteZh}` : text;
        for (const f of scanContent(withPrerequisite, { status: MODE[status], registry: REGISTRY, root: ROOT })) {
          offenders.push(`${c.claim_id} (${status}): ${f.rule} ${JSON.stringify(f.match)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("refuses the copy still waiting for the owner, and every retired wording", () => {
    for (const c of CLAIMS.filter((x) => x.public_use === "pending_owner")) {
      for (const text of [c.allowed_copy!, ...(c.allowed_copy_extra ?? [])]) {
        expect(scanContent(text, { registry: REGISTRY, root: ROOT }).map((f: { rule: string }) => f.rule), `${c.claim_id}: ${text}`).toContain("PENDING_CLAIM_TEXT");
      }
    }
    const retired = CLAIMS.flatMap((c) => (c.retired_copy ?? []).map((text) => [c.claim_id, text] as const));
    expect(retired.map(([id]) => id).sort()).toEqual(["developer_data", "filters", "grid", "grid"]);
    for (const [id, text] of retired) {
      expect(scanContent(text, { registry: REGISTRY, root: ROOT }).map((f: { rule: string }) => f.rule), id).toContain("PENDING_CLAIM_TEXT");
    }
  });

  it("gives every exemption a reason that says what it waits for", () => {
    for (const e of REGISTRY.historical_allowlist) {
      expect(e.reason, e.text).toMatch(/pending a separate change/);
      expect(e.expires_when, e.text).toMatch(/remove this exemption/);
    }
  });
});

describe("the current tree", () => {
  const result = validate({ root: ROOT });

  it("the CLI exits 0 on it and says so in its summary (and, until the removal is recorded, that WITHDRAWN_UNRECORDED is deferred)", () => {
    const out = spawnSync(process.execPath, [path.join(import.meta.dirname, "validate-public-claims.mjs")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, T0_MERGE_CHECK: "" } });
    expect(out.stdout).toMatch(new RegExp(`^public-claims: status=${REGISTRY.released.status} files=\\d+ findings=0 exemptions used=(\\d+)/\\1 \\(clean\\)$`, "m"));
    expect(out.stdout.split("\n").filter((l: string) => l.startsWith("DEFERRED ")).map((l: string) => l.split(" ")[1])).toEqual(DEFERRED_NOW);
    expect(out.status).toBe(0);
  });

  it("scans every registered public file", () => {
    expect(result.files).toEqual(
      expect.arrayContaining([
        "sites/landing/index.html",
        "sites/landing/ios/index.html",
        "sites/landing/ios/award-grid/index.html",
        "sites/landing/ios/zh-hans/index.html",
        "sites/landing/privacy/index.html",
        "sites/landing/support/index.html",
        "LEGAL.md",
        "README.md",
        "growth/geo/accuracy-answer.md",
      ]),
    );
  });

  it("passes in the registry's status, with the registered exemptions", () => {
    expect(result.status).toBe(REGISTRY.released.status);
    expect(result.findings.map(formatFinding)).toEqual([]);
  });

  it("uses every exemption at least once, so a stale one fails", () => {
    expect(result.exemptions.length).toBeGreaterThan(0);
    expect(result.exemptions.filter((e: { used: number }) => e.used === 0)).toEqual([]);
  });

  // The withdrawn wording, pinned: in released mode (--status released) and in submitted mode every piece of it is
  // premature, and nothing else is reported. release_status's withdrawn sentence as the status line of the home page,
  // /ios/award-grid/, README.md and llms.txt, as /ios/'s status paragraph, and as the answer to the first question on
  // /ios/ (on the page and in its FAQPage JSON-LD, so twice) and in the short answers; its Chinese as the answer to
  // 免费吗 on /ios/zh-hans/ (page and JSON-LD); the history sentence in LEGAL.md. The date is read as whatever the
  // sentence holds (<date>, or the date set-withdrawn.mjs wrote), so the list holds before and after the date is filled.
  // Line numbers are left out, so an unrelated edit above them does not break this.
  const EN = /^AwardGrid for iPhone was removed from the App Store on \S.*$/;
  const ZH = /^AwardGrid iPhone 版已于 \S.*从 App Store 下架$/;
  const WITHDRAWN_WORDING: ReadonlyArray<readonly [string, RegExp | string]> = [
    ["LEGAL.md", "The iPhone app was a separate, public release until it was removed from the App Store"],
    ["README.md", EN],
    ["growth/geo/accuracy-answer.md", EN],
    ["sites/landing/index.html", EN],
    ["sites/landing/ios/award-grid/index.html", EN],
    ["sites/landing/ios/index.html", EN],
    ["sites/landing/ios/index.html", EN],
    ["sites/landing/ios/index.html", EN],
    ["sites/landing/ios/zh-hans/index.html", ZH],
    ["sites/landing/ios/zh-hans/index.html", ZH],
    ["sites/landing/public/llms.txt", EN],
  ];
  const found = (status: "submitted" | "released") =>
    validate({ root: ROOT, status }).findings.map((f: { rule: string; logical: string; match: string }) => ({ rule: f.rule, file: f.logical, match: f.match }));
  const matches = (list: Array<{ rule: string; file: string; match: string }>) => {
    const left = [...list];
    for (const [file, want] of WITHDRAWN_WORDING) {
      const i = left.findIndex((f) => f.rule === "PREMATURE_STATUS" && f.file === file && (typeof want === "string" ? f.match === want : want.test(f.match)));
      if (i < 0) return `not found: ${file} ${want}`;
      left.splice(i, 1);
    }
    return left.map((f) => `${f.rule} ${f.file} ${JSON.stringify(f.match)}`);
  };

  it.each(["released", "submitted"] as const)("with --status %s it finds exactly the withdrawn wording, all of it premature, and nothing else", (status) => {
    expect(matches(found(status))).toEqual([]);
  });

  it("the CLI exits 1 in released mode and lists the premature wording", () => {
    const out = spawnSync(process.execPath, [path.join(import.meta.dirname, "validate-public-claims.mjs"), "--status", "released"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, T0_MERGE_CHECK: "" } });
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(new RegExp(`^public-claims: status=released \\(registry: withdrawn\\) files=\\d+ findings=${WITHDRAWN_WORDING.length} `, "m"));
    expect(out.stdout.split("\n").filter((l: string) => l.startsWith("PREMATURE_STATUS ")).length).toBe(WITHDRAWN_WORDING.length);
  });

  // The date of the removal: <date> in every withdrawn sentence until set-withdrawn.mjs records it, and then the UTC date
  // of withdrawn_at_utc, written as the registry says ("1 November 2026"; "2026 年 11 月 1 日").
  it.each(["README.md", "growth/geo/accuracy-answer.md", "sites/landing/index.html", "sites/landing/ios/index.html", "sites/landing/ios/award-grid/index.html", "sites/landing/ios/zh-hans/index.html", "sites/landing/public/llms.txt"])(
    "%s: its withdrawn sentences are dated as the registry is",
    (file) => {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      expect(fillWithdrawnDates(text, "2026-11-01").count).toBeGreaterThan(0);
      if (WITHDRAWAL_RECORDED) {
        const date = t0Date(REGISTRY.released.withdrawn_at_utc);
        expect(fillWithdrawnDates(text, date).text, `${dateEn(date)} / ${dateZh(date)}`).toBe(text);
        expect(placeholderLines(text)).toEqual([]);
      } else {
        expect(placeholderLines(text, { section: file === "README.md" }).length).toBe(fillWithdrawnDates(text, "2026-11-01").count);
      }
    },
  );

  // The change to a later status swaps each status sentence for its claim's copy for that status. The layout of each
  // file below must take that swap as it is (a sentence with no copy for the new status goes). Withdrawn is the last
  // status, so on this tree there is none to swap to: the withdrawn layout is pinned above instead.
  const LATER: Record<string, ReadonlyArray<"released" | "withdrawn">> = { submitted_not_live: ["released", "withdrawn"], released: ["withdrawn"], withdrawn: [] };
  const swapped = (text: string, from: string, to: "released" | "withdrawn") => {
    let out = text;
    for (const c of CLAIMS) {
      for (const copy of [c.allowed_copy_by_status, c.allowed_copy_zh_by_status]) {
        if (!copy?.[from]) continue;
        const next = copy[to]?.replace("<date>", "1 November 2026") ?? "";
        out = out.split(copy[from]!).join(next);
      }
    }
    return out;
  };
  it.skipIf(LATER[STATUS]!.length === 0).each([
    ["README.md", true],
    ["growth/geo/accuracy-answer.md", false],
    ["sites/landing/index.html", false],
    ["sites/landing/ios/award-grid/index.html", false],
  ] as const)("%s passes in each later status once its status sentences take that status's copy", (file, section) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const status of LATER[STATUS]!) {
      const findings = scanContent(swapped(text, STATUS, status), { logical: file, section, status, registry: REGISTRY, root: ROOT });
      expect(findings.map(formatFinding), `${file} (${status})`).toEqual([]);
    }
  });
});

describe("the public copy is the registry's", () => {
  // Every sentence of the README's public section, of the short answers and of the pages written from the registry is
  // a registered sentence (in some status, variant or language), so a public sentence cannot drift from the facts it
  // stands for.
  const registered = new Set(
    CLAIMS.flatMap((c) => [
      c.allowed_copy,
      c.allowed_copy_zh,
      ...(c.allowed_copy_extra ?? []),
      ...(c.allowed_copy_zh_extra ?? []),
      ...byStatus(c).map(([, s]) => s),
      ...Object.values(c.allowed_copy_variants ?? {}),
    ])
      .filter((s): s is string => typeof s === "string")
      .flatMap(splitSentences),
  );
  /**
   * A registered sentence with a <date> (the withdrawn status) is registered with any date in its place: the placeholder
   * until the removal is recorded, then the date set-withdrawn.mjs writes, in English or in Chinese.
   */
  const DATE = String.raw`(?:<date>|\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}|\d{4} 年 \d{1,2} 月 \d{1,2} 日)`;
  const dated = [...registered]
    .filter((s) => s.includes("<date>"))
    .map((s) => new RegExp(`^${s.split("<date>").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(DATE)}$`));
  const isRegistered = (s: string) => registered.has(s) || dated.some((re) => re.test(s));
  const sentences = (runs: string[]) => runs.flatMap(splitSentences);
  /** One-word answers that open an answer ("No. Watches are checked …"); the sentence after them is what is checked. */
  const SHORT_ANSWERS = new Set(["No.", "Yes.", "没有。", "不会。", "不是。", "可以。", "不能。", "不支持。"]);
  /**
   * The platform line, which is released.platforms and released.minimum_ios rather than a claim's copy (the same line
   * is on /support/, in both languages).
   */
  const PLATFORM = new Set(["An iPhone with iOS 18 or later.", "iPhone only, iOS 18 or later.", "运行 iOS 18 或更高版本的 iPhone。"]);
  const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">" };
  /**
   * The text of each <p> and <li> of a page's <main>, tags read through: its navigation, its eyebrow labels, and a
   * paragraph that is only a link left out. `drop` removes whole sections first (copy kept from before the registry).
   */
  const pageBlocks = (file: string, drop: RegExp[] = []) => {
    let main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(readFileSync(path.join(ROOT, file), "utf8"))?.[1] ?? "";
    main = main.replace(/<!--[\s\S]*?-->/g, " ").replace(/<nav\b[\s\S]*?<\/nav>/gi, " ");
    for (const re of drop) main = main.replace(re, " ");
    return [...main.matchAll(/<(p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
      .filter((m) => !/\bclass="[^"]*\beyebrow\b/.test(m[2]!) && !/^\s*<a\b[^>]*>[^<]*<\/a>\s*$/.test(m[3]!))
      .map((m) => m[3]!.replace(/<[^>]+>/g, "").replace(/&([a-z]+);/gi, (x, name: string) => ENTITIES[name.toLowerCase()] ?? x).replace(/\s+/g, " ").trim())
      .filter(Boolean);
  };
  const loose = (blocks: string[]) => sentences(blocks).filter((s) => !SHORT_ANSWERS.has(s) && !PLATFORM.has(s) && !isRegistered(s));
  /**
   * A page's headlines, as a search result or a reader first sees them: its <title>, its meta description and its
   * <h1>s (og:title and og:description are the same text; sites/landing/test/crawl.test.ts checks that).
   */
  const headlines = (file: string) => {
    const html = readFileSync(path.join(ROOT, file), "utf8").replace(/<!--[\s\S]*?-->/g, " ");
    const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    const description = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1];
    const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1]!);
    return [title, description, ...h1]
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.replace(/<[^>]+>/g, "").replace(/&([a-z]+);/gi, (x, name: string) => ENTITIES[name.toLowerCase()] ?? x).replace(/\s+/g, " ").trim());
  };

  it("the platform line is the registry's released platform and minimum iOS", () => {
    expect(REGISTRY.released.platforms).toEqual(["iPhone"]);
    expect(REGISTRY.released.minimum_ios).toBe("18.0");
  });

  it("sites/landing/ios/index.html: the lead, what you need, the example's caption, every answer and where this is up to", () => {
    // "What it does not do" is the page's copy from before the registry, kept as it was. The example table's cells are
    // illustrative figures drawn as the app's Matrix, not claims; its visible caption ("Illustrative figures, not
    // seats.aero data…") is outside the table and is checked. The link to the listing is a paragraph that is only a
    // link; its words are release_status's released copy too.
    const blocks = pageBlocks("sites/landing/ios/index.html", [/<section class="limits"[\s\S]*?<\/section>/i, /<table class="ag-preview"[\s\S]*?<\/table>/i]);
    expect(loose(blocks)).toEqual([]);
    expect(sentences(blocks).length).toBeGreaterThan(20);
    // Withdrawn: "Where this is up to" is the withdrawn sentence, then the pointer to the privacy policy, and the page
    // links no listing.
    const status = /<section class="status"[\s\S]*?<\/section>/i.exec(readFileSync(path.join(ROOT, "sites/landing/ios/index.html"), "utf8"))![0];
    const statusBlocks = [...status.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) =>
      m[1]!.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(),
    );
    expect(statusBlocks).toHaveLength(2);
    expect(isRegistered(statusBlocks[0]!) && /removed from the App Store on/.test(statusBlocks[0]!)).toBe(true);
    expect(statusBlocks[1]).toBe(claim("privacy").allowed_copy_extra![0]);
    expect(readFileSync(path.join(ROOT, "sites/landing/ios/index.html"), "utf8")).not.toMatch(/apps\.apple\.com/);
    // ... and it comes right after the lead, before "What you need", so a reader learns it first.
    const page = readFileSync(path.join(ROOT, "sites/landing/ios/index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const order = [...page.matchAll(/<(?:header|section) class="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["hero", "status", "needs", "preview", "faq", "limits"]);
  });

  it("sites/landing/ios/award-grid/index.html: every sentence", () => {
    const blocks = pageBlocks("sites/landing/ios/award-grid/index.html");
    expect(loose(blocks)).toEqual([]);
    expect(sentences(blocks).length).toBeGreaterThan(20);
  });

  it("sites/landing/ios/zh-hans/index.html: every sentence, in Chinese (allowed_copy_zh and its kin)", () => {
    const blocks = pageBlocks("sites/landing/ios/zh-hans/index.html");
    expect(loose(blocks)).toEqual([]);
    expect(sentences(blocks).length).toBeGreaterThan(20);
    // Withdrawn: 免费吗 is answered with the withdrawn sentence, 哪里能下载 is gone, and the page links no listing.
    const html = readFileSync(path.join(ROOT, "sites/landing/ios/zh-hans/index.html"), "utf8");
    expect(html).toMatch(/<h3>AwardGrid 免费吗？<\/h3>\s*<p>AwardGrid iPhone 版已于 (?:&lt;date&gt;|\d{4} 年 \d{1,2} 月 \d{1,2} 日)从 App Store 下架。<\/p>/);
    expect(html).not.toMatch(/哪里能下载|apps\.apple\.com/);
  });

  it.each(["sites/landing/ios/index.html", "sites/landing/ios/award-grid/index.html", "sites/landing/ios/zh-hans/index.html"])(
    "%s: the <title>, the meta description and the H1 are registry copy too",
    (file) => {
      const runs = headlines(file);
      expect(runs).toHaveLength(3);
      expect(loose(runs)).toEqual([]);
    },
  );

  it("README.md: every sentence between the public-claims markers, links aside", () => {
    // The Markdown reader reads <date> as a tag; it is kept whole here, as the registry writes it.
    const doc = markdownDocument(readFileSync(path.join(ROOT, "README.md"), "utf8").replaceAll("<date>", "DATEPLACEHOLDER"), { section: true });
    const runs = doc.stream
      .split("\n")
      .map((run: string) => run.replaceAll("DATEPLACEHOLDER", "<date>"))
      .filter((run: string) => run !== "AwardGrid for iPhone" && !/https:\/\//.test(run));
    const loose = sentences(runs).filter((s) => !isRegistered(s));
    expect(loose).toEqual([]);
    expect(sentences(runs).length).toBeGreaterThan(10);
  });

  it("README.md: the identity and status lines first; the prerequisite and the dependency after the product, before the disclaimer", () => {
    const raw = readFileSync(path.join(ROOT, "README.md"), "utf8");
    const section = raw.slice(raw.indexOf("<!-- public-claims:start -->"), raw.indexOf("<!-- public-claims:end -->"));
    const paragraphs = section.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => !p.startsWith("<!--") && !p.startsWith("#"));
    const status = claim("release_status").allowed_copy_by_status![STATUS]!;
    const DATE_OF = String.raw`(?:<date>|\d{1,2} [A-Z][a-z]+ \d{4})`;
    const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(paragraphs[0]).toMatch(new RegExp(`^${escaped(claim("identity").allowed_copy!)}\\n${status.split("<date>").map(escaped).join(DATE_OF)}$`));
    expect(paragraphs[1]!.startsWith(claim("grid").allowed_copy!.split(". ")[0]!)).toBe(true);
    const disclaimer = paragraphs.findIndex((p) => p === claim("affiliation").allowed_copy);
    const dependency = claim("dependency").allowed_copy!;
    expect(paragraphs[disclaimer - 1]).toBe(`${claim("prerequisite").allowed_copy}\n${STATUS === "withdrawn" ? splitSentences(dependency)[0] : dependency}`);
  });

  it.skipIf(STATUS !== "withdrawn")("the dependency is its first sentence alone once withdrawn: no public file advises checking before you subscribe", () => {
    const [first, check] = splitSentences(claim("dependency").allowed_copy!);
    const [firstZh, checkZh] = splitSentences(claim("dependency").allowed_copy_zh!);
    expect(check).toMatch(/before you subscribe\.$/);
    expect(checkZh).toMatch(/^订阅之前/);
    const files = ["README.md", "growth/geo/accuracy-answer.md", "sites/landing/public/llms.txt", ...["index.html", "ios/index.html", "ios/award-grid/index.html", "ios/zh-hans/index.html", "support/index.html"].map((f) => `sites/landing/${f}`)];
    const texts = files.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8").replace(/\s+/g, " ")] as const);
    for (const [f, text] of texts) {
      expect(text, f).not.toContain(check);
      expect(text, f).not.toContain(checkZh);
    }
    // Every file that stated the dependency still states its first sentence.
    for (const f of files.filter((x) => !["sites/landing/index.html", "sites/landing/ios/zh-hans/index.html"].includes(x))) expect(texts.find(([x]) => x === f)![1], f).toContain(first);
    for (const f of ["sites/landing/ios/zh-hans/index.html", "sites/landing/support/index.html"]) expect(texts.find(([x]) => x === f)![1], f).toContain(firstZh);
  });

  it("\"What you need\" and 使用前提 list the same four things in one order: the iPhone, the key, the dependency, Ask", () => {
    const items = (file: string, section: RegExp) => {
      const html = readFileSync(path.join(ROOT, file), "utf8");
      const block = section.exec(html)![0];
      return [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!.replace(/\s+/g, " ").trim());
    };
    const en = items("sites/landing/ios/index.html", /<section class="needs"[\s\S]*?<\/section>/);
    const zh = items("sites/landing/ios/zh-hans/index.html", /<section aria-labelledby="needs-h">[\s\S]*?<\/section>/);
    for (const list of [en, zh]) expect(list).toHaveLength(4);
    expect([en[0], zh[0]]).toEqual(["An iPhone with iOS 18 or later.", "运行 iOS 18 或更高版本的 iPhone。"]);
    expect([en[1], zh[1]]).toEqual([claim("prerequisite").allowed_copy_extra![0], claim("prerequisite").allowed_copy_zh_extra![0]]);
    expect(en[2]!.startsWith("AwardGrid depends on seats.aero's Partner API") && zh[2]!.startsWith("AwardGrid 依赖 seats.aero 的 Partner API")).toBe(true);
    expect(en[3]!.startsWith("For Ask") && zh[3]!.startsWith("AI 辅助（Ask）")).toBe(true);
  });

  it("growth/geo/accuracy-answer.md: every sentence of every answer (the questions and the file's header aside)", () => {
    const raw = readFileSync(path.join(ROOT, "growth/geo/accuracy-answer.md"), "utf8");
    const answers = raw
      .split(/^## .*$/m)
      .slice(1)
      .map((block) => block.replace(/\s+/g, " ").trim());
    expect(answers).toHaveLength(9);
    const loose = sentences(answers).filter((s) => s !== "No." && s !== "Yes." && !isRegistered(s));
    expect(loose).toEqual([]);
  });
});
