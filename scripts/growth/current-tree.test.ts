/**
 * The facts registry (growth/product-facts.json) and this branch's public files, as they stand.
 *
 *   - The registry is well formed and every evidence ref resolves to lines that exist.
 *   - Every approved sentence passes the gate in its own status, so the registry cannot hold copy the gate refuses.
 *   - The registered public files pass in the registry's status, with the registered exemptions, and every exemption
 *     is used: one that matches nothing any more fails here, so it gets removed.
 *   - In released and withdrawn mode the same files fail on exactly today's submission wording, and nothing else.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GENERAL_LIMITATION, checkRegistry, formatFinding, markdownDocument, scanContent, validate } from "./validate-public-claims.mjs";

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
  allowed_copy_variants?: Record<string, string>;
  in_use?: string[];
  retired_copy?: string[];
}
const CLAIMS: Claim[] = REGISTRY.claims;
const claim = (id: string) => CLAIMS.find((c) => c.claim_id === id)!;
const MODE: Record<string, "submitted" | "released" | "withdrawn"> = { submitted_not_live: "submitted", released: "released", withdrawn: "withdrawn" };
/** Sentences: an English one ends at . ! or ? and a space, a Chinese one at 。！？ with or without one. */
const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+|(?<=[。！？])\s*/).filter(Boolean);

describe("the facts registry", () => {
  it("passes every registry check: fields, enums, evidence refs, public files, markers, surfaces, exemptions", () => {
    expect(checkRegistry(REGISTRY, { root: ROOT, registryText: REGISTRY_TEXT }).map(formatFinding)).toEqual([]);
  });

  it("holds exactly the claims the public copy is built from", () => {
    expect(CLAIMS.map((c) => c.claim_id)).toEqual([
      "identity", "domain_collision", "release_status", "history", "webapp_note", "dependency", "prerequisite", "sample_mode",
      "price", "grid", "query_input", "query_zh_hant", "filters", "views", "cell_fields", "scope", "programs", "data_cached",
      "watches", "planner", "quota", "ask", "privacy", "developer_data", "keys", "oauth_connection", "short_term_caching",
      "program_link", "not_offered", "affiliation", "availability",
    ]);
  });

  it("holds only the pending claims listed here, and approves the rest", () => {
    // dependency, grid (reworded for the iPhone app's Matrix), developer_data (the owner's PR #104 wording) and
    // domain_collision were approved on 2026-09-28; a claim set back to pending_owner must be listed here on purpose.
    // filters and cell_fields were registered on 2026-09-28 for /ios/award-grid/, from the app's source and its copy;
    // filters was reworded the same day (cabins are always asked, business and first by default), for the owner to see.
    // query_zh_hant: 1.0 does not read 飛 on its own, 下禮拜 or 桃園 (its limitations), so its sentence waits.
    // sample_mode and planner were registered on 2026-10-07 for build 4 (release plan step 22), from the app's source;
    // oauth_connection and short_term_caching the same day for the build that connects only through seats.aero's own
    // sign-in (release plan 47F step 5).
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
    expect(claim("release_status").allowed_copy_by_status?.withdrawn).toContain("<date>");
    expect(Object.keys(claim("webapp_note").allowed_copy_variants ?? {})).toEqual(["kept_host", "kept_named_host", "kept_repo", "retired"]);
    expect(claim("webapp_note").in_use).toEqual(["kept_host", "kept_named_host", "kept_repo"]);
    expect(REGISTRY.exact_copy_exempt_claims).toEqual(["history", "webapp_note"]);
  });

  it("registers Q6's sentence under ask, with its evidence", () => {
    // Since 2026-10-07 (build 4) search needs no key at all: without one it runs on sample data. Q6's answer says only
    // what stays true, that search needs no AI key; "Search runs on your seats.aero key alone." is retired.
    expect(claim("ask").allowed_copy_extra).toContain("Search needs no AI key.");
    expect(claim("ask").limitations.join(" ")).toMatch(/needs no AI key.*search\.ts/);
    expect(claim("ask").retired_copy).toContain("Search runs on your seats.aero key alone.");
  });

  it("says Ask is not part of the App Store version, and that without an account the app shows sample data", () => {
    expect(claim("ask").allowed_copy).toMatch(/is in testing; it is not part of the App Store version 1\.0\.$/);
    expect(claim("sample_mode").allowed_copy).toMatch(/^Without a seats\.aero account, AwardGrid shows sample data only: /);
    expect(claim("prerequisite").allowed_copy_extra?.[0]).toMatch(/Without it, AwardGrid shows sample data only\.$/);
    const everything = CLAIMS.flatMap((c) => [c.allowed_copy, c.allowed_copy_zh, ...(c.allowed_copy_extra ?? []), ...(c.allowed_copy_zh_extra ?? [])]);
    expect(everything.filter((s) => s && /searches nothing|什么也搜不到|无法查票|Pro key|Pro 密钥/.test(s))).toEqual([]);
  });

  it("records the release as submitted, not live, with nothing that only a release can fill", () => {
    expect(REGISTRY.released).toMatchObject({
      status: "submitted_not_live",
      app_id: "6816321841",
      bundle_id: "com.dowhiz.awardgrid",
      seller: "Curastone CORP.",
      version: "1.0",
      build: "3",
      platforms: ["iPhone"],
      minimum_ios: "18.0",
      interface_languages: ["en", "zh-Hans"],
      territories: { count: 174, excluded: ["China mainland"] },
      released_at_utc: null,
      withdrawn_at_utc: null,
      t0_lookup_receipt: null,
    });
    expect(REGISTRY.candidate).toBeNull();
  });

  it("every approved sentence passes the gate in its own status (price and the listing next to the prerequisite)", () => {
    const prerequisite = claim("prerequisite").allowed_copy!;
    const prerequisiteZh = claim("prerequisite").allowed_copy_zh!;
    const offenders: string[] = [];
    for (const c of CLAIMS.filter((x) => x.public_use === "approved")) {
      const versions: Array<[string, string]> = [];
      for (const s of [c.allowed_copy, c.allowed_copy_zh, ...(c.allowed_copy_extra ?? []), ...(c.allowed_copy_zh_extra ?? [])]) if (s) versions.push([REGISTRY.released.status, s]);
      for (const [status, s] of Object.entries(c.allowed_copy_by_status ?? {})) versions.push([status, s.replace("<date>", "1 November 2026")]);
      for (const [status, s] of Object.entries(c.allowed_copy_zh_by_status ?? {})) versions.push([status, s.replace("<date>", "2026 年 11 月 1 日")]);
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
    // Since 2026-10-07 (build 4): the prerequisite's "searches nothing", the grid's "Pro key" headlines, the quota's "a Pro
    // key allows", Ask as a feature of the app, and the privacy sentence that sent searches to Anthropic for Ask. Since
    // the same day (the OAuth build, release plan 47F): the prerequisite's four sentences that told the reader to paste
    // the API key from the API tab, privacy's "no server of its own" (twice), and the keys claim's three key sentences.
    // Since 2026-10-08 (build 6, whose search loads no route lists): the programs claim's "marked "not monitored"", in
    // its sentence, its extra sentence and its Chinese, and cell_fields' "Not monitored" as an empty line's example.
    expect(Object.fromEntries(CLAIMS.filter((c) => c.retired_copy).map((c) => [c.claim_id, c.retired_copy!.length]))).toEqual({
      prerequisite: 7,
      grid: 8,
      filters: 1,
      cell_fields: 1,
      programs: 3,
      quota: 1,
      ask: 4,
      privacy: 3,
      developer_data: 1,
      keys: 3,
    });
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

  it("the CLI exits 0 on it and says so in its summary", () => {
    const out = spawnSync(process.execPath, [path.join(import.meta.dirname, "validate-public-claims.mjs")], { cwd: ROOT, encoding: "utf8" });
    expect(out.stdout).toMatch(new RegExp(`^public-claims: status=${REGISTRY.released.status} files=\\d+ findings=0 exemptions used=(\\d+)/\\1 \\(clean\\)$`, "m"));
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
    // Since 2026-10-07 there are none: the privacy policy names AwardGrid for iPhone as the subject of "no accounts / no
    // server" and links seats.aero in its footer, and en-US/ holds build 4's description, written from the registry.
    expect(result.exemptions).toEqual([]);
    expect(result.exemptions.filter((e: { used: number }) => e.used === 0)).toEqual([]);
  });

  // What has to change when the registry's status moves on from submitted_not_live, pinned so that the change of
  // status fixes exactly these and nothing slips through. All are the submission wording, correct today: the
  // release_status and price sentences at the top of README.md, the price answer in growth/geo/accuracy-answer.md,
  // the history sentence in LEGAL.md, the /ios/ status paragraph and its price answer (on the page and in its FAQPage
  // JSON-LD, so twice), the home page's status line, the status line of /ios/award-grid/, the "Price and status" and
  // Availability lines of llms.txt, and on /ios/zh-hans/ the price and "where to download" answers in Chinese (each on
  // the page and in its JSON-LD). Once released, each takes its claim's released copy (allowed_copy_by_status, or
  // allowed_copy_zh_by_status in Chinese); once withdrawn, the withdrawn copy (release_status) or none. Line numbers
  // are left out, so an unrelated edit above them does not break this. Since 2026-10-06 (after Apple's 2026-10-05
  // rejection) the status sentence says the app "is submitted to the App Store and not available there yet", and
  // nothing says it is waiting for Apple's review.
  const AFTER_SUBMISSION = [
    'STALE_STATUS LEGAL.md "has been submitted to the App Store"',
    'STALE_STATUS README.md "submitted as a free app"',
    'STALE_STATUS README.md "is submitted to the App Store"',
    'STALE_STATUS growth/geo/accuracy-answer.md "submitted as a free app"',
    'STALE_STATUS sites/landing/index.html "is submitted to the App Store"',
    'STALE_STATUS sites/landing/ios/award-grid/index.html "is submitted to the App Store"',
    'STALE_STATUS sites/landing/ios/index.html "is submitted to the App Store"',
    'STALE_STATUS sites/landing/ios/index.html "submitted as a free app"',
    'STALE_STATUS sites/landing/ios/index.html "submitted as a free app"',
    'STALE_STATUS sites/landing/ios/zh-hans/index.html "它将在 174 个国家或地区提供，中国大陆除外"',
    'STALE_STATUS sites/landing/ios/zh-hans/index.html "它将在 174 个国家或地区提供，中国大陆除外"',
    'STALE_STATUS sites/landing/ios/zh-hans/index.html "已提交 App Store"',
    'STALE_STATUS sites/landing/ios/zh-hans/index.html "已提交 App Store"',
    'STALE_STATUS sites/landing/ios/zh-hans/index.html "已提交 App Store"',
    'STALE_STATUS sites/landing/ios/zh-hans/index.html "已提交 App Store"',
    'STALE_STATUS sites/landing/public/llms.txt "is submitted to the App Store"',
    'STALE_STATUS sites/landing/public/llms.txt "submitted as a free app"',
    'STALE_STATUS sites/landing/public/llms.txt "will be offered in 174"',
  ];
  it.each(["released", "withdrawn"] as const)("in %s mode it finds exactly the submission wording, and nothing else", (status) => {
    const found = validate({ root: ROOT, status }).findings.map((f: { rule: string; logical: string; match: string }) => `${f.rule} ${f.logical} ${JSON.stringify(f.match)}`);
    expect(found.sort()).toEqual([...AFTER_SUBMISSION].sort());
  });

  // The switch at release swaps each status sentence for its claim's copy for the new status. The layout of each file
  // below must take that swap as it is: the released release_status sentence says "free", so it has to sit next to the
  // prerequisite (FREE_WITHOUT_PRO), and nothing else may need rewording.
  const swapped = (text: string, status: "released" | "withdrawn") => {
    let out = text;
    for (const c of CLAIMS) {
      for (const copy of [c.allowed_copy_by_status, c.allowed_copy_zh_by_status]) {
        if (!copy) continue;
        const next = copy[status]?.replace("<date>", "1 November 2026") ?? "";
        out = out.split(copy.submitted_not_live!).join(next);
      }
    }
    return out;
  };
  it.each([
    ["README.md", true],
    ["growth/geo/accuracy-answer.md", false],
    ["sites/landing/index.html", false],
    ["sites/landing/ios/award-grid/index.html", false],
    ["sites/landing/public/llms.txt", false],
  ] as const)("%s passes in released and withdrawn mode once its status sentences take that status's copy", (file, section) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const status of ["released", "withdrawn"] as const) {
      const found = scanContent(swapped(text, status), { logical: file, section, status, registry: REGISTRY, root: ROOT });
      expect(found.map(formatFinding), `${file} (${status})`).toEqual([]);
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
      ...Object.values(c.allowed_copy_by_status ?? {}),
      ...Object.values(c.allowed_copy_zh_by_status ?? {}),
      ...Object.values(c.allowed_copy_variants ?? {}),
    ])
      .filter((s): s is string => typeof s === "string")
      .flatMap(splitSentences),
  );
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
  const loose = (blocks: string[]) => sentences(blocks).filter((s) => !SHORT_ANSWERS.has(s) && !PLATFORM.has(s) && !registered.has(s));
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

  it("sites/landing/ios/index.html: the lead, what you need, the example's caption and every answer", () => {
    // "What it does not do" and "Where this is up to" are the page's copy from before the registry, kept as it was.
    // The example table's cells are illustrative figures drawn as the app's Matrix, not claims; its visible caption
    // ("Illustrative figures, not seats.aero data…") is outside the table and is checked.
    const blocks = pageBlocks("sites/landing/ios/index.html", [
      /<section class="limits"[\s\S]*?<\/section>/i,
      /<section class="status"[\s\S]*?<\/section>/i,
      /<table class="ag-preview"[\s\S]*?<\/table>/i,
    ]);
    expect(loose(blocks)).toEqual([]);
    expect(sentences(blocks).length).toBeGreaterThan(20);
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
    const doc = markdownDocument(readFileSync(path.join(ROOT, "README.md"), "utf8"), { section: true });
    const runs = doc.stream.split("\n").filter((run: string) => run !== "AwardGrid for iPhone" && !/https:\/\//.test(run));
    const loose = sentences(runs).filter((s) => !registered.has(s));
    expect(loose).toEqual([]);
    expect(sentences(runs).length).toBeGreaterThan(10);
  });

  it("growth/geo/accuracy-answer.md: every sentence of every answer (the questions and the file's header aside)", () => {
    const raw = readFileSync(path.join(ROOT, "growth/geo/accuracy-answer.md"), "utf8");
    const answers = raw
      .split(/^## .*$/m)
      .slice(1)
      .map((block) => block.replace(/\s+/g, " ").trim());
    expect(answers).toHaveLength(10);
    const loose = sentences(answers).filter((s) => s !== "No." && s !== "Yes." && !registered.has(s));
    expect(loose).toEqual([]);
  });
});
