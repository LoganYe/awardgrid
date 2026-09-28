#!/usr/bin/env node
/**
 * FAQPage JSON-LD, written from the questions a page shows. Structured data has to say what a visitor reads on the
 * page, and the usual way that breaks is someone editing a visible answer and forgetting the JSON-LD beside it. So the
 * JSON-LD is generated from the page's own FAQ markup rather than kept by hand. (A port of Restful's
 * tool/aso/sync_faq_schema.py, which read its questions from a React component; these pages are static HTML.)
 *
 *   node scripts/growth/sync-faq-schema.mjs --check [page.html ...]   exit 1 when a page's FAQPage is not its FAQ
 *   node scripts/growth/sync-faq-schema.mjs --write [page.html ...]   rewrite the FAQPage of every page that differs
 *   options: --root <dir>   the repository root (default: this script's). Without pages, every index.html under
 *                           <root>/sites/landing is read (build output, dependencies, public/, test/ and scripts/ aside)
 *
 * Exit 0 when every page is in sync (or has been written), 1 when a page is not, or its FAQ does not follow the
 * convention below (one line each: `FAQ_SCHEMA file: reason`, `FAQ_MARKUP file:line: reason`), 2 on a usage error.
 * A summary line is always printed, so a CI log shows the check ran. sites/landing/test/faq.test.ts runs --check on
 * every page that has an FAQ, and on the whole site.
 *
 * The convention, the one way a page marks up the questions it answers:
 *
 *   <section class="faq" data-faq aria-labelledby="questions-h">
 *     <h2 id="questions-h">Questions</h2>
 *     <h3>The question?</h3>
 *     <p>The answer.</p>
 *     <p>A second paragraph of the same answer, if it needs one.</p>
 *     <h3>The next question?</h3>
 *     <p>Its answer.</p>
 *   </section>
 *
 * - The section carries data-faq, the class "faq", and an aria-labelledby that names an id on the page.
 * - Before its first <h3> it may hold its heading (an <h2>) and <p>s that introduce it; they belong to no answer.
 * - From the first <h3> on it holds only questions, each an <h3>, and answers, each the one or more <p> after its <h3>.
 *   Nothing else: no list, table, <div>, wrapper or nested section, so no visible answer text can be left out.
 * - Inside an <h3> or a <p>, only inline markup (a link, <em>, <strong>, <code>, <span>, <br> ...); every element
 *   closed; no `hidden`.
 * - A page may hold more than one such section; their questions make one FAQPage, in page order.
 *
 * What is written: one node {"@type": "FAQPage", "@id": "<the page's canonical URL>#faq", "inLanguage": <the page's
 * <html lang>>, "isPartOf": {"@id": <the page's WebSite node>}, "mainEntity": [Question ...]}. A Question's name is its
 * <h3>'s text; its acceptedAnswer's text is its paragraphs' text, joined by a blank line; a Question whose section is
 * in another language than the page (the section's own lang, or that of the <section> around it) carries that
 * inLanguage. Text is what a reader sees: tags read through, a <br> read as a space, entities decoded, whitespace
 * collapsed. The node goes into the @graph of the page's first JSON-LD block that has one; a page with no @graph gets a
 * <script type="application/ld+json"> block of its own. A page without data-faq carries no FAQPage, so removing a
 * page's FAQ removes its JSON-LD too. The block the node goes into is written whole: two-space indents, an object that
 * holds only "@id" on one line (the pages' hand-written style), and every "<" in a string escaped as the JSON escape
 * for U+003C, so no string can close the script or open a comment.
 *
 * The parser is strict, and a guard that does not share its blind spots backs it: the <h3>s and <p>s of each section
 * are also counted by a plain pattern, and a section whose count and parse disagree fails instead of shipping a
 * partial FAQPage (the failure this script exists to prevent is an answer silently left out).
 *
 * Node built-ins only.
 */
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The static site's directory, relative to the repository root. */
export const SITE_DIR = path.join("sites", "landing");
/** Directories of the site that hold no page source. */
const NOT_SOURCE = new Set(["dist", "node_modules", "public", "test", "scripts"]);
export const USAGE = "usage: node scripts/growth/sync-faq-schema.mjs --check|--write [--root <dir>] [page.html ...]";

/** Named character references a page is likely to use, decoded to what a reader sees. An unknown one is an error. */
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", shy: "\u00ad", zwj: "\u200d", zwnj: "\u200c",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", hyphen: "\u2010", dash: "\u2010", ndash: "\u2013", mdash: "\u2014",
  minus: "\u2212", lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201a", ldquo: "\u201c", rdquo: "\u201d", bdquo: "\u201e",
  laquo: "\u00ab", raquo: "\u00bb", lsaquo: "\u2039", rsaquo: "\u203a", hellip: "\u2026", middot: "\u00b7",
  bull: "\u2022", times: "\u00d7", divide: "\u00f7", plusmn: "\u00b1", le: "\u2264", ge: "\u2265", rarr: "\u2192",
  larr: "\u2190", harr: "\u2194", copy: "\u00a9", reg: "\u00ae", trade: "\u2122", deg: "\u00b0", euro: "\u20ac",
  pound: "\u00a3", yen: "\u00a5", cent: "\u00a2", sect: "\u00a7", para: "\u00b6", frac12: "\u00bd",
};
/** A tag: its slash, its name, and its attribute text (a `>` inside a quoted value stays in it). */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^'">]|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
/** The markup an <h3> or a <p> may hold: inline elements whose text a reader sees as it is written. */
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr"]);
/** HTML's whitespace (not U+00A0: a no-break space is text). */
const SPACE = /[\t\n\f\r ]+/g;
const JSON_LD_SCRIPT = /<script\b((?:[^'">]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;

/** A page whose FAQ does not follow the convention, at `offset` in it. */
export class FaqMarkupError extends Error {
  /** @param {string} message @param {number} offset */
  constructor(message, offset) {
    super(message);
    this.name = "FaqMarkupError";
    this.offset = offset;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------------------------------------------

/** The attributes of an opening tag's attribute text, by lower-case name; the first of a repeated name wins. */
export function attributes(text) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const m of String(text).matchAll(ATTRIBUTE)) {
    const name = m[1].toLowerCase();
    if (!found.has(name)) found.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return found;
}

/** The same text with every character of `re`'s matches but the line breaks turned into spaces: offsets hold. */
const blankOut = (text, re) => text.replace(re, (m) => m.replace(/[^\n]/g, " "));

/** The page with its comments blanked (a commented-out question is not on the page). */
const withoutComments = (html) => blankOut(html, /<!--[\s\S]*?-->/g);

/** Also blank what <script> and <style> hold, so markup-like text in them is never read as the page's markup. */
const scanText = (noComments) =>
  noComments.replace(/(<(script|style)\b(?:[^'">]|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/\2\s*>)/gi, (_m, open, _name, body, close) => open + body.replace(/[^\n]/g, " ") + close);

/** The 1-based line of `offset` in `text`. */
export const lineAt = (text, offset) => text.slice(0, Math.max(0, offset)).split("\n").length;

/** `text` with its character references decoded; an unknown named one throws (at `offset`). */
function decodeEntities(text, offset) {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
      throw new FaqMarkupError(`${m} is not a character`, offset);
    }
    const named = ENTITIES[/** @type {keyof typeof ENTITIES} */ (ref.toLowerCase())];
    if (named === undefined) throw new FaqMarkupError(`${m} is a character reference this script does not know; write the character itself`, offset);
    return named;
  });
}

/** The text a reader sees in inline markup: tags read through, a <br> a space, entities decoded, whitespace collapsed. */
export function visibleText(markup, offset = 0) {
  const text = decodeEntities(markup.replace(/<br\b(?:[^'">]|"[^"]*"|'[^']*')*>/gi, " ").replace(TAG, ""), offset);
  return text.replace(SPACE, " ").replace(/^ | $/g, "");
}

/**
 * Every data-faq section of a page (read from `scan`, the page with comments, scripts and styles blanked): where its
 * content starts and ends, and its opening tag's attributes. Throws on data-faq anywhere but a <section>, on a data-faq
 * section inside another, and on one that is never closed.
 */
function faqSections(scan) {
  const sections = [];
  const open = [];
  for (const m of scan.matchAll(TAG)) {
    const name = m[2].toLowerCase();
    if (!m[1]) {
      const attrs = attributes(m[3]);
      if (attrs.has("data-faq") && name !== "section") throw new FaqMarkupError(`data-faq is on a <${name}>; it goes on the <section> that holds the questions`, m.index);
      if (name !== "section") continue;
      const faq = attrs.has("data-faq");
      if (faq && open.some((s) => s.faq)) throw new FaqMarkupError("a data-faq section inside another one", m.index);
      const lang = attrs.get("lang")?.trim() || open[open.length - 1]?.lang || null;
      open.push({ start: m.index, innerStart: m.index + m[0].length, faq, attrs, lang });
    } else if (name === "section") {
      const section = open.pop();
      if (section?.faq) sections.push({ ...section, innerEnd: m.index });
    }
  }
  const unclosed = open.find((s) => s.faq);
  if (unclosed) throw new FaqMarkupError("the data-faq section is never closed", unclosed.start);
  return sections;
}

/**
 * The guard: the questions and answer paragraphs a section holds, counted by a plain pattern rather than by the
 * parser (`inner` is the section's content, comments blanked). Throws when the count and the parse disagree.
 * @param {string} inner
 * @param {Array<{ paragraphs: string[] }>} items
 * @param {number} offset
 */
export function guardCount(inner, items, offset = 0) {
  const first = inner.search(/<h3\b/i);
  const questions = (inner.match(/<h3\b/gi) ?? []).length;
  const paragraphs = first < 0 ? 0 : (inner.slice(first).match(/<p\b/gi) ?? []).length;
  const parsed = items.reduce((n, item) => n + item.paragraphs.length, 0);
  if (questions !== items.length || paragraphs !== parsed) {
    throw new FaqMarkupError(
      `parsed ${items.length} questions with ${parsed} answer paragraphs, but the section contains ${questions} <h3> and ${paragraphs} <p> from its first question on; ` +
        "a question or an answer is written in a way the parser does not read. Fix the parser rather than ship a partial FAQPage.",
      offset,
    );
  }
}

/**
 * The questions of one data-faq section, in order: `{ question, answer }`, the answer its paragraphs joined by a blank
 * line. Throws a FaqMarkupError (with the offset in the page) on anything the convention does not allow.
 */
function sectionQuestions(scan, section, ids, pageLang) {
  const cls = (section.attrs.get("class") ?? "").split(/\s+/);
  if (!cls.includes("faq")) throw new FaqMarkupError('the data-faq section needs class="faq"', section.start);
  const label = (section.attrs.get("aria-labelledby") ?? "").trim();
  if (!label) throw new FaqMarkupError("the data-faq section needs an aria-labelledby that names its heading", section.start);
  for (const id of label.split(/\s+/)) if (!ids.has(id)) throw new FaqMarkupError(`aria-labelledby names "${id}", and no element on the page has that id`, section.start);

  const base = section.innerStart;
  const inner = scan.slice(base, section.innerEnd);
  /** @type {Array<{ question: string, paragraphs: string[], offset: number }>} */
  const items = [];
  const tags = new RegExp(TAG.source, "g");
  let pos = 0;
  for (;;) {
    tags.lastIndex = pos;
    const m = tags.exec(inner);
    const between = inner.slice(pos, m ? m.index : inner.length);
    if (between.trim()) {
      const at = base + pos + between.search(/\S/);
      throw new FaqMarkupError(`text outside a question or an answer: "${between.trim().slice(0, 60)}"; put it in a <p>`, at);
    }
    if (!m) break;
    const at = base + m.index;
    const name = m[2].toLowerCase();
    if (m[1]) throw new FaqMarkupError(`</${name}> with no <${name}> open in the FAQ`, at);
    const allowed = items.length ? ["h3", "p"] : ["h2", "h3", "p"];
    if (!allowed.includes(name)) {
      const rule = items.length
        ? "after the first question the FAQ holds only questions (<h3>) and their answers (<p>)"
        : "before the first question the FAQ holds only its heading (<h2>) and <p>s that introduce it";
      throw new FaqMarkupError(`<${name}> in the FAQ: ${rule}`, at);
    }
    if (attributes(m[3]).has("hidden")) throw new FaqMarkupError(`a hidden <${name}> in the FAQ: the FAQPage says only what a reader sees`, at);
    const close = new RegExp(`</${name}\\s*>`, "gi");
    close.lastIndex = m.index + m[0].length;
    const c = close.exec(inner);
    if (!c) throw new FaqMarkupError(`<${name}> is never closed; write its </${name}>`, at);
    const content = inner.slice(m.index + m[0].length, c.index);
    const contentAt = at + m[0].length;
    for (const t of content.matchAll(TAG)) {
      const child = t[2].toLowerCase();
      if (!INLINE.has(child)) throw new FaqMarkupError(`<${child}> inside an FAQ <${name}>: only inline markup (a link, <em>, <strong>, <code>, <span>, <br> ...) goes there`, contentAt + t.index);
      if (!t[1] && attributes(t[3]).has("hidden")) throw new FaqMarkupError(`a hidden <${child}> in the FAQ: the FAQPage says only what a reader sees`, contentAt + t.index);
    }
    const text = visibleText(content, contentAt);
    if (name === "h3") {
      if (!text) throw new FaqMarkupError("an empty question", at);
      items.push({ question: text, paragraphs: [], offset: at });
    } else if (name === "p" && items.length) {
      if (!text) throw new FaqMarkupError("an empty paragraph in an answer", at);
      items[items.length - 1].paragraphs.push(text);
    }
    pos = c.index + c[0].length;
  }
  if (!items.length) throw new FaqMarkupError("the data-faq section holds no question (<h3>)", section.start);
  for (const item of items) if (!item.paragraphs.length) throw new FaqMarkupError(`"${item.question}" has no answer: write it as one or more <p> after the <h3>`, item.offset);
  guardCount(inner, items, section.start);
  const lang = section.lang && section.lang.toLowerCase() !== (pageLang ?? "").toLowerCase() ? section.lang : null;
  return items.map((item) => ({ question: item.question, answer: item.paragraphs.join("\n\n"), ...(lang ? { lang } : {}) }));
}

/** The page's language, its <html lang>, or null. */
function pageLanguage(scan) {
  const html = /<html\b((?:[^'">]|"[^"]*"|'[^']*')*)>/i.exec(scan);
  return (html && attributes(html[1]).get("lang")?.trim()) || null;
}

/**
 * The questions a page shows, in page order, from every data-faq section (an empty list when it has none). A
 * question carries `lang` when its section's language (its own lang, or that of the section around it) is not the
 * page's.
 * @param {string} html
 * @returns {Array<{ question: string, answer: string, lang?: string }>}
 */
export function extractFaq(html) {
  const scan = scanText(withoutComments(html));
  const sections = faqSections(scan);
  if (!sections.length) return [];
  const ids = new Set();
  for (const m of scan.matchAll(TAG)) if (!m[1]) for (const [name, value] of attributes(m[3])) if (name === "id" && value) ids.add(value);
  const lang = pageLanguage(scan);
  return sections.flatMap((section) => sectionQuestions(scan, section, ids, lang));
}

// ---------------------------------------------------------------------------------------------------------------
// The JSON-LD
// ---------------------------------------------------------------------------------------------------------------

/** A string as written into the block: JSON, with `<` escaped so no `</script` or `<!--` can appear. */
const jsonString = (s) => JSON.stringify(s).replace(/</g, "\\u003c");

/**
 * A JSON value in the pages' hand-written style: two-space indents from `indent`, one member per line, an object
 * whose only member is "@id" on one line. The first line carries no indent (it follows whatever precedes it).
 * @param {unknown} value
 * @param {string} indent
 * @returns {string}
 */
export function formatJson(value, indent = "") {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    if (entries.length === 1 && entries[0][0] === "@id" && typeof entries[0][1] === "string") return `{ "@id": ${jsonString(entries[0][1])} }`;
    return `{\n${entries.map(([k, v]) => `${inner}${jsonString(k)}: ${formatJson(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  if (typeof value === "string") return jsonString(value);
  return JSON.stringify(value) ?? "null";
}

/**
 * The FAQPage node for a page's questions: in the page's language when it has one, and a question in another
 * language (its section's) says so.
 * @param {Array<{ question: string, answer: string, lang?: string }>} entries
 * @param {{ pageUrl: string, websiteId?: string | null, language?: string | null, context?: boolean }} where
 */
export function faqPageNode(entries, { pageUrl, websiteId = null, language = null, context = false }) {
  /** @type {Record<string, unknown>} */
  const node = {};
  if (context) node["@context"] = "https://schema.org";
  node["@type"] = "FAQPage";
  node["@id"] = `${pageUrl}#faq`;
  if (language) node.inLanguage = language;
  if (websiteId) node.isPartOf = { "@id": websiteId };
  node.mainEntity = entries.map(({ question, answer, lang }) => ({
    "@type": "Question",
    ...(lang ? { inLanguage: lang } : {}),
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  }));
  return node;
}

const typesOf = (node) => [node?.["@type"]].flat().filter((t) => typeof t === "string");
const isNode = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isFaqPage = (v) => isNode(v) && typesOf(v).includes("FAQPage");

/** Every object inside a JSON value, the value itself included. */
function nodesIn(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => nodesIn(v, out));
  else if (isNode(value)) {
    out.push(value);
    Object.values(value).forEach((v) => nodesIn(v, out));
  }
  return out;
}

/**
 * The page's JSON-LD blocks: where each is, the indentation of its line (null when other markup shares the line),
 * whether it is alone on its lines, and its parsed value.
 */
function jsonLdBlocks(html, noComments) {
  const blocks = [];
  for (const m of noComments.matchAll(JSON_LD_SCRIPT)) {
    const attrs = attributes(m[1]);
    if (attrs.has("src") || (attrs.get("type") ?? "").trim().toLowerCase() !== "application/ld+json") continue;
    const start = m.index;
    const end = start + m[0].length;
    const contentStart = start + `<script${m[1]}>`.length;
    const contentEnd = contentStart + m[2].length;
    const lineStart = html.lastIndexOf("\n", start - 1) + 1;
    const lead = html.slice(lineStart, start);
    const indent = /^[ \t]*$/.test(lead) ? lead : null;
    const newline = html.indexOf("\n", end);
    const lineEnd = newline < 0 ? html.length : newline + 1;
    const alone = indent !== null && /^[ \t]*\r?\n?$/.test(html.slice(end, lineEnd));
    const block = { start, end, contentStart, contentEnd, indent, lineStart, lineEnd, alone, value: /** @type {unknown} */ (undefined) };
    try {
      block.value = JSON.parse(html.slice(contentStart, contentEnd));
    } catch (error) {
      throw new FaqMarkupError(`a JSON-LD block does not parse: ${error instanceof Error ? error.message : error}`, start);
    }
    blocks.push(block);
  }
  return blocks;
}

/** A block's content, as written: the value on its own lines, indented one step from the <script> tag. */
const blockContent = (value, indent) => `\n${indent}  ${formatJson(value, `${indent}  `)}\n${indent}`;

/** The canonical URL a page gives itself, or null. */
function canonicalOf(scan) {
  for (const m of scan.matchAll(TAG)) {
    if (m[1] || m[2].toLowerCase() !== "link") continue;
    const attrs = attributes(m[3]);
    if ((attrs.get("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical") && attrs.get("href")) return attrs.get("href") ?? null;
  }
  return null;
}

/** Why the page's FAQPage is not the one its FAQ makes, for a person to read. */
function driftReason(existing, expected, entries) {
  if (!expected) return `the page has no data-faq section but its JSON-LD has ${existing.length === 1 ? "an FAQPage" : `${existing.length} FAQPage nodes`}`;
  if (!existing.length) return `the page shows ${entries.length} questions and has no FAQPage JSON-LD`;
  if (existing.length > 1) return `${existing.length} FAQPage nodes; a page carries one`;
  const have = Array.isArray(existing[0].mainEntity) ? existing[0].mainEntity : [];
  if (have.length !== entries.length) return `FAQPage lists ${have.length} questions; the page shows ${entries.length}`;
  for (let i = 0; i < entries.length; i++) {
    const q = have[i];
    if (q?.name !== entries[i].question) return `question ${i + 1}: the page asks ${JSON.stringify(entries[i].question)}, FAQPage has ${JSON.stringify(q?.name)}`;
    if (q?.acceptedAnswer?.text !== entries[i].answer) return `question ${i + 1} (${JSON.stringify(entries[i].question)}): FAQPage's answer is not the page's`;
  }
  return "FAQPage's other members, its place (it goes in the page's @graph when there is one) or its formatting differ from what --write writes";
}

/**
 * One page, synced: the page as --write leaves it, the questions it shows, and, when the page changed, why.
 * Throws a FaqMarkupError when its FAQ breaks the convention, its JSON-LD does not parse, or it has an FAQ and no
 * canonical link.
 * @param {string} html
 * @returns {{ html: string, entries: Array<{ question: string, answer: string }>, reason: string | null }}
 */
export function syncPage(html) {
  const noComments = withoutComments(html);
  const scan = scanText(noComments);
  const entries = extractFaq(html);
  const blocks = jsonLdBlocks(html, noComments);
  const existing = blocks.flatMap((b) => nodesIn(b.value)).filter(isFaqPage);
  if (!entries.length && !existing.length) return { html, entries, reason: null };

  let expected = null;
  if (entries.length) {
    const pageUrl = canonicalOf(scan);
    if (!pageUrl) throw new FaqMarkupError('the page has an FAQ and no <link rel="canonical">; the FAQPage\'s @id is the canonical URL', 0);
    const website = blocks.flatMap((b) => nodesIn(b.value)).find((n) => typesOf(n).includes("WebSite") && typeof n["@id"] === "string");
    expected = { pageUrl, websiteId: website ? /** @type {string} */ (website["@id"]) : null, language: pageLanguage(scan) };
  }

  // Where the node goes: the first block with a @graph; else the first block that holds nothing but FAQPage (the
  // node's own block, rewritten where it is); else a new block.
  const graphBlock = blocks.find((b) => isNode(b.value) && Array.isArray(b.value["@graph"]));
  const onlyFaq = (v) => isFaqPage(v) || (Array.isArray(v) && v.length > 0 && v.every(isFaqPage));
  const slotBlock = graphBlock ? null : blocks.find((b) => onlyFaq(b.value));

  /** @type {Array<{ start: number, end: number, text: string }>} */
  const edits = [];
  for (const block of blocks) {
    const indent = block.indent ?? "";
    if (block === slotBlock) {
      if (expected) edits.push({ start: block.contentStart, end: block.contentEnd, text: blockContent(faqPageNode(entries, { ...expected, context: true }), indent) });
      else edits.push(block.alone ? { start: block.lineStart, end: block.lineEnd, text: "" } : { start: block.start, end: block.end, text: "" });
      continue;
    }
    if (onlyFaq(block.value)) {
      edits.push(block.alone ? { start: block.lineStart, end: block.lineEnd, text: "" } : { start: block.start, end: block.end, text: "" });
      continue;
    }
    if (nodesIn(block.value).some((n) => n !== block.value && isFaqPage(n) && !(Array.isArray(block.value) ? block.value : block.value?.["@graph"] ?? []).includes(n))) {
      throw new FaqMarkupError("an FAQPage nested inside another JSON-LD node; this script keeps it as a top-level node of the @graph", block.start);
    }
    const value = /** @type {any} */ (block.value);
    if (isNode(value) && Array.isArray(value["@graph"])) {
      // The target block is written whole, even when its node is already right, so --check holds its formatting;
      // any other @graph only loses its FAQPage.
      const graph = value["@graph"];
      const target = block === graphBlock && expected !== null;
      if (!target && !graph.some(isFaqPage)) continue;
      const at = graph.findIndex(isFaqPage);
      const rest = graph.filter((n) => !isFaqPage(n));
      if (target && expected) rest.splice(at < 0 ? rest.length : at, 0, faqPageNode(entries, expected));
      edits.push({ start: block.contentStart, end: block.contentEnd, text: blockContent({ ...value, "@graph": rest }, indent) });
    } else if (Array.isArray(value) && value.some(isFaqPage)) {
      edits.push({ start: block.contentStart, end: block.contentEnd, text: blockContent(value.filter((n) => !isFaqPage(n)), indent) });
    }
  }
  if (expected && !graphBlock && !slotBlock) {
    const last = blocks.filter((b) => !onlyFaq(b.value)).pop();
    if (last) {
      const indent = last.indent ?? "";
      const content = blockContent(faqPageNode(entries, { ...expected, context: true }), indent);
      edits.push({ start: last.end, end: last.end, text: `\n${indent}<script type="application/ld+json">${content}</script>` });
    } else {
      const head = /<\/head\s*>/i.exec(noComments);
      if (!head) throw new FaqMarkupError("the page has an FAQ, no JSON-LD block and no </head> to put one before", 0);
      const lineStart = html.lastIndexOf("\n", head.index - 1) + 1;
      const lead = html.slice(lineStart, head.index);
      const own = /^[ \t]*$/.test(lead);
      const indent = own ? `${lead}  ` : "";
      const script = `<script type="application/ld+json">${blockContent(faqPageNode(entries, { ...expected, context: true }), indent)}</script>`;
      edits.push(own ? { start: lineStart, end: lineStart, text: `${indent}${script}\n` } : { start: head.index, end: head.index, text: script });
    }
  }

  let out = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  const node = expected ? faqPageNode(entries, expected) : null;
  return { html: out, entries, reason: out === html ? null : driftReason(existing, node, entries) };
}

// ---------------------------------------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------------------------------------

/** Every index.html of the site's source under `dir`, sorted (build output, dependencies, public/, test/, scripts/ aside). */
export function sitePages(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return NOT_SOURCE.has(entry.name) || entry.name.startsWith(".") ? [] : sitePages(full);
      return entry.isFile() && entry.name === "index.html" ? [full] : [];
    })
    .sort();
}

/**
 * @param {string[]} argv
 * @returns {{ mode?: "check" | "write", root?: string, files: string[], help?: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ mode?: "check" | "write", root?: string, files: string[], help?: boolean }} */
  const opts = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check" || a === "--write") {
      const mode = a === "--check" ? "check" : "write";
      if (opts.mode && opts.mode !== mode) throw new Error("--check and --write are two different runs; pass one");
      opts.mode = mode;
    } else if (a === "--root") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error("--root needs a value");
      opts.root = v;
    } else if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("-")) throw new Error(`unknown argument ${a}`);
    else opts.files.push(a);
  }
  if (!opts.help && !opts.mode) throw new Error("pass --check or --write");
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
  const root = path.resolve(opts.root ?? DEFAULT_ROOT);
  let files;
  try {
    files = opts.files.length ? opts.files.map((f) => path.resolve(f)) : sitePages(path.join(root, SITE_DIR));
    for (const file of files) if (!statSync(file).isFile()) throw new Error(`${file} is not a file`);
  } catch (error) {
    io.error(`sync-faq-schema: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
  if (!files.length) {
    io.error(`sync-faq-schema: no index.html under ${path.join(root, SITE_DIR)}`);
    return 2;
  }
  const shown = (file) => path.relative(root, file).split(path.sep).join("/") || file;
  const withFaq = [];
  let questions = 0;
  let markup = 0;
  let stale = 0;
  let written = 0;
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    let result;
    try {
      result = syncPage(html);
    } catch (error) {
      if (!(error instanceof FaqMarkupError)) throw error;
      io.error(`FAQ_MARKUP ${shown(file)}:${lineAt(html, error.offset)}: ${error.message}`);
      markup++;
      continue;
    }
    if (result.entries.length) {
      withFaq.push(`${shown(file)} (${result.entries.length})`);
      questions += result.entries.length;
    }
    if (result.html === html) continue;
    if (opts.mode === "check") {
      io.error(`FAQ_SCHEMA ${shown(file)}: ${result.reason}`);
      stale++;
    } else {
      writeFileSync(file, result.html);
      io.log(`sync-faq-schema: wrote ${shown(file)} (${result.entries.length ? `${result.entries.length} questions` : "FAQPage removed: no data-faq section"})`);
      written++;
    }
  }
  if (stale) io.error("Run: node scripts/growth/sync-faq-schema.mjs --write");
  const outcome = opts.mode === "check" ? `out of date=${stale}` : `written=${written}`;
  io.log(`sync-faq-schema --${opts.mode}: pages=${files.length} with an FAQ=${withFaq.length} questions=${questions} ${outcome} markup errors=${markup}${stale || markup ? "" : " (in sync)"}`);
  io.log(`sync-faq-schema: FAQ on ${withFaq.length ? withFaq.join(", ") : "no page"}`);
  return stale || markup ? 1 : 0;
}

/**
 * Run as a script, however it was reached: Node resolves this module's own path through symlinks (on macOS /tmp is
 * one), so both sides are compared as real paths. A check that silently did nothing would pass.
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
