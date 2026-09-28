/**
 * The T0 switch: growth/product-facts.json says released.status "released" before T0, with released_at_utc and
 * t0_lookup_receipt empty, because only the first cache-busted lookup that returns the app can fill them
 * (scripts/growth/set-t0.mjs, on T0 day).
 *
 *   - The gate reports the empty pair as its own finding, T0_UNRECORDED. It is deferred by default, so CI on the
 *     prepared switch passes, and it fails the gate under the T0 merge check (--t0-merge-check, or T0_MERGE_CHECK=1).
 *   - The T0 merge check runs at the end of this file only when T0_MERGE_CHECK=1 is set (it is skipped otherwise):
 *     `T0_MERGE_CHECK=1 pnpm exec vitest run scripts/growth/t0-switch.test.ts` must pass before the switch is merged.
 *     CI runs it, with the gate under --t0-merge-check, in a job of its own on every pull request and every push to
 *     main ("T0 merge check"): a pull request that carries the switch shows that job red until T0 is recorded, the
 *     owner has re-read seats.aero's help article 68 and the dates of the DECISIONS.md amendments are filled in. On
 *     any other change it passes, since it asks nothing of a registry that does not say released.
 *   - Whether or not the switch carries the Smart App Banner (a commit of its own), DECISIONS.md records under the
 *     no-badge decision that /ios/ and /ios/zh-hans/ link the listing as text.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ARTICLE_68, applyT0, staleArticle68Reads, t0Date } from "./set-t0.mjs";
import { DEFERRED_RULE_IDS, checkRegistry, formatFinding, lookupProblem, validate } from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(import.meta.dirname, "validate-public-claims.mjs");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, "growth", "product-facts.json"), "utf8"));
const RECEIPT = "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1759154700";
const T0_MERGE_CHECK = process.env.T0_MERGE_CHECK === "1";

/** The registry as the switch is prepared: released, and T0 not yet recorded. */
const prepared = () => {
  const r = structuredClone(REGISTRY);
  r.released.status = "released";
  r.released.released_at_utc = null;
  r.released.t0_lookup_receipt = null;
  return r;
};
const rulesOf = (findings: Array<{ rule: string }>) => findings.map((f) => f.rule);

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("T0_UNRECORDED: released without the T0 lookup", () => {
  it("is reported by the registry check, as its own rule, naming what is empty and what fills it", () => {
    const found = checkRegistry(prepared(), { root: ROOT }).filter((f: { rule: string }) => f.rule === "T0_UNRECORDED");
    expect(found).toHaveLength(1);
    expect(found[0].match).toMatch(/released_at_utc and t0_lookup_receipt are empty: on T0 day run node scripts\/growth\/set-t0\.mjs/);
    const half = prepared();
    half.released.t0_lookup_receipt = RECEIPT;
    expect(checkRegistry(half, { root: ROOT }).filter((f: { rule: string }) => f.rule === "T0_UNRECORDED").map((f: { match: string }) => f.match)).toEqual([
      expect.stringMatching(/but released_at_utc is empty/),
    ]);
    expect(DEFERRED_RULE_IDS).toEqual(["T0_UNRECORDED"]);
  });

  it("fails the gate in released mode under the T0 merge check, and is deferred without it", () => {
    const strict = validate({ root: ROOT, registry: prepared(), t0MergeCheck: true });
    expect(rulesOf(strict.findings)).toContain("T0_UNRECORDED");
    expect(strict.deferred).toEqual([]);
    const lenient = validate({ root: ROOT, registry: prepared() });
    expect(rulesOf(lenient.findings)).not.toContain("T0_UNRECORDED");
    expect(rulesOf(lenient.deferred)).toEqual(["T0_UNRECORDED"]);
  });

  it("the CLI exits 0 with a DEFERRED line, and 1 with T0_MERGE_CHECK=1 or --t0-merge-check", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "t0-switch-"));
    temps.push(dir);
    const file = path.join(dir, "product-facts.json");
    writeFileSync(file, `${JSON.stringify(prepared(), null, 2)}\n`);
    const run = (args: string[], env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [SCRIPT, "--registry", file, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, T0_MERGE_CHECK: "", ...env } });

    const lenient = run([]);
    expect(lenient.status).toBe(0);
    expect(lenient.stdout).toMatch(/^DEFERRED T0_UNRECORDED \S+product-facts\.json:\d+ /m);
    expect(lenient.stdout).toMatch(/^public-claims: status=released files=\d+ findings=0 exemptions used=(\d+)\/\1 \(clean\)$/m);
    expect(lenient.stdout).toMatch(/^public-claims: deferred T0_UNRECORDED=1 \(not failing: the T0 merge check, T0_MERGE_CHECK=1 or --t0-merge-check, fails on it\)$/m);

    for (const strict of [run([], { T0_MERGE_CHECK: "1" }), run(["--t0-merge-check"])]) {
      expect(strict.status).toBe(1);
      expect(strict.stdout).toMatch(/^T0_UNRECORDED \S+product-facts\.json:\d+ /m);
      expect(strict.stdout).toMatch(/^public-claims: status=released files=\d+ findings=1 /m);
      expect(strict.stdout).not.toMatch(/^DEFERRED /m);
    }
  });

  it("is not reported once set-t0 has recorded T0, and the recorded values must be well formed", () => {
    const { registry: filled } = applyT0(prepared(), { releasedAt: "2026-09-29T14:05:00Z", receipt: RECEIPT, now: new Date("2026-09-29T15:00:00Z") });
    expect(checkRegistry(filled, { root: ROOT }).map(formatFinding)).toEqual([]);
    expect(validate({ root: ROOT, registry: filled, t0MergeCheck: true }).findings.map(formatFinding)).toEqual([]);

    const bad = structuredClone(filled);
    bad.released.released_at_utc = "2026-09-29";
    bad.released.t0_lookup_receipt = "https://apps.apple.com/app/id6816321841";
    const problems = checkRegistry(bad, { root: ROOT }).map((f: { rule: string; match: string }) => `${f.rule} ${f.match}`);
    expect(problems).toEqual([
      expect.stringMatching(/^REGISTRY released\.released_at_utc "2026-09-29" is not a UTC time/),
      expect.stringMatching(/^REGISTRY released\.t0_lookup_receipt: .* is not an https:\/\/itunes\.apple\.com\/lookup URL/),
    ]);
  });

  it("a T0 receipt is a cache-busted lookup of this app", () => {
    expect(lookupProblem(RECEIPT, "6816321841")).toBeNull();
    expect(lookupProblem("https://itunes.apple.com/gb/lookup?id=6816321841&cb=1", "6816321841")).toBeNull();
    expect(lookupProblem("https://itunes.apple.com/lookup?id=6816321841&country=us", "6816321841")).toMatch(/not cache-busted/);
    expect(lookupProblem("https://itunes.apple.com/lookup?id=123&cb=1", "6816321841")).toMatch(/does not look up id=6816321841/);
    expect(lookupProblem("http://itunes.apple.com/lookup?id=6816321841&cb=1", "6816321841")).toMatch(/not an https/);
    expect(lookupProblem("https://apps.apple.com/app/id6816321841", "6816321841")).toMatch(/not an https/);
    expect(lookupProblem("not a url", "6816321841")).toMatch(/is not a URL/);
  });
});

/** DECISIONS.md's paragraphs, each on one line. */
const decisionParagraphs = () =>
  readFileSync(path.join(ROOT, "DECISIONS.md"), "utf8")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim());
/**
 * The dates the switch's DECISIONS.md amendments leave to fill in on T0 day: the day of each amendment ("Amended
 * <date>") and the day of the approval or release of 1.0 ("1.0 on <date>"). Any other "<date>" in DECISIONS.md, such
 * as a quoted template, is not the switch's.
 */
const SWITCH_PLACEHOLDER = /Amended <date>|\b1\.0 on <date>/;

describe("DECISIONS.md under the no-badge decision (with or without the Smart App Banner)", () => {
  it("records, once released, that /ios/ and /ios/zh-hans/ link the listing as text, and where the licence is stated", () => {
    const paragraphs = decisionParagraphs();
    const noBadge = paragraphs.findIndex((p) => p.startsWith("- **The landing page carries NO App Store badge, and says why on the page.**"));
    const textLink = paragraphs.findIndex((p) =>
      /^Amended \S+: after the release of 1\.0 on [^,]+, \/ios\/ and \/ios\/zh-hans\/ link the listing as text, and \/ios\/ states the licence in the dependency sentence \(seats\.aero licenses its Partner API for non-commercial use and can limit or withdraw it\)\.$/.test(p),
    );
    expect(noBadge).toBeGreaterThanOrEqual(0);
    expect(textLink, "the text-link amendment").toBe(noBadge + 1);
  });

  it("the T0 merge check looks only at the switch's own placeholders", () => {
    expect(SWITCH_PLACEHOLDER.test("Amended <date>: after the release of 1.0 on 2026-09-29, /ios/ and /ios/zh-hans/ link")).toBe(true);
    expect(SWITCH_PLACEHOLDER.test("Amended 2026-09-30: After Apple approved 1.0 on <date>, /ios/ links the listing")).toBe(true);
    expect(SWITCH_PLACEHOLDER.test("Amended 2026-09-30: After Apple approved 1.0 on 2026-09-29, /ios/ links the listing")).toBe(false);
    expect(SWITCH_PLACEHOLDER.test("Amended <date>: no executable script in the pages' source")).toBe(true);
    expect(SWITCH_PLACEHOLDER.test("Amended 2026-09-30: no executable script in the pages' source")).toBe(false);
    expect(SWITCH_PLACEHOLDER.test("The status line reads \"AwardGrid for iPhone was removed from the App Store on <date>.\"")).toBe(false);
  });
});

describe("the T0 merge check (runs only with T0_MERGE_CHECK=1; run it before merging the switch)", () => {
  it.skipIf(!T0_MERGE_CHECK)("T0 is recorded, article 68 re-read, the gate passes with the merge check, and the switch's dates are filled in", () => {
    if (REGISTRY.released.status === "released") {
      expect(REGISTRY.released.released_at_utc, "run scripts/growth/set-t0.mjs").toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
      expect(REGISTRY.released.t0_lookup_receipt, "run scripts/growth/set-t0.mjs").toEqual(expect.stringMatching(/^https:\/\/itunes\.apple\.com\//));
      // The released copy of /ios/ relies on seats.aero's help article 68, which the owner re-reads on the day of the
      // merge. T0's date is the UTC date of released_at_utc, as set-t0.mjs wrote it, on every machine.
      const date = t0Date(REGISTRY.released.released_at_utc);
      expect(staleArticle68Reads(REGISTRY), `the owner re-reads ${ARTICLE_68}, then set-t0.mjs --article-68-read <that date> (T0's date is ${date})`).toEqual([]);
    }
    expect(validate({ root: ROOT, t0MergeCheck: true }).findings.map(formatFinding)).toEqual([]);
    expect(decisionParagraphs().filter((p) => SWITCH_PLACEHOLDER.test(p)), "fill in the dates of the DECISIONS.md amendments").toEqual([]);
  });
});
