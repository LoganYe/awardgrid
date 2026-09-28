#!/usr/bin/env node
/**
 * Records T0, the moment the iPhone app is live, on the switch to released.status "released". T0 is the first
 * cache-busted App Store lookup that returns the app (resultCount 1 or more). The switch is prepared before T0 with
 * released_at_utc and t0_lookup_receipt left empty, and the gate reports that as T0_UNRECORDED (deferred until the T0
 * merge check). On T0 day, before the switch is merged, this script writes what only that lookup can give:
 *
 *   node scripts/growth/set-t0.mjs --released-at 2026-09-29T14:05:00Z \
 *     --receipt "https://itunes.apple.com/lookup?id=6816321841&country=us&cb=1759154700" [--article-68-read 2026-09-29]
 *   options: --root <dir>  --dry-run (print, write nothing)  --force (replace values already recorded)
 *            --article-68-read <YYYY-MM-DD> (the day the owner re-read seats.aero's help article 68; see below)
 *            --now <ISO> (the current time, for tests)
 *
 * What it writes:
 *   growth/product-facts.json   released.released_at_utc and released.t0_lookup_receipt; released.checked_at and the
 *                               release_status claim's checked_at become T0's date; the lookup is added to both
 *                               evidence_ref lists as an [external] ref read on that date.
 *   sites/landing/pages.json    lastmod of the pages the switch changes (/, /ios/, /ios/award-grid/, /ios/zh-hans/),
 *                               raised to T0's date.
 *   sites/landing/public/llms.txt  its "## Facts (checked …)" date, raised to T0's date: its status line is T0's fact.
 *
 * seats.aero's help article 68 (https://docs.seats.aero/article/68) is the source of the released sentence of /ios/
 * that not every Pro account or country gets API access, and of the dependency sentence beside it. The registry says
 * an external source is re-checked on the day of a publication that relies on it, so the owner re-reads the article
 * on the day the switch is merged. If it still says so, --article-68-read <date>
 * moves the "(read …)" date of the article's refs in the prerequisite and dependency claims to that day; the T0 merge
 * check fails while either is older than T0's date. If the article has changed, the released sentence comes off /ios/
 * and out of the registry before the merge. The option can be given with T0 or later, re-running with the same values.
 *
 * T0's date is the UTC date of --released-at, on every machine, so this script, the T0 merge check and CI agree on
 * it. "Today" is the later of the UTC date and this machine's date, as the site's build takes it (buildDate in
 * sites/landing/vite.config.ts), so no UTC date written today is later than a build's "today", here or in CI.
 *
 * It refuses: a registry whose status is not released; a time that is not YYYY-MM-DDTHH:MM[:SS]Z, is before the
 * submission (released.submitted_at_utc), is in the future or falls on a UTC date after today; a receipt that is not a
 * cache-busted https://itunes.apple.com/lookup URL for the app's id; values already recorded that differ, unless
 * --force; and an --article-68-read date that is not a date, is before T0's date or after today, or finds no ref of
 * the article to move. Running it again with the same values changes nothing.
 *
 * After it, the T0 merge check must pass before the switch is merged (CI runs it in its "T0 merge check" job):
 *   T0_MERGE_CHECK=1 pnpm exec vitest run scripts/growth/t0-switch.test.ts
 *
 * Exit 0 when written (or nothing to change), 1 when refused, 2 on a usage error. Node built-ins only.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isUtcInstant, lookupProblem } from "./validate-public-claims.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REGISTRY_FILE = "growth/product-facts.json";
export const PAGES_FILE = "sites/landing/pages.json";
export const LLMS_FILE = "sites/landing/public/llms.txt";
/** The pages whose content the switch to released changes, so their lastmod moves to T0's date. */
export const SWITCH_PAGES = ["/", "/ios/", "/ios/award-grid/", "/ios/zh-hans/"];
/** How far ahead of this machine's clock --released-at may be (clock skew), in milliseconds. */
const FUTURE_SLACK_MS = 10 * 60 * 1000;
export const USAGE = `usage: node scripts/growth/set-t0.mjs --released-at <YYYY-MM-DDTHH:MM:SSZ> --receipt <lookup URL>
       [--article-68-read <YYYY-MM-DD>] [--root <dir>] [--dry-run] [--force] [--now <ISO>]`;

export class T0Error extends Error {}

/** YYYY-MM-DDTHH:MM[:SS[.sss]]Z → YYYY-MM-DDTHH:MM:SSZ, or null when it is not a real UTC time. */
export function normalizeInstant(value) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,3})?)?Z$/.exec(String(value ?? ""));
  if (!m) return null;
  const out = `${m[1]}:${m[2] ?? "00"}Z`;
  return isUtcInstant(out) ? out : null;
}

const pad = (n) => String(n).padStart(2, "0");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** T0's date: the UTC date of the instant (YYYY-MM-DDTHH:MM:SSZ), the same on every machine. */
export function t0Date(instant) {
  return String(instant).slice(0, 10);
}

/**
 * "Today" at `now`: the later of its UTC date and this machine's date, as the site's build takes it (buildDate in
 * sites/landing/vite.config.ts). A UTC date written today is never later than it, whatever the machine's time zone.
 */
export function todayOf(now = new Date()) {
  const utc = now.toISOString().slice(0, 10);
  const local = localDate(now);
  return local > utc ? local : utc;
}

/** seats.aero's help article that /ios/'s released status paragraph relies on, and the claims whose refs cite it for that. */
export const ARTICLE_68 = "https://docs.seats.aero/article/68";
export const ARTICLE_68_CLAIMS = ["prerequisite", "dependency"];
const ARTICLE_68_REF = /^(\[external\] https:\/\/docs\.seats\.aero\/article\/68 \(read )(\d{4}-\d{2}-\d{2})(\).*)$/;

/** The "(read …)" dates of the article-68 refs in ARTICLE_68_CLAIMS, as `claim_id date` strings. */
export function article68Reads(registry) {
  const out = [];
  for (const id of ARTICLE_68_CLAIMS) {
    const claim = (registry?.claims ?? []).find((c) => c.claim_id === id);
    for (const ref of claim?.evidence_ref ?? []) {
      const m = ARTICLE_68_REF.exec(String(ref));
      if (m) out.push(`${id} ${m[2]}`);
    }
  }
  return out;
}

/**
 * The article-68 reads (as article68Reads gives them) older than T0's date, the UTC date of released_at_utc; none while
 * T0 is not recorded. The T0 merge check fails on any (scripts/growth/t0-switch.test.ts), and this script names them.
 */
export function staleArticle68Reads(registry) {
  const at = registry?.released?.released_at_utc;
  if (!at) return [];
  const date = t0Date(at);
  return article68Reads(registry).filter((r) => r.split(" ")[1] < date);
}

const T0_REF_END = "the first cache-busted lookup that returned the app (T0)";
/** The evidence ref the lookup is recorded as (the gate's [external] form). */
export const receiptRef = (receipt, date) => `[external] ${receipt} (read ${date}): resultCount 1 or more, ${T0_REF_END}`;

/**
 * The registry with T0 recorded, and what changed. Pure: `registry` is not modified.
 * @param {any} registry
 * @param {{ releasedAt: string, receipt: string, now?: Date, force?: boolean, article68Read?: string }} options
 * @returns {{ registry: any, changes: string[], date: string }}
 */
export function applyT0(registry, { releasedAt, receipt, now = new Date(), force = false, article68Read }) {
  const rel = registry?.released;
  if (!rel) throw new T0Error("the registry has no released section");
  if (rel.status !== "released") {
    throw new T0Error(`released.status is "${rel.status}": T0 is recorded on the switch, whose registry says "released"`);
  }
  const at = normalizeInstant(releasedAt);
  if (!at) throw new T0Error(`--released-at "${releasedAt}" is not a UTC time (YYYY-MM-DDTHH:MM:SSZ)`);
  if (rel.submitted_at_utc && at < String(rel.submitted_at_utc)) throw new T0Error(`--released-at ${at} is before the submission (${rel.submitted_at_utc})`);
  if (new Date(at).getTime() > now.getTime() + FUTURE_SLACK_MS) throw new T0Error(`--released-at ${at} is in the future (now ${now.toISOString()})`);
  const problem = lookupProblem(receipt, String(rel.app_id ?? ""));
  if (problem) throw new T0Error(`--receipt: ${problem}`);

  const same = rel.released_at_utc === at && rel.t0_lookup_receipt === receipt;
  if (!same && (rel.released_at_utc || rel.t0_lookup_receipt) && !force) {
    throw new T0Error(
      `T0 is already recorded (released_at_utc ${rel.released_at_utc ?? "empty"}, t0_lookup_receipt ${rel.t0_lookup_receipt ?? "empty"}); pass --force to replace it`,
    );
  }

  const date = t0Date(at);
  const today = todayOf(now);
  if (date > today) throw new T0Error(`--released-at ${at} is on ${date}, after today (${today})`);
  const ref = receiptRef(receipt, date);
  const next = structuredClone(registry);
  const changes = [];
  const set = (label, obj, key, value) => {
    if (obj[key] === value) return;
    changes.push(`${label}: ${JSON.stringify(obj[key])} -> ${JSON.stringify(value)}`);
    obj[key] = value;
  };
  const addRef = (label, obj) => {
    // There is one T0: a ref this script wrote for another lookup or date (a --force replacement) goes.
    const refs = [];
    for (const r of obj.evidence_ref ?? []) {
      if (r !== ref && String(r).startsWith("[external] ") && String(r).endsWith(T0_REF_END)) changes.push(`${label}: evidence_ref - ${r}`);
      else refs.push(r);
    }
    if (!refs.includes(ref)) {
      refs.push(ref);
      changes.push(`${label}: evidence_ref + ${ref}`);
    }
    obj.evidence_ref = refs;
  };
  set("released.released_at_utc", next.released, "released_at_utc", at);
  set("released.t0_lookup_receipt", next.released, "t0_lookup_receipt", receipt);
  if (!next.released.checked_at || next.released.checked_at < date || force) set("released.checked_at", next.released, "checked_at", date);
  addRef("released", next.released);
  const status = (next.claims ?? []).find((c) => c.claim_id === "release_status");
  if (status) {
    if (!status.checked_at || status.checked_at < date || force) set("claims.release_status.checked_at", status, "checked_at", date);
    addRef("claims.release_status", status);
  }
  if (article68Read !== undefined) {
    const read = String(article68Read);
    if (!DATE.test(read) || !isUtcInstant(`${read}T00:00:00Z`)) throw new T0Error(`--article-68-read "${read}" is not a date (YYYY-MM-DD)`);
    if (read < date) throw new T0Error(`--article-68-read ${read} is before T0's date (${date}): the article is re-read on the day the switch is merged`);
    if (read > today) throw new T0Error(`--article-68-read ${read} is after today (${today})`);
    for (const id of ARTICLE_68_CLAIMS) {
      const claim = (next.claims ?? []).find((c) => c.claim_id === id);
      const refs = claim?.evidence_ref ?? [];
      if (!refs.some((r) => ARTICLE_68_REF.test(String(r)))) throw new T0Error(`claim ${id} has no "[external] ${ARTICLE_68} (read …)" ref to move to ${read}`);
      claim.evidence_ref = refs.map((r) => {
        const m = ARTICLE_68_REF.exec(String(r));
        if (!m || m[2] === read || (m[2] > read && !force)) return r;
        const moved = `${m[1]}${read}${m[3]}`;
        changes.push(`claims.${id}: evidence_ref ${r} -> ${moved}`);
        return moved;
      });
    }
  }
  return { registry: next, changes, date };
}

/** pages.json with each switched page's lastmod raised to `date`, edited in place so its layout is kept. */
export function raiseLastmod(text, date, pages = SWITCH_PAGES) {
  const changes = [];
  let out = text;
  for (const page of pages) {
    const escaped = page.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const re = new RegExp(`("path":\\s*"${escaped}"[^}]*?"lastmod":\\s*")(\\d{4}-\\d{2}-\\d{2})(")`);
    const m = re.exec(out);
    if (!m) throw new T0Error(`${PAGES_FILE} has no lastmod for ${page}`);
    if (m[2] >= date) continue;
    changes.push(`${PAGES_FILE} ${page}: lastmod ${m[2]} -> ${date}`);
    out = out.slice(0, m.index) + m[1] + date + m[3] + out.slice(m.index + m[0].length);
  }
  return { text: out, changes };
}

/** llms.txt with its "## Facts (checked …)" date raised to `date`. */
export function raiseChecked(text, date) {
  const re = /^(## Facts \(checked )(\d{4}-\d{2}-\d{2})(\))$/m;
  const m = re.exec(text);
  if (!m) throw new T0Error(`${LLMS_FILE} has no "## Facts (checked YYYY-MM-DD)" line`);
  if (m[2] >= date) return { text, changes: [] };
  return { text: text.replace(re, `$1${date}$3`), changes: [`${LLMS_FILE}: checked ${m[2]} -> ${date}`] };
}

/**
 * Record T0 in `root`: returns the changes, and writes them unless `dryRun`.
 * @param {{ root?: string, releasedAt: string, receipt: string, now?: Date, force?: boolean, dryRun?: boolean, article68Read?: string }} options
 */
export function setT0({ root = DEFAULT_ROOT, releasedAt, receipt, now = new Date(), force = false, dryRun = false, article68Read }) {
  const file = (rel) => path.join(root, rel);
  for (const rel of [REGISTRY_FILE, PAGES_FILE, LLMS_FILE]) if (!existsSync(file(rel))) throw new T0Error(`${rel} does not exist under ${root}`);
  const registry = JSON.parse(readFileSync(file(REGISTRY_FILE), "utf8"));
  const applied = applyT0(registry, { releasedAt, receipt, now, force, article68Read });
  const pages = raiseLastmod(readFileSync(file(PAGES_FILE), "utf8"), applied.date);
  const llms = raiseChecked(readFileSync(file(LLMS_FILE), "utf8"), applied.date);
  const changes = [...applied.changes, ...pages.changes, ...llms.changes];
  if (!dryRun && changes.length) {
    writeFileSync(file(REGISTRY_FILE), `${JSON.stringify(applied.registry, null, 2)}\n`);
    writeFileSync(file(PAGES_FILE), pages.text);
    writeFileSync(file(LLMS_FILE), llms.text);
  }
  return { changes, date: applied.date, article68: article68Reads(applied.registry), stale: staleArticle68Reads(applied.registry) };
}

/**
 * @param {string[]} argv
 * @returns {{ releasedAt?: string, receipt?: string, root?: string, now?: string, force?: boolean, dryRun?: boolean, help?: boolean, article68Read?: string }}
 */
export function parseArgs(argv) {
  /** @type {{ releasedAt?: string, receipt?: string, root?: string, now?: string, force?: boolean, dryRun?: boolean, help?: boolean, article68Read?: string }} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--released-at") opts.releasedAt = value();
    else if (a === "--receipt") opts.receipt = value();
    else if (a === "--article-68-read") opts.article68Read = value();
    else if (a === "--root") opts.root = value();
    else if (a === "--now") opts.now = value();
    else if (a === "--force") opts.force = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.help && (!opts.releasedAt || !opts.receipt)) throw new Error("--released-at and --receipt are both required");
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
    const { changes, date, stale } = setT0({
      root: opts.root ? path.resolve(opts.root) : DEFAULT_ROOT,
      releasedAt: opts.releasedAt,
      receipt: opts.receipt,
      now,
      force: opts.force,
      dryRun: opts.dryRun,
      article68Read: opts.article68Read,
    });
    for (const c of changes) io.log(`set-t0: ${opts.dryRun ? "would set " : ""}${c}`);
    io.log(`set-t0: T0 ${normalizeInstant(opts.releasedAt)} (date ${date}): ${changes.length ? `${changes.length} change(s)${opts.dryRun ? ", none written (--dry-run)" : " written"}` : "already recorded, nothing to change"}`);
    if (stale.length) {
      io.log(
        `set-t0: ${ARTICLE_68} was last read before T0 (${stale.join(", ")}): the owner re-reads it on the day of the merge, then run this again with --article-68-read <that date>`,
      );
    }
    if (!opts.dryRun) io.log("set-t0: next, the T0 merge check must pass before the switch is merged: T0_MERGE_CHECK=1 pnpm exec vitest run scripts/growth/t0-switch.test.ts");
    return 0;
  } catch (error) {
    if (error instanceof T0Error) {
      io.error(`set-t0: ${error.message}`);
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
