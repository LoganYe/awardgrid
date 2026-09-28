/**
 * The facts registry (growth/product-facts.json) and this branch's public files, as they stand.
 *
 *   - The registry is well formed and every evidence ref resolves to lines that exist.
 *   - Every approved sentence passes the gate in its own status, so the registry cannot hold copy the gate refuses.
 *   - The registered public files pass in the registry's status, with the registered exemptions, and every exemption
 *     is used: one that matches nothing any more fails here, so it gets removed.
 *   - The registry says released (the T0 switch): in submitted mode the same files fail on exactly the released
 *     wording, all of it PREMATURE_STATUS, so the switch is true only after T0; in withdrawn mode on the same wording,
 *     as WITHDRAWN_STATUS. T0 itself (released_at_utc, t0_lookup_receipt) is recorded on T0 day by set-t0.mjs; until
 *     then the gate defers T0_UNRECORDED (t0-switch.test.ts).
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

describe("the facts registry", () => {
  it("passes every registry check: fields, enums, evidence refs, public files, markers, surfaces, exemptions", () => {
    // T0_UNRECORDED is the gate's deferred finding until T0 is recorded (t0-switch.test.ts); anything else fails here.
    const found = checkRegistry(REGISTRY, { root: ROOT, registryText: REGISTRY_TEXT });
    expect(found.filter((f: { rule: string }) => f.rule !== "T0_UNRECORDED").map(formatFinding)).toEqual([]);
    expect(found.filter((f: { rule: string }) => f.rule === "T0_UNRECORDED")).toHaveLength(T0_RECORDED ? 0 : 1);
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
    expect(claim("release_status").allowed_copy_by_status?.withdrawn).toContain("<date>");
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

  it("records the release as released (the T0 switch), with T0 itself empty until set-t0.mjs records it", () => {
    expect(REGISTRY.released).toMatchObject({
      status: "released",
      app_id: "6816321841",
      bundle_id: "com.dowhiz.awardgrid",
      seller: "Curastone CORP.",
      version: "1.0",
      build: "3",
      platforms: ["iPhone"],
      minimum_ios: "18.0",
      interface_languages: ["en", "zh-Hans"],
      territories: { count: 174, excluded: ["China mainland"] },
      withdrawn_at_utc: null,
    });
    if (T0_RECORDED) expect(REGISTRY.released.released_at_utc > REGISTRY.released.submitted_at_utc).toBe(true);
    else expect(REGISTRY.released).toMatchObject({ released_at_utc: null, t0_lookup_receipt: null });
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

  it("the CLI exits 0 on it and says so in its summary (and, until T0 is recorded, that T0_UNRECORDED is deferred)", () => {
    const out = spawnSync(process.execPath, [path.join(import.meta.dirname, "validate-public-claims.mjs")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, T0_MERGE_CHECK: "" } });
    expect(out.stdout).toMatch(new RegExp(`^public-claims: status=${REGISTRY.released.status} files=\\d+ findings=0 exemptions used=(\\d+)/\\1 \\(clean\\)$`, "m"));
    expect(/^DEFERRED T0_UNRECORDED /m.test(out.stdout)).toBe(!T0_RECORDED);
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

  // The released wording of the T0 switch, pinned: in submitted mode (--status submitted, before T0) every piece of it
  // is premature, and in withdrawn mode untrue, and nothing else is reported. The release_status sentence, and on /ios/
  // its status paragraph (with the listing's link), on the home page, /ios/award-grid/, README.md and llms.txt; the
  // price sentence in README.md, the short answers, /ios/'s question 1 (on the page and in its FAQPage JSON-LD, so
  // twice) and llms.txt; the history sentence in LEGAL.md (its only status wording); llms.txt's App Store and
  // availability lines; on /ios/zh-hans/ the answers to 免费吗 and 哪里能下载 (each on the page and in its JSON-LD) and
  // the listing's link. Line numbers are left out, so an unrelated edit above them does not break this.
  const RELEASED_WORDING: ReadonlyArray<readonly [string, string, string?]> = [
    // In withdrawn mode the history sentence is found whole (the registry's released copy, which has no withdrawn one).
    ["LEGAL.md", "is a separate, public release", "The iPhone app is a separate, public release"],
    ["README.md", "AwardGrid is free"],
    ["README.md", "app is free"],
    ["README.md", "on the App Store"],
    ["growth/geo/accuracy-answer.md", "app is free"],
    ["sites/landing/index.html", "AwardGrid is free"],
    ["sites/landing/index.html", "on the App Store"],
    ["sites/landing/ios/award-grid/index.html", "AwardGrid is free"],
    ["sites/landing/ios/award-grid/index.html", "on the App Store"],
    ["sites/landing/ios/index.html", "AwardGrid is free"],
    ["sites/landing/ios/index.html", "app is free"],
    ["sites/landing/ios/index.html", "app is free"],
    ["sites/landing/ios/index.html", "apps.apple.com/app/apple-store/id6816321841"],
    ["sites/landing/ios/index.html", "on the App Store"],
    ["sites/landing/ios/index.html", "on the App Store"],
    ["sites/landing/ios/index.html", "seats.aero notes that not every Pro account or country gets API access, so check that your seats.aero settings show an API tab before you subscribe or download"],
    ["sites/landing/ios/zh-hans/index.html", "App 免费，没有内购"],
    ["sites/landing/ios/zh-hans/index.html", "App 免费，没有内购"],
    ["sites/landing/ios/zh-hans/index.html", "apps.apple.com/app/apple-store/id6816321841"],
    ["sites/landing/ios/zh-hans/index.html", "在 App Store 免费"],
    ["sites/landing/ios/zh-hans/index.html", "在 App Store 免费"],
    ["sites/landing/ios/zh-hans/index.html", "已在 174 个国家或地区提供，中国大陆除外"],
    ["sites/landing/ios/zh-hans/index.html", "已在 174 个国家或地区提供，中国大陆除外"],
    ["sites/landing/public/llms.txt", "Available in 174"],
    ["sites/landing/public/llms.txt", "AwardGrid is free"],
    ["sites/landing/public/llms.txt", "app is free"],
    ["sites/landing/public/llms.txt", "apps.apple.com/app/id6816321841"],
    ["sites/landing/public/llms.txt", "on the App Store"],
  ];
  // The Smart App Banner and the MobileApplication node, when this tree has them: they come and go together, in a
  // change of their own, and without them /ios/ links the listing as text only. What each adds, when it is there: the
  // banner's meta on /ios/ and /ios/zh-hans/; the node (only once released: SCHEMA_JSON) and its two links to the
  // listing (offers.url, sameAs).
  const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
  const BADGE: ReadonlyArray<readonly [string, string, string]> = [
    ...["sites/landing/ios/index.html", "sites/landing/ios/zh-hans/index.html"].filter((f) => /<meta name="apple-itunes-app"/.test(source(f))).map((f) => ["STATUS", f, "apple-itunes-app"] as const),
    ...(/"@type": "MobileApplication"/.test(source("sites/landing/ios/index.html"))
      ? ([
          ["SCHEMA_JSON", "sites/landing/ios/index.html", "<script"],
          ["STATUS", "sites/landing/ios/index.html", "apps.apple.com/app/id6816321841"],
          ["STATUS", "sites/landing/ios/index.html", "apps.apple.com/app/id6816321841"],
        ] as const)
      : []),
  ];
  const expected = (status: "submitted" | "withdrawn") => {
    const rule = status === "submitted" ? "PREMATURE_STATUS" : "WITHDRAWN_STATUS";
    return [
      ...RELEASED_WORDING.map(([file, match, whole]) => `${rule} ${file} ${JSON.stringify(status === "withdrawn" && whole ? whole : match)}`),
      ...BADGE.map(([r, file, match]) => `${r === "STATUS" ? rule : r} ${file} ${JSON.stringify(match)}`),
    ].sort();
  };
  const found = (status: "submitted" | "withdrawn") =>
    validate({ root: ROOT, status }).findings.map((f: { rule: string; logical: string; match: string }) => `${f.rule} ${f.logical} ${JSON.stringify(f.match)}`).sort();

  it("before T0 (--status submitted) it finds exactly the released wording, all of it premature, and nothing else", () => {
    expect(found("submitted")).toEqual(expected("submitted"));
    expect(found("submitted").filter((f: string) => !/^(?:PREMATURE_STATUS|SCHEMA_JSON) /.test(f))).toEqual([]);
  });

  it("once withdrawn it finds exactly the same wording, as WITHDRAWN_STATUS, and nothing else", () => {
    expect(found("withdrawn")).toEqual(expected("withdrawn"));
  });

  it("the CLI exits 1 in submitted mode and lists the premature wording", () => {
    const out = spawnSync(process.execPath, [path.join(import.meta.dirname, "validate-public-claims.mjs"), "--status", "submitted"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, T0_MERGE_CHECK: "" } });
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(new RegExp(`^public-claims: status=submitted_not_live \\(registry: released\\) files=\\d+ findings=${expected("submitted").length} `, "m"));
    expect(out.stdout.split("\n").filter((l: string) => l.startsWith("PREMATURE_STATUS ")).length).toBe(expected("submitted").filter((f) => f.startsWith("PREMATURE_STATUS ")).length);
  });

  // The switch to a later status swaps each status sentence for its claim's copy for that status. The layout of each
  // file below must take that swap as it is (a sentence with no copy for the new status goes): the withdrawn
  // release_status sentence says the app was removed, and nothing else may need rewording. llms.txt is left out once
  // released: the switch to withdrawn also removes its App Store line.
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
  it.each([
    ["README.md", true],
    ["growth/geo/accuracy-answer.md", false],
    ["sites/landing/index.html", false],
    ["sites/landing/ios/award-grid/index.html", false],
  ] as const)("%s passes in each later status once its status sentences take that status's copy", (file, section) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const from = REGISTRY.released.status as string;
    expect(LATER[from]!.length).toBeGreaterThan(0);
    for (const status of LATER[from]!) {
      const found = scanContent(swapped(text, from, status), { logical: file, section, status, registry: REGISTRY, root: ROOT });
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
      ...byStatus(c).map(([, s]) => s),
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

  it("sites/landing/ios/index.html: the lead, what you need, the example's caption, every answer and where this is up to", () => {
    // "What it does not do" is the page's copy from before the registry, kept as it was. The example table's cells are
    // illustrative figures drawn as the app's Matrix, not claims; its visible caption ("Illustrative figures, not
    // seats.aero data…") is outside the table and is checked. The link to the listing is a paragraph that is only a
    // link; its words are release_status's released copy too.
    const blocks = pageBlocks("sites/landing/ios/index.html", [/<section class="limits"[\s\S]*?<\/section>/i, /<table class="ag-preview"[\s\S]*?<\/table>/i]);
    expect(loose(blocks)).toEqual([]);
    expect(sentences(blocks).length).toBeGreaterThan(20);
    expect(blocks).toEqual(expect.arrayContaining([expect.stringMatching(/^AwardGrid is free on the App Store for iPhone \(iOS 18 or later\)\. /)]));
    expect(readFileSync(path.join(ROOT, "sites/landing/ios/index.html"), "utf8")).toContain(
      '<a href="https://apps.apple.com/app/apple-store/id6816321841?pt=124116782&amp;ct=awardgrid-ios&amp;mt=8">View AwardGrid on the App Store</a>',
    );
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
    expect(readFileSync(path.join(ROOT, "sites/landing/ios/zh-hans/index.html"), "utf8")).toContain(
      'AwardGrid 可在 <a href="https://apps.apple.com/app/apple-store/id6816321841?pt=124116782&amp;ct=awardgrid-ios&amp;mt=8">App Store</a> 免费下载（App ID 6816321841）。',
    );
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
    expect(answers).toHaveLength(9);
    const loose = sentences(answers).filter((s) => s !== "No." && s !== "Yes." && !registered.has(s));
    expect(loose).toEqual([]);
  });
});
