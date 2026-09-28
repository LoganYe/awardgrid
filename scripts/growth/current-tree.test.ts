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
  allowed_copy_by_status?: Record<string, string>;
  allowed_copy_variants?: Record<string, string>;
  in_use?: string[];
  retired_copy?: string[];
}
const CLAIMS: Claim[] = REGISTRY.claims;
const claim = (id: string) => CLAIMS.find((c) => c.claim_id === id)!;
const MODE: Record<string, "submitted" | "released" | "withdrawn"> = { submitted_not_live: "submitted", released: "released", withdrawn: "withdrawn" };

describe("the facts registry", () => {
  it("passes every registry check: fields, enums, evidence refs, public files, markers, surfaces, exemptions", () => {
    expect(checkRegistry(REGISTRY, { root: ROOT, registryText: REGISTRY_TEXT }).map(formatFinding)).toEqual([]);
  });

  it("holds exactly the claims the public copy is built from", () => {
    expect(CLAIMS.map((c) => c.claim_id)).toEqual([
      "identity", "domain_collision", "release_status", "history", "webapp_note", "dependency", "prerequisite", "price", "grid",
      "query_input", "query_zh_hant", "views", "scope", "programs", "data_cached", "watches", "quota", "ask", "privacy",
      "developer_data", "keys", "program_link", "not_offered", "affiliation", "availability",
    ]);
  });

  it("holds only the pending claims listed here, and approves the rest", () => {
    // dependency, grid (reworded for the iPhone app's Matrix), developer_data (the owner's PR #104 wording) and
    // domain_collision were approved on 2026-09-28; a claim set back to pending_owner must be listed here on purpose.
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

  it("registers Q6's sentence under ask, with its evidence", () => {
    expect(claim("ask").allowed_copy_extra).toContain("Search runs on your seats.aero key alone.");
    expect(claim("ask").limitations.join(" ")).toMatch(/seats\.aero key alone.*search\.ts/);
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
    const offenders: string[] = [];
    for (const c of CLAIMS.filter((x) => x.public_use === "approved")) {
      const versions: Array<[string, string]> = [];
      for (const s of [c.allowed_copy, c.allowed_copy_zh, ...(c.allowed_copy_extra ?? [])]) if (s) versions.push([REGISTRY.released.status, s]);
      for (const [status, s] of Object.entries(c.allowed_copy_by_status ?? {})) versions.push([status, s.replace("<date>", "1 November 2026")]);
      for (const key of c.in_use ?? []) versions.push([REGISTRY.released.status, c.allowed_copy_variants![key]!]);
      for (const [status, text] of versions) {
        const withPrerequisite = /\bfree\b/.test(text) ? `${text} ${prerequisite}` : text;
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
    expect(retired.map(([id]) => id).sort()).toEqual(["developer_data", "grid", "grid"]);
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

  // What has to change when the registry's status moves on from submitted_not_live, pinned so that the change of
  // status fixes exactly these and nothing slips through. All ten are the submission wording, correct today: the
  // release_status and price sentences at the top of README.md, the price answer in growth/geo/accuracy-answer.md,
  // the history sentence in LEGAL.md, the /ios/ status paragraph, the home page's status line, and the Status, Price
  // and Availability lines of llms.txt. Once released, each takes its claim's released copy; once withdrawn, the
  // withdrawn copy (release_status) or none. Line numbers are left out, so an unrelated edit above them does not
  // break this.
  const AFTER_SUBMISSION = [
    'STALE_STATUS LEGAL.md "has been submitted to the App Store"',
    'STALE_STATUS README.md "submitted as a free app"',
    'STALE_STATUS README.md "has been submitted to the App Store"',
    'STALE_STATUS growth/geo/accuracy-answer.md "submitted as a free app"',
    'STALE_STATUS sites/landing/index.html "has been submitted to the App Store"',
    'STALE_STATUS sites/landing/ios/index.html "has been submitted to the App Store"',
    `STALE_STATUS sites/landing/ios/index.html "waiting for Apple's review"`,
    'STALE_STATUS sites/landing/public/llms.txt "has been submitted to the App Store"',
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
      const copy = c.allowed_copy_by_status;
      if (!copy) continue;
      const next = copy[status]?.replace("<date>", "1 November 2026") ?? "";
      out = out.split(copy.submitted_not_live!).join(next);
    }
    return out;
  };
  it.each([
    ["README.md", true],
    ["growth/geo/accuracy-answer.md", false],
    ["sites/landing/index.html", false],
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
  // Every sentence of the README's public section and of the short answers is a registered sentence (in some status,
  // variant or language), so a public sentence cannot drift from the facts it stands for.
  const registered = new Set(
    CLAIMS.flatMap((c) => [c.allowed_copy, c.allowed_copy_zh, ...(c.allowed_copy_extra ?? []), ...Object.values(c.allowed_copy_by_status ?? {}), ...Object.values(c.allowed_copy_variants ?? {})])
      .filter((s): s is string => typeof s === "string")
      .flatMap((s) => s.split(/(?<=[.!?。！？])\s+/)),
  );
  const sentences = (runs: string[]) => runs.flatMap((run) => run.split(/(?<=[.!?。！？])\s+/)).filter(Boolean);

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
