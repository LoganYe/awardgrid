/**
 * scripts/growth/set-t0.mjs: it records T0 (the first cache-busted lookup that returns the app) in the registry, the
 * lastmod of the pages the switch changes and the check date of llms.txt; it refuses anything that is not a T0, and it
 * never writes a date later than a build's "today". T0's date is the UTC date of the release on every machine, and
 * "today" is the later of the UTC and the local date (as the site's build takes it). It runs on copies in a temp
 * directory: never on this tree.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ARTICLE_68,
  LLMS_FILE,
  PAGES_FILE,
  REGISTRY_FILE,
  SWITCH_PAGES,
  T0Error,
  applyT0,
  article68Reads,
  main,
  normalizeInstant,
  raiseChecked,
  raiseLastmod,
  receiptRef,
  staleArticle68Reads,
  t0Date,
  todayOf,
} from "./set-t0.mjs";
import { applyWithdrawal } from "./set-withdrawn.mjs";
import { checkRegistry, formatFinding } from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(import.meta.dirname, "set-t0.mjs");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, REGISTRY_FILE), "utf8"));
const RECEIPT = "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1759154700";
const AT = "2026-09-29T14:05:00Z";
const NOW = new Date("2026-09-29T15:00:00Z");

/**
 * The registry as the switch is prepared: released, T0 not recorded, and no removal (whatever `base` holds: this tree's
 * registry may say released, or withdrawn with T0 and the removal recorded).
 */
const preparedFrom = (base: typeof REGISTRY) => {
  const r = structuredClone(base);
  r.released.status = "released";
  r.released.released_at_utc = null;
  r.released.t0_lookup_receipt = null;
  r.released.withdrawn_at_utc = null;
  for (const holder of [r.released, ...r.claims]) holder.evidence_ref = holder.evidence_ref.filter((ref: string) => !ref.endsWith("(withdrawal)"));
  r.released.checked_at = "2026-09-28";
  const status = r.claims.find((c: { claim_id: string }) => c.claim_id === "release_status");
  status.checked_at = "2026-09-28";
  status.evidence_ref = status.evidence_ref.filter((ref: string) => !ref.endsWith("(T0)"));
  r.released.evidence_ref = r.released.evidence_ref.filter((ref: string) => !ref.endsWith("(T0)"));
  // seats.aero's help article 68 as read before T0, whatever this tree says.
  for (const c of r.claims) c.evidence_ref = c.evidence_ref.map((ref: string) => ref.replace(/^(\[external\] https:\/\/docs\.seats\.aero\/article\/68 \(read )\d{4}-\d{2}-\d{2}/, "$12026-09-28"));
  return r;
};
const prepared = () => preparedFrom(REGISTRY);
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(T0Error);
    return (error as Error).message;
  }
  throw new Error("expected a T0Error");
};

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
/** A temp root holding copies of the three files set-t0 writes, the registry as the switch is prepared. */
const tempRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), "set-t0-"));
  temps.push(root);
  for (const rel of [PAGES_FILE, LLMS_FILE]) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    copyFileSync(path.join(ROOT, rel), path.join(root, rel));
  }
  mkdirSync(path.join(root, "growth"), { recursive: true });
  writeFileSync(path.join(root, REGISTRY_FILE), `${JSON.stringify(prepared(), null, 2)}\n`);
  // The dates set-t0 raises, set back to before T0 whatever this tree says.
  const pages = path.join(root, PAGES_FILE);
  writeFileSync(pages, readFileSync(pages, "utf8").replace(/"lastmod": "\d{4}-\d{2}-\d{2}"/g, '"lastmod": "2026-09-28"'));
  const llms = path.join(root, LLMS_FILE);
  writeFileSync(llms, readFileSync(llms, "utf8").replace(/^## Facts \(checked \d{4}-\d{2}-\d{2}\)$/m, "## Facts (checked 2026-09-28)"));
  return root;
};
const cli = (args: string[]) => {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = main(args, { log: (s: string) => lines.push(s), error: (s: string) => errors.push(s) });
  return { code, out: lines.join("\n"), err: errors.join("\n") };
};
/** `fn(instant)` from set-t0.mjs, in a process of its own whose time zone is `tz` (this process's is left alone). */
const inZone = (tz: string, fn: "t0Date" | "todayOf", instant: string) =>
  spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `import { ${fn} } from ${JSON.stringify(SCRIPT)}; console.log(${fn}(${fn === "todayOf" ? `new Date(${JSON.stringify(instant)})` : JSON.stringify(instant)}));`],
    { encoding: "utf8", env: { ...process.env, TZ: tz } },
  ).stdout.trim();

describe("applyT0: the registry with T0 recorded", () => {
  it("fills released_at_utc and t0_lookup_receipt, dates the check, and cites the lookup; the gate then has nothing to say", () => {
    const before = prepared();
    const { registry, changes, date } = applyT0(before, { releasedAt: AT, receipt: RECEIPT, now: NOW });
    expect(date).toBe("2026-09-29");
    expect(registry.released).toMatchObject({ status: "released", released_at_utc: AT, t0_lookup_receipt: RECEIPT, checked_at: "2026-09-29", withdrawn_at_utc: null });
    const status = registry.claims.find((c: { claim_id: string }) => c.claim_id === "release_status");
    expect(status.checked_at).toBe("2026-09-29");
    expect(status.evidence_ref.at(-1)).toBe(receiptRef(RECEIPT, "2026-09-29"));
    expect(registry.released.evidence_ref.at(-1)).toBe(receiptRef(RECEIPT, "2026-09-29"));
    expect(changes).toHaveLength(6);
    // Pure: the registry it was given is unchanged.
    expect(before.released.released_at_utc).toBeNull();
    // Every ref it writes is one the gate reads, and T0_UNRECORDED is gone.
    expect(checkRegistry(registry, { root: ROOT }).map(formatFinding)).toEqual([]);
  });

  it("prepares the same switch from a tree whose registry says withdrawn, with T0 and the removal recorded", () => {
    // The withdrawn template's tree on the day of the removal, after set-t0.mjs (on main) and set-withdrawn.mjs.
    const released = applyT0(prepared(), { releasedAt: AT, receipt: RECEIPT, now: NOW }).registry;
    released.released.status = "withdrawn";
    const removal = "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1793437200";
    const removed = applyWithdrawal(released, { withdrawnAt: "2026-11-01T09:00:00Z", receipt: removal, now: new Date("2026-11-01T10:00:00Z") }).registry;
    expect(checkRegistry(removed, { root: ROOT }).map(formatFinding)).toEqual([]);
    const again = preparedFrom(removed);
    expect(again.released).toMatchObject({ status: "released", released_at_utc: null, t0_lookup_receipt: null, withdrawn_at_utc: null });
    const { registry } = applyT0(again, { releasedAt: AT, receipt: RECEIPT, now: NOW });
    expect(registry.released.withdrawn_at_utc).toBeNull();
    expect(checkRegistry(registry, { root: ROOT }).map(formatFinding)).toEqual([]);
  });

  it("changes nothing when run again with the same values, and accepts a time without seconds", () => {
    const once = applyT0(prepared(), { releasedAt: "2026-09-29T14:05Z", receipt: RECEIPT, now: NOW }).registry;
    expect(once.released.released_at_utc).toBe(AT);
    expect(applyT0(once, { releasedAt: AT, receipt: RECEIPT, now: NOW }).changes).toEqual([]);
  });

  it("refuses a registry that is not released, and a time or receipt that is not a T0", () => {
    const submitted = prepared();
    submitted.released.status = "submitted_not_live";
    expect(refused(() => applyT0(submitted, { releasedAt: AT, receipt: RECEIPT, now: NOW }))).toMatch(/released\.status is "submitted_not_live"/);
    const at = (releasedAt: string) => refused(() => applyT0(prepared(), { releasedAt, receipt: RECEIPT, now: NOW }));
    expect(at("2026-09-29")).toMatch(/is not a UTC time/);
    expect(at("2026-09-29T14:05:00+02:00")).toMatch(/is not a UTC time/);
    expect(at("2026-02-30T14:05:00Z")).toMatch(/is not a UTC time/);
    expect(at("2026-09-26T12:00:00Z")).toMatch(/is before the submission \(2026-09-27T03:24:00Z\)/);
    expect(at("2026-09-29T16:00:00Z")).toMatch(/is in the future/);
    const receipt = (value: string) => refused(() => applyT0(prepared(), { releasedAt: AT, receipt: value, now: NOW }));
    expect(receipt("https://itunes.apple.com/lookup?id=6816321841&country=us")).toMatch(/not cache-busted/);
    expect(receipt("https://apps.apple.com/app/apple-store/id6816321841?pt=124116782&ct=awardgrid-ios&mt=8")).toMatch(/not an https:\/\/itunes\.apple\.com\/lookup URL/);
    expect(receipt("https://itunes.apple.com/lookup?id=1&cb=1")).toMatch(/does not look up id=6816321841/);
  });

  it("will not overwrite a recorded T0 unless forced, and a forced one replaces the old lookup's ref", () => {
    const once = applyT0(prepared(), { releasedAt: AT, receipt: RECEIPT, now: NOW }).registry;
    const other = "https://itunes.apple.com/lookup?id=6816321841&country=gb&cb=1759155000";
    expect(refused(() => applyT0(once, { releasedAt: "2026-09-29T14:10:00Z", receipt: other, now: NOW }))).toMatch(/already recorded .* pass --force/);
    const { registry } = applyT0(once, { releasedAt: "2026-09-29T14:10:00Z", receipt: other, now: NOW, force: true });
    expect(registry.released).toMatchObject({ released_at_utc: "2026-09-29T14:10:00Z", t0_lookup_receipt: other });
    for (const refs of [registry.released.evidence_ref, registry.claims.find((c: { claim_id: string }) => c.claim_id === "release_status").evidence_ref]) {
      expect(refs.filter((r: string) => r.endsWith("(T0)"))).toEqual([receiptRef(other, "2026-09-29")]);
    }
  });
});

describe("--article-68-read: the owner's re-read of seats.aero's help article 68", () => {
  it("moves the article's refs in the prerequisite and dependency claims to that day, and only those", () => {
    const before = prepared();
    expect(article68Reads(before)).toEqual(["prerequisite 2026-09-28", "dependency 2026-09-28"]);
    const { registry, changes } = applyT0(before, { releasedAt: AT, receipt: RECEIPT, now: NOW, article68Read: "2026-09-29" });
    expect(article68Reads(registry)).toEqual(["prerequisite 2026-09-29", "dependency 2026-09-29"]);
    expect(changes.filter((c: string) => c.includes(ARTICLE_68))).toEqual([
      `claims.prerequisite: evidence_ref [external] ${ARTICLE_68} (read 2026-09-28) -> [external] ${ARTICLE_68} (read 2026-09-29)`,
      `claims.dependency: evidence_ref [external] ${ARTICLE_68} (read 2026-09-28) -> [external] ${ARTICLE_68} (read 2026-09-29)`,
    ]);
    // Other claims that cite the article (the quota) keep their date: the switch does not publish their copy.
    const quota = (r: { claims: Array<{ claim_id: string; evidence_ref: string[] }> }) => r.claims.find((c) => c.claim_id === "quota")!.evidence_ref.filter((ref) => ref.includes(ARTICLE_68));
    expect(quota(registry)).toEqual(quota(before));
    expect(checkRegistry(registry, { root: ROOT }).map(formatFinding)).toEqual([]);
    // Again with the same day: nothing to change.
    expect(applyT0(registry, { releasedAt: AT, receipt: RECEIPT, now: NOW, article68Read: "2026-09-29" }).changes).toEqual([]);
  });

  it("refuses a day that is not a date, is before T0's date or after today, and a registry with no ref to move", () => {
    const read = (article68Read: string, registry = prepared()) => refused(() => applyT0(registry, { releasedAt: AT, receipt: RECEIPT, now: NOW, article68Read }));
    expect(read("2026-9-29")).toMatch(/is not a date/);
    expect(read("2026-02-30")).toMatch(/is not a date/);
    expect(read("2026-09-28")).toMatch(/is before T0's date \(2026-09-29\): the article is re-read on the day the switch is merged/);
    expect(read("2026-10-01")).toMatch(/is after today/);
    const noRef = prepared();
    const dependency = noRef.claims.find((c: { claim_id: string }) => c.claim_id === "dependency");
    dependency.evidence_ref = dependency.evidence_ref.filter((ref: string) => !ref.includes(ARTICLE_68));
    expect(read("2026-09-29", noRef)).toMatch(/claim dependency has no "\[external\] https:\/\/docs\.seats\.aero\/article\/68 \(read …\)" ref/);
  });
});

describe("dates", () => {
  it("normalizes a UTC time to YYYY-MM-DDTHH:MM:SSZ, and refuses anything else", () => {
    expect(normalizeInstant("2026-09-29T14:05Z")).toBe(AT);
    expect(normalizeInstant("2026-09-29T14:05:00.123Z")).toBe(AT);
    expect(normalizeInstant("2026-09-29T24:05:00Z")).toBeNull();
    expect(normalizeInstant("2026-09-29 14:05:00Z")).toBeNull();
    expect(normalizeInstant(undefined)).toBeNull();
  });

  it("T0's date is the UTC date of the release, on every machine", () => {
    // 02:00Z on the 30th is the evening of the 29th in California; 20:00Z on the 29th is the 30th in Tokyo.
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
      expect(inZone(tz, "t0Date", "2026-09-30T02:00:00Z"), tz).toBe("2026-09-30");
      expect(inZone(tz, "t0Date", "2026-09-29T20:00:00Z"), tz).toBe("2026-09-29");
      expect(inZone(tz, "t0Date", AT), tz).toBe("2026-09-29");
    }
    expect(t0Date(AT)).toBe("2026-09-29");
  });

  it("today is the later of the UTC and the local date, so no UTC date written today is later than it", () => {
    expect(inZone("America/Los_Angeles", "todayOf", "2026-09-30T04:00:00Z")).toBe("2026-09-30");
    expect(inZone("Asia/Tokyo", "todayOf", "2026-09-29T20:00:00Z")).toBe("2026-09-30");
    expect(inZone("UTC", "todayOf", "2026-09-29T20:00:00Z")).toBe("2026-09-29");
    const now = new Date("2026-09-30T04:00:00Z");
    expect(todayOf(now) >= t0Date(now.toISOString())).toBe(true);
  });

  it("refuses a release whose UTC date is after today, even within the clock-skew allowance", () => {
    // 00:02Z on the 30th, 7 minutes after "now" (23:55Z on the 29th): the 30th has not begun in UTC or in California.
    const root = tempRoot();
    const r = spawnSync(process.execPath, [SCRIPT, "--root", root, "--released-at", "2026-09-30T00:02:00Z", "--receipt", RECEIPT, "--now", "2026-09-29T23:55:00Z"], {
      encoding: "utf8",
      env: { ...process.env, TZ: "America/Los_Angeles" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^set-t0: --released-at 2026-09-30T00:02:00Z is on 2026-09-30, after today \(2026-09-29\)$/m);
  });

  it("raises the switched pages' lastmod and the llms.txt check date, never lowers them, and keeps the files' layout", () => {
    const pages = readFileSync(path.join(ROOT, PAGES_FILE), "utf8").replace(/"lastmod": "\d{4}-\d{2}-\d{2}"/g, '"lastmod": "2026-09-28"');
    const raised = raiseLastmod(pages, "2026-09-29");
    expect(raised.changes).toHaveLength(SWITCH_PAGES.length);
    const manifest = JSON.parse(raised.text);
    for (const p of manifest.pages) expect(p.lastmod, p.path).toBe(SWITCH_PAGES.includes(p.path) ? "2026-09-29" : "2026-09-28");
    expect(raised.text.split("\n").length).toBe(pages.split("\n").length);
    expect(raiseLastmod(raised.text, "2026-09-20").changes).toEqual([]);
    const llms = "# AwardGrid\n\n## Facts (checked 2026-09-28)\n";
    expect(raiseChecked(llms, "2026-09-29").text).toBe("# AwardGrid\n\n## Facts (checked 2026-09-29)\n");
    expect(raiseChecked(llms, "2026-09-27").changes).toEqual([]);
    expect(refused(() => raiseChecked("# AwardGrid\n", "2026-09-29"))).toMatch(/no "## Facts \(checked YYYY-MM-DD\)" line/);
  });
});

describe("the command line", () => {
  const args = (root: string, extra: string[] = []) => ["--root", root, "--released-at", AT, "--receipt", RECEIPT, "--now", NOW.toISOString(), ...extra];

  it("writes the registry, pages.json and llms.txt, and says what to run next", () => {
    const root = tempRoot();
    const r = cli(args(root));
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^set-t0: T0 2026-09-29T14:05:00Z \(date 2026-09-29\): 11 change\(s\) written$/m);
    expect(r.out).toMatch(/the T0 merge check must pass before the switch is merged: T0_MERGE_CHECK=1 pnpm exec vitest run scripts\/growth\/t0-switch\.test\.ts$/m);
    // Without --article-68-read it says the article is still to be re-read.
    expect(r.out).toMatch(/^set-t0: https:\/\/docs\.seats\.aero\/article\/68 was last read before T0 \(prerequisite 2026-09-28, dependency 2026-09-28\): the owner re-reads it/m);
    const registry = JSON.parse(readFileSync(path.join(root, REGISTRY_FILE), "utf8"));
    expect(registry.released).toMatchObject({ released_at_utc: AT, t0_lookup_receipt: RECEIPT });
    expect(readFileSync(path.join(root, REGISTRY_FILE), "utf8")).toBe(`${JSON.stringify(registry, null, 2)}\n`);
    expect(readFileSync(path.join(root, LLMS_FILE), "utf8")).toMatch(/^## Facts \(checked 2026-09-29\)$/m);
    const lastmods = JSON.parse(readFileSync(path.join(root, PAGES_FILE), "utf8")).pages.map((p: { path: string; lastmod: string }) => `${p.path} ${p.lastmod}`);
    expect(lastmods).toEqual(expect.arrayContaining(SWITCH_PAGES.map((p) => `${p} 2026-09-29`)));
    // Again, the same values: nothing to change.
    const again = cli(args(root));
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already recorded, nothing to change/);
    // Then the owner's re-read of the article, with the same T0: only its two refs move, and the reminder is gone.
    const reread = cli(args(root, ["--article-68-read", "2026-09-29"]));
    expect(reread.code).toBe(0);
    expect(reread.out).toMatch(/: 2 change\(s\) written$/m);
    expect(reread.out).not.toMatch(/was last read before T0/);
    expect(article68Reads(JSON.parse(readFileSync(path.join(root, REGISTRY_FILE), "utf8")))).toEqual(["prerequisite 2026-09-29", "dependency 2026-09-29"]);
  });

  it("records a release at 03:00Z on the 30th as the 30th in California too, the date the T0 merge check gives it", () => {
    // The review's case: on a machine in California, set-t0 --released-at 2026-09-30T03:00:00Z --article-68-read
    // 2026-09-30 --now 2026-09-30T04:00:00Z (the evening of the 29th there) wrote the local date, the 29th, while the
    // T0 merge check in CI (UTC) dated T0 the 30th. Run here with the instants alone, and in a process of its own in
    // each time zone.
    const t0 = ["--released-at", "2026-09-30T03:00:00Z", "--receipt", RECEIPT, "--article-68-read", "2026-09-30", "--now", "2026-09-30T04:00:00Z"];
    const here = tempRoot();
    const runs = [{ tz: "this process", root: here, ...cli(["--root", here, ...t0]) }];
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
      const root = tempRoot();
      const r = spawnSync(process.execPath, [SCRIPT, "--root", root, ...t0], { encoding: "utf8", env: { ...process.env, TZ: tz } });
      runs.push({ tz, root, code: r.status ?? -1, out: r.stdout, err: r.stderr });
    }
    for (const run of runs) {
      expect(run.err, run.tz).toBe("");
      expect(run.code, run.tz).toBe(0);
      expect(run.out, run.tz).toMatch(/^set-t0: T0 2026-09-30T03:00:00Z \(date 2026-09-30\): 13 change\(s\) written$/m);
      expect(run.out, run.tz).not.toMatch(/was last read before T0/);
      // What set-t0 wrote: the 30th, everywhere it writes a date.
      const registry = JSON.parse(readFileSync(path.join(run.root, REGISTRY_FILE), "utf8"));
      const status = registry.claims.find((c: { claim_id: string }) => c.claim_id === "release_status");
      expect([registry.released.checked_at, status.checked_at], run.tz).toEqual(["2026-09-30", "2026-09-30"]);
      expect(registry.released.evidence_ref.at(-1), run.tz).toBe(receiptRef(RECEIPT, "2026-09-30"));
      expect(article68Reads(registry), run.tz).toEqual(["prerequisite 2026-09-30", "dependency 2026-09-30"]);
      const lastmods = JSON.parse(readFileSync(path.join(run.root, PAGES_FILE), "utf8")).pages.map((p: { path: string; lastmod: string }) => `${p.path} ${p.lastmod}`);
      expect(lastmods, run.tz).toEqual(expect.arrayContaining(SWITCH_PAGES.map((p) => `${p} 2026-09-30`)));
      expect(readFileSync(path.join(run.root, LLMS_FILE), "utf8"), run.tz).toMatch(/^## Facts \(checked 2026-09-30\)$/m);
      // What the T0 merge check makes of it: T0's date is the 30th, and the article's re-read is not stale.
      expect(t0Date(registry.released.released_at_utc), run.tz).toBe("2026-09-30");
      expect(staleArticle68Reads(registry), run.tz).toEqual([]);
      expect(checkRegistry(registry, { root: ROOT }).map(formatFinding), run.tz).toEqual([]);
    }
    // The merge check's date on the machine in California, and in CI.
    expect(inZone("America/Los_Angeles", "t0Date", "2026-09-30T03:00:00Z")).toBe("2026-09-30");
    expect(inZone("UTC", "t0Date", "2026-09-30T03:00:00Z")).toBe("2026-09-30");
  });

  it("--dry-run writes nothing", () => {
    const root = tempRoot();
    const before = [REGISTRY_FILE, PAGES_FILE, LLMS_FILE].map((rel) => readFileSync(path.join(root, rel), "utf8"));
    const r = cli(args(root, ["--dry-run"]));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^set-t0: would set released\.released_at_utc: null -> "2026-09-29T14:05:00Z"$/m);
    expect(r.out).toMatch(/none written \(--dry-run\)/);
    expect([REGISTRY_FILE, PAGES_FILE, LLMS_FILE].map((rel) => readFileSync(path.join(root, rel), "utf8"))).toEqual(before);
  });

  it("exits 1 when it refuses and 2 on a usage error", () => {
    const root = tempRoot();
    const bad = cli(["--root", root, "--released-at", "tomorrow", "--receipt", RECEIPT]);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/^set-t0: --released-at "tomorrow" is not a UTC time/);
    expect(cli(["--root", root, "--released-at", AT]).code).toBe(2);
    expect(cli(["--released-at", AT, "--receipt", RECEIPT, "--bogus"]).code).toBe(2);
    expect(cli(["--released-at", AT, "--receipt", RECEIPT, "--now", "later"]).code).toBe(2);
    expect(cli(["--help"]).code).toBe(0);
  });

  it("runs as a script", () => {
    const root = tempRoot();
    const r = spawnSync(process.execPath, [SCRIPT, ...args(root, ["--dry-run"])], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/none written \(--dry-run\)/);
  });
});
