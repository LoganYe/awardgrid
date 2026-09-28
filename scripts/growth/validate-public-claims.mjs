#!/usr/bin/env node
/**
 * The public-claims gate. Every public sentence about the AwardGrid iPhone app has to be one the facts registry
 * (`growth/product-facts.json`) can back, and wording that overclaims fails here, in CI, rather than in review.
 *
 *   node scripts/growth/validate-public-claims.mjs                   registry checks + the registered public files
 *   node scripts/growth/validate-public-claims.mjs --dist <dir>      … plus every *.html and *.txt of a built site
 *   node scripts/growth/validate-public-claims.mjs --status released run the content rules as if the registry said so
 *   node scripts/growth/validate-public-claims.mjs --file draft.md   scan only these files (a draft kept elsewhere)
 *   node scripts/growth/validate-public-claims.mjs --t0-merge-check  … and fail on the deferred findings (so does T0_MERGE_CHECK=1)
 *   options: --registry <path>  --root <dir>  --json
 *
 * Exit 0 when clean, 1 with one line per finding (`RULE file:line "excerpt"`), 2 on a usage error. A summary line
 * with the count per rule and the files scanned is always printed, so a CI log shows the gate really ran.
 *
 * T0_UNRECORDED is one deferred finding: a registry whose status is released (or withdrawn, since a removal follows
 * the release) but whose released_at_utc or t0_lookup_receipt is still empty. The T0 switch is prepared before T0 with those two left empty, since only the
 * lookup that first returns the app can fill them (scripts/growth/set-t0.mjs does, on T0 day). Until then the gate
 * prints it as a DEFERRED line and does not fail on it, so CI on the prepared switch stays green; with
 * --t0-merge-check or T0_MERGE_CHECK=1 it is a finding like any other, and the switch is not merged until that run
 * exits 0.
 *
 * WITHDRAWN_UNRECORDED is the other, the same pattern for the removal: a registry whose status is withdrawn but whose
 * withdrawn_at_utc is still empty. The change to withdrawn is prepared with the date of the removal left as <date> in
 * the withdrawn sentences (the registry's own placeholder); scripts/growth/set-withdrawn.mjs records withdrawn_at_utc
 * and writes its date into them in one run. Until then the one deferred line stands for every placeholder; once the
 * date is recorded, a placeholder left in a public file is DATE_PLACEHOLDER, which fails in every mode.
 *
 * Pages are read the way `apps/ios/src/honesty.test.ts` (`landingTexts`) reads them, so both scanners see the same
 * text: comments, the doctype and <style> are dropped; the strings of <script type="application/ld+json"> are kept;
 * inline tags are read through and every other tag starts a new text run; the attributes a reader or a search
 * result sees (content, alt, title, aria-label, placeholder, and the label of a submit or button input) are runs of
 * their own, however they are quoted; entities are decoded; typographic apostrophes, quotes and hyphens read as
 * their plain forms, and invisible characters (soft hyphen, zero-width space) are dropped.
 *
 * The content rules match promise forms, not topics: each has a negation guard, so "not live", "no alerts",
 * "never books", "does not", 没有提醒 and 不是实时 pass, and a question ("Are the results live?") is not a claim.
 * The guard is narrow on purpose: a negation governs only the words right after it in its own clause (a comma,
 * "and", a dash or "but" ends one), or a list that continues from a negated match ("no alerts or notifications";
 * "not affiliated with, endorsed by, or sponsored by"); idioms such as "no time", "no more" or "not just" negate
 * nothing. A question is one that asks (it starts with is/does/can/what/…, or 吗/是否 …), not any text before a "?".
 * Exemptions (`historical_allowlist`) are exact text in one file, for the listed rules only, each with a reason; an
 * exemption that no longer matches anything fails, so stale ones get removed.
 *
 * Every repo evidence ref carries a quoted snippet that must start on the first line it cites
 * (`LEGAL.md:16-17 "Live Search is never used"`), so a ref that drifts when lines move fails here instead of
 * quietly citing other text.
 *
 * Node built-ins only: this runs in CI before anything is installed for it.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STATUSES = ["submitted_not_live", "released", "withdrawn"];
const STATUS_ALIASES = { submitted: "submitted_not_live", submitted_not_live: "submitted_not_live", released: "released", withdrawn: "withdrawn" };
export const EVIDENCE_LEVELS = ["source-verified", "external", "observed"];
export const PUBLIC_USES = ["approved", "pending_owner"];
export const GENERAL_LIMITATION = "Source-verified; not run on a physical iPhone; not verified with real keys on the 1.0 build.";
export const MARKER_START = "<!-- public-claims:start -->";
export const MARKER_END = "<!-- public-claims:end -->";
/**
 * Paths that are public by nature: a file here must be registered, as public or as not marketing, so none goes
 * unchecked. Under sites/landing/public/ and apps/ios/store-metadata/ dot-directories count too: Vite copies
 * public/.well-known/ into the built site like any other directory.
 */
export const SURFACE_PATTERNS = ["sites/landing/**/index.html", "sites/landing/public/**", "apps/ios/store-metadata/**", "growth/geo/**"];
const SURFACE_DOT_DIRS = new Set(["sites/landing/public/**", "apps/ios/store-metadata/**"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------------------------------------------------------------------------------------------------------
// Reading a page the way a person (or a search result, or an answer engine) reads it
// ---------------------------------------------------------------------------------------------------------------

/** Named entities a page is likely to use. Soft hyphen and zero-width characters decode to nothing: a reader never sees them. */
export const ENTITIES = {
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  shy: "", zwj: "", zwnj: "", zerowidthspace: "", wj: "",
  hyphen: "-", dash: "-", minus: "-", ndash: "–", mdash: "—", horbar: "—",
  lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"', laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  hellip: "…", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™", times: "×", rarr: "→", larr: "←",
  thinsp: " ", ensp: " ", emsp: " ", deg: "°", euro: "€", pound: "£", yen: "¥", cent: "¢",
};
/** Inline (phrasing) tags: read through, so "Get <u>real</u>-time" reads as "Get real-time". Any other tag starts a new run. */
const INLINE_TAG = /^<\/?(?:a|abbr|b|bdi|bdo|big|cite|code|data|del|dfn|em|font|i|ins|kbd|label|mark|q|s|samp|small|span|strike|strong|sub|sup|time|tt|u|var|wbr)\b/i;
/** A tag, with a `>` inside a quoted attribute value kept in it. */
const TAG = /<[a-zA-Z/!?](?:[^'">]|=\s*"[^"]*"|=\s*'[^']*')*>/g;
/** Attributes whose value a reader or a search result is shown. */
const SHOWN_ATTRIBUTES = new Set(["content", "alt", "title", "aria-label", "placeholder"]);
const BUTTON_INPUT = new Set(["submit", "button", "reset"]);
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const blank = (s) => s.replace(/[^\n]/g, " ");

/**
 * One character as it is read: typographic apostrophes and quotes become ' and ", hyphens that are not dashes
 * (U+2010-U+2012, U+2212) become -, and invisible characters become nothing (""). An en dash inside a word is folded
 * by the caller. Everything else is itself.
 */
function readChar(ch) {
  switch (ch) {
    case "‘": case "’": case "‛": case "ʼ": case "＇":
      return "'";
    case "“": case "”": case "„": case "‟":
      return '"';
    case "‐": case "‑": case "‒": case "−":
      return "-";
    case "­": case "​": case "‌": case "‍": case "⁠": case "﻿":
      return "";
    default:
      return ch;
  }
}

/** A string as the scanner reads it (the same normalization as a page's text runs): for registry copy and needles. */
export function readText(s) {
  let out = "";
  for (const ch of String(s)) out += readChar(ch);
  return out.replace(/(?<=[\p{L}\p{N}])–(?=[\p{L}\p{N}])/gu, "-");
}

/** Offsets at which each line starts, for turning an offset into a 1-based line number. */
function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Text pieces (each with the source offset of its first character) → one run: entities decoded, characters read as
 * `readChar` reads them, whitespace collapsed and trimmed, and for every output character the source offset it came
 * from.
 * @param {Array<{ text: string, offset: number }>} pieces
 * @param {boolean} decode
 */
function buildRun(pieces, decode) {
  const chars = [];
  const offsets = [];
  const add = (ch, at) => {
    const read = readChar(ch);
    if (read === "") return;
    chars.push(read);
    offsets.push(at);
  };
  for (const { text, offset } of pieces) {
    let i = 0;
    while (i < text.length) {
      if (decode && text[i] === "&") {
        const m = /^&(#x[0-9a-f]+|#\d+|[a-z]+);/i.exec(text.slice(i, i + 20));
        if (m) {
          const ref = m[1];
          let out = null;
          if (ref[0] !== "#") out = ENTITIES[ref.toLowerCase()] ?? null;
          else {
            const code = ref.charAt(1).toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
            if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) out = String.fromCodePoint(code);
          }
          if (out !== null) {
            for (const ch of out) add(ch, offset + i);
            i += m[0].length;
            continue;
          }
        }
      }
      const cp = text.codePointAt(i) ?? 0;
      const ch = String.fromCodePoint(cp);
      add(ch, offset + i);
      i += ch.length;
    }
  }
  // An en dash between two letters is a hyphen typed with the wrong key ("Real–time"); a spaced one is a dash.
  for (let k = 1; k < chars.length - 1; k++) {
    if (chars[k] === "–" && /[\p{L}\p{N}]/u.test(chars[k - 1]) && /[\p{L}\p{N}]/u.test(chars[k + 1])) chars[k] = "-";
  }
  let out = "";
  const map = [];
  let pendingSpace = -1;
  for (let k = 0; k < chars.length; k++) {
    if (/\s/.test(chars[k])) {
      if (pendingSpace < 0) pendingSpace = offsets[k];
      continue;
    }
    if (pendingSpace >= 0 && out.length > 0) {
      out += " ";
      map.push(pendingSpace);
    }
    pendingSpace = -1;
    out += chars[k];
    // One map entry per UTF-16 unit, so an astral character keeps the map aligned with the text.
    for (let u = 0; u < chars[k].length; u++) map.push(offsets[k]);
  }
  return { text: out, map };
}

/**
 * The attributes of an opening tag's attribute text, in order, each with the offset (relative to that text) where its
 * value starts. A name with no value has value "" and offset -1.
 */
function attributeSpans(text) {
  const out = [];
  for (const m of text.matchAll(ATTRIBUTE)) {
    const value = m[2] ?? m[3] ?? m[4];
    if (value === undefined) {
      out.push({ name: m[1].toLowerCase(), value: "", offset: -1 });
      continue;
    }
    const valueEnd = m.index + m[0].length - (m[4] !== undefined ? 0 : 1);
    out.push({ name: m[1].toLowerCase(), value, offset: valueEnd - value.length });
  }
  return out;
}

/** Every opening tag of a piece of markup: its lower-case name, its attribute text and where that text starts. */
function openingTags(markup) {
  const out = [];
  for (const m of markup.matchAll(TAG)) {
    const head = /^<([a-zA-Z][^\s/>]*)/.exec(m[0]);
    if (!head) continue;
    const attrsStart = head[0].length;
    const attrsEnd = m[0].length - (m[0].endsWith("/>") ? 2 : 1);
    out.push({ name: head[1].toLowerCase(), index: m.index, tag: m[0], attrs: m[0].slice(attrsStart, attrsEnd), attrsOffset: m.index + attrsStart });
  }
  return out;
}

/** The attributes of an opening tag, by lower-case name; the first of a repeated name wins, as in a browser. */
export function tagAttributes(text) {
  const found = new Map();
  for (const { name, value } of attributeSpans(text)) if (!found.has(name)) found.set(name, value);
  return found;
}

/**
 * The attribute values of a piece of markup that a reader or a search result is shown, each as a text piece with
 * its source offset: content, alt, title, aria-label and placeholder on any tag, and the label (value) of an
 * <input type=submit|button|reset>. Quoted either way or unquoted.
 */
export function shownAttributes(markup, baseOffset = 0) {
  const out = [];
  for (const tag of openingTags(markup)) {
    const spans = attributeSpans(tag.attrs);
    const seen = new Set();
    const type = (spans.find((s) => s.name === "type")?.value ?? "").trim().toLowerCase();
    for (const s of spans) {
      if (seen.has(s.name) || s.offset < 0) continue;
      seen.add(s.name);
      const shown = SHOWN_ATTRIBUTES.has(s.name) || (s.name === "value" && tag.name === "input" && BUTTON_INPUT.has(type));
      if (shown) out.push({ text: s.value, offset: baseOffset + tag.attrsOffset + s.offset });
    }
  }
  return out;
}

/** A <script> a browser never runs: JSON-LD data, type="application/ld+json" with no src. */
export function isJsonLd(scriptAttributes) {
  const attrs = tagAttributes(scriptAttributes);
  return !attrs.has("src") && (attrs.get("type") ?? "").trim().toLowerCase() === "application/ld+json";
}

function jsonStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(jsonStrings);
  return [];
}

/** Split markup into runs of pieces: inline tags are read through, any other tag ends a run. */
function markupRuns(markup, baseOffset) {
  const runs = [];
  let pieces = [];
  let last = 0;
  // A run opened by <th>, <td>, <dt> or <dd> is a table cell: `cell` names its row, so a rule can read a row's
  // header and the cell beside it ("Alerts" | "Not offered").
  let row = 0;
  let cell = null;
  for (const m of markup.matchAll(TAG)) {
    if (m.index > last) pieces.push({ text: markup.slice(last, m.index), offset: baseOffset + last });
    if (!INLINE_TAG.test(m[0])) {
      runs.push({ pieces, cell });
      pieces = [];
      if (/^<(?:tr|dl)\b/i.test(m[0])) row++;
      cell = /^<(?:th|td|dt|dd)\b/i.test(m[0]) ? `r${row}` : null;
    }
    last = m.index + m[0].length;
  }
  if (last < markup.length) pieces.push({ text: markup.slice(last), offset: baseOffset + last });
  runs.push({ pieces, cell });
  return runs;
}

/**
 * A document: its text stream (runs joined by "\n", each run whitespace-collapsed) with a map from every stream
 * character to its source offset, plus the source views the markup rules read.
 * @typedef {{ file: string, logical: string, kind: "html"|"markdown"|"text", dist: boolean, raw: string,
 *   page: string, markup: string, stream: string, streamMap: number[], lineStarts: number[],
 *   jsonLd: Array<{ offset: number, body: string, parsed?: unknown, error?: string }>, region: [number, number] }} Doc
 */

function assemble(file, logical, kind, dist, raw, runs, extra) {
  runs.sort((a, b) => (a.map[0] ?? 0) - (b.map[0] ?? 0));
  let stream = "";
  const streamMap = [];
  /** Each run's place in the stream, and its table row when it is a cell. */
  const runInfo = [];
  for (const run of runs) {
    if (!run.text) continue;
    if (stream) {
      stream += "\n";
      streamMap.push(streamMap[streamMap.length - 1] ?? 0);
    }
    runInfo.push({ start: stream.length, end: stream.length + run.text.length, cell: run.cell ?? null });
    stream += run.text;
    for (const at of run.map) streamMap.push(at);
  }
  return { file, logical, kind, dist, raw, stream, streamMap, runInfo, lineStarts: lineStartsOf(raw), jsonLd: [], page: raw, markup: raw, region: [0, raw.length], ...extra };
}

/** An HTML page, read like `landingTexts` in apps/ios/src/honesty.test.ts. */
export function htmlDocument(raw, { file = "page.html", logical = file, dist = false } = {}) {
  const page = raw.replace(/<!--[\s\S]*?-->/g, blank).replace(/<!doctype[^>]*>/gi, blank);
  const jsonLd = [];
  const runs = [];
  for (const m of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!isJsonLd(m[1] ?? "")) continue;
    const block = { offset: m.index, body: m[2] ?? "" };
    try {
      block.parsed = JSON.parse(block.body);
      for (const s of jsonStrings(block.parsed)) {
        // A string's markup is read as the page's is, but <date> is the withdrawn copy's placeholder, not a tag: it
        // reads as the page's &lt;date&gt; does, so a withdrawn sentence in the JSON-LD is found like the one on the page.
        for (const { pieces } of markupRuns(s.replace(/<date>/g, "&lt;date&gt;"), 0)) {
          const run = buildRun(pieces, true);
          run.map = run.map.map(() => m.index);
          runs.push(run);
        }
      }
    } catch (error) {
      block.error = error instanceof Error ? error.message : String(error);
    }
    jsonLd.push(block);
  }
  const markup = page.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, blank);
  for (const { pieces, cell } of markupRuns(markup, 0)) runs.push({ ...buildRun(pieces, true), cell });
  for (const piece of shownAttributes(markup)) runs.push(buildRun([piece], true));
  return assemble(file, logical, "html", dist, raw, runs, { page, markup, jsonLd });
}

/**
 * A Markdown file as plain text: headings, list items, table rows and paragraphs are runs; emphasis, code ticks,
 * link brackets and HTML comments are read through. `section` limits it to the text between the public-claims markers.
 */
export function markdownDocument(raw, { file = "file.md", logical = file, section = false } = {}) {
  let start = 0;
  let end = raw.length;
  if (section) {
    const a = raw.indexOf(MARKER_START);
    const b = raw.indexOf(MARKER_END);
    if (a < 0 || b < 0 || b < a || raw.indexOf(MARKER_START, a + 1) >= 0 || raw.indexOf(MARKER_END, b + 1) >= 0) {
      return { ...assemble(file, logical, "markdown", false, raw, [], {}), region: [0, 0], markersMissing: true };
    }
    start = a + MARKER_START.length;
    end = b;
  }
  // Length-preserving clean-up, so every offset still points into `raw`.
  const clean =
    raw.slice(0, start).replace(/[^\n]/g, " ") +
    raw
      .slice(start, end)
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/\*+|__|`/g, blank)
      .replace(/\]\(/g, "  ")
      .replace(/[[\]<>]/g, " ") +
    raw.slice(end).replace(/[^\n]/g, " ");
  const runs = [];
  let pieces = [];
  let fenced = false;
  const flush = () => {
    if (pieces.length) runs.push(buildRun(pieces, false));
    pieces = [];
  };
  let offset = 0;
  for (const line of clean.split("\n")) {
    const lineOffset = offset;
    offset += line.length + 1;
    if (lineOffset < start || lineOffset >= end) continue;
    const rawLine = raw.slice(lineOffset, lineOffset + line.length);
    if (/^\s*(?:```|~~~)/.test(rawLine)) {
      fenced = !fenced;
      flush();
      continue;
    }
    if (fenced) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s/.exec(rawLine);
    const item = /^\s*(?:[-*+]|\d+[.)])\s/.exec(rawLine);
    const table = /^\s*\|/.test(rawLine);
    const quote = /^\s*>\s?/.exec(rawLine);
    if (heading || item || table) flush();
    if (table) {
      // Each cell is a run of its own, as <th>/<td> are in a page; the |---| row under the header is not text.
      if (/^[\s|:-]+$/.test(line)) continue;
      let at = 0;
      for (const segment of line.split("|")) {
        if (segment.trim()) runs.push({ ...buildRun([{ text: segment, offset: lineOffset + at }], false), cell: `r${lineOffset}` });
        at += segment.length + 1;
      }
      continue;
    }
    let text = line;
    const skip = heading ? heading[0].length : item ? item[0].length : quote ? quote[0].length : 0;
    text = " ".repeat(skip) + text.slice(skip);
    pieces.push({ text: text + " ", offset: lineOffset });
    if (heading) flush();
  }
  flush();
  return assemble(file, logical, "markdown", false, raw, runs, { region: [start, end], markersMissing: false });
}

/** A plain text file: paragraphs (lines up to a blank line) are runs. */
export function textDocument(raw, { file = "file.txt", logical = file, dist = false } = {}) {
  const runs = [];
  let pieces = [];
  let offset = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      if (pieces.length) runs.push(buildRun(pieces, false));
      pieces = [];
    } else pieces.push({ text: line + " ", offset });
    offset += line.length + 1;
  }
  if (pieces.length) runs.push(buildRun(pieces, false));
  return assemble(file, logical, "text", dist, raw, runs, {});
}

export function documentFor(raw, { file, logical = file, dist = false, section = false }) {
  const base = logical.replace(/#.*$/, "");
  if (/\.html?$/i.test(base)) return htmlDocument(raw, { file, logical: base, dist });
  if (/\.(?:md|markdown)$/i.test(base)) return markdownDocument(raw, { file, logical: base, section });
  return textDocument(raw, { file, logical: base, dist });
}

// ---------------------------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------------------------

/**
 * English negators. A determiner ("no alerts", "without a key") governs the next two words; a negated verb ("does
 * not send you alerts", "doesn't check for new seats in the background") the next four.
 */
const EN_NEGATOR = /\b(?:no longer|no|not|never|without|nor|neither|none|nothing|cannot|can't|isn't|aren't|doesn't|don't|won't|wasn't|weren't|didn't|hasn't|haven't|hadn't|shouldn't|wouldn't|couldn't|mustn't)\b|n't\b/gi;
const EN_DETERMINER = new Set(["no", "without", "nor", "neither", "none", "nothing"]);
/** Idioms that start with a negator and negate nothing after them ("Set up in no time", "Not just a search tool"). */
const EN_IDIOM = /^(?:no[- ]time|no more|no[- ]brainer|no doubt|no wonder|no matter|no problem|no need to|no less than|not just|not only|not to mention|not least|nothing but|none other than)\b/i;
/** Chinese negation words: they govern up to six characters after them (没有提醒; 不会在后台检查; 不提供实时查询). */
const ZH_NEGATOR = /不是|不再|不会|不會|不能|不可|不提供|不支持|不需要|不需|不用|不必|不做|不在|从不|從不|从未|從未|并不|並不|并非|並非|绝不|絕不|决不|決不|无需|無需|无须|無須|尚未|未曾|毫无|毫無|均无|均無|没有|沒有/g;
/**
 * Single-character negators govern only the next two characters (不抓取, 非实时, 未监测, 无提醒), and never as part of
 * a word that is not a negation: 非常 (very), 不断 (constantly), 未来 (future), 无论, 无缝, 特别 (especially) …
 */
const ZH_NEGATOR_CHAR = /[不没沒无無非未]/g;
const ZH_NOT_NEGATION =
  /^(?:不断|不斷|不同|不仅|不僅|不但|不少|不错|不錯|不过|不過|不管|不久|不止|不停|不妨|不论|不論|不愧|非常|未来|未來|无论|無論|无限|無限|无比|無比|无缝|無縫|无敌|無敵|无忧|無憂|无时|無時|无处|無處|没落|沒落)/;
/**
 * Where a clause ends: a negation before it does not reach past. A dot only counts before a space (not seats.aero).
 * A comma, "and" and a dash end one too ("AwardGrid has no ads and sends alerts"; "No more refreshing — alerts"); a
 * list after a negation is read by `commaList` and `listContinues` instead.
 */
const HARD_BREAK =
  /[;!?\n。；！？：:，—―]|\.(?=\s|$)|\s[–-]{1,2}\s|\b(?:but|and|so|because|since|while|whereas|although|though|then|plus|instead|just)\b|但是?|而且|而是|并且|並且|所以|因此|然后|然後|不过|不過/gi;
const CLAUSE_BREAK = new RegExp(`${HARD_BREAK.source}|,`, "gi");
/** The words after a match that make it a negated verb's subject ("Live Search is never used"); "are not a luxury" is not one. */
const NEGATED_PREDICATE =
  /^(?:\s+[\w'-]+){0,2}\s+(?:is|are|was|were)\s+(?:never|not)\s+(?:used|offered|available|built|supported|provided|included|sent|shown|made|done|run|possible|planned|part of)\b/i;
const CJK = /[㐀-鿿]/;

/** A negator at `index` of `text` that starts an idiom ("no time", "not just") or asks "why not …?": it negates nothing. */
function isIdiom(text, index) {
  return EN_IDIOM.test(text.slice(index)) || /\bwhy\s+$/i.test(text.slice(0, index));
}

/** The text of `before` after its last clause break (`HARD_BREAK`, or any break including a comma). */
function clauseTail(before, breaks = CLAUSE_BREAK) {
  let cut = 0;
  for (const m of before.matchAll(breaks)) cut = m.index + m[0].length;
  return before.slice(cut);
}

/**
 * A negator distributed over a comma list that the match is an item of: "never automates, crawls or scrapes"; "no
 * ads, alerts or tracking". The match must start its item (so "no ads, sends real-time alerts" is not one), and every
 * item before it is short and starts nothing new.
 */
function commaList(gap) {
  if (!gap.includes(",")) return false;
  const items = gap.split(/,|\bor\b|\bnor\b/i);
  if (items.pop()?.trim() !== "" || items.length > 6) return false;
  return items.every((item) => {
    const words = item.match(/[A-Za-z0-9][\w'.-]*/g) ?? [];
    return words.length <= 3 && !words.some((w) => LIST_BLOCK.test(w));
  });
}

/** The words (Latin) and characters (CJK) in a gap. */
function gapSize(gap) {
  const words = gap.match(/[A-Za-z0-9][\w'.-]*/g)?.length ?? 0;
  const han = gap.match(/[㐀-鿿]/g)?.length ?? 0;
  return { words, han };
}

/**
 * True when a negation governs the match directly: a negator close before it in its own clause ("no alerts",
 * "never books", "does not send you alerts", 没有提醒, 不是实时), the match the subject of a negated verb ("Live
 * Search is never used"), or a table row's header whose cell says no ("Alerts" | "Not offered"; "Alerts: no").
 * A list that continues from a negated match is read by the caller (`listContinues`).
 */
export function isNegated(text, start, end, doc = null) {
  const tail = clauseTail(text.slice(Math.max(0, start - 80), start));
  // English: the last negator of the clause that is not an idiom, close enough.
  let last = null;
  for (const m of tail.matchAll(EN_NEGATOR)) if (!isIdiom(tail, m.index)) last = m;
  if (last) {
    const { words, han } = gapSize(tail.slice(last.index + last[0].length));
    const reach = EN_DETERMINER.has(last[0].toLowerCase()) ? 2 : 4;
    if (words <= reach && han <= 2) return true;
  }
  // A comma list the negation is distributed over. It is a list only with a conjunction in it, before or after the
  // match: "Not a subscription, real-time alerts included" is an apposition, not a list.
  const hard = clauseTail(text.slice(Math.max(0, start - 80), start), HARD_BREAK);
  let listHead = null;
  for (const m of hard.matchAll(EN_NEGATOR)) if (!isIdiom(hard, m.index)) listHead = m;
  if (listHead) {
    const gap = hard.slice(listHead.index + listHead[0].length);
    const rest = text.slice(end, end + 80).split(/[;:!?\n。；！？：—―]|\.(?=\s|$)|\s[–-]{1,2}\s/)[0] ?? "";
    if (commaList(gap) && /\b(?:or|nor|and)\b/i.test(`${gap} ${rest}`)) return true;
  }
  // Chinese: a negation word within six characters, or a single-character negator right before the match.
  let zh = null;
  for (const m of tail.matchAll(ZH_NEGATOR)) zh = m;
  if (zh) {
    const { words, han } = gapSize(tail.slice(zh.index + zh[0].length));
    if (han <= 6 && words <= 2) return true;
  }
  for (const m of tail.matchAll(ZH_NEGATOR_CHAR)) {
    if (ZH_NOT_NEGATION.test(tail.slice(m.index))) continue;
    const { words, han } = gapSize(tail.slice(m.index + 1));
    if (han <= 2 && words <= 1) return true;
  }
  // After the match: "Live Search is never used"; "Alerts: not offered".
  const after = text.slice(end, end + 60);
  if (NEGATED_PREDICATE.test(after)) return true;
  if (/^[^:.;!?\n]{0,30}:\s*(?:no|not(?:\s+(?:offered|available|supported|built|included|provided|yet))?|none|never)\s*(?:[.;\n]|$)/i.test(after)) return true;
  return doc ? cellSaysNo(doc, start) : false;
}

/** The match is in a short table cell (a row's header), and the next cell of the same row only says no. */
function cellSaysNo(doc, index) {
  const runs = doc.runInfo ?? [];
  const k = runs.findIndex((r) => index >= r.start && index < r.end);
  if (k < 0 || !runs[k].cell) return false;
  const here = runs[k];
  const next = runs[k + 1];
  if (!next || next.cell !== here.cell || here.end - here.start > 40) return false;
  return /^(?:no|not(?:\s+[\w-]+){0,2}|none|never|n\/a|[—–×✗✘-])\.?$/i.test(doc.stream.slice(next.start, next.end).trim());
}

/** Words that start something new, so a list does not carry a negation past them. */
const LIST_BLOCK = /^(?:just|but|only|instead|rather|plus|yet|so|then|now|also|even|still|always|it|we|you|they|he|she|this|that|which|who|awardgrid|get|gets|enjoy|with|while|because|since|though|although|however)$/i;
const ZH_LIST_BLOCK = /[但而却卻就只还還都也会會]/;

/**
 * True when `gap` (the text between a negated match and the next match) only continues a list, so the negation
 * carries over: "no alerts or notifications", "not affiliated with, endorsed by, or sponsored by", "no push
 * notifications", 不提供实时查询、提醒或推送. A sentence or clause end, or a word that starts something new ("just",
 * "but", "you", "with" …), stops it.
 */
export function listContinues(gap) {
  if (/^\s*$/.test(gap)) return true;
  if (/[;:!?.。；！？：\n—―]|\s[–-]{1,2}\s/.test(gap)) return false;
  if (CJK.test(gap)) {
    if (/[，,]/.test(gap) || ZH_LIST_BLOCK.test(gap)) return false;
    const han = gap.match(/[㐀-鿿]/g)?.length ?? 0;
    return /、|或|和|及|与|與|跟|\//.test(gap) && han <= 6;
  }
  const words = gap.match(/[A-Za-z0-9][\w'.-]*/g) ?? [];
  if (words.some((w) => LIST_BLOCK.test(w))) return false;
  if (words.filter((w) => !/^(?:or|and|nor)$/i.test(w)).length > 3) return false;
  return /,|\b(?:or|and|nor)\b|\//i.test(gap);
}

const INTERROGATIVE = /^(?:is|are|am|was|were|does|do|did|can|could|will|would|should|shall|may|might|must|has|have|had|what|which|who|whom|whose|when|where|how|why)\b/i;
const QUESTION_ZH = /[吗嗎呢么麼][\s"'」』]*？$|是否|是不是|会不会|會不會|能不能|可不可以|有没有|有沒有|什么|什麼|怎么|怎麼|怎样|怎樣|哪|几|幾|多少|为什么|為什麼|为何|為何|何时|何時/;
/** Where the clause of a question ends. The full-width comma is one: 实时查询，还等什么？ asks nothing about 实时查询. */
const QUESTION_BOUNDARY = /[!?\n。！？;；:：，—―]|\.(?=\s|$)|\s[–-]{1,2}\s/g;

/**
 * True when the match sits in a question that asks ("Are the results live?", "Does it book tickets?", 结果是实时的吗？):
 * a question claims nothing. Its clause must end in "?" with no dash before it, and start with an interrogative word
 * (English) or ask with 吗 / 是否 / 什么 … (Chinese). "Looking for real-time alerts?", "Get real-time alerts — why
 * wait?" and "It alerts you, right?" are claims.
 */
export function isQuestion(text, start, end) {
  const after = text.slice(end);
  const close = new RegExp(QUESTION_BOUNDARY.source).exec(after);
  if (!close || (close[0] !== "?" && close[0] !== "？")) return false;
  let clauseStart = 0;
  for (const m of text.slice(0, start).matchAll(QUESTION_BOUNDARY)) clauseStart = m.index + m[0].length;
  const clause = text.slice(clauseStart, end + close.index + 1).trim();
  if (INTERROGATIVE.test(clause)) return !/^why\s+(?:not|wait)\b/i.test(clause);
  return QUESTION_ZH.test(clause);
}

const p = (source, why) => ({ source, why });

/**
 * Wording that says the app is listed, or can be had, on the App Store. Premature before the release; untrue once
 * withdrawn. "submitted to the App Store" and "removed from the App Store" are not listings, and a negated one ("not
 * available on the App Store yet", "no longer on the App Store") passes the guard.
 */
const LISTED = [
  p(
    String.raw`(?<!\bremoved )\b(?:on|in|from|via|through) the (?:Apple )?App Store\b(?!\s*(?:Connect|Review|review|guidelines?|privacy label|statistics)\b)`,
    'only "submitted to the App Store" until the app is live',
  ),
  p(String.raw`\b(?:now available|available now|out now|now live|live now|now on sale)\b`, "nothing is available until the app is live"),
  p(String.raw`\bdownload (?:it|AwardGrid|the app)\b|\bfree to (?:download|install)\b`, "there is nothing to download until the app is live"),
  p(String.raw`\bis a free (?:iPhone |iOS )?app\b|\b(?:app|AwardGrid) is free\b`, 'the released version of the price sentence ("has been submitted as a free app" is the current one)'),
  p(String.raw`\bavailable in 174\b`, "availability is future tense until the app is live"),
  p(
    String.raw`已上架|现已上架|現已上架|已在\s*App\s*Store|在\s*App\s*Store\s*上?免费|(?:在|从|從)\s*App\s*Store\s*(?:上\s*)?(?:下载|下載|获取|獲取|安装|安裝|搜索|搜尋|找到)|App\s*Store\s*(?:上\s*)?可\s*(?:下载|下載)|现已(?:推出|发布|上线)|現已(?:推出|發布|上線)|已(?:上线|上線)`,
    "已上架 / 可在 App Store 下载",
  ),
];
const LISTING_MARKUP = [p(String.raw`apple-itunes-app`, "Smart App Banner"), p(String.raw`(?:apps|itunes)\.apple\.com/[^\s"'<>)]*6816321841`, "store link")];

/**
 * The content rules. `guard: true` rules skip a negated match and a question. `near` rules fail only when the
 * required words are missing within `distance` characters of the match (across neighbouring runs); with
 * `affirmative`, a negated or denied mention ("no seats.aero Pro needed") does not count. `statuses` limits a rule
 * to those registry statuses. `markup` patterns read the source (links, meta tags).
 */
export const CONTENT_RULES = [
  {
    id: "LIVE",
    guard: true,
    patterns: [
      p(String.raw`\breal[- ]?time\b`, '"real-time": results are seats.aero\'s cached availability'),
      // "If you live in mainland China" is the verb: a person lives somewhere.
      p(String.raw`(?<!\b(?:you|we|they|who|people|users?|I)\s)\blive\b`, '"live": there is no live search (Live Search needs a commercial agreement)'),
      p(String.raw`\binstant(?:ly|aneous(?:ly)?)?\b`, '"instant" promises speed nothing measures'),
      p(String.raw`实时|即时|實時|即時`, "实时 / 即时"),
    ],
  },
  {
    id: "ALERT",
    guard: true,
    patterns: [
      p(String.raw`\balert(?:s|ed|ing)?\b`, "no alerts: watches are checked only while the app is open"),
      p(String.raw`\bnotif(?:y|ies|ied|ying|ication|ications)\b`, "no notifications"),
      p(String.raw`\bpush(?:es|ed|ing)?\b`, "no push"),
      p(String.raw`(?<!seats\.aero\s)\bmonitor(?:s|ed|ing)?\b`, "AwardGrid monitors nothing (seats.aero monitoring routes is a different subject)"),
      p(String.raw`\bnever miss\b|\b24\s*/\s*7\b|\baround the clock\b`, '"never miss" / "24/7"'),
      p(String.raw`\bin the background\b|\bbackground (?:check|checks|checking|refresh|monitoring|search|searches|task|tasks)\b`, "no background check is built"),
      p(String.raw`提醒|推送|后台|後台|不错过|不錯過|全天候|通知|(?<!seats\.aero\s?)(?:监控|監控|监测|監測)`, "提醒 / 推送 / 通知 / 监控 / 后台 / 不错过"),
    ],
  },
  {
    id: "AFFILIATION",
    guard: true,
    patterns: [
      p(String.raw`\b(?:affiliated|associated) with\b|\bendorsed\b|\bsponsored\b`, "AwardGrid is not affiliated with, endorsed or sponsored by seats.aero"),
      p(String.raw`\bofficial(?:ly)?\b`, '"official"'),
      p(String.raw`\bpartner(?:s|ed|ship|ships)?\b(?!\s+API)`, '"partner" (the seats.aero "Partner API" is the API\'s name and passes)'),
      p(String.raw`\bintegrat(?:ed|es|ion) with\b|\bpowered by\b`, '"integrated with" / "powered by"'),
      p(String.raw`\bseats\.aero(?:'s)? (?:own |official )?(?:iPhone |iOS )?app\b|\bseats\.aero(?:'s)? (?:for|on) (?:iPhone|iOS)\b`, '"the seats.aero app for iPhone" / "seats.aero for iPhone"'),
      p(String.raw`\b(?:approved|authori[sz]ed|licensed|certified) by seats\.aero\b`, '"approved by seats.aero"'),
      p(String.raw`官方(?!网站|网|網)|合作|(?:获得?|已获|取得|经)(?:其|seats\.aero)?\s*(?:授权|授權|认可|認可|赞助|贊助)|seats\.aero\s*(?:官方|授权|授權|认可|認可)`, "官方 / 合作 / 授权"),
      p(String.raw`与\s*seats\.aero[^。；！？]{0,30}?(?<!无|無|没有|沒有|不)(?:关联|關聯)`, "与 seats.aero 有关联"),
    ],
  },
  {
    id: "COMPETITOR_FRAME",
    guard: true,
    patterns: [
      p(
        String.raw`\bseats\.aero alternative\b|\balternative to seats\.aero\b|\b(?:vs\.?|versus) seats\.aero\b|\bseats\.aero (?:vs\.?|versus)(?=\s|$)|\bfree seats\.aero\b|\bseats\.aero (?:for free|without (?:a |the )?(?:Pro|subscription|paying))\b|\b(?:cheaper|better) than seats\.aero\b|\breplac(?:e|es|ing) seats\.aero\b`,
        "AwardGrid is described on its own terms, never as a stand-in for seats.aero",
      ),
      p(String.raw`平替|seats\.aero\s*(?:的)?替代|替代\s*seats\.aero|比\s*seats\.aero\s*(?:更好|更便宜)`, "平替 / 替代"),
    ],
  },
  {
    // Denying the prerequisite: these carry their own negation, so they are not guarded.
    id: "COMPETITOR_FRAME",
    patterns: [
      p(
        String.raw`\b(?:no|zero)\s+(?:paid\s+)?seats\.aero Pro(?:\s+(?:subscription|account|key|plan))?\s+(?:needed|required|necessary)\b|\b(?:don't|do not|doesn't|does not|won't|will not|never)\s+need\s+(?:a\s+|any\s+|your own\s+|the\s+)?(?:paid\s+)?seats\.aero Pro\b|\bno need for\s+(?:a\s+|any\s+)?(?:paid\s+)?seats\.aero Pro\b|\bseats\.aero Pro(?:\s+(?:subscription|account|key|plan))?\s+(?:is\s+|are\s+)?(?:optional|not (?:needed|required|necessary)|unnecessary)\b`,
        "it needs your own paid seats.aero Pro subscription; saying it does not is the free-seats.aero frame",
      ),
      p(String.raw`(?:不需要|无需|無需|不用|不必)\s*(?:购买|購買|订阅|訂閱|开通|開通)?\s*(?:seats\.aero\s*)?Pro\b`, "不需要 Pro"),
    ],
  },
  {
    id: "BOOKING",
    guard: true,
    patterns: [
      // "You book the seat yourself, on the program's own site" is the honest division of labour.
      p(
        String.raw`(?<!\byou\s)(?<!\byou can\s)(?<!\bthen you\s)(?<!\byou then\s)\bbook(?:s|ed)?\b(?![^.;\n]{0,40}\byourself\b)`,
        "it never books: it opens seats.aero's booking link, or you copy the search",
      ),
      p(String.raw`\bauto[- ]?book(?:s|ed|ing)?\b|\bbooking (?:engine|service|assistant|agent)\b|\bissues? tickets?\b`, '"auto-book"'),
      p(String.raw`出票|代订|代訂|预订|預訂|订票|訂票`, "出票 / 代订 / 预订"),
    ],
  },
  {
    id: "ALL_COVERAGE",
    guard: true,
    patterns: [
      p(
        String.raw`\ball (?:the )?(?:major )?airlines\b|\bevery (?:single )?(?:airline|program|programme|seat|award|route|flight)s?\b(?!\.aero)|\ball (?:the )?(?:loyalty |mileage |frequent[- ]flyer |award )?program(?:me)?s\b|\ball (?:award )?seats\b|\bdeep[- ]links? (?:to|for) (?:each|every|all)\b`,
        "coverage is the 26 programs seats.aero lists, where seats.aero monitors the route",
      ),
      p(String.raw`所有(?:的)?(?:航司|航空公司|里程计划|里程計劃|常旅客计划|项目|項目|座位)|全部(?:航司|航空公司)|每个项目直达|每個項目直達`, "所有航司 / 每个项目直达"),
    ],
  },
  {
    id: "AI_SEARCH",
    guard: true,
    patterns: [
      p(
        String.raw`\bAI[- ]?(?:powered |driven |based )?search(?:es|ing)?\b|\bAI (?:understands|reads your|parses)\b|\bsmart search\b|\bsearch(?:es)? (?:is |are )?(?:powered by|driven by|with|using) (?:AI|Claude|an? LLM)\b|\b(?:AI|Claude|LLM|GPT)[- ](?:powered|driven|based|assisted|enabled)\b[^.\n]{0,30}?\bsearch(?:es|ing)?\b(?!\s+results)`,
        "the search parser is deterministic, with no AI (apps/ios/src/search/search.ts)",
      ),
      p(String.raw`AI\s*(?:搜索|搜尋|查票|理解|解析)|智能(?:搜索|搜尋|查票)|人工智能(?:搜索|查票)`, "AI 搜索 / 智能搜索"),
    ],
  },
  {
    id: "PLATFORM_OVERCLAIM",
    guard: true,
    patterns: [
      p(String.raw`\biPad(?:OS)?\b|\bAndroid\b|\bTraditional Chinese\b|\bmacOS\b|\bApple Watch\b|\bVision Pro\b`, "iPhone only; the interface is English or Simplified Chinese"),
      p(String.raw`安卓|平板|繁体|繁體`, "安卓 / 平板 / 繁体"),
    ],
  },
  {
    id: "SCRAPING",
    guard: true,
    patterns: [
      p(String.raw`\bscrap(?:e|es|ed|ing|er|ers)\b|\bcrawl(?:s|ed|ing|er|ers)?\b`, "nothing is scraped"),
      p(String.raw`抓取|爬取|爬虫|爬蟲`, "抓取 / 爬虫"),
    ],
  },
  {
    id: "EXCLUSIVITY",
    guard: true,
    patterns: [
      p(
        String.raw`\b(?:the )?(?:only|first) (?:(?:award|mileage|miles|points)[- ](?:search |flight |grid |seat )?|grid |search )?(?:app|apps|tool|tools|iPhone app)\b|\bthe only way\b|\bworld'?s first\b|\bfirst[- ]ever\b|\bbest\b|\b(?:industry|market)[- ]leading\b|\bthe leading (?:app|tool|award|search|way)\b|\bunique(?:ly)?\b|#1\b|\bnumber one\b|\bunrivall?ed\b`,
        "no only / first / best",
      ),
      p(String.raw`唯一|首个|首款|第一款|最好|最佳|最强|领先|領先|独家|獨家`, "唯一 / 首个 / 最好"),
    ],
  },
  {
    id: "FREE_WITHOUT_PRO",
    guard: true,
    near: { source: String.raw`seats\.aero Pro`, flags: "i", distance: 120, affirmative: true },
    patterns: [
      p(
        // Not "free" as in "feel free", "free up space", "free-text" or "free of ads"; "free of charge" is a price.
        String.raw`(?<!-)(?<!\bfeel )\bfree\b(?![- ](?:text|form)\b)(?!\s+(?:up|space)\b)(?!\s+of\s+(?!charge|cost))|\bno (?:[\w-]+ ){0,2}(?:fees?|charges?)\b|\bat no (?:extra )?cost\b|\bwithout (?:any )?(?:charge|cost|fees?)\b`,
        'a free app still needs a paid seats.aero Pro subscription: "seats.aero Pro", affirmed, within 120 characters',
      ),
    ],
  },
  {
    id: "FREE_WITHOUT_PRO",
    guard: true,
    near: { source: String.raw`\bPro\b`, flags: "", distance: 60, affirmative: true },
    patterns: [p(String.raw`免费|免費|不收费|不收費|零费用|零費用`, "免费 needs Pro, affirmed, within 60 characters")],
  },
  {
    id: "PRICE_UNSOURCED",
    nearFails: { source: String.raw`\bPro\b|\bAnthropic\b|\bAsk\b|\bClaude\b|AI\s*辅助`, flags: "", distance: 100 },
    patterns: [
      p(
        String.raw`(?:US)?\$\s?\d|\b(?:USD|EUR|GBP|CNY|RMB)\s?\d|\d[\d,.]*\s?(?:USD|EUR|GBP|CNY|RMB|dollars?|euros?|cents?|bucks)\b|[€£¥￥]\s?\d|\d[\d,.]*\s?(?:元|块|塊|人民币|人民幣|欧元|歐元|英镑|英鎊)|美元|美金`,
        "no Pro or Ask price without a dated source",
      ),
    ],
  },
  {
    id: "STALE_STATUS",
    patterns: [
      p(String.raw`\btest(?:ing|ed) (?:it )?privately\b|\bthrough (?:Apple's )?TestFlight and is not\b`, "1.0 was submitted for review on 2026-09-26; private TestFlight testing is over in every status"),
    ],
  },
  {
    id: "STALE_STATUS",
    statuses: ["released"],
    patterns: [
      p(
        String.raw`(?:\bnot|n't|\bnever)(?:\s+(?:yet|currently|available|listed|live|out|found))*\s+(?:on|in) the App Store\b|\bfriends[- ]only\b|\bfewer than ten\b|未上架|没有?上架|沒有?上架|还没有?上架|還沒有?上架`,
        "untrue once the app is on the App Store",
      ),
    ],
  },
  {
    id: "STALE_STATUS",
    statuses: ["released", "withdrawn"],
    patterns: [
      p(
        String.raw`\bhas been submitted to the App Store\b|\bsubmitted as a free app\b|\bwill be offered in 174\b|\b(?:waiting for|waiting on|awaiting|pending|in|under) (?:Apple's |Apple |the )?(?:App )?[Rr]eview\b|已提交(?:到|至)?\s*App\s*Store|等待\s*(?:Apple|苹果|蘋果)?\s*审核|等待\s*(?:Apple|苹果|蘋果)?\s*審核|审核中|審核中|正在审核|正在審核`,
        "submission wording is untrue once Apple has decided",
      ),
    ],
  },
  {
    id: "PREMATURE_STATUS",
    statuses: ["submitted_not_live"],
    guard: true,
    patterns: [...LISTED, p(String.raw`\bis a separate, public release\b`, "the released version of the history sentence")],
    markup: LISTING_MARKUP.map((x) => ({ ...x, why: `${x.why} before the app is live` })),
  },
  {
    id: "WITHDRAWN_STATUS",
    statuses: ["withdrawn"],
    guard: true,
    patterns: LISTED.map((x) => ({ ...x, why: `${x.why} (only "removed from the App Store" once withdrawn)` })),
    markup: LISTING_MARKUP.map((x) => ({ ...x, why: `${x.why} after withdrawal` })),
  },
  // Tuned on the 2026-09-28 pages, LEGAL.md and README.md: the pages say "privacy" and "privately" (neither is the
  // word "private"), and "private" or "invite-only" describe the web app only in the history and webapp_note
  // sentences, which pass verbatim. Uses that are not about the product pass too: "private key", "keep your key
  // private", "your key stays private", "private browsing". Anything else calling AwardGrid private is the web app's
  // description leaking.
  {
    id: "PRIVATE_WEBAPP",
    guard: true,
    exactCopyExempt: true,
    patterns: [
      p(
        String.raw`(?<!\bkeep (?:it|them|this|that|keys?|your [\w-]+) )(?<!\b(?:key|keys|data|information|searches|search|results|history|questions|query|queries|details|everything)\s+(?:stays?|remains?|is kept|are kept|kept)\s)\bprivate\b(?!\s+(?:keys?|API keys?|browsing|mode|relay|network|information|data)\b)`,
        "private describes the web app, only in the registered history and webapp_note sentences",
      ),
      p(String.raw`\binvit(?:e|ation)[- ]only\b|\bby invit(?:e|ation)\b|\bfriends[- ]only\b|\bmembers[- ]only\b|\bclosed beta\b`, "invite-only, only in the registered history and webapp_note sentences"),
      p(
        String.raw`私人|私有(?!\s*(?:密钥|密鑰|钥匙|鑰匙|key|数据|數據|信息|資訊))|邀请制|邀請制|仅限邀请|僅限邀請|仅限朋友|僅限朋友|仅供受邀|僅供受邀|受邀(?:用户|用戶)|内测|內測`,
        "私人 / 私有 / 邀请制 / 仅供受邀",
      ),
    ],
  },
  {
    id: "NO_SERVER_SUBJECT",
    subject: true,
    patterns: [
      p(String.raw`\bno (?:user )?accounts?\b|\bno servers?\b(?![\s-]*keys?\b)`, '"no accounts / no server" is said of the iPhone app: the web app on the same host has both'),
      p(
        String.raw`(?:没有|沒有|无需|無需|不需要|无|無)\s*(?:任何\s*)?(?:用户|用戶)?\s*(?:账户|账号|帐户|帐号|帳戶|帳號|帳户|帳号|账戶|账號)|(?:没有|沒有|无|無)\s*(?:自己的\s*)?(?:服务器|服務器|伺服器)`,
        "没有账户 / 没有服务器 needs App as its subject",
      ),
    ],
  },
];

export const RULE_IDS = [
  ...new Set([
    ...CONTENT_RULES.map((r) => r.id),
    "PENDING_CLAIM_TEXT",
    "HTML_COMMENT_IN_DIST",
    "SCRIPT_NOT_LD_JSON",
    "ATTRIBUTION_LINK",
    "SCHEMA_JSON",
    "TRADEMARK_ASO",
    "DATE_PLACEHOLDER",
  ]),
];
export const REGISTRY_RULE_IDS = [
  "REGISTRY", "EVIDENCE_REF", "PUBLIC_FILE_MISSING", "PUBLIC_CLAIMS_MARKERS", "UNREGISTERED_SURFACE", "EXEMPTION_INVALID", "EXEMPTION_UNUSED", "T0_UNRECORDED",
  "WITHDRAWN_UNRECORDED",
];
/** Findings the gate reports without failing on, unless the T0 merge check asks for them (see the header). */
export const DEFERRED_RULE_IDS = ["T0_UNRECORDED", "WITHDRAWN_UNRECORDED"];

/** The iPhone app as a subject: "the app", "iPhone app", "iOS app"; not "App Store", "App ID", "App Review". */
const SUBJECT_EN = /\b(?:iPhone|iOS|the) app\b(?!\s*(?:Store|ID|Review|Clip)\b)/i;
/** Chinese copy calls the app "App" ("App 没有账号"); "Web App" / 网页 App is the web app, never the subject. */
const SUBJECT_APP = /(?<![Ww][Ee][Bb]\s?)(?<!网页\s?)(?<!網頁\s?)(?<!网络\s?)(?<!網路\s?)\bApp(?=\s*[㐀-鿿])/;

/** Brand words for each seats.aero source code, beyond its full name in packages/core (TRADEMARK_ASO). */
export const PROGRAM_BRANDS = {
  eurobonus: ["SAS", "EuroBonus"],
  virginatlantic: ["Virgin Atlantic", "Flying Club"],
  aeromexico: ["Aeromexico", "Aeroméxico", "Club Premier"],
  american: ["American Airlines", "AAdvantage"],
  delta: ["Delta", "SkyMiles"],
  etihad: ["Etihad", "Etihad Guest"],
  united: ["United", "MileagePlus"],
  emirates: ["Emirates", "Skywards"],
  aeroplan: ["Air Canada", "Aeroplan"],
  alaska: ["Alaska", "Mileage Plan"],
  velocity: ["Virgin Australia", "Velocity Frequent Flyer", "Velocity"],
  qantas: ["Qantas"],
  connectmiles: ["Copa", "ConnectMiles"],
  azul: ["Azul", "TudoAzul"],
  smiles: ["GOL Smiles"],
  flyingblue: ["Air France", "KLM", "Flying Blue"],
  jetblue: ["JetBlue", "TrueBlue"],
  qatar: ["Qatar", "Privilege Club"],
  turkish: ["Turkish Airlines", "Miles&Smiles", "Miles & Smiles"],
  singapore: ["Singapore Airlines", "KrisFlyer"],
  ethiopian: ["Ethiopian Airlines", "ShebaMiles"],
  saudia: ["Saudia", "AlFursan"],
  finnair: ["Finnair"],
  lufthansa: ["Lufthansa", "Miles & More", "Miles&More"],
  frontier: ["Frontier Airlines"],
  spirit: ["Spirit Airlines"],
};
/** Third-party names that never go in the App Store name, subtitle or keywords (Guideline 2.3.7; APP_STORE_HANDOFF.md). */
export const TRADEMARK_BASE = ["seats.aero", "seats aero", "seatsaero", "Claude", "Anthropic", "point.me", "Roame", "AwardFares", "PointsYeah", "AwardTool", "MilesUp", "Flightpoints"];
/** A localization's name, subtitle and keyword fields: <locale>/ (as submitted) and next/<locale>/ (drafts), with the byte-limited keyword fallback. */
const STORE_FIELD = /^apps\/ios\/store-metadata\/(?:next\/)?[^/]+\/(?:name|subtitle|keywords|keywords_fallback)\.txt$/;

/** The program list in packages/core: source codes and full names, read from its source so the two cannot drift. */
export function programList(root = DEFAULT_ROOT) {
  const file = path.join(root, "packages/core/src/lib/seatsaero/types.ts");
  if (!existsSync(file)) return { sources: Object.keys(PROGRAM_BRANDS), names: [] };
  const src = readFileSync(file, "utf8");
  const list = /SEATS_SOURCES\s*=\s*\[([\s\S]*?)\]/.exec(src)?.[1] ?? "";
  const names = /SOURCE_NAMES[^=]*=\s*\{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
  return {
    sources: [...list.matchAll(/"([a-z]+)"/g)].map((m) => m[1]),
    names: [...names.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]),
  };
}

export function trademarkTerms(root = DEFAULT_ROOT) {
  const { names } = programList(root);
  return [...new Set([...TRADEMARK_BASE, ...names, ...Object.values(PROGRAM_BRANDS).flat()])];
}

// ---------------------------------------------------------------------------------------------------------------
// Scanning one document
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {{ rule: string, file: string, logical: string, line: number, match: string, excerpt: string, why: string, hay: "stream"|"page"|"raw", start: number, end: number }} Finding */

function excerptOf(text, start, end) {
  const from = Math.max(0, start - 40);
  const to = Math.min(text.length, end + 40);
  let s = text.slice(from, to).replace(/\s+/g, " ").trim();
  if (from > 0) s = "…" + s;
  if (to < text.length) s += "…";
  return s;
}

/**
 * A claim's status-dependent copy as [status, sentence] pairs: allowed_copy_by_status and allowed_copy_zh_by_status
 * (one text per status), and allowed_copy_extra_by_status and allowed_copy_zh_extra_by_status (more sentences per
 * status, e.g. a page's own wording of the released status).
 */
export function statusCopies(claim) {
  const out = [];
  for (const key of ["allowed_copy_by_status", "allowed_copy_zh_by_status"]) {
    const map = claim[key];
    if (map && typeof map === "object" && !Array.isArray(map)) for (const [status, text] of Object.entries(map)) out.push([status, text]);
  }
  for (const key of ["allowed_copy_extra_by_status", "allowed_copy_zh_extra_by_status"]) {
    const map = claim[key];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const [status, list] of Object.entries(map)) if (Array.isArray(list)) for (const text of list) out.push([status, text]);
  }
  return out.filter(([, text]) => typeof text === "string");
}

/**
 * Every sentence of a claim's copy, in every status, variant and language: the Chinese of a claim is allowed_copy_zh
 * (the sentence), allowed_copy_zh_extra (more sentences) and allowed_copy_zh_by_status (the status-dependent ones).
 */
export function claimCopies(claim) {
  const out = [];
  if (typeof claim.allowed_copy === "string") out.push(claim.allowed_copy);
  if (typeof claim.allowed_copy_zh === "string") out.push(claim.allowed_copy_zh);
  if (Array.isArray(claim.allowed_copy_extra)) out.push(...claim.allowed_copy_extra);
  if (Array.isArray(claim.allowed_copy_zh_extra)) out.push(...claim.allowed_copy_zh_extra);
  out.push(...statusCopies(claim).map(([, text]) => text));
  if (claim.allowed_copy_variants && typeof claim.allowed_copy_variants === "object") out.push(...Object.values(claim.allowed_copy_variants));
  return out.filter((s) => typeof s === "string");
}

/** The exact sentences that may say "private" or "invite-only": history (every status) and webapp_note (in use). */
export function exactCopySentences(registry) {
  const ids = new Set(registry.exact_copy_exempt_claims ?? []);
  const out = [];
  for (const claim of registry.claims ?? []) {
    if (!ids.has(claim.claim_id)) continue;
    const variants = claim.allowed_copy_variants;
    if (variants && typeof variants === "object") {
      for (const key of claim.in_use ?? []) if (typeof variants[key] === "string") out.push(variants[key]);
    }
    if (claim.allowed_copy_by_status) out.push(...Object.values(claim.allowed_copy_by_status));
    if (typeof claim.allowed_copy === "string") out.push(claim.allowed_copy);
  }
  return [...new Set(out.flatMap((s) => readText(s).replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)))];
}

/** A Chinese character or punctuation mark (CJK ideographs, CJK punctuation, full-width forms). */
const CJK_CHAR = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;

/**
 * The sentences of every status-dependent claim (allowed_copy_by_status, and its Chinese, allowed_copy_zh_by_status,
 * and the extra sentences per status, allowed_copy_extra_by_status and allowed_copy_zh_extra_by_status), each with a
 * pattern that finds it in page text: the final full stop is optional (a page may go on "… and is waiting"), and
 * <date> stands for any date. A Chinese full stop ends a sentence with or without a space after it.
 */
export function statusSentences(registry) {
  const out = [];
  for (const claim of registry.claims ?? []) {
    for (const [status, text] of statusCopies(claim)) {
      const sentences = String(text).replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+|(?<=[。！？])\s*/);
      for (const sentence of sentences.filter(Boolean)) {
        const body = sentence.replace(/[.。]$/, "");
        // A space next to Chinese is optional (Chinese text puts one only between Chinese and Latin letters or digits,
        // and a page may leave it out), so a status sentence is found however its Chinese is spaced.
        const parts = body
          .split("<date>")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, (_s, i, str) => (CJK_CHAR.test(str[i - 1] ?? "") || CJK_CHAR.test(str[i + 1] ?? "") ? "\\s*" : "\\s+")));
        // A date inside a sentence is as short as it can be; one that ends it runs to the full stop, so the finding
        // shows the whole date ("on 1 November 2026", or the placeholder).
        const source = parts.reduce((out, part, k) => `${out}${k === parts.length - 1 && part === "" ? "[^.。\\n]{1,40}" : "[^.。\\n]{1,40}?"}${part}`);
        out.push({ claim: claim.claim_id, status, sentence: body, source });
      }
    }
  }
  return out;
}

/**
 * The pieces of copy that must not appear: the copy of a claim still pending the owner, and any claim's
 * retired_copy (wording that was replaced because it was not true, e.g. a sentence that described the web app's table
 * rather than the iPhone app's). Each sentence without its final stop (a list item or a table cell drops it), and each
 * clause of 25 characters or more (a draft may reuse a clause alone: "AwardGrid depends on seats.aero's Partner API";
 * "The pages at /ios/, /privacy/ and /support/ run no scripts"). Read as the scanner reads text, lower-cased.
 */
export function pendingNeedles(registry) {
  const out = [];
  const seen = new Set();
  // A retired sentence may share a clause with the copy that replaced it ("It puts … into one table"); that clause is
  // still true, so it is not a needle.
  const approved = (registry.claims ?? [])
    .filter((c) => c.public_use === "approved")
    .flatMap((c) => claimCopies(c))
    .map((copy) => readText(copy).replace(/\s+/g, " ").toLowerCase())
    .join("\n");
  for (const c of registry.claims ?? []) {
    const copies = [
      ...(c.public_use === "pending_owner" ? claimCopies(c).map((copy) => ({ copy, kind: "pending" })) : []),
      ...(Array.isArray(c.retired_copy) ? c.retired_copy.map((copy) => ({ copy, kind: "retired" })) : []),
    ];
    for (const { copy, kind } of copies) {
      for (const sentence of readText(copy).replace(/\s+/g, " ").trim().split(/(?<=[.!?。！？])\s+/)) {
        const whole = sentence.replace(/[.。!?！？]+$/, "").trim();
        const clauses = whole.split(/\s*[;；:：]\s*|,\s+(?:which|and|with|so|but)\s+|，/);
        for (const piece of [whole, ...clauses]) {
          const needle = piece.trim().toLowerCase();
          if (needle.length < 25 || seen.has(`${c.claim_id}\u0000${needle}`)) continue;
          if (kind === "retired" && approved.includes(needle)) continue;
          seen.add(`${c.claim_id}\u0000${needle}`);
          out.push({ claim: c.claim_id, sentence: needle, kind });
        }
      }
    }
  }
  return out;
}

function streamLine(doc, index) {
  return lineAt(doc.lineStarts, doc.streamMap[Math.min(index, doc.streamMap.length - 1)] ?? 0);
}

function push(out, doc, rule, hay, start, end, why, text) {
  const line = hay === "stream" ? streamLine(doc, start) : lineAt(doc.lineStarts, start);
  const match = text.slice(start, end).replace(/\s+/g, " ").trim();
  out.push({ rule, file: doc.file, logical: doc.logical, line, match, excerpt: excerptOf(text, start, end), why, hay, start, end });
}

/** The text run (between "\n" separators) that holds `index`, as [start, end). */
function runBounds(stream, index) {
  const start = stream.lastIndexOf("\n", index - 1) + 1;
  const next = stream.indexOf("\n", index);
  return [start, next < 0 ? stream.length : next];
}

/**
 * Which guarded matches a negation governs: directly (`isNegated`), or because the match continues a list from the
 * nearest earlier match, itself negated ("no alerts or notifications"). Keyed by "start:end".
 * @param {Doc} doc
 * @param {Array<{ start: number, end: number }>} guarded
 */
function negations(doc, guarded) {
  const spans = [...new Map(guarded.map((g) => [`${g.start}:${g.end}`, g])).values()].sort((a, b) => a.start - b.start || a.end - b.end);
  const negated = new Map();
  for (let i = 0; i < spans.length; i++) {
    const g = spans[i];
    let neg = isNegated(doc.stream, g.start, g.end, doc);
    if (!neg) {
      for (let j = i - 1; j >= 0; j--) {
        const prev = spans[j];
        if (prev.end > g.start) continue;
        neg = negated.get(`${prev.start}:${prev.end}`) === true && listContinues(doc.stream.slice(prev.end, g.start));
        break;
      }
    }
    negated.set(`${g.start}:${g.end}`, neg);
  }
  return negated;
}

/** After "seats.aero Pro": wording that denies it is needed ("… is optional", "… not required"). */
const PRO_DENIED = /^(?:\s+(?:subscription|account|key|plan))?\s*,?\s*(?:is\s+|are\s+)?(?:optional|not (?:needed|required|necessary)|unnecessary|isn't (?:needed|required|necessary))\b|^\s*(?:订阅|訂閱|账户|帳戶|账号|帳號)?\s*(?:是)?\s*(?:可选|可選|非必需|不是必需|不必要)/i;

function contentFindings(doc, ctx, out) {
  const { stream } = doc;
  const exactRanges = [];
  for (const sentence of ctx.exactCopy) {
    for (let i = stream.indexOf(sentence); i >= 0; i = stream.indexOf(sentence, i + 1)) exactRanges.push([i, i + sentence.length]);
  }
  // Every match of every rule that applies; then which of the guarded ones a negation governs, lists included.
  const matches = [];
  for (const rule of CONTENT_RULES) {
    if (rule.statuses && !rule.statuses.includes(ctx.status)) continue;
    for (const pat of rule.patterns) {
      for (const m of stream.matchAll(new RegExp(pat.source, "gi"))) matches.push({ rule, pat, start: m.index, end: m.index + m[0].length });
    }
  }
  const negated = negations(doc, matches.filter((m) => m.rule.guard));
  for (const { rule, pat, start, end } of matches) {
    if (rule.guard && (negated.get(`${start}:${end}`) || isQuestion(stream, start, end))) continue;
    if (rule.exactCopyExempt && exactRanges.some(([a, b]) => start >= a && end <= b)) continue;
    if (rule.near) {
      // The required words, near enough, and (when `affirmative`) not negated or denied: "no seats.aero Pro
      // subscription needed" does not make "free" true.
      const from = Math.max(0, start - rule.near.distance);
      const window = stream.slice(from, end + rule.near.distance);
      let satisfied = false;
      for (const n of window.matchAll(new RegExp(rule.near.source, `${rule.near.flags}g`))) {
        const ns = from + n.index;
        const ne = ns + n[0].length;
        if (rule.near.affirmative && (isNegated(stream, ns, ne, doc) || PRO_DENIED.test(stream.slice(ne, ne + 50)))) continue;
        satisfied = true;
        break;
      }
      if (satisfied) continue;
    }
    if (rule.nearFails) {
      const re = new RegExp(rule.nearFails.source, rule.nearFails.flags);
      if (!re.test(stream.slice(Math.max(0, start - rule.nearFails.distance), end + rule.nearFails.distance))) continue;
    }
    if (rule.subject) {
      // The subject is looked for in the same run, within 80 characters. A short run (a heading, a label, a
      // table row's header) also reaches into the run after it, and is read as the subject of that run: the
      // row "No accounts, no analytics in the app" names the app for its cell "There is no server to collect
      // any of it." A long run before does not count, and nothing reaches further than one run.
      const [runStart, runEnd] = runBounds(stream, start);
      const reach = runEnd - runStart <= 40 ? runBounds(stream, runEnd + 1)[1] : runEnd;
      const around = stream.slice(Math.max(runStart, start - 80), Math.min(reach, end + 80));
      const [leadStart, leadEnd] = runStart > 0 ? runBounds(stream, runStart - 1) : [0, 0];
      const lead = leadEnd - leadStart <= 40 ? stream.slice(leadStart, leadEnd) : "";
      if (SUBJECT_EN.test(around) || SUBJECT_APP.test(around) || SUBJECT_EN.test(lead) || SUBJECT_APP.test(lead)) continue;
    }
    push(out, doc, rule.id, "stream", start, end, pat.why, stream);
  }
  for (const rule of CONTENT_RULES) {
    if (rule.statuses && !rule.statuses.includes(ctx.status)) continue;
    for (const pat of rule.markup ?? []) {
      const source = doc.kind === "html" ? doc.page : doc.raw;
      const [a, b] = doc.region;
      for (const m of source.slice(a, b).matchAll(new RegExp(pat.source, "gi"))) push(out, doc, rule.id, "page", a + m.index, a + m.index + m[0].length, pat.why, source);
    }
  }
  // Registry copy written for another status: earlier is stale, later is premature, released copy once withdrawn.
  const current = STATUSES.indexOf(ctx.status);
  const explicit = out.slice();
  for (const { claim, status, sentence, source } of ctx.statusCopy ?? []) {
    if (status === ctx.status) continue;
    // A sentence the claim uses in more than one status does not depend on the status.
    if (ctx.statusCopy.some((o) => o.claim === claim && o.status !== status && o.sentence === sentence)) continue;
    const other = STATUSES.indexOf(status);
    const rule = ctx.status === "withdrawn" && status === "released" ? "WITHDRAWN_STATUS" : other < current ? "STALE_STATUS" : "PREMATURE_STATUS";
    for (const m of stream.matchAll(new RegExp(source, "gi"))) {
      const start = m.index;
      const end = start + m[0].length;
      if (explicit.some((f) => f.rule === rule && f.hay === "stream" && f.start < end && start < f.end)) continue;
      push(out, doc, rule, "stream", start, end, `the ${claim} copy for ${status}, while the status is ${ctx.status}`, stream);
    }
  }
  // Pending copy, whole or by the clause: one finding per place, the longest piece that matches there.
  const lower = stream.toLowerCase();
  const pending = [];
  for (const { claim, sentence, kind } of ctx.pending) {
    for (let i = lower.indexOf(sentence); i >= 0; i = lower.indexOf(sentence, i + 1)) pending.push({ claim, kind, start: i, end: i + sentence.length });
  }
  pending.sort((a, b) => b.end - b.start - (a.end - a.start));
  const taken = [];
  for (const f of pending) {
    if (taken.some((t) => f.start < t.end && t.start < f.end)) continue;
    taken.push(f);
    const why = f.kind === "retired" ? `retired wording of the ${f.claim} claim (see its retired_copy)` : `the ${f.claim} claim is pending the owner's approval`;
    push(out, doc, "PENDING_CLAIM_TEXT", "stream", f.start, f.end, why, stream);
  }
}

const SEATS_HREF = /\bhref\s*=\s*(["']?)https:\/\/seats\.aero\/?\1(?=[\s>])/i;
const SPACE = String.raw`(?:\s|&nbsp;|&#160;|&#x0*a0;)`;
const ATTRIBUTION = new RegExp(
  String.raw`(?:\bData(?:\s+source)?|\bSource|数据(?:来源)?|數據(?:來源)?)${SPACE}*[:：]${SPACE}*((?:<[^>]*>${SPACE}*)*)seats\.aero|\bData from${SPACE}+((?:<[^>]*>${SPACE}*)*)seats\.aero`,
  "gi",
);

/** Entities decoded in an attribute value, as a browser decodes them (the final ";" may be missing). */
function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, ref) => {
    if (ref[0] !== "#") return ENTITIES[ref.toLowerCase()] ?? match;
    const code = ref.charAt(1).toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function htmlFindings(doc, ctx, out) {
  if (doc.dist) {
    for (const m of doc.raw.matchAll(/<!--/g)) push(out, doc, "HTML_COMMENT_IN_DIST", "raw", m.index, m.index + 4, "built pages carry no comments", doc.raw);
  }
  for (const m of doc.raw.matchAll(/<script\b([^>]*)>/gi)) {
    if (!isJsonLd(m[1] ?? "")) push(out, doc, "SCRIPT_NOT_LD_JSON", "raw", m.index, m.index + Math.min(m[0].length, 60), "no executable script: only JSON-LD without src", doc.raw);
  }
  const { markup } = doc;
  // Script that runs without a <script> tag: an event handler, a javascript: URL, the srcdoc of an iframe.
  for (const tag of openingTags(markup)) {
    for (const s of attributeSpans(tag.attrs)) {
      const value = decodeEntities(s.value).replace(/[\s\u0000-\u001f]/g, "");
      let why = null;
      if (/^on[a-z]+$/.test(s.name)) why = `an event handler (${s.name})`;
      else if (/^javascript:/i.test(value) || (s.name === "content" && /url=javascript:/i.test(value))) why = "a javascript: URL";
      else if (tag.name === "iframe" && s.name === "srcdoc") why = "the srcdoc of an iframe";
      if (why) push(out, doc, "SCRIPT_NOT_LD_JSON", "raw", tag.index, tag.index + Math.min(tag.tag.length, 60), `no executable script: ${why}`, doc.raw);
    }
  }
  // A visible attribution, however it is spaced or worded: "Data: seats.aero", "Data:&nbsp;seats.aero", "Data from
  // seats.aero", "Source: seats.aero", 数据：seats.aero, 数据来源：seats.aero.
  for (const m of markup.matchAll(ATTRIBUTION)) {
    const start = m.index;
    const end = start + m[0].length;
    const between = m[1] ?? m[2] ?? "";
    const opens = [...between.matchAll(/<a\b[^>]*>/gi)];
    let linked = opens.length > 0 && SEATS_HREF.test(opens[opens.length - 1][0]) && /^\s*<\/a\s*>/i.test(markup.slice(end));
    if (!linked) {
      const before = markup.slice(0, start);
      const lastOpen = [...before.matchAll(/<a\b[^>]*>/gi)].pop();
      if (lastOpen && !/<\/a\s*>/i.test(before.slice(lastOpen.index)) && SEATS_HREF.test(lastOpen[0])) {
        const after = markup.slice(end);
        const close = after.search(/<\/a\s*>/i);
        const nextOpen = after.search(/<a\b/i);
        linked = close >= 0 && (nextOpen < 0 || close < nextOpen);
      }
    }
    if (!linked) push(out, doc, "ATTRIBUTION_LINK", "page", start, end, 'every visible "Data: seats.aero" links to https://seats.aero', markup);
  }
  for (const block of doc.jsonLd) {
    if (block.error !== undefined) {
      push(out, doc, "SCHEMA_JSON", "raw", block.offset, block.offset + 7, `JSON-LD does not parse: ${block.error}`, doc.raw);
      continue;
    }
    const nodes = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        nodes.push(v);
        Object.values(v).forEach(walk);
      }
    };
    walk(block.parsed);
    for (const node of nodes) {
      const types = [node["@type"]].flat();
      if (!types.some((t) => t === "MobileApplication" || t === "SoftwareApplication")) continue;
      if (ctx.status !== "released") {
        push(out, doc, "SCHEMA_JSON", "raw", block.offset, block.offset + 7, `${types.join("/")} JSON-LD only once released.status is released`, doc.raw);
        continue;
      }
      const offers = [node.offers].flat();
      const want = `https://apps.apple.com/app/id${ctx.appId}`;
      if (!offers.length || offers.some((o) => !o || o.url !== want)) {
        push(out, doc, "SCHEMA_JSON", "raw", block.offset, block.offset + 7, `offers.url must be ${want}, with no slug`, doc.raw);
      }
    }
  }
}

/**
 * The date placeholder of the withdrawn copy, as a public file holds it until scripts/growth/set-withdrawn.mjs fills
 * it: <date> in Markdown and plain text, &lt;date&gt; in a page's text, and \u003cdate> in its JSON-LD (the escape
 * scripts/growth/sync-faq-schema.mjs writes for "<").
 */
export const DATE_PLACEHOLDER = /<date>|&lt;date&gt;|\\u003cdate(?:>|\\u003e)/gi;

function placeholderFindings(doc, ctx, out) {
  // While the removal is not recorded, the registry's deferred WITHDRAWN_UNRECORDED stands for every placeholder:
  // set-withdrawn.mjs records the date and fills them in one run.
  if (ctx.withdrawalPending) return;
  const source = doc.kind === "html" ? doc.page : doc.raw.replace(/<!--[\s\S]*?-->/g, blank);
  const [a, b] = doc.region;
  for (const m of source.slice(a, b).matchAll(DATE_PLACEHOLDER)) {
    push(out, doc, "DATE_PLACEHOLDER", "raw", a + m.index, a + m.index + m[0].length, "a date left as <date>: scripts/growth/set-withdrawn.mjs writes the date of the removal", doc.raw);
  }
}

function trademarkFindings(doc, ctx, out) {
  if (!STORE_FIELD.test(doc.logical)) return;
  for (const term of ctx.trademarks) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    for (const m of doc.raw.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"))) {
      push(out, doc, "TRADEMARK_ASO", "raw", m.index, m.index + m[0].length, `"${term}" does not go in the App Store name, subtitle or keywords (Guideline 2.3.7)`, doc.raw);
    }
  }
}

/**
 * Every finding in one document, before exemptions.
 * @param {Doc} doc
 * @param {{ status: string, appId: string, exactCopy: string[], pending: Array<{claim: string, sentence: string}>, statusCopy?: Array<{claim: string, status: string, sentence: string, source: string}>, trademarks: string[], withdrawalPending?: boolean }} ctx
 * @returns {Finding[]}
 */
export function scanDocument(doc, ctx) {
  const out = [];
  contentFindings(doc, ctx, out);
  if (doc.kind === "html") htmlFindings(doc, ctx, out);
  trademarkFindings(doc, ctx, out);
  placeholderFindings(doc, ctx, out);
  const seen = new Set();
  return out.filter((f) => {
    const key = `${f.rule}\u0000${f.file}\u0000${f.hay}\u0000${f.start}\u0000${f.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The scan context a registry gives, for a status (the registry's own unless overridden). */
export function scanContext(registry, { status, root = DEFAULT_ROOT } = {}) {
  const effective = normalizeStatus(status ?? registry?.released?.status ?? "submitted_not_live");
  return {
    status: effective,
    appId: String(registry?.released?.app_id ?? "6816321841"),
    exactCopy: registry ? exactCopySentences(registry) : [],
    pending: registry ? pendingNeedles(registry) : [],
    statusCopy: registry ? statusSentences(registry) : [],
    trademarks: trademarkTerms(root),
    // The removal is not recorded yet: the registry's deferred WITHDRAWN_UNRECORDED covers the <date> placeholders.
    withdrawalPending: registry?.released?.status === "withdrawn" && !registry?.released?.withdrawn_at_utc,
  };
}

export function normalizeStatus(status) {
  const s = STATUS_ALIASES[String(status)];
  if (!s) throw new Error(`Unknown status "${status}" (use submitted, released or withdrawn)`);
  return s;
}

/**
 * Scan a piece of content as if it were the file at `logical` (tests, drafts).
 * @param {string} content
 * @param {{ logical?: string, file?: string, dist?: boolean, section?: boolean, status?: string, registry?: any, root?: string }} [options]
 * @returns {Finding[]}
 */
export function scanContent(content, { logical = "draft.md", file = logical, dist = false, section = false, status, registry = null, root = DEFAULT_ROOT } = {}) {
  const doc = documentFor(content, { file, logical, dist, section });
  return scanDocument(doc, scanContext(registry, { status, root }));
}

// ---------------------------------------------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------------------------------------------

function normalizeWithMap(s) {
  let norm = "";
  const map = [];
  let inSpace = false;
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) {
      if (!inSpace) {
        norm += " ";
        map.push(i);
      }
      inSpace = true;
    } else {
      norm += s[i];
      map.push(i);
      inSpace = false;
    }
  }
  return { norm, map };
}

function haystack(doc, hay) {
  doc.normalized ??= {};
  if (!doc.normalized[hay]) {
    const text = hay === "stream" ? doc.stream : hay === "page" ? doc.page : doc.raw;
    doc.normalized[hay] = { text, ...normalizeWithMap(text) };
  }
  return doc.normalized[hay];
}

/**
 * Drop the findings an exemption covers: same file, a listed rule, and the finding inside an occurrence of the
 * exemption's exact text (whitespace-normalized). Returns the remaining findings and, per entry, how often it applied.
 * @param {Finding[]} findings
 * @param {Array<{ file: string, text: string, rules: string[], statuses?: string[] }>} allowlist
 * @param {Map<string, Doc>} docsByFile
 * @param {string} status
 */
export function applyExemptions(findings, allowlist, docsByFile, status) {
  const used = allowlist.map(() => 0);
  const kept = findings.filter((f) => {
    const doc = docsByFile.get(f.file);
    if (!doc) return true;
    for (let k = 0; k < allowlist.length; k++) {
      const entry = allowlist[k];
      if (entry.file !== f.logical || !entry.rules?.includes(f.rule)) continue;
      if (entry.statuses && !entry.statuses.includes(status)) continue;
      const hay = haystack(doc, f.hay);
      const needle = String(entry.text ?? "").replace(/\s+/g, " ").trim();
      if (!needle) continue;
      for (let i = hay.norm.indexOf(needle); i >= 0; i = hay.norm.indexOf(needle, i + 1)) {
        const from = hay.map[i];
        const to = hay.map[i + needle.length - 1] + 1;
        if (f.start >= from && f.end <= to) {
          used[k]++;
          return false;
        }
      }
    }
    return true;
  });
  return { findings: kept, used };
}

// ---------------------------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------------------------

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * Files under `root` matching a glob, skipping node_modules, dist and (unless `dot`) dot-directories. Posix,
 * root-relative.
 */
export function expandGlob(root, glob, { dot = false } = {}) {
  const parts = glob.split("/");
  const firstGlob = parts.findIndex((part) => /[*?]/.test(part));
  if (firstGlob < 0) return existsSync(path.join(root, glob)) ? [glob] : [];
  const base = parts.slice(0, firstGlob).join("/");
  const re = globToRegExp(glob);
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && (dot ? e.name !== ".git" : !e.name.startsWith("."))) walk(child);
      } else if (e.isFile() && re.test(child)) out.push(child);
    }
  };
  walk(base);
  return out.sort();
}

const REF = /^([^:\s"][^:"]*):(\d+)(?:-(\d+))?(?:\s+"(.*)")?$/;
const EXTERNAL = /^\[external\] https?:\/\/\S+ \((?:read \d{4}-\d{2}-\d{2}|pattern)[^)]*\)(?:: .+)?$/;
const refText = (s) => readText(s).replace(/\s+/g, " ").trim();

/**
 * Is `ref` a `path:line "snippet"`, `path:line-line "snippet"` or `[external] URL (read YYYY-MM-DD)` that holds in
 * `root`? The snippet (whitespace-normalized) must start on the first line the ref cites, so a ref whose lines moved
 * fails, and the problem says where the snippet is now. Returns a problem or null.
 */
export function checkEvidenceRef(ref, root, fileLines = new Map()) {
  if (typeof ref !== "string") return "not a string";
  if (ref.startsWith("[external]")) return EXTERNAL.test(ref) ? null : 'external refs read "[external] URL (read YYYY-MM-DD)"';
  const m = REF.exec(ref);
  if (!m) return 'not "path:line \\"snippet\\"", "path:line-line \\"snippet\\"" or "[external] URL (read YYYY-MM-DD)"';
  const [, file, a, b, snippet] = m;
  const abs = path.join(root, file);
  if (!existsSync(abs)) return `${file} does not exist`;
  if (!fileLines.has(file)) {
    const text = readFileSync(abs, "utf8");
    const lines = text.split("\n");
    if (text.endsWith("\n")) lines.pop();
    fileLines.set(file, lines);
  }
  const lines = fileLines.get(file);
  const from = Number(a);
  const to = b === undefined ? from : Number(b);
  if (from < 1 || to < from) return `bad line range ${a}-${b}`;
  if (to > lines.length) return `${file} has ${lines.length} lines, not ${to}`;
  if (snippet === undefined) return `needs a quoted snippet of line ${from}, as in ${file}:${a}${b ? `-${b}` : ""} "words from line ${from}", so a ref that drifts fails`;
  const needle = refText(snippet);
  if (needle.length < 6) return `the snippet "${snippet}" is too short to pin line ${from}`;
  const first = refText(lines[from - 1]);
  const cited = lines.slice(from - 1, to).map(refText).join(" ");
  const at = cited.indexOf(needle);
  if (at >= 0 && at < Math.max(first.length, 1)) return null;
  // Where the snippet starts now (the occurrence nearest the cited line), to say how far the ref drifted.
  const starts = [];
  let whole = "";
  for (const line of lines) {
    starts.push(whole.length);
    whole += `${refText(line)} `;
  }
  let now = -1;
  for (let found = whole.indexOf(needle); found >= 0; found = whole.indexOf(needle, found + 1)) {
    const line = starts.findLastIndex((s) => s <= found) + 1;
    if (now < 0 || Math.abs(line - from) < Math.abs(now - from)) now = line;
  }
  return `"${snippet}" does not start on line ${from} of ${file}${now > 0 ? ` (it starts on line ${now})` : " (it is not in the file)"}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A UTC instant written as released_at_utc is: YYYY-MM-DDTHH:MM:SSZ, a real date and time. */
export function isUtcInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const t = new Date(value);
  return !Number.isNaN(t.getTime()) && t.toISOString().replace(".000Z", "Z") === value;
}

/**
 * Why `value` is not the receipt of a T0 lookup for app `appId`, or null when it is: an https URL of Apple's lookup
 * endpoint (itunes.apple.com/lookup, or /<storefront>/lookup) whose id is the app's, cache-busted (a parameter besides
 * id, country and entity), so the answer it recorded did not come from a cache.
 */
export function lookupProblem(value, appId) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return `"${value}" is not a URL`;
  }
  if (url.protocol !== "https:" || url.hostname !== "itunes.apple.com" || !/^\/(?:[a-z]{2}\/)?lookup$/.test(url.pathname)) {
    return `"${value}" is not an https://itunes.apple.com/lookup URL`;
  }
  if (url.searchParams.get("id") !== appId) return `"${value}" does not look up id=${appId}`;
  if (![...url.searchParams.keys()].some((k) => !["id", "country", "entity"].includes(k))) return `"${value}" is not cache-busted (add a parameter such as &cb=<epoch>)`;
  return null;
}

const RELEASED_FIELDS = [
  "status", "app_id", "bundle_id", "seller", "name", "version", "build", "build_source_revision", "main_revision", "submitted_at_utc",
  "platforms", "minimum_ios", "interface_languages", "price", "territories", "checked_at", "evidence_level", "evidence_ref",
  "released_at_utc", "withdrawn_at_utc", "t0_lookup_receipt",
];
const CLAIM_FIELDS = ["claim_id", "released_version", "candidate_version", "market", "checked_at", "evidence_level", "evidence_ref", "limitations", "public_use"];

/** Registry findings (fields, enums, evidence, public files, markers, unregistered surfaces, exemption shape). */
export function checkRegistry(registry, { root = DEFAULT_ROOT, registryFile = "growth/product-facts.json", registryText = "" } = {}) {
  const out = [];
  /** The registry line of `needle`, looked for after `after` (a claim's own id) when that is given. */
  const lineOf = (needle, after) => {
    const from = after ? Math.max(0, registryText.indexOf(after)) : 0;
    let i = needle ? registryText.indexOf(needle, from) : -1;
    if (i < 0 && needle) i = registryText.indexOf(needle);
    return i < 0 ? 1 : registryText.slice(0, i).split("\n").length;
  };
  const add = (rule, detail, needle, after) =>
    out.push({ rule, file: registryFile, logical: registryFile, line: lineOf(needle, after), match: detail, excerpt: detail, why: detail, hay: "raw", start: 0, end: 0 });
  const lineCounts = new Map();

  if (registry.schema_version !== 2) add("REGISTRY", "schema_version must be 2", '"schema_version"');
  for (const key of ["released", "claims", "public_files", "nonmarketing_files", "historical_allowlist", "exact_copy_exempt_claims"]) {
    if (!(key in registry)) add("REGISTRY", `missing top-level field ${key}`);
  }
  if (!("candidate" in registry)) add("REGISTRY", "missing top-level field candidate (null when there is none)");

  const rel = registry.released ?? {};
  for (const f of RELEASED_FIELDS) if (!(f in rel)) add("REGISTRY", `released.${f} is missing`, '"released"');
  if (!STATUSES.includes(rel.status)) add("REGISTRY", `released.status "${rel.status}" is not one of ${STATUSES.join(", ")}`, '"status"');
  if (rel.status === "released" || rel.status === "withdrawn") {
    const empty = ["released_at_utc", "t0_lookup_receipt"].filter((f) => !rel[f]);
    if (empty.length) {
      // The removal follows the release: the change to withdrawn goes on a tree whose T0 set-t0.mjs has recorded.
      const fill =
        rel.status === "released"
          ? "on T0 day run node scripts/growth/set-t0.mjs --released-at <ISO> --receipt <lookup URL>, before the switch is merged"
          : "the app is removed only after it is released, so the change to withdrawn goes on a tree where node scripts/growth/set-t0.mjs has recorded T0";
      add("T0_UNRECORDED", `released.status is ${rel.status} but ${empty.join(" and ")} ${empty.length > 1 ? "are" : "is"} empty: ${fill}`, '"status"');
    }
  }
  if (rel.released_at_utc && !isUtcInstant(rel.released_at_utc)) add("REGISTRY", `released.released_at_utc "${rel.released_at_utc}" is not a UTC time (YYYY-MM-DDTHH:MM:SSZ)`, '"released_at_utc"');
  if (rel.t0_lookup_receipt) {
    const problem = lookupProblem(rel.t0_lookup_receipt, String(rel.app_id ?? ""));
    if (problem) add("REGISTRY", `released.t0_lookup_receipt: ${problem}`, '"t0_lookup_receipt"');
  }
  if (rel.status === "withdrawn" && !rel.withdrawn_at_utc) {
    add(
      "WITHDRAWN_UNRECORDED",
      "released.status is withdrawn but withdrawn_at_utc is empty: on the day of the removal run node scripts/growth/set-withdrawn.mjs --withdrawn-at <ISO> --receipt <lookup URL>, which also writes the date into the withdrawn sentences, before the change is merged",
      '"status"',
    );
  }
  if (rel.withdrawn_at_utc) {
    if (!isUtcInstant(rel.withdrawn_at_utc)) add("REGISTRY", `released.withdrawn_at_utc "${rel.withdrawn_at_utc}" is not a UTC time (YYYY-MM-DDTHH:MM:SSZ)`, '"withdrawn_at_utc"');
    else if (rel.status !== "withdrawn") add("REGISTRY", `released.status is ${rel.status} but withdrawn_at_utc is set`, '"withdrawn_at_utc"');
    else {
      const [label, before] = rel.released_at_utc ? ["released_at_utc", rel.released_at_utc] : ["submitted_at_utc", rel.submitted_at_utc];
      if (before && rel.withdrawn_at_utc < String(before)) add("REGISTRY", `released.withdrawn_at_utc ${rel.withdrawn_at_utc} is before ${label} (${before})`, '"withdrawn_at_utc"');
    }
  }
  if (rel.status === "submitted_not_live" && rel.released_at_utc) add("REGISTRY", "released.status is submitted_not_live but released_at_utc is set", '"released_at_utc"');
  if (rel.evidence_level !== undefined && !EVIDENCE_LEVELS.includes(rel.evidence_level)) add("REGISTRY", `released.evidence_level "${rel.evidence_level}" is not one of ${EVIDENCE_LEVELS.join(", ")}`);
  if (rel.checked_at !== undefined && !DATE.test(rel.checked_at)) add("REGISTRY", "released.checked_at is not YYYY-MM-DD");
  for (const ref of [rel.evidence_ref ?? []].flat()) {
    const problem = checkEvidenceRef(ref, root, lineCounts);
    if (problem) add("EVIDENCE_REF", `released: ${ref}: ${problem}`, JSON.stringify(ref).slice(1, -1));
  }

  const ids = new Set();
  for (const [i, c] of (registry.claims ?? []).entries()) {
    const id = c?.claim_id ?? `#${i}`;
    const needle = `"claim_id": "${id}"`;
    for (const f of CLAIM_FIELDS) if (!(f in (c ?? {}))) add("REGISTRY", `claim ${id}: ${f} is missing`, needle);
    if (!/^[a-z][a-z0-9_]*$/.test(String(c?.claim_id))) add("REGISTRY", `claim ${id}: claim_id must be snake_case`, needle);
    if (ids.has(id)) add("REGISTRY", `claim ${id}: claim_id is not unique`, needle);
    ids.add(id);
    if (!EVIDENCE_LEVELS.includes(c.evidence_level)) add("REGISTRY", `claim ${id}: evidence_level "${c.evidence_level}" is not one of ${EVIDENCE_LEVELS.join(", ")}`, needle);
    if (!PUBLIC_USES.includes(c.public_use)) add("REGISTRY", `claim ${id}: public_use "${c.public_use}" is not one of ${PUBLIC_USES.join(", ")}`, needle);
    if ("retired_copy" in c && (!Array.isArray(c.retired_copy) || !c.retired_copy.every((x) => typeof x === "string" && x.trim()))) add("REGISTRY", `claim ${id}: retired_copy must be a list of sentences`, needle);
    if (!DATE.test(String(c.checked_at))) add("REGISTRY", `claim ${id}: checked_at is not YYYY-MM-DD`, needle);
    if (!Array.isArray(c.limitations) || !c.limitations.includes(GENERAL_LIMITATION)) add("REGISTRY", `claim ${id}: limitations must include the general limitation`, needle);
    const forms = ["allowed_copy", "allowed_copy_by_status", "allowed_copy_variants"].filter((k) => k in c);
    if (forms.length !== 1) add("REGISTRY", `claim ${id}: exactly one of allowed_copy, allowed_copy_by_status, allowed_copy_variants`, needle);
    if ("allowed_copy" in c && (typeof c.allowed_copy !== "string" || !c.allowed_copy.trim())) add("REGISTRY", `claim ${id}: allowed_copy must be a sentence`, needle);
    if (c.allowed_copy_by_status) {
      const keys = Object.keys(c.allowed_copy_by_status);
      if (!keys.includes("submitted_not_live")) add("REGISTRY", `claim ${id}: allowed_copy_by_status needs submitted_not_live`, needle);
      for (const k of keys) if (!STATUSES.includes(k)) add("REGISTRY", `claim ${id}: allowed_copy_by_status key "${k}" is not a status`, needle);
    }
    if ("allowed_copy_zh" in c && (typeof c.allowed_copy_zh !== "string" || !c.allowed_copy_zh.trim())) add("REGISTRY", `claim ${id}: allowed_copy_zh must be a sentence`, needle);
    if ("allowed_copy_zh_extra" in c && (!Array.isArray(c.allowed_copy_zh_extra) || !c.allowed_copy_zh_extra.every((x) => typeof x === "string" && x.trim()))) {
      add("REGISTRY", `claim ${id}: allowed_copy_zh_extra must be a list of sentences`, needle);
    }
    if (c.allowed_copy_zh_by_status) {
      // The Chinese follows the English status by status: a status the English does not word has no Chinese either.
      const keys = Object.keys(c.allowed_copy_zh_by_status);
      if (!c.allowed_copy_by_status) add("REGISTRY", `claim ${id}: allowed_copy_zh_by_status needs allowed_copy_by_status`, needle);
      if (!keys.includes("submitted_not_live")) add("REGISTRY", `claim ${id}: allowed_copy_zh_by_status needs submitted_not_live`, needle);
      for (const k of keys) if (!(k in (c.allowed_copy_by_status ?? {}))) add("REGISTRY", `claim ${id}: allowed_copy_zh_by_status key "${k}" is not a status of allowed_copy_by_status`, needle);
    }
    for (const key of ["allowed_copy_extra_by_status", "allowed_copy_zh_extra_by_status"]) {
      if (!(key in c)) continue;
      const map = c[key];
      if (!map || typeof map !== "object" || Array.isArray(map)) {
        add("REGISTRY", `claim ${id}: ${key} must map a status to a list of sentences`, needle);
        continue;
      }
      for (const [k, list] of Object.entries(map)) {
        if (!STATUSES.includes(k)) add("REGISTRY", `claim ${id}: ${key} key "${k}" is not a status`, needle);
        if (!Array.isArray(list) || !list.length || !list.every((x) => typeof x === "string" && x.trim())) add("REGISTRY", `claim ${id}: ${key}.${k} must be a list of sentences`, needle);
      }
    }
    if (c.allowed_copy_variants) {
      const keys = Object.keys(c.allowed_copy_variants);
      if (!Array.isArray(c.in_use) || !c.in_use.length || c.in_use.some((k) => !keys.includes(k))) add("REGISTRY", `claim ${id}: in_use must name variants of allowed_copy_variants`, needle);
    }
    if (!Array.isArray(c.evidence_ref) || c.evidence_ref.length === 0) add("REGISTRY", `claim ${id}: evidence_ref must be a non-empty array`, needle);
    for (const ref of c.evidence_ref ?? []) {
      const problem = checkEvidenceRef(ref, root, lineCounts);
      if (problem) add("EVIDENCE_REF", `claim ${id}: ${ref}: ${problem}`, JSON.stringify(ref).slice(1, -1), needle);
    }
  }
  for (const id of registry.exact_copy_exempt_claims ?? []) if (!ids.has(id)) add("REGISTRY", `exact_copy_exempt_claims names an unknown claim ${id}`, '"exact_copy_exempt_claims"');

  const registered = [];
  for (const entry of registry.public_files ?? []) {
    if (entry.glob) {
      if (!entry.discovery) registered.push(globToRegExp(entry.glob));
      continue;
    }
    const [file, fragment] = String(entry.path).split("#");
    registered.push(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    const abs = path.join(root, file);
    if (!existsSync(abs)) {
      if (!entry.reserved) add("PUBLIC_FILE_MISSING", `public file ${entry.path} does not exist`, `"${entry.path}"`);
      continue;
    }
    if (fragment === "public-claims" && markdownDocument(readFileSync(abs, "utf8"), { section: true }).markersMissing) {
      add("PUBLIC_CLAIMS_MARKERS", `${file} needs exactly one ${MARKER_START} … ${MARKER_END} section`, `"${entry.path}"`);
    }
  }
  for (const entry of registry.nonmarketing_files ?? []) {
    if (!entry.reason) add("REGISTRY", `nonmarketing file ${entry.path} needs a reason`, `"${entry.path}"`);
    registered.push(new RegExp(`^${String(entry.path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  }
  const patterns = [...new Set([...SURFACE_PATTERNS, ...(registry.public_files ?? []).filter((e) => e.glob && e.discovery).map((e) => e.glob)])];
  for (const file of [...new Set(patterns.flatMap((g) => expandGlob(root, g, { dot: SURFACE_DOT_DIRS.has(g) })))]) {
    if (!registered.some((re) => re.test(file))) add("UNREGISTERED_SURFACE", `${file} is public by its path but is not in public_files or nonmarketing_files`);
  }

  for (const [k, e] of (registry.historical_allowlist ?? []).entries()) {
    const label = `historical_allowlist[${k}]`;
    if (!e.file || !e.text || !Array.isArray(e.rules) || !e.rules.length || !e.reason) add("EXEMPTION_INVALID", `${label} needs file, text, rules and reason`, e.text);
    for (const r of e.rules ?? []) if (!RULE_IDS.includes(r)) add("EXEMPTION_INVALID", `${label}: unknown rule ${r}`, e.text);
    for (const s of e.statuses ?? []) if (!STATUSES.includes(s)) add("EXEMPTION_INVALID", `${label}: unknown status ${s}`, e.text);
    if (e.file && !existsSync(path.join(root, e.file))) add("EXEMPTION_INVALID", `${label}: ${e.file} does not exist`, e.text);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// A whole run
// ---------------------------------------------------------------------------------------------------------------

/** The registered public files that exist, each with how it is read. */
export function registeredFiles(registry, root = DEFAULT_ROOT) {
  const out = new Map();
  for (const entry of registry.public_files ?? []) {
    if (entry.glob) {
      for (const file of expandGlob(root, entry.glob)) if (!out.has(file)) out.set(file, { file, section: false });
      continue;
    }
    const [file, fragment] = String(entry.path).split("#");
    if (existsSync(path.join(root, file))) out.set(file, { file, section: fragment === "public-claims" });
  }
  return [...out.values()];
}

/** Every *.html and *.txt a built site serves, in any directory (.well-known/ included). */
export function distFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && e.name !== "node_modules") walk(child);
      else if (e.isFile() && /\.(?:html?|txt)$/i.test(e.name)) out.push(child);
    }
  };
  walk("");
  return out.sort();
}

/**
 * Run the gate. `t0MergeCheck` makes a T0_UNRECORDED finding fail like any other; without it the finding is returned
 * in `deferred`, not in `findings`.
 * @param {{ root?: string, registryPath?: string, status?: string, dist?: string, files?: string[], registry?: object, t0MergeCheck?: boolean }} options
 */
export function validate(options = {}) {
  const root = path.resolve(options.root ?? DEFAULT_ROOT);
  const registryPath = path.resolve(root, options.registryPath ?? "growth/product-facts.json");
  const registryText = options.registry ? JSON.stringify(options.registry, null, 2) : readFileSync(registryPath, "utf8");
  const registry = options.registry ?? JSON.parse(registryText);
  const ctx = scanContext(registry, { status: options.status, root });
  const display = (abs) => {
    const r = path.relative(process.cwd(), abs);
    return r && !r.startsWith("..") ? r.split(path.sep).join("/") : abs;
  };
  const drafts = options.files ?? [];
  const docs = [];
  let registryFindings = [];
  if (drafts.length === 0) {
    registryFindings = checkRegistry(registry, { root, registryFile: display(registryPath), registryText });
    for (const { file, section } of registeredFiles(registry, root)) {
      docs.push(documentFor(readFileSync(path.join(root, file), "utf8"), { file, logical: file, section }));
    }
    // A file public by its path but not registered is still read (UNREGISTERED_SURFACE says why separately).
    const known = new Set(docs.map((d) => d.logical));
    for (const glob of SURFACE_PATTERNS) {
      for (const file of expandGlob(root, glob, { dot: SURFACE_DOT_DIRS.has(glob) })) {
        if (!known.has(file) && !(registry.nonmarketing_files ?? []).some((e) => e.path === file)) {
          known.add(file);
          docs.push(documentFor(readFileSync(path.join(root, file), "utf8"), { file, logical: file }));
        }
      }
    }
  }
  for (const draft of drafts) {
    const abs = path.resolve(draft);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const logical = rel.startsWith("..") ? abs : rel;
    docs.push(documentFor(readFileSync(abs, "utf8"), { file: display(abs), logical }));
  }
  if (options.dist) {
    const dir = path.resolve(options.dist);
    for (const rel of distFiles(dir)) {
      const abs = path.join(dir, rel);
      docs.push(documentFor(readFileSync(abs, "utf8"), { file: display(abs), logical: `sites/landing/${rel}`, dist: true }));
    }
  }
  const all = docs.flatMap((doc) => scanDocument(doc, ctx));
  const allowlist = registry.historical_allowlist ?? [];
  const { findings, used } = applyExemptions(all, allowlist, new Map(docs.map((d) => [d.file, d])), ctx.status);
  const unused = [];
  if (drafts.length === 0) {
    allowlist.forEach((entry, k) => {
      if (used[k] > 0) return;
      if (entry.statuses && !entry.statuses.includes(ctx.status)) return;
      unused.push({
        rule: "EXEMPTION_UNUSED",
        file: display(registryPath),
        logical: "growth/product-facts.json",
        line: lineOfText(registryText, JSON.stringify(String(entry.text)).slice(1, -1)),
        match: entry.text,
        excerpt: `${entry.file}: ${entry.text}`,
        why: "an exemption that matches nothing is stale: remove it",
        hay: "raw",
        start: 0,
        end: 0,
      });
    });
  }
  const order = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule) || a.start - b.start;
  const isDeferred = (f) => !options.t0MergeCheck && DEFERRED_RULE_IDS.includes(f.rule);
  const reported = [...registryFindings, ...findings, ...unused];
  const result = reported.filter((f) => !isDeferred(f)).sort(order);
  const deferred = reported.filter(isDeferred).sort(order);
  const counts = Object.fromEntries([...REGISTRY_RULE_IDS, ...RULE_IDS].map((id) => [id, 0]));
  for (const f of result) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
  return {
    status: ctx.status,
    registryStatus: registry.released?.status,
    files: docs.map((d) => d.file),
    findings: result,
    deferred,
    counts,
    exemptions: allowlist.map((e, k) => ({ file: e.file, text: e.text, rules: e.rules, used: used[k] })),
  };
}

function lineOfText(text, needle) {
  const i = needle ? text.indexOf(needle) : -1;
  return i < 0 ? 1 : text.slice(0, i).split("\n").length;
}

export function formatFinding(f) {
  return `${f.rule} ${f.file}:${f.line} ${JSON.stringify(f.excerpt)}`;
}

export function summaryLines(result) {
  const nonzero = Object.entries(result.counts).filter(([, n]) => n > 0);
  const counts = Object.entries(result.counts)
    .map(([id, n]) => `${id}=${n}`)
    .join(" ");
  const usedCount = result.exemptions.filter((e) => e.used > 0).length;
  const deferred = result.deferred ?? [];
  const lines = [
    `public-claims: status=${result.status}${result.status !== result.registryStatus ? ` (registry: ${result.registryStatus})` : ""} files=${result.files.length} findings=${result.findings.length} exemptions used=${usedCount}/${result.exemptions.length}${nonzero.length ? "" : " (clean)"}`,
    `public-claims: rules ${counts}`,
  ];
  if (deferred.length) {
    const byRule = new Map();
    for (const f of deferred) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    const tally = [...byRule].map(([id, n]) => `${id}=${n}`).join(" ");
    lines.push(`public-claims: deferred ${tally} (not failing: the T0 merge check, T0_MERGE_CHECK=1 or --t0-merge-check, fails on it)`);
  }
  lines.push(`public-claims: scanned ${result.files.join(", ")}`);
  return lines;
}

const USAGE = `usage: node scripts/growth/validate-public-claims.mjs [--dist <dir>] [--status submitted|released|withdrawn]
       [--file <path>]... [--registry <path>] [--root <dir>] [--json] [--t0-merge-check]`;

/**
 * @param {string[]} argv
 * @returns {{ files: string[], dist?: string, status?: string, registryPath?: string, root?: string, json?: boolean, help?: boolean, t0MergeCheck?: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ files: string[], dist?: string, status?: string, registryPath?: string, root?: string, json?: boolean, help?: boolean, t0MergeCheck?: boolean }} */
  const opts = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--dist") opts.dist = value();
    else if (a === "--status") opts.status = normalizeStatus(value());
    else if (a === "--file") opts.files.push(value());
    else if (a === "--registry") opts.registryPath = value();
    else if (a === "--root") opts.root = value();
    else if (a === "--json") opts.json = true;
    else if (a === "--t0-merge-check") opts.t0MergeCheck = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/**
 * @param {string[]} argv
 * @param {{ log: (s: string) => void, error: (s: string) => void }} io
 * @param {Record<string, string | undefined>} env  T0_MERGE_CHECK=1 turns the T0 merge check on, as --t0-merge-check does
 */
export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }, env = process.env) {
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
  if (env.T0_MERGE_CHECK === "1") opts.t0MergeCheck = true;
  let result;
  try {
    result = validate(opts);
  } catch (error) {
    io.error(`public-claims: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
  const bare = ({ hay: _h, start: _s, end: _e, ...f }) => f;
  if (opts.json) io.log(JSON.stringify({ ...result, findings: result.findings.map(bare), deferred: result.deferred.map(bare) }, null, 2));
  else {
    for (const f of result.findings) io.log(formatFinding(f));
    for (const f of result.deferred) io.log(`DEFERRED ${formatFinding(f)}`);
    for (const line of summaryLines(result)) io.log(line);
  }
  return result.findings.length ? 1 : 0;
}

/**
 * Run as a script, however it was reached: Node resolves this module's own path through symlinks (on macOS /tmp is
 * one), so both sides are compared as real paths. A gate that silently did nothing would pass.
 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main();
