#!/usr/bin/env node
/**
 * Records the removal of the iPhone app from the App Store, on the change to released.status "withdrawn". The removal
 * is dated by the first cache-busted App Store lookup that no longer returns the app (resultCount 0 in the storefronts
 * where it was offered), as T0 is dated by the first one that returns it (set-t0.mjs). The change is prepared with
 * released.withdrawn_at_utc empty and the withdrawn sentences saying <date>, the registry's own placeholder; the gate
 * reports that as WITHDRAWN_UNRECORDED, deferred until the merge check. The removal follows the release, so the change
 * goes on a tree whose T0 scripts/growth/set-t0.mjs has recorded (released_at_utc and t0_lookup_receipt). On the day,
 * before the change is merged:
 *
 *   node scripts/growth/set-withdrawn.mjs --withdrawn-at 2026-11-01T09:00:00Z \
 *     --receipt "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1793437200"
 *   options: --root <dir>  --dry-run (print, write nothing)  --force (replace a removal already recorded)
 *            --now <ISO> (the current time, for tests)
 *
 * What it writes:
 *   growth/product-facts.json   released.withdrawn_at_utc; released.checked_at and the checked_at of the release_status
 *                               and history claims become the removal's date; the lookup is added to those three
 *                               evidence_ref lists as an [external] ref read on that date.
 *   the public files            the removal's date in every withdrawn sentence of the registered public files
 *                               (public_files in the registry): "… removed from the App Store on <date>" in English
 *                               ("1 November 2026") and "… 已于 <date>从 App Store 下架" in Chinese ("2026 年 11 月 1
 *                               日", with no space before 从), in the forms a page holds <date> (&lt;date&gt; in its
 *                               text, \u003cdate> in its JSON-LD, which sync-faq-schema.mjs --check then still finds in
 *                               sync).
 *   DECISIONS.md                the date in "the app was removed from the App Store on <date>" (YYYY-MM-DD). The day of
 *                               the amendment itself ("Amended <date>") is filled in by hand on the day of the merge,
 *                               as the switch's amendments are.
 *   sites/landing/pages.json    lastmod of the pages the change rewrites (/, /ios/, /ios/award-grid/, /ios/zh-hans/,
 *                               /support/), raised to the removal's date.
 *   sites/landing/public/llms.txt  its "## Facts (checked …)" date, raised to the removal's date.
 *
 * The removal's date is the UTC date of --withdrawn-at on every machine, and "today" is the later of the UTC date and
 * this machine's date, as for T0 (set-t0.mjs).
 *
 * It refuses: a registry whose status is not withdrawn, or whose T0 is not recorded; a time that is not
 * YYYY-MM-DDTHH:MM[:SS]Z, is before the release (released.released_at_utc), is in the future or falls on a UTC date after
 * today; a receipt that is not a cache-busted https://itunes.apple.com/lookup URL for the app's id; a removal already
 * recorded with other values, unless --force; public files with no withdrawn sentence to date; a <date> it would leave
 * in a public file; and a DECISIONS.md without the amendment. Running it again with the same values changes nothing.
 *
 * After it, fill in "Amended <date>" in DECISIONS.md; then every test and the merge check must pass before the change is
 * merged:
 *   pnpm test && T0_MERGE_CHECK=1 pnpm exec vitest run scripts/growth/t0-switch.test.ts
 *
 * Exit 0 when written (or nothing to change), 1 when refused, 2 on a usage error. Node built-ins only.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLMS_FILE, PAGES_FILE, REGISTRY_FILE, SWITCH_PAGES, T0Error, normalizeInstant, raiseChecked, raiseLastmod, t0Date, todayOf } from "./set-t0.mjs";
import { DATE_PLACEHOLDER, MARKER_END, MARKER_START, lookupProblem, registeredFiles } from "./validate-public-claims.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DECISIONS_FILE = "DECISIONS.md";
/** The pages the change to withdrawn rewrites: the switch's, and /support/ (the dependency's first sentence alone). */
export const WITHDRAWN_PAGES = [...SWITCH_PAGES, "/support/"];
/** The claims whose withdrawn copy rests on the removal: their checked_at and evidence move with it. */
export const WITHDRAWAL_CLAIMS = ["release_status", "history"];
/** How far ahead of this machine's clock --withdrawn-at may be (clock skew), in milliseconds. */
const FUTURE_SLACK_MS = 10 * 60 * 1000;
export const USAGE = `usage: node scripts/growth/set-withdrawn.mjs --withdrawn-at <YYYY-MM-DDTHH:MM:SSZ> --receipt <lookup URL>
       [--root <dir>] [--dry-run] [--force] [--now <ISO>]`;

/** A refusal (the kind set-t0.mjs uses, so its helpers' refusals read the same). */
export class WithdrawalError extends T0Error {}

const REF_END = "the first cache-busted lookup that no longer returned the app (withdrawal)";
/** The evidence ref the lookup is recorded as (the gate's [external] form). */
export const withdrawalRef = (receipt, date) => `[external] ${receipt} (read ${date}): resultCount 0, ${REF_END}`;
const isWithdrawalRef = (ref) => String(ref).startsWith("[external] ") && String(ref).endsWith(REF_END);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const parts = (date) => String(date).split("-").map(Number);
/** A YYYY-MM-DD date as the English withdrawn sentence gives it: "1 November 2026". */
export function dateEn(date) {
  const [y, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
/** A YYYY-MM-DD date as the Chinese withdrawn sentence gives it: "2026 年 11 月 1 日" (and 从 right after it). */
export function dateZh(date) {
  const [y, m, d] = parts(date);
  return `${y} 年 ${m} 月 ${d} 日`;
}

/** <date> as a public file holds it: plain, as a page's text writes it, as its JSON-LD writes it. */
const HOLE = String.raw`<date>|&lt;date&gt;|\\u003cdate(?:>|\\u003e)`;
const EN_DATE = String.raw`\d{1,2} (?:${MONTHS.join("|")}) \d{4}`;
const ZH_DATE = String.raw`\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日`;
/** release_status's withdrawn sentence, English and Chinese, at its date: a placeholder, or a date already written. */
const EN_SENTENCE = new RegExp(String.raw`(removed\s+from\s+the\s+App\s+Store\s+on\s+)(?:${HOLE}|${EN_DATE})`, "g");
const ZH_SENTENCE = new RegExp(String.raw`(已于\s*)(?:${HOLE}|${ZH_DATE})(\s*从\s*App\s*Store\s*下架)`, "g");
/** DECISIONS.md's amendment, at its date of the removal. */
const DECISIONS_SENTENCE = /(the app was removed from the App Store on\s+)(?:<date>|\d{4}-\d{2}-\d{2})/g;

/**
 * `text` with the removal's date written into every withdrawn sentence, and how many there are (dated before or not).
 * In Chinese the date is followed by 从 with no space, as the registry writes the sentence, however the file spaced it.
 * @param {string} text
 * @param {string} date YYYY-MM-DD
 */
export function fillWithdrawnDates(text, date) {
  let count = 0;
  const en = dateEn(date);
  const zh = dateZh(date);
  const out = String(text)
    .replace(EN_SENTENCE, (_m, lead) => {
      count++;
      return lead + en;
    })
    .replace(ZH_SENTENCE, (_m, lead, tail) => {
      count++;
      return lead + zh + tail.replace(/^\s+/, "");
    });
  return { text: out, count };
}

/** DECISIONS.md with the removal's date (YYYY-MM-DD) in its amendment, and how many amendments say it. */
export function fillDecisions(text, date) {
  let count = 0;
  const out = String(text).replace(DECISIONS_SENTENCE, (_m, lead) => {
    count++;
    return lead + date;
  });
  return { text: out, count };
}

/**
 * The line of every <date> placeholder left in the part of a public file the gate reads (a page or a Markdown file
 * without its comments; README.md between its public-claims markers).
 */
export function placeholderLines(text, { section = false } = {}) {
  let start = 0;
  let end = text.length;
  if (section) {
    const a = text.indexOf(MARKER_START);
    const b = text.indexOf(MARKER_END);
    if (a >= 0 && b > a) [start, end] = [a, b];
  }
  const read = text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));
  const out = [];
  for (const m of read.slice(start, end).matchAll(DATE_PLACEHOLDER)) out.push(text.slice(0, start + m.index).split("\n").length);
  return out;
}

/**
 * The registry with the removal recorded, and what changed. Pure: `registry` is not modified.
 * @param {any} registry
 * @param {{ withdrawnAt: string, receipt: string, now?: Date, force?: boolean }} options
 * @returns {{ registry: any, changes: string[], date: string, at: string }}
 */
export function applyWithdrawal(registry, { withdrawnAt, receipt, now = new Date(), force = false }) {
  const rel = registry?.released;
  if (!rel) throw new WithdrawalError("the registry has no released section");
  if (rel.status !== "withdrawn") {
    throw new WithdrawalError(`released.status is "${rel.status}": the removal is recorded on the change whose registry says "withdrawn"`);
  }
  const at = normalizeInstant(withdrawnAt);
  if (!at) throw new WithdrawalError(`--withdrawn-at "${withdrawnAt}" is not a UTC time (YYYY-MM-DDTHH:MM:SSZ)`);
  // The removal follows the release: the change goes on a tree whose T0 set-t0.mjs has recorded.
  const unrecorded = ["released_at_utc", "t0_lookup_receipt"].filter((f) => !rel[f]);
  if (unrecorded.length) {
    throw new WithdrawalError(
      `released.${unrecorded.join(" and released.")} ${unrecorded.length > 1 ? "are" : "is"} empty: the app is removed only after it is released, so the change to withdrawn goes on a tree where set-t0.mjs has recorded T0`,
    );
  }
  if (at < String(rel.released_at_utc)) throw new WithdrawalError(`--withdrawn-at ${at} is before the release (${rel.released_at_utc})`);
  if (new Date(at).getTime() > now.getTime() + FUTURE_SLACK_MS) throw new WithdrawalError(`--withdrawn-at ${at} is in the future (now ${now.toISOString()})`);
  const problem = lookupProblem(receipt, String(rel.app_id ?? ""));
  if (problem) throw new WithdrawalError(`--receipt: ${problem}`);

  const date = t0Date(at);
  const today = todayOf(now);
  if (date > today) throw new WithdrawalError(`--withdrawn-at ${at} is on ${date}, after today (${today})`);
  const ref = withdrawalRef(receipt, date);
  const recordedRefs = (rel.evidence_ref ?? []).filter(isWithdrawalRef);
  const same = rel.withdrawn_at_utc === at && recordedRefs.every((r) => r === ref);
  if (!same && (rel.withdrawn_at_utc || recordedRefs.length) && !force) {
    throw new WithdrawalError(
      `the removal is already recorded (withdrawn_at_utc ${rel.withdrawn_at_utc ?? "empty"}${recordedRefs.length ? `, ${recordedRefs[0]}` : ""}); pass --force to replace it`,
    );
  }

  const next = structuredClone(registry);
  const changes = [];
  const set = (name, obj, key, value) => {
    if (obj[key] === value) return;
    changes.push(`${name}: ${JSON.stringify(obj[key])} -> ${JSON.stringify(value)}`);
    obj[key] = value;
  };
  const addRef = (name, obj) => {
    // There is one removal: a ref this script wrote for another lookup or date (a --force replacement) goes.
    const refs = [];
    for (const r of obj.evidence_ref ?? []) {
      if (r !== ref && isWithdrawalRef(r)) changes.push(`${name}: evidence_ref - ${r}`);
      else refs.push(r);
    }
    if (!refs.includes(ref)) {
      refs.push(ref);
      changes.push(`${name}: evidence_ref + ${ref}`);
    }
    obj.evidence_ref = refs;
  };
  set("released.withdrawn_at_utc", next.released, "withdrawn_at_utc", at);
  if (!next.released.checked_at || next.released.checked_at < date || force) set("released.checked_at", next.released, "checked_at", date);
  addRef("released", next.released);
  for (const id of WITHDRAWAL_CLAIMS) {
    const claim = (next.claims ?? []).find((c) => c.claim_id === id);
    if (!claim) throw new WithdrawalError(`the registry has no ${id} claim`);
    if (!claim.checked_at || claim.checked_at < date || force) set(`claims.${id}.checked_at`, claim, "checked_at", date);
    addRef(`claims.${id}`, claim);
  }
  return { registry: next, changes, date, at };
}

/**
 * Record the removal in `root`: returns the changes, and writes them unless `dryRun`.
 * @param {{ root?: string, withdrawnAt: string, receipt: string, now?: Date, force?: boolean, dryRun?: boolean }} options
 */
export function setWithdrawn({ root = DEFAULT_ROOT, withdrawnAt, receipt, now = new Date(), force = false, dryRun = false }) {
  const file = (rel) => path.join(root, rel);
  for (const rel of [REGISTRY_FILE, PAGES_FILE, LLMS_FILE, DECISIONS_FILE]) if (!existsSync(file(rel))) throw new WithdrawalError(`${rel} does not exist under ${root}`);
  const registry = JSON.parse(readFileSync(file(REGISTRY_FILE), "utf8"));
  const applied = applyWithdrawal(registry, { withdrawnAt, receipt, now, force });
  const { date } = applied;
  const changes = [...applied.changes];
  /** Every file this run rewrites, with its new text. */
  const writes = new Map();

  let sentences = 0;
  const left = [];
  for (const { file: rel, section } of registeredFiles(applied.registry, root)) {
    const before = readFileSync(file(rel), "utf8");
    const filled = fillWithdrawnDates(before, date);
    sentences += filled.count;
    for (const line of placeholderLines(filled.text, { section })) left.push(`${rel}:${line}`);
    if (filled.text !== before) {
      writes.set(rel, filled.text);
      changes.push(`${rel}: the removal dated ${date} in ${filled.count} withdrawn sentence(s)`);
    }
  }
  if (!sentences) throw new WithdrawalError('no public file says the app was removed from the App Store ("… removed from the App Store on <date>." or its Chinese)');
  if (left.length) throw new WithdrawalError(`a <date> this script does not know how to fill is left in ${left.join(", ")}`);

  const decisions = fillDecisions(readFileSync(file(DECISIONS_FILE), "utf8"), date);
  if (!decisions.count) throw new WithdrawalError(`${DECISIONS_FILE} has no amendment saying "the app was removed from the App Store on <date>"`);
  if (decisions.text !== readFileSync(file(DECISIONS_FILE), "utf8")) {
    writes.set(DECISIONS_FILE, decisions.text);
    changes.push(`${DECISIONS_FILE}: the removal dated ${date}`);
  }

  const pages = raiseLastmod(readFileSync(file(PAGES_FILE), "utf8"), date, WITHDRAWN_PAGES);
  if (pages.changes.length) writes.set(PAGES_FILE, pages.text);
  const llms = raiseChecked(writes.get(LLMS_FILE) ?? readFileSync(file(LLMS_FILE), "utf8"), date);
  if (llms.changes.length) writes.set(LLMS_FILE, llms.text);
  changes.push(...pages.changes, ...llms.changes);

  if (applied.changes.length) writes.set(REGISTRY_FILE, `${JSON.stringify(applied.registry, null, 2)}\n`);
  if (!dryRun) for (const [rel, text] of writes) writeFileSync(file(rel), text);
  return { changes, date, at: applied.at, files: [...writes.keys()].sort() };
}

/**
 * @param {string[]} argv
 * @returns {{ withdrawnAt?: string, receipt?: string, root?: string, now?: string, force?: boolean, dryRun?: boolean, help?: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ withdrawnAt?: string, receipt?: string, root?: string, now?: string, force?: boolean, dryRun?: boolean, help?: boolean }} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--withdrawn-at") opts.withdrawnAt = value();
    else if (a === "--receipt") opts.receipt = value();
    else if (a === "--root") opts.root = value();
    else if (a === "--now") opts.now = value();
    else if (a === "--force") opts.force = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.help && (!opts.withdrawnAt || !opts.receipt)) throw new Error("--withdrawn-at and --receipt are both required");
  return opts;
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    io.error(`${error instanceof Error ? error.message : error}\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    io.log(USAGE);
    return 0;
  }
  const now = opts.now ? new Date(opts.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    io.error(`--now "${opts.now}" is not a time\n${USAGE}`);
    return 2;
  }
  try {
    const { changes, date, at } = setWithdrawn({
      root: opts.root ? path.resolve(opts.root) : DEFAULT_ROOT,
      withdrawnAt: opts.withdrawnAt,
      receipt: opts.receipt,
      now,
      force: opts.force,
      dryRun: opts.dryRun,
    });
    for (const c of changes) io.log(`set-withdrawn: ${opts.dryRun ? "would set " : ""}${c}`);
    io.log(
      `set-withdrawn: removal ${at} (date ${date}): ${changes.length ? `${changes.length} change(s)${opts.dryRun ? ", none written (--dry-run)" : " written"}` : "already recorded, nothing to change"}`,
    );
    if (!opts.dryRun) {
      io.log(
        'set-withdrawn: next, fill in "Amended <date>" in DECISIONS.md; then every test and the merge check must pass before the change is merged: pnpm test && T0_MERGE_CHECK=1 pnpm exec vitest run scripts/growth/t0-switch.test.ts',
      );
    }
    return 0;
  } catch (error) {
    if (error instanceof T0Error) {
      io.error(`set-withdrawn: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

/** Run as a script (the real path, as validate-public-claims.mjs compares it). */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main();
