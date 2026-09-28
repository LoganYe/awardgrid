/**
 * scripts/growth/set-withdrawn.mjs: it records the app's removal from the App Store (the first cache-busted lookup that
 * no longer returns it) in the registry, writes its date into every withdrawn sentence of the public files and into
 * DECISIONS.md's amendment, and raises the lastmod of the pages and the check date of llms.txt; it refuses anything
 * that is not a removal. The date is the UTC date of the removal on every machine. It runs on copies in a temp
 * directory, never on this tree, and its fixtures are the change as prepared whatever this tree holds (before or after
 * the date is written).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LLMS_FILE, PAGES_FILE, REGISTRY_FILE, applyT0 } from "./set-t0.mjs";
import {
  DECISIONS_FILE,
  WITHDRAWAL_CLAIMS,
  WITHDRAWN_PAGES,
  WithdrawalError,
  applyWithdrawal,
  dateEn,
  dateZh,
  fillDecisions,
  fillWithdrawnDates,
  main,
  placeholderLines,
  setWithdrawn,
  withdrawalRef,
} from "./set-withdrawn.mjs";
import { checkRegistry, formatFinding, scanContent } from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(import.meta.dirname, "set-withdrawn.mjs");
const SYNC_FAQ = path.join(import.meta.dirname, "sync-faq-schema.mjs");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, REGISTRY_FILE), "utf8"));
const RECEIPT = "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1793437200";
const AT = "2026-11-01T09:00:00Z";
const NOW = new Date("2026-11-01T10:00:00Z");
const EN = "AwardGrid for iPhone was removed from the App Store on <date>.";
const ZH = "AwardGrid iPhone 版已于 <date>从 App Store 下架。";
/** T0, as set-t0.mjs records it on main before the app can be removed (used when this tree's registry has none). */
const T0 = { releasedAt: "2026-09-29T14:05:00Z", receipt: "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1759154700", now: new Date("2026-09-29T15:00:00Z") };
/** The public files the change to withdrawn rewrites, which the temp root holds copies of. */
const PUBLIC = [
  "sites/landing/index.html",
  "sites/landing/ios/index.html",
  "sites/landing/ios/award-grid/index.html",
  "sites/landing/ios/zh-hans/index.html",
  "sites/landing/public/llms.txt",
  "README.md",
  "LEGAL.md",
  "growth/geo/accuracy-answer.md",
];

/**
 * The registry as the change to withdrawn is prepared, from `base` whatever it holds: T0 recorded (the removal follows
 * the release), status withdrawn, the removal not recorded.
 */
const preparedFrom = (base: typeof REGISTRY) => {
  let r = structuredClone(base);
  r.released.withdrawn_at_utc = null;
  for (const holder of [r.released, ...r.claims]) holder.evidence_ref = holder.evidence_ref.filter((ref: string) => !ref.endsWith("(withdrawal)"));
  if (!r.released.released_at_utc || !r.released.t0_lookup_receipt) {
    r.released.status = "released";
    r = applyT0(r, T0).registry;
  }
  r.released.status = "withdrawn";
  r.released.checked_at = "2026-09-28";
  for (const id of WITHDRAWAL_CLAIMS) r.claims.find((c: { claim_id: string }) => c.claim_id === id).checked_at = "2026-09-28";
  return r;
};
const prepared = () => preparedFrom(REGISTRY);
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WithdrawalError);
    return (error as Error).message;
  }
  throw new Error("expected a WithdrawalError");
};
const claimOf = (r: { claims: Array<{ claim_id: string; checked_at: string; evidence_ref: string[] }> }, id: string) => r.claims.find((c) => c.claim_id === id)!;

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
/** A date no removal has: written first, then turned back into the placeholder in each form a file holds it. */
const HOLE_DATE = "1900-01-01";
/**
 * `text` as the change is prepared: every withdrawn sentence says <date> again, in the form the file holds it
 * (&lt;date&gt; in a page's text, \u003cdate> in its JSON-LD, <date> in Markdown and text), and so does the date of
 * the removal in DECISIONS.md, and the day of its amendment.
 */
const unfilled = (rel: string, text: string) => {
  const holes = (t: string, hole: string) => [dateEn(HOLE_DATE), dateZh(HOLE_DATE)].reduce((out, d) => out.split(d).join(hole), t);
  if (rel === DECISIONS_FILE) {
    return fillDecisions(text, HOLE_DATE).text.split(HOLE_DATE).join("<date>").replace(/Amended \S+(: the app was removed from the App Store on <date>)/, "Amended <date>$1");
  }
  const out = fillWithdrawnDates(text, HOLE_DATE).text;
  if (!rel.endsWith(".html")) return holes(out, "<date>");
  const ld = out.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (_m, a: string, body: string, b: string) => a + holes(body, "\\u003cdate>") + b);
  return holes(ld, "&lt;date&gt;");
};
/**
 * A temp root holding copies of the files set-withdrawn reads and writes, from `from` (this tree by default), as the
 * change is prepared: the registry, and the files' dates and placeholders.
 */
const tempRoot = (from = ROOT) => {
  const root = mkdtempSync(path.join(tmpdir(), "set-withdrawn-"));
  temps.push(root);
  for (const rel of [...PUBLIC, PAGES_FILE, DECISIONS_FILE]) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    const text = readFileSync(path.join(from, rel), "utf8");
    writeFileSync(path.join(root, rel), rel === PAGES_FILE ? text : unfilled(rel, text));
  }
  mkdirSync(path.join(root, "growth"), { recursive: true });
  writeFileSync(path.join(root, REGISTRY_FILE), `${JSON.stringify(preparedFrom(JSON.parse(readFileSync(path.join(from, REGISTRY_FILE), "utf8"))), null, 2)}\n`);
  // The dates set-withdrawn raises, set back to before the removal whatever this tree says.
  const pages = path.join(root, PAGES_FILE);
  writeFileSync(pages, readFileSync(pages, "utf8").replace(/"lastmod": "\d{4}-\d{2}-\d{2}"/g, '"lastmod": "2026-09-28"'));
  const llms = path.join(root, LLMS_FILE);
  writeFileSync(llms, readFileSync(llms, "utf8").replace(/^## Facts \(checked \d{4}-\d{2}-\d{2}\)$/m, "## Facts (checked 2026-09-28)"));
  return root;
};
const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");
const cli = (args: string[]) => {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = main(args, { log: (s: string) => lines.push(s), error: (s: string) => errors.push(s) });
  return { code, out: lines.join("\n"), err: errors.join("\n") };
};

describe("applyWithdrawal: the registry with the removal recorded", () => {
  it("fills withdrawn_at_utc, dates the checks, and cites the lookup; the registry check then has nothing to say", () => {
    const before = prepared();
    expect(checkRegistry(before, { root: ROOT }).map((f: { rule: string }) => f.rule)).toEqual(["WITHDRAWN_UNRECORDED"]);
    const { registry, changes, date, at } = applyWithdrawal(before, { withdrawnAt: AT, receipt: RECEIPT, now: NOW });
    expect([date, at]).toEqual(["2026-11-01", AT]);
    expect(registry.released).toMatchObject({ status: "withdrawn", withdrawn_at_utc: AT, checked_at: "2026-11-01" });
    expect(registry.released.evidence_ref.at(-1)).toBe(withdrawalRef(RECEIPT, "2026-11-01"));
    for (const id of WITHDRAWAL_CLAIMS) {
      expect(claimOf(registry, id).checked_at, id).toBe("2026-11-01");
      expect(claimOf(registry, id).evidence_ref.at(-1), id).toBe(withdrawalRef(RECEIPT, "2026-11-01"));
    }
    expect(changes).toHaveLength(7);
    // Pure: the registry it was given is unchanged.
    expect(before.released.withdrawn_at_utc).toBeNull();
    // Every ref it writes is one the gate reads, and WITHDRAWN_UNRECORDED is gone.
    expect(checkRegistry(registry, { root: ROOT }).map(formatFinding)).toEqual([]);
  });

  it("changes nothing when run again with the same values, and accepts a time without seconds", () => {
    const once = applyWithdrawal(prepared(), { withdrawnAt: "2026-11-01T09:00Z", receipt: RECEIPT, now: NOW }).registry;
    expect(once.released.withdrawn_at_utc).toBe(AT);
    expect(applyWithdrawal(once, { withdrawnAt: AT, receipt: RECEIPT, now: NOW }).changes).toEqual([]);
  });

  it("refuses a registry that is not withdrawn, and a time or receipt that is not a removal", () => {
    const released = prepared();
    released.released.status = "released";
    expect(refused(() => applyWithdrawal(released, { withdrawnAt: AT, receipt: RECEIPT, now: NOW }))).toMatch(/released\.status is "released"/);
    const at = (withdrawnAt: string, registry = prepared()) => refused(() => applyWithdrawal(registry, { withdrawnAt, receipt: RECEIPT, now: NOW }));
    expect(at("2026-11-01")).toMatch(/is not a UTC time/);
    expect(at("2026-11-01T09:00:00+01:00")).toMatch(/is not a UTC time/);
    expect(at("2026-02-30T09:00:00Z")).toMatch(/is not a UTC time/);
    const afterT0 = prepared();
    afterT0.released.released_at_utc = "2026-09-29T14:05:00Z";
    expect(at("2026-09-29T12:00:00Z", afterT0)).toMatch(/is before the release \(2026-09-29T14:05:00Z\)/);
    // The removal follows the release: a registry whose T0 is not recorded is refused, whatever the time.
    for (const field of ["released_at_utc", "t0_lookup_receipt"]) {
      const noT0 = prepared();
      noT0.released[field] = null;
      expect(at(AT, noT0), field).toMatch(new RegExp(`released\\.${field} is empty: the app is removed only after it is released`));
    }
    expect(at("2026-11-01T11:00:00Z")).toMatch(/is in the future/);
    const receipt = (value: string) => refused(() => applyWithdrawal(prepared(), { withdrawnAt: AT, receipt: value, now: NOW }));
    expect(receipt("https://itunes.apple.com/lookup?id=6816321841&country=us")).toMatch(/not cache-busted/);
    expect(receipt("https://apps.apple.com/app/id6816321841")).toMatch(/not an https:\/\/itunes\.apple\.com\/lookup URL/);
    expect(receipt("https://itunes.apple.com/lookup?id=1&cb=1")).toMatch(/does not look up id=6816321841/);
  });

  it("will not overwrite a recorded removal unless forced, and a forced one replaces the old lookup's ref", () => {
    const once = applyWithdrawal(prepared(), { withdrawnAt: AT, receipt: RECEIPT, now: NOW }).registry;
    const other = "https://itunes.apple.com/lookup?id=6816321841&country=gb&cb=1793437500";
    expect(refused(() => applyWithdrawal(once, { withdrawnAt: "2026-11-01T09:05:00Z", receipt: other, now: NOW }))).toMatch(/already recorded .* pass --force/);
    expect(refused(() => applyWithdrawal(once, { withdrawnAt: AT, receipt: other, now: NOW }))).toMatch(/already recorded .* pass --force/);
    const { registry } = applyWithdrawal(once, { withdrawnAt: "2026-11-01T09:05:00Z", receipt: other, now: NOW, force: true });
    expect(registry.released.withdrawn_at_utc).toBe("2026-11-01T09:05:00Z");
    for (const refs of [registry.released.evidence_ref, ...WITHDRAWAL_CLAIMS.map((id) => claimOf(registry, id).evidence_ref)]) {
      expect(refs.filter((r: string) => r.endsWith("(withdrawal)"))).toEqual([withdrawalRef(other, "2026-11-01")]);
    }
  });
});

describe("the withdrawn sentences' date", () => {
  it("is written as the registry says: 1 November 2026 in English, 2026 年 11 月 1 日 in Chinese", () => {
    expect([dateEn("2026-11-01"), dateZh("2026-11-01")]).toEqual(["1 November 2026", "2026 年 11 月 1 日"]);
    expect([dateEn("2027-01-31"), dateZh("2027-01-31")]).toEqual(["31 January 2027", "2027 年 1 月 31 日"]);
  });

  it("fills <date> in every form a public file holds it, and moves a date already written", () => {
    const page = `<p>${EN.replace("<date>", "&lt;date&gt;")}</p>\n{"text": "${EN.replace("<", "\\u003c")}"}\n<p>${ZH.replace("<date>", "&lt;date&gt;")}</p>\n{"text": "${ZH.replace("<", "\\u003c")}"}`;
    const filled = fillWithdrawnDates(page, "2026-11-01");
    expect(filled.count).toBe(4);
    expect(filled.text).toBe(
      [
        "<p>AwardGrid for iPhone was removed from the App Store on 1 November 2026.</p>",
        '{"text": "AwardGrid for iPhone was removed from the App Store on 1 November 2026."}',
        "<p>AwardGrid iPhone 版已于 2026 年 11 月 1 日从 App Store 下架。</p>",
        '{"text": "AwardGrid iPhone 版已于 2026 年 11 月 1 日从 App Store 下架。"}',
      ].join("\n"),
    );
    expect(fillWithdrawnDates(filled.text, "2026-11-01")).toEqual(filled);
    const moved = fillWithdrawnDates(filled.text, "2026-10-31").text;
    expect(moved).toContain("on 31 October 2026.");
    expect(moved).toContain("已于 2026 年 10 月 31 日从 App Store 下架");
    // No space between the date and 从, however the file spaced it (a space goes only between Chinese and Latin or digits).
    expect(fillWithdrawnDates("已于 &lt;date&gt; 从 App Store 下架", "2026-11-01").text).toBe("已于 2026 年 11 月 1 日从 App Store 下架");
    expect(fillWithdrawnDates("已于 2026 年 11 月 1 日 从 App Store 下架", "2026-11-01").text).toBe("已于 2026 年 11 月 1 日从 App Store 下架");
    // Across a line break (a wrapped paragraph), and Markdown or text as written.
    expect(fillWithdrawnDates(`removed from the App Store on\n  <date>.`, "2026-11-01").text).toBe("removed from the App Store on\n  1 November 2026.");
    // The history's sentence has no date, and nothing else is touched.
    const history = "The iPhone app was a separate, public release until it was removed from the App Store. <date>";
    expect(fillWithdrawnDates(history, "2026-11-01")).toEqual({ text: history, count: 0 });
  });

  it("fills the date of the removal in DECISIONS.md, not the day of the amendment", () => {
    const text = "  Amended <date>: the app was removed from the App Store on <date>; the pages carry no Smart App Banner and no link\n  to the listing.";
    expect(fillDecisions(text, "2026-11-01")).toEqual({
      text: "  Amended <date>: the app was removed from the App Store on 2026-11-01; the pages carry no Smart App Banner and no link\n  to the listing.",
      count: 1,
    });
    expect(fillDecisions("Amended <date>: After Apple approved 1.0 on <date>, /ios/ links the listing.", "2026-11-01").count).toBe(0);
  });

  it("finds a <date> left where the gate reads, not in a comment or outside README.md's public section", () => {
    expect(placeholderLines(`a\n<p>on &lt;date&gt;.</p>\n{"t": "\\u003cdate>"}\n<!-- <date> -->`)).toEqual([2, 3]);
    const readme = "# x\n<date>\n<!-- public-claims:start -->\non <date>.\n<!-- public-claims:end -->\n<date>\n";
    expect(placeholderLines(readme, { section: true })).toEqual([4]);
    expect(placeholderLines("on 1 November 2026.")).toEqual([]);
  });
});

describe("setWithdrawn: the files", () => {
  it("dates every withdrawn sentence, DECISIONS.md's removal, the pages' lastmod and llms.txt, and the gate passes them", () => {
    const root = tempRoot();
    const { changes, files } = setWithdrawn({ root, withdrawnAt: AT, receipt: RECEIPT, now: NOW });
    expect(changes.length).toBeGreaterThan(10);
    expect(files).toEqual(
      [...PUBLIC.filter((f) => f !== "LEGAL.md"), PAGES_FILE, DECISIONS_FILE, REGISTRY_FILE].sort(),
    );
    const registry = JSON.parse(read(root, REGISTRY_FILE));
    expect(registry.released.withdrawn_at_utc).toBe(AT);
    expect(read(root, REGISTRY_FILE)).toBe(`${JSON.stringify(registry, null, 2)}\n`);
    // No <date> is left where a reader sees it, and each file passes the gate as it now reads.
    for (const rel of PUBLIC) {
      const text = read(root, rel);
      expect(placeholderLines(text, { section: rel === "README.md" }), rel).toEqual([]);
      const found = scanContent(text, { logical: rel, section: rel === "README.md", status: "withdrawn", registry, root: ROOT });
      expect(found.map(formatFinding), rel).toEqual([]);
    }
    expect(read(root, "sites/landing/index.html")).toContain("<p>AwardGrid for iPhone was removed from the App Store on 1 November 2026.</p>");
    expect(read(root, "sites/landing/ios/zh-hans/index.html")).toContain("<p>AwardGrid iPhone 版已于 2026 年 11 月 1 日从 App Store 下架。</p>");
    expect(read(root, "README.md")).toContain("\nAwardGrid for iPhone was removed from the App Store on 1 November 2026.\n");
    expect(read(root, LLMS_FILE)).toMatch(/^## Facts \(checked 2026-11-01\)$/m);
    expect(read(root, LLMS_FILE)).toContain("- Status: AwardGrid for iPhone was removed from the App Store on 1 November 2026.\n");
    const lastmods = JSON.parse(read(root, PAGES_FILE)).pages.map((p: { path: string; lastmod: string }) => `${p.path} ${p.lastmod}`);
    expect(lastmods).toEqual(expect.arrayContaining(WITHDRAWN_PAGES.map((p) => `${p} 2026-11-01`)));
    expect(lastmods).toContain("/privacy/ 2026-09-28");
    // DECISIONS.md: the date of the removal; the day of the amendment is the owner's, on the day of the merge.
    expect(read(root, DECISIONS_FILE)).toContain("Amended <date>: the app was removed from the App Store on 2026-11-01; the pages carry no Smart App Banner");
    // The FAQPage JSON-LD still says what the pages show.
    const sync = spawnSync(process.execPath, [SYNC_FAQ, "--check", "--root", root], { encoding: "utf8" });
    expect(sync.status, sync.stdout + sync.stderr).toBe(0);
    // Again, the same values: nothing to change.
    expect(setWithdrawn({ root, withdrawnAt: AT, receipt: RECEIPT, now: NOW }).changes).toEqual([]);
  });

  it("its fixture is the same from a tree set-withdrawn has already run on (the day's tree, before pnpm test)", () => {
    const fresh = tempRoot();
    const filled = tempRoot();
    setWithdrawn({ root: filled, withdrawnAt: AT, receipt: RECEIPT, now: NOW });
    // The day of the amendment, filled in by hand.
    writeFileSync(path.join(filled, DECISIONS_FILE), read(filled, DECISIONS_FILE).replace("Amended <date>: the app was removed", "Amended 2026-11-02: the app was removed"));
    expect(read(filled, "sites/landing/ios/index.html")).not.toMatch(/&lt;date&gt;|\\u003cdate/);
    const again = tempRoot(filled);
    for (const rel of [...PUBLIC, DECISIONS_FILE, REGISTRY_FILE]) expect(read(again, rel), rel).toBe(read(fresh, rel));
    // pages.json and llms.txt: set back to before the removal, as tempRoot does whatever it copies.
    expect(read(again, PAGES_FILE)).toBe(read(fresh, PAGES_FILE));
  });

  it("with --force, moves every date to the new removal", () => {
    const root = tempRoot();
    setWithdrawn({ root, withdrawnAt: AT, receipt: RECEIPT, now: NOW });
    const other = "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1793350800";
    expect(refused(() => setWithdrawn({ root, withdrawnAt: "2026-10-31T09:00:00Z", receipt: other, now: NOW }))).toMatch(/pass --force/);
    setWithdrawn({ root, withdrawnAt: "2026-10-31T09:00:00Z", receipt: other, now: NOW, force: true });
    for (const rel of PUBLIC) expect(read(root, rel), rel).not.toMatch(/1 November 2026|2026 年 11 月 1 日/);
    expect(read(root, "sites/landing/ios/index.html")).toContain("removed from the App Store on 31 October 2026.");
    expect(read(root, DECISIONS_FILE)).toContain("removed from the App Store on 2026-10-31;");
  });

  it("refuses public files with no withdrawn sentence, a <date> it cannot fill, and a DECISIONS.md without the amendment", () => {
    const noSentence = tempRoot();
    for (const rel of PUBLIC) writeFileSync(path.join(noSentence, rel), read(noSentence, rel).replace(/removed from the App Store on/g, "gone on").replace(/已于/g, "于"));
    expect(refused(() => setWithdrawn({ root: noSentence, withdrawnAt: AT, receipt: RECEIPT, now: NOW }))).toMatch(/no public file says the app was removed/);

    const stray = tempRoot();
    writeFileSync(path.join(stray, "growth/geo/accuracy-answer.md"), `${read(stray, "growth/geo/accuracy-answer.md")}\n## When?\n\nOn <date>.\n`);
    expect(refused(() => setWithdrawn({ root: stray, withdrawnAt: AT, receipt: RECEIPT, now: NOW }))).toMatch(/a <date> this script does not know how to fill is left in growth\/geo\/accuracy-answer\.md:\d+/);

    const noAmendment = tempRoot();
    writeFileSync(path.join(noAmendment, DECISIONS_FILE), read(noAmendment, DECISIONS_FILE).replace(/the app was removed from the App Store on/g, "the app went on"));
    expect(refused(() => setWithdrawn({ root: noAmendment, withdrawnAt: AT, receipt: RECEIPT, now: NOW }))).toMatch(/DECISIONS\.md has no amendment/);
    // A refusal writes nothing.
    expect(JSON.parse(read(noAmendment, REGISTRY_FILE)).released.withdrawn_at_utc).toBeNull();
    expect(read(noAmendment, "sites/landing/index.html")).toContain("&lt;date&gt;");
  });
});

describe("the command line", () => {
  const args = (root: string, extra: string[] = []) => ["--root", root, "--withdrawn-at", AT, "--receipt", RECEIPT, "--now", NOW.toISOString(), ...extra];

  it("writes the files, and says what to fill in and run next", () => {
    const root = tempRoot();
    const r = cli(args(root));
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^set-withdrawn: removal 2026-11-01T09:00:00Z \(date 2026-11-01\): \d+ change\(s\) written$/m);
    expect(r.out).toMatch(
      /fill in "Amended <date>" in DECISIONS\.md; then every test and the merge check must pass before the change is merged: pnpm test && T0_MERGE_CHECK=1 pnpm exec vitest run scripts\/growth\/t0-switch\.test\.ts$/m,
    );
    const again = cli(args(root));
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already recorded, nothing to change/);
  });

  it("dates a removal at 03:00Z on the 2nd as the 2nd in California too, the date the merge check gives it", () => {
    const t = ["--withdrawn-at", "2026-11-02T03:00:00Z", "--receipt", RECEIPT, "--now", "2026-11-02T04:00:00Z"];
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
      const root = tempRoot();
      const r = spawnSync(process.execPath, [SCRIPT, "--root", root, ...t], { encoding: "utf8", env: { ...process.env, TZ: tz } });
      expect(r.stderr, tz).toBe("");
      expect(r.status, tz).toBe(0);
      expect(r.stdout, tz).toMatch(/^set-withdrawn: removal 2026-11-02T03:00:00Z \(date 2026-11-02\)/m);
      expect(read(root, "sites/landing/index.html"), tz).toContain("removed from the App Store on 2 November 2026.");
      expect(JSON.parse(read(root, REGISTRY_FILE)).released.checked_at, tz).toBe("2026-11-02");
    }
  });

  it("refuses a removal whose UTC date is after today, even within the clock-skew allowance", () => {
    const root = tempRoot();
    const r = spawnSync(process.execPath, [SCRIPT, "--root", root, "--withdrawn-at", "2026-11-02T00:02:00Z", "--receipt", RECEIPT, "--now", "2026-11-01T23:55:00Z"], {
      encoding: "utf8",
      env: { ...process.env, TZ: "America/Los_Angeles" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^set-withdrawn: --withdrawn-at 2026-11-02T00:02:00Z is on 2026-11-02, after today \(2026-11-01\)$/m);
  });

  it("--dry-run writes nothing", () => {
    const root = tempRoot();
    const files = [REGISTRY_FILE, PAGES_FILE, DECISIONS_FILE, ...PUBLIC];
    const before = files.map((rel) => read(root, rel));
    const r = cli(args(root, ["--dry-run"]));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^set-withdrawn: would set released\.withdrawn_at_utc: null -> "2026-11-01T09:00:00Z"$/m);
    expect(r.out).toMatch(/none written \(--dry-run\)/);
    expect(files.map((rel) => read(root, rel))).toEqual(before);
  });

  it("exits 1 when it refuses and 2 on a usage error", () => {
    const root = tempRoot();
    const bad = cli(["--root", root, "--withdrawn-at", "yesterday", "--receipt", RECEIPT]);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/^set-withdrawn: --withdrawn-at "yesterday" is not a UTC time/);
    expect(cli(["--root", root, "--withdrawn-at", AT]).code).toBe(2);
    expect(cli(["--withdrawn-at", AT, "--receipt", RECEIPT, "--bogus"]).code).toBe(2);
    expect(cli(["--withdrawn-at", AT, "--receipt", RECEIPT, "--now", "later"]).code).toBe(2);
    expect(cli(["--help"]).code).toBe(0);
  });

  it("runs as a script", () => {
    const root = tempRoot();
    const r = spawnSync(process.execPath, [SCRIPT, ...args(root, ["--dry-run"])], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/none written \(--dry-run\)/);
  });
});
