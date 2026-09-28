/**
 * The T0 switch: growth/product-facts.json says released.status "released" before T0, with released_at_utc and
 * t0_lookup_receipt empty, because only the first cache-busted lookup that returns the app can fill them
 * (scripts/growth/set-t0.mjs, on T0 day). The change to withdrawn, if the app is ever removed from the App Store,
 * follows the same pattern: withdrawn_at_utc stays empty, and the withdrawn sentences say <date>, until
 * scripts/growth/set-withdrawn.mjs records the removal (WITHDRAWN_UNRECORDED, deferred like T0_UNRECORDED). A removal
 * follows the release, so a withdrawn registry without T0 is T0_UNRECORDED too.
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
import { applyWithdrawal } from "./set-withdrawn.mjs";
import { DEFERRED_RULE_IDS, REGISTRY_RULE_IDS, checkRegistry, formatFinding, lookupProblem, validate } from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(import.meta.dirname, "validate-public-claims.mjs");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, "growth", "product-facts.json"), "utf8"));
const RECEIPT = "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1759154700";
const T0_MERGE_CHECK = process.env.T0_MERGE_CHECK === "1";
/**
 * Whether this tree's pages carry the released wording. On the withdrawn template they carry the withdrawn wording, which
 * the gate in released mode reports as premature, so the tests below that need the released pages skip there.
 */
const TREE_RELEASED = REGISTRY.released.status === "released";

/**
 * The registry as the switch is prepared: released, T0 not yet recorded, and no removal (whatever `base` holds: this
 * tree's registry may say withdrawn, with T0 and the removal recorded).
 */
const preparedFrom = (base: typeof REGISTRY) => {
  const r = structuredClone(base);
  r.released.status = "released";
  r.released.released_at_utc = null;
  r.released.t0_lookup_receipt = null;
  r.released.withdrawn_at_utc = null;
  for (const holder of [r.released, ...r.claims]) holder.evidence_ref = holder.evidence_ref.filter((ref: string) => !ref.endsWith("(withdrawal)"));
  return r;
};
const prepared = () => preparedFrom(REGISTRY);
const T0 = { releasedAt: "2026-09-29T14:05:00Z", receipt: RECEIPT, now: new Date("2026-09-29T15:00:00Z") };
const WITHDRAWN_RECEIPT = "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1793437200";
const REMOVAL = { withdrawnAt: "2026-11-01T09:00:00Z", receipt: WITHDRAWN_RECEIPT, now: new Date("2026-11-01T10:00:00Z") };
/** The registry as the change to withdrawn is prepared: withdrawn, T0 recorded (the removal follows it), the removal not yet. */
const withdrawnPrepared = () => {
  const r = applyT0(prepared(), T0).registry;
  r.released.status = "withdrawn";
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
    expect(DEFERRED_RULE_IDS).toEqual(["T0_UNRECORDED", "WITHDRAWN_UNRECORDED"]);
  });

  it("fails the gate in released mode under the T0 merge check, and is deferred without it", () => {
    const strict = validate({ root: ROOT, registry: prepared(), t0MergeCheck: true });
    expect(rulesOf(strict.findings)).toContain("T0_UNRECORDED");
    expect(strict.deferred).toEqual([]);
    const lenient = validate({ root: ROOT, registry: prepared() });
    expect(rulesOf(lenient.findings)).not.toContain("T0_UNRECORDED");
    expect(rulesOf(lenient.deferred)).toEqual(["T0_UNRECORDED"]);
  });

  it.skipIf(!TREE_RELEASED)("the CLI exits 0 with a DEFERRED line, and 1 with T0_MERGE_CHECK=1 or --t0-merge-check", () => {
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
    const { registry: filled } = applyT0(prepared(), T0);
    expect(checkRegistry(filled, { root: ROOT }).map(formatFinding)).toEqual([]);
    // The whole tree passes the merge check on the released pages; on the withdrawn template's pages the gate in released
    // mode finds the withdrawn wording (current-tree.test.ts pins it), and still nothing of the registry's.
    const found = validate({ root: ROOT, registry: filled, t0MergeCheck: true }).findings;
    expect(found.filter((f: { rule: string }) => REGISTRY_RULE_IDS.includes(f.rule)).map(formatFinding)).toEqual([]);
    if (TREE_RELEASED) expect(found.map(formatFinding)).toEqual([]);

    const bad = structuredClone(filled);
    bad.released.released_at_utc = "2026-09-29";
    bad.released.t0_lookup_receipt = "https://apps.apple.com/app/id6816321841";
    const problems = checkRegistry(bad, { root: ROOT }).map((f: { rule: string; match: string }) => `${f.rule} ${f.match}`);
    expect(problems).toEqual([
      expect.stringMatching(/^REGISTRY released\.released_at_utc "2026-09-29" is not a UTC time/),
      expect.stringMatching(/^REGISTRY released\.t0_lookup_receipt: .* is not an https:\/\/itunes\.apple\.com\/lookup URL/),
    ]);
  });

  it("is prepared the same from a tree with the removal recorded (the withdrawn template on the day)", () => {
    const removed = applyWithdrawal(withdrawnPrepared(), REMOVAL).registry;
    expect(checkRegistry(removed, { root: ROOT }).map(formatFinding)).toEqual([]);
    const { registry } = applyT0(preparedFrom(removed), T0);
    expect(registry.released).toMatchObject({ status: "released", withdrawn_at_utc: null });
    expect(checkRegistry(registry, { root: ROOT }).map(formatFinding)).toEqual([]);
  });

  it("is reported for a withdrawn registry too, since the app is removed only after it is released", () => {
    const noT0 = withdrawnPrepared();
    noT0.released.released_at_utc = null;
    noT0.released.t0_lookup_receipt = null;
    const found = checkRegistry(noT0, { root: ROOT }).filter((f: { rule: string }) => DEFERRED_RULE_IDS.includes(f.rule));
    expect(found.map((f: { rule: string; match: string }) => `${f.rule} ${f.match}`)).toEqual([
      expect.stringMatching(/^T0_UNRECORDED released\.status is withdrawn but released_at_utc and t0_lookup_receipt are empty: .* where node scripts\/growth\/set-t0\.mjs has recorded T0$/),
      expect.stringMatching(/^WITHDRAWN_UNRECORDED /),
    ]);
    // Recording the removal does not stand for T0: the merge check still fails on it.
    const removed = structuredClone(noT0);
    removed.released.withdrawn_at_utc = REMOVAL.withdrawnAt;
    expect(rulesOf(checkRegistry(removed, { root: ROOT }))).toEqual(["T0_UNRECORDED"]);
    expect(rulesOf(validate({ root: ROOT, registry: removed, t0MergeCheck: true }).findings)).toContain("T0_UNRECORDED");
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

describe("WITHDRAWN_UNRECORDED: withdrawn without the date of the removal", () => {
  it("is reported by the registry check, as its own rule, naming what fills it, and is the other deferred finding", () => {
    const found = checkRegistry(withdrawnPrepared(), { root: ROOT }).filter((f: { rule: string }) => DEFERRED_RULE_IDS.includes(f.rule));
    expect(found.map((f: { rule: string }) => f.rule)).toEqual(["WITHDRAWN_UNRECORDED"]);
    expect(found[0].match).toMatch(/^released\.status is withdrawn but withdrawn_at_utc is empty: on the day of the removal run node scripts\/growth\/set-withdrawn\.mjs --withdrawn-at <ISO> --receipt <lookup URL>/);
  });

  it("fails the gate under the merge check, and is deferred without it (standing for the pages' <date> too)", () => {
    const strict = validate({ root: ROOT, registry: withdrawnPrepared(), t0MergeCheck: true });
    expect(rulesOf(strict.findings)).toContain("WITHDRAWN_UNRECORDED");
    expect(strict.deferred).toEqual([]);
    const lenient = validate({ root: ROOT, registry: withdrawnPrepared() });
    expect(rulesOf(lenient.findings)).not.toContain("WITHDRAWN_UNRECORDED");
    expect(rulesOf(lenient.findings)).not.toContain("DATE_PLACEHOLDER");
    expect(rulesOf(lenient.deferred)).toEqual(["WITHDRAWN_UNRECORDED"]);
  });

  it("the CLI exits with a DEFERRED line, and 1 with T0_MERGE_CHECK=1 or --t0-merge-check", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "withdrawn-"));
    temps.push(dir);
    const file = path.join(dir, "product-facts.json");
    writeFileSync(file, `${JSON.stringify(withdrawnPrepared(), null, 2)}\n`);
    const run = (args: string[], env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [SCRIPT, "--registry", file, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, T0_MERGE_CHECK: "", ...env } });
    const count = (stdout: string) => Number(/^public-claims: status=withdrawn files=\d+ findings=(\d+) /m.exec(stdout)?.[1]);

    const lenient = run([]);
    expect(lenient.stdout).toMatch(/^DEFERRED WITHDRAWN_UNRECORDED \S+product-facts\.json:\d+ /m);
    expect(lenient.stdout).toMatch(/^public-claims: deferred WITHDRAWN_UNRECORDED=1 \(not failing: the T0 merge check, T0_MERGE_CHECK=1 or --t0-merge-check, fails on it\)$/m);
    expect(lenient.status).toBe(count(lenient.stdout) ? 1 : 0);
    // On the withdrawn pages (this template) nothing else is found.
    if (!TREE_RELEASED) expect(count(lenient.stdout)).toBe(0);

    for (const strict of [run([], { T0_MERGE_CHECK: "1" }), run(["--t0-merge-check"])]) {
      expect(strict.status).toBe(1);
      expect(strict.stdout).toMatch(/^WITHDRAWN_UNRECORDED \S+product-facts\.json:\d+ /m);
      expect(count(strict.stdout)).toBe(count(lenient.stdout) + 1);
      expect(strict.stdout).not.toMatch(/^DEFERRED /m);
    }
  });

  it("is not reported once set-withdrawn has recorded the removal; a <date> left in a page then fails in every mode", () => {
    const { registry: recorded } = applyWithdrawal(withdrawnPrepared(), REMOVAL);
    expect(checkRegistry(recorded, { root: ROOT }).map(formatFinding)).toEqual([]);
    const found = validate({ root: ROOT, registry: recorded }).findings;
    expect(found.filter((f: { rule: string }) => f.rule !== "DATE_PLACEHOLDER").filter((f: { rule: string }) => REGISTRY_RULE_IDS.includes(f.rule))).toEqual([]);
    // This template's pages still say <date> (set-withdrawn.mjs fills them in the same run that records the date).
    if (!TREE_RELEASED && !REGISTRY.released.withdrawn_at_utc) {
      expect(found.length).toBeGreaterThan(0);
      expect(new Set(rulesOf(found))).toEqual(new Set(["DATE_PLACEHOLDER"]));
    }
  });
});

/** DECISIONS.md's paragraphs, each on one line. */
const decisionParagraphs = () =>
  readFileSync(path.join(ROOT, "DECISIONS.md"), "utf8")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim());
/**
 * The dates the switch's DECISIONS.md amendments leave to fill in on T0 day: the day of each amendment ("Amended
 * <date>") and the day of the approval or release of 1.0 ("1.0 on <date>"); and the withdrawal's amendment, whose date
 * of the removal set-withdrawn.mjs writes. Any other "<date>" in DECISIONS.md, such as a quoted template, is not theirs.
 */
const SWITCH_PLACEHOLDER = /Amended <date>|\b1\.0 on <date>|^Amended \S+: the app was removed from the App Store on <date>/;

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
    const removal = "the pages carry no Smart App Banner and no link to the listing.";
    expect(SWITCH_PLACEHOLDER.test(`Amended <date>: the app was removed from the App Store on <date>; ${removal}`)).toBe(true);
    expect(SWITCH_PLACEHOLDER.test(`Amended 2026-11-02: the app was removed from the App Store on <date>; ${removal}`)).toBe(true);
    expect(SWITCH_PLACEHOLDER.test(`Amended 2026-11-02: the app was removed from the App Store on 2026-11-01; ${removal}`)).toBe(false);
  });
});

describe("the T0 merge check (runs only with T0_MERGE_CHECK=1; run it before merging the switch, or the change to withdrawn)", () => {
  it.skipIf(!T0_MERGE_CHECK)("T0 is recorded, article 68 re-read, the removal recorded, the gate passes with the merge check, and the dates are filled in", () => {
    if (REGISTRY.released.status === "released") {
      expect(REGISTRY.released.released_at_utc, "run scripts/growth/set-t0.mjs").toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
      expect(REGISTRY.released.t0_lookup_receipt, "run scripts/growth/set-t0.mjs").toEqual(expect.stringMatching(/^https:\/\/itunes\.apple\.com\//));
      // The released copy of /ios/ relies on seats.aero's help article 68, which the owner re-reads on the day of the
      // merge. T0's date is the UTC date of released_at_utc, as set-t0.mjs wrote it, on every machine.
      const date = t0Date(REGISTRY.released.released_at_utc);
      expect(staleArticle68Reads(REGISTRY), `the owner re-reads ${ARTICLE_68}, then set-t0.mjs --article-68-read <that date> (T0's date is ${date})`).toEqual([]);
    }
    if (REGISTRY.released.status === "withdrawn") {
      // The removal follows the release: T0 as set-t0.mjs recorded it on main, then the removal.
      expect(REGISTRY.released.released_at_utc, "base the change on a tree where set-t0.mjs recorded T0").toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
      expect(REGISTRY.released.t0_lookup_receipt, "base the change on a tree where set-t0.mjs recorded T0").toEqual(expect.stringMatching(/^https:\/\/itunes\.apple\.com\//));
      expect(REGISTRY.released.withdrawn_at_utc, "run scripts/growth/set-withdrawn.mjs").toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
    }
    expect(validate({ root: ROOT, t0MergeCheck: true }).findings.map(formatFinding)).toEqual([]);
    expect(decisionParagraphs().filter((p) => SWITCH_PLACEHOLDER.test(p)), "fill in the dates of the DECISIONS.md amendments").toEqual([]);
  });
});
