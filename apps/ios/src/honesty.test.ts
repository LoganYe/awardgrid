/**
 * The one lie this product must not tell, enforced by CI rather than by discipline.
 *
 * `docs/PIVOT.md` §3: "Never print a next-run time. Print 'last checked 2 h ago' … Promising a cadence
 * the OS will not honour is the one lie this product must not tell." iOS gives an app no mechanism that
 * runs on a schedule, so any UI string that promises a cadence is false the moment it ships.
 *
 * Three rules, over the shell's source and the landing page:
 *
 *   1. No user-visible string may promise a cadence or a next run — in English or Chinese.
 *   2. No declared name may encode a schedule (`nextRunAt`, `dueAt`, `scheduleCron`). A value that does
 *      not exist cannot be rendered by mistake.
 *   3. While no background check is built (./watch/capabilities.ts), nothing may claim one.
 *
 * Strings are read from the TypeScript AST rather than by grepping source. This repo's comments DISCUSS
 * the banned phrases at length ("the web app renders a Next run column"), and a grep would flag the
 * explanation of the rule as a violation. They are also read the way a user reads them: a template
 * literal is joined across its interpolations (`every ${n} hours` reads "every {x} hours"), and JSX text
 * is joined across inline tags (`Next <strong>check</strong>` reads "Next check"). A first version split
 * both, so a sentence could pass in pieces.
 *
 * The deny-list targets PROMISE forms, not topics. The landing page honestly says "No guaranteed
 * schedule"; "1,000 calls per day", 每天允许 and "Resets at {time}" are quota facts. The self-tests pin
 * both directions against the web app's own dictionaries (`packages/core/src/lib/i18n/dictionaries`),
 * by key, so a copy change there is noticed here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { en } from "@awardgrid/core/i18n/dictionaries/en";
import { zh } from "@awardgrid/core/i18n/dictionaries/zh";
import { COPY, type CopyKey } from "@awardgrid/core/workspace/present";

const SHELL_SRC = path.join(import.meta.dirname);
const CORE_WATCH = path.join(import.meta.dirname, "..", "..", "..", "packages", "core", "src", "lib", "watch");
// Ask's system prompt, tool descriptions and failure copy are string literals in core, not in the shell. A
// person reads the copy, and the model repeats what the prompt and the tools tell it, so both are scanned.
const CORE_ASK = path.join(import.meta.dirname, "..", "..", "..", "packages", "core", "src", "lib", "ask");
const LANDING = path.join(import.meta.dirname, "..", "..", "..", "sites", "landing", "index.html");
/** Every page of the static site (release D7): the landing page, the privacy policy and the support page. */
const SITE_PAGES = ["index.html", "privacy/index.html", "support/index.html"].map((page) => path.join(path.dirname(LANDING), page));

/**
 * Phrases that promise a cadence or a next run. Each names the string it was derived from. `{x}` is how
 * an interpolation reads after extraction, and `{hours}` how a dictionary placeholder reads, so a count
 * is `\d+` or `\{\w+\}` throughout.
 */
const CADENCE_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  // ---- English ----
  { re: /\bnext\s+(?:run|check|refresh|update|sync|fetch|scan|poll|alert|digest|attempt|execution|trigger)s?\b/i, why: 'saved.next_run "Next run"' },
  { re: /^\s*(?:schedule|frequency|cadence|interval|repeats?|recurrence)\s*:?\s*(?:\{\w+\})?\s*$/i, why: 'saved.schedule "Schedule" — as a label, the word is the promise' },
  { re: /\bon\s+(?:(?:a|an|its|their|your|the)\s+)?(?:\w+\s+)?schedule\b/i, why: 'saved.subtitle "on its schedule" / saved.disabled_hint "run on schedule"' },
  { re: /\b(?:regular|fixed|set|chosen|custom|hourly|daily|weekly)\s+(?:cadence|schedule|interval)s?\b/i, why: 'saved.schedule.custom "custom schedule ({expr})"' },
  {
    re: /\bschedul(?:ed|ing)\s+(?:checks?|runs?|refresh(?:es)?|scans?|searches|alerts?|digests?|tasks?|jobs?)\b|\bschedule\s+(?:a|an|the|your|it|this|checks?|runs?)\b|\b(?:runs?|checks?|refresh(?:es)?)\s+(?:are|is)\s+scheduled\b|\bscheduled\s+(?:for|at)\b/i,
    why: "a scheduled run, or the time one is scheduled for",
  },
  {
    re: /\bevery\s+(?:(?:\d+|\{\w+\}|few|couple\s+of|other|one|two|three|four|five|six|eight|twelve)\s*-?\s*)?(?:minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|wks?|months?|nights?|mornings?|evenings?|afternoons?|weekdays?|weekends?)\b/i,
    why: 'saved.schedule.every_hours "every {hours} hours"',
  },
  { re: /\beach\s+(?:minute|hour|day|week|month|night|morning|evening)\b/i, why: '"each morning" and its kin' },
  { re: /\b(?:hourly|nightly|weekly|fortnightly|monthly)\b/i, why: 'saved.schedule.hourly "hourly"' },
  // "daily" alone is a cadence ("daily at 08:00"); "daily limit" and "daily calls" are quota facts.
  { re: /\bdaily\b(?!\s+(?:limit|quota|cap|allowance|budget|calls?|usage|reset|maximum|max)\b)/i, why: 'saved.schedule.daily "daily at {time}"' },
  { re: /\b(?:periodic(?:ally)?|regularly|continuous(?:ly)?|constantly|around\s+the\s+clock|round[- ]the[- ]clock|24\s*\/\s*7)\b/i, why: "a frequency adverb promises a cadence" },
  {
    re: /\b(?:once|twice|thrice|(?:\d+|\{\w+\}|a\s+few|several)\s*(?:times|x))\s+(?:a|an|per|each|every)\s+(?:minute|hour|day|week|month|night)\b/i,
    why: 'error.cron_too_frequent "at most once an hour"',
  },
  // "calls per day" is a quota fact; only a verb that runs something makes it a cadence.
  { re: /\b(?:checks?|runs?|refresh(?:es)?|polls?|scans?|syncs?)\s+(?:per|an?|each)\s+(?:minute|hour|day|week)\b/i, why: '"two checks a day"' },
  // A cadence word must come first, so "Resets at {time}" stays a quota fact.
  {
    re: /\b(?:daily|every\s+(?:day|morning|evening|night|weekday)|each\s+day|checks?|runs?|refresh(?:es)?|polls?|syncs?|scans?)\s+at\s+(?:\{\w+\}|\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?|noon|midnight)/i,
    why: 'saved.dialog.preset.daily_08 "Daily at 08:00"',
  },
  // The verb must sit right before "in", so "expires in 15 minutes" and "Try again in a few minutes" pass.
  {
    re: /\b(?:checks?|checking|runs?|running|refresh(?:es|ing)?|polls?|scans?|syncs?|updates?)\s+(?:again\s+)?in\s+(?:about\s+|~\s*|under\s+)?(?:\d+|\{\w+\}|an?|a\s+few|few)\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i,
    why: 'a countdown, "refreshing in 5 minutes"',
  },
  { re: /\b(?:due\s+(?:now|soon|in|at|by|next)|overdue)\b/i, why: 'saved.due_now "due now"' },
  { re: /\bcron(?:tab)?s?\b/i, why: 'saved.dialog.preset.custom "Custom cron"' },
  {
    re: /(?:^|[\s(])(?=[\d*/,\- ]*\*)(?:\*|\d{1,2})(?:[/,-]\d{1,2})*(?:\s+(?:\*|\d{1,2})(?:[/,-]\d{1,2})*){4}(?=$|[\s)])/,
    why: 'saved.dialog.custom_cron_invalid "0 */4 * * *"',
  },
  { re: /\b(?:keeps?|will\s+keep)\s+(?:checking|watching|monitoring)\b|\breal[- ]time\s+(?:alerts?|monitoring|checks?)\b/i, why: '"keeps watching" promises continuity' },
  // "It will check your watches when you open the app" is honest; only a run without the user is not.
  {
    re: /\bwill\s+(?:check|run|refresh|re-?run)\s+(?:again\s+)?(?:automatically|soon|later|shortly|periodically|regularly)\b/i,
    why: '"will check again soon"',
  },
  { re: /\bauto[-\s]?refresh(?:es|ing)?\b/i, why: "an auto-refresh control implies a reliable cadence" },
  { re: /\bstanding\s+quer(?:y|ies)\b/i, why: 'saved.title "Standing queries" — the web app\'s feature name, whose zh is 定时查询' },
  // ---- Chinese ----
  { re: /下一?次\s*(?:运行|检查|查看|刷新|更新|同步|获取|扫描|执行|提醒|通知)/, why: 'saved.next_run "下次运行"' },
  { re: /定时/, why: 'saved.title "定时查询" — 定时 means "on a timer"; the feature name itself is the promise' },
  { re: /(?<!请求|调用|访问)频率/, why: 'saved.schedule "频率" / saved.disabled_hint "不会按频率运行"' },
  {
    re: /每隔?\s*(?:\d+|\{\w+\}|[一二两三四五六七八九十百半几]+)?\s*个?\s*(?:分钟|小时|钟头|天|日|周|星期|礼拜|月|晚|早上|早晨|夜)(?!\s*(?:上限|额度|限额|配额|允许|限制|可用|调用|最多可))/,
    why: 'saved.schedule.every_hours "每 {hours} 小时"; 每天允许 and 每日上限 are quota facts',
  },
  {
    re: /(?:一|每)(?:天|日|小时|周|星期|月)\s*(?:\d+|[一二两三四五六七八九十几]+)\s*次(?!\s*(?:调用|API))|(?:\d+|\{\w+\}|[一二两三四五六七八九十百半几]+)\s*个?\s*(?:小时|分钟|天)\s*一次/,
    why: 'saved.dialog.custom_cron "最多每小时一次"',
  },
  { re: /定期|周期性|按计划|按时间表|按时(?!间|区)/, why: '"定期" means periodically' },
  {
    re: /已?到了?(?:运行|检查|刷新|更新|同步|执行)时间|(?:即将|将于|将在|预计[于在]?)[^。；！？\n]{0,12}?(?:运行|检查|查看|刷新|同步|执行)/,
    why: 'saved.due_now "已到运行时间"; ask.budget "将于 {resetAt} 重置" is a quota fact',
  },
  {
    re: /(?:\d+|\{\w+\}|[一二两三四五六七八九十百半几]+)\s*(?:秒|分钟|个?小时|天)钟?后\s*[再将会]?\s*(?:运行|检查|刷新|更新|同步|执行)/,
    why: 'a countdown; "15 分钟后失效" is not one',
  },
  { re: /(?:继续|持续|一直|不断)(?:检查|监控|刷新|关注)|实时监控/, why: '"持续关注" promises continuity' },
];

/**
 * Declared names that encode a schedule, matched on the name as lower-case words, so `nextRunAt`,
 * `NEXT_RUN_AT` and `#nextRunAt` all read `next_run_at`. Only declarations are checked: calling a
 * plugin's `.schedule()` or `Array.every` is not storing a schedule.
 */
const SCHEDULE_NAME = new RegExp(
  "(?:^|_)(?:" +
    [
      "cron(?:tab|job)?s?",
      "schedul(?:e|es|ed|ing)(?=$|_(?:at|for|in|cron|expr|expression|label|text|time|date|kind|shape|preset|spec|config|interval|every|minutes?|hours?|id)(?:_|$))",
      "schedulers?",
      "cadences?",
      "recurr(?:ence|ing|ent)",
      "periodic(?:ally|ity)?",
      "frequenc(?:y|ies)",
      "hourly",
      "nightly",
      "weekly",
      "monthly",
      "daily(?!_(?:soft_|hard_)?(?:limit|quota|cap|calls?|budget|allowance|usage|reset|max))",
      "next_(?:run|check|refresh|fetch|sync|poll|scan|fire|tick|execution|attempt|due|trigger|wake|job|update|alert)s?",
      "is_due",
      "overdue",
      "due_(?:at|in|by|date|time|next|soon|now)",
      "(?:run|check|refresh|sync|watch|background|bg)_(?:every|interval|frequency|period|cadence)",
      "every_(?:\\d+|n|minutes?|hours?|days?|weeks?|mins?|hrs?|h|d)",
      "interval_(?:minutes?|mins?|hours?|hrs?|days?)",
      "countdown",
      "time_until",
      "until_next",
    ].join("|") +
    ")(?:_|$)",
);

function nameWords(name: string): string {
  return name
    .replace(/^#/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\-$.]+/)
    .filter(Boolean)
    .join("_");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function sourceFiles(dir: string): string[] {
  return walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
}

interface Located {
  text: string;
  line: number;
}

interface Extracted {
  strings: Located[];
  names: Located[];
  imports: string[];
}

/** Tags a sentence runs through. Any other element starts a new block of text. */
const INLINE_TAGS = new Set(["a", "abbr", "b", "code", "em", "i", "kbd", "mark", "small", "span", "strong", "sub", "sup", "time"]);

const ENTITIES: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };

/** TypeScript leaves JSX entities raw (`seats.aero&apos;s`); a reader sees them decoded. One pass, so `&amp;#39;` stays `&#39;`. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] !== "#") return ENTITIES[ref.toLowerCase()] ?? match;
    const code = ref.charAt(1).toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

const templateText = (t: ts.TemplateExpression): string => t.head.text + t.templateSpans.map((s) => `{x}${s.literal.text}`).join("");

function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  return ts.forEachChild(node, (child) => containsJsx(child) || undefined) ?? false;
}

/** The text of one JSX block: inline children joined into it, block-level children read on their own. */
function jsxBlocks(children: ts.NodeArray<ts.JsxChild>, sf: ts.SourceFile): string[] {
  const blocks: string[] = [];
  let buffer = "";
  const flush = () => {
    const text = decodeEntities(buffer).replace(/\s+/g, " ").trim();
    if (text) blocks.push(text);
    buffer = "";
  };
  const read = (kids: ts.NodeArray<ts.JsxChild>) => {
    for (const kid of kids) {
      if (ts.isJsxText(kid)) {
        buffer += kid.text;
      } else if (ts.isJsxExpression(kid)) {
        const e = kid.expression;
        if (!e) continue; // {/* a comment */}
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) buffer += e.text;
        else if (ts.isTemplateExpression(e)) buffer += templateText(e);
        else if (containsJsx(e)) flush(); // conditional markup is read where it is written
        else buffer += "{x}";
      } else if (ts.isJsxElement(kid) && INLINE_TAGS.has(kid.openingElement.tagName.getText(sf))) {
        read(kid.children);
      } else {
        flush();
      }
    }
  };
  read(children);
  flush();
  return blocks;
}

function isDeclaredName(node: ts.Identifier | ts.PrivateIdentifier | ts.StringLiteral): boolean {
  const p = node.parent;
  if (ts.isPrivateIdentifier(node)) return true;
  // A literal type ("checked_recently") or a quoted key is a name, not copy.
  if (ts.isStringLiteral(node)) return ts.isLiteralTypeNode(p) || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === node);
  if (ts.isShorthandPropertyAssignment(p)) return true;
  return (
    (ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isBindingElement(p) ||
      ts.isTypeParameterDeclaration(p)) &&
    p.name === node
  );
}

/** User-visible text, declared names and module paths from one file, via the AST. Comments are never visited. */
function extract(file: string, code = readFileSync(file, "utf8")): Extracted {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const out: Extracted = { strings: [], names: [], imports: [] };
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const isModulePath =
        ts.isImportDeclaration(p) ||
        ts.isExportDeclaration(p) ||
        (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent));
      if (isModulePath) out.imports.push(node.text);
      else if (ts.isStringLiteral(node) && isDeclaredName(node)) out.names.push({ text: node.text, line: lineOf(node) });
      else out.strings.push({ text: node.text, line: lineOf(node) });
    } else if (ts.isTemplateExpression(node)) {
      out.strings.push({ text: templateText(node), line: lineOf(node) });
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const readByParent =
        ts.isJsxElement(node) &&
        INLINE_TAGS.has(node.openingElement.tagName.getText(sf)) &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent));
      if (!readByParent) for (const text of jsxBlocks(node.children, sf)) out.strings.push({ text, line: lineOf(node) });
    } else if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && isDeclaredName(node)) {
      out.names.push({ text: node.text, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const landingHtml = () => readFileSync(LANDING, "utf8");

/** What a reader sees on each page of the static site, with the page it is on. */
const siteTexts = () =>
  SITE_PAGES.flatMap((file) => landingTexts(readFileSync(file, "utf8")).map((text) => ({ page: path.relative(path.dirname(LANDING), file), text })));

/** What a reader of the landing page sees, block by block, plus the attributes a browser or a search result shows. */
function landingTexts(html = landingHtml()): string[] {
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  const shown = [...markup.matchAll(/\s(?:content|alt|title|aria-label|placeholder)\s*=\s*"([^"]*)"/gi)].map((m) => m[1] ?? "");
  const blocks = markup.replace(/<\/?(?:a|abbr|b|code|em|i|kbd|mark|small|span|strong|sub|sup|time)\b[^>]*>/gi, "").split(/<[^>]*>/);
  return [...blocks, ...shown].map((t) => decodeEntities(t).replace(/\s+/g, " ").trim()).filter(Boolean);
}

function cadenceHits(text: string): string[] {
  return CADENCE_PATTERNS.filter(({ re }) => re.test(text)).map(({ re, why }) => `${re} (${why})`);
}

/** A dictionary key's text in both languages, for `it.each`. */
const byLanguage = (keys: ReadonlyArray<keyof typeof en>) =>
  keys.flatMap((key) => [
    { lang: "en", key, text: en[key] },
    { lang: "zh", key, text: zh[key] },
  ]);

describe("no cadence is ever promised", () => {
  const files = [...sourceFiles(SHELL_SRC), ...sourceFiles(CORE_WATCH), ...sourceFiles(CORE_ASK)];

  it("scans a real amount of source, so an empty glob cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(landingTexts().length).toBeGreaterThan(10);
    for (const file of SITE_PAGES) expect(landingTexts(readFileSync(file, "utf8")).length, file).toBeGreaterThan(10);
  });

  it("no user-visible string in the shell, the watch module or the Ask module promises a cadence", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const { text, line } of extract(file).strings) {
        for (const hit of cadenceHits(text)) {
          offenders.push(`${path.relative(SHELL_SRC, file)}:${line} ${JSON.stringify(text)} matches ${hit}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no declared name encodes a schedule", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const { text, line } of extract(file).names) {
        if (SCHEDULE_NAME.test(nameWords(text))) offenders.push(`${path.relative(SHELL_SRC, file)}:${line} ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no page of the static site (landing, privacy policy, support) promises a cadence", () => {
    expect(siteTexts().flatMap(({ page, text }) => cadenceHits(text).map((hit) => `${page} ${JSON.stringify(text)} matches ${hit}`))).toEqual([]);
  });

  it("no page of the static site has a script, so its markup is everything a reader can see", () => {
    for (const file of SITE_PAGES) expect(readFileSync(file, "utf8"), file).not.toMatch(/<script\b/i);
  });

  it("the shell renders no translated strings, which this test could not see", () => {
    // t("saved.next_run") contains no banned words; the dictionary value it renders does. When the shell
    // gains i18n, scan en[key] and zh[key] for every key it renders before letting this pass.
    const translating = files.filter((file) => extract(file).imports.some((m) => /(^|\/)i18n(\/|$)/.test(m)));
    expect(translating.map((f) => path.relative(SHELL_SRC, f))).toEqual([]);
  });
});

describe("the deny-list is precise in both directions", () => {
  // The web app's schedule copy, by key: every one must be caught in both languages.
  const CADENCE_KEYS = [
    "saved.title",
    "saved.subtitle",
    "saved.disabled_hint",
    "saved.next_run",
    "saved.card.next_run",
    "saved.due_now",
    "saved.schedule",
    "saved.schedule.every_hours",
    "saved.schedule.hourly",
    "saved.schedule.daily",
    "saved.schedule.custom",
    "saved.dialog.preset.every_3h",
    "saved.dialog.preset.daily_08",
    "saved.dialog.preset.custom",
    "saved.dialog.custom_cron",
    "saved.dialog.custom_cron_invalid",
    "error.cron_too_frequent",
  ] as const satisfies ReadonlyArray<keyof typeof en>;

  // The web app's time and quota copy that states a fact rather than a cadence: all must pass.
  const HONEST_KEYS = [
    "settings.quota.hint",
    "quota.tooltip.reset",
    "settings.telegram.instruction",
    "grid.cell.not_fetched_quota",
    "saved.dialog.quota_hint",
    "ask.budget",
  ] as const satisfies ReadonlyArray<keyof typeof en>;

  it.each(byLanguage(CADENCE_KEYS))("catches $lang $key", ({ text }) => {
    expect(cadenceHits(text), `${JSON.stringify(text)} slipped past the deny-list`).not.toEqual([]);
  });

  it.each(byLanguage(HONEST_KEYS))("allows $lang $key", ({ text }) => {
    expect(cadenceHits(text)).toEqual([]);
  });

  // Paraphrases a copywriter or translator would reach for, beyond the dictionaries.
  const MUST_CATCH = [
    "It checks every 3 hours.",
    "Checks your watches regularly",
    "twice a day",
    "two checks a day",
    "each morning",
    "a weekly digest",
    "Refreshes weekly",
    "checks periodically",
    "Runs at {time}",
    "Checks daily at 9am",
    "Refreshing in 5 minutes",
    "We will check again soon",
    "Keeps watching your routes",
    "real-time alerts",
    "Schedule:",
    "Your next check",
    "scheduled checks",
    "下一次检查",
    "每隔 3 小时",
    "定期检查",
    "3 小时后检查",
    "即将刷新",
    "持续关注这条航线",
  ];

  // Honest sentences that talk ABOUT schedules without promising one, or state a fact about time.
  const MUST_ALLOW = [
    "No guaranteed schedule",
    "iOS cannot promise to run anything on a cadence, so awardgrid does not claim one.",
    "last checked 2 h ago",
    "Last checked 3 min ago",
    "Checks when you open the app",
    "Each watch is checked when you open the app, and at no other time.",
    "It will check your watches when you open the app.",
    "Award results are cached on this device for 45 minutes so repeating a search costs no seats.aero calls.",
    "skipping keeps your daily calls for your own searches",
    "the daily limit",
    "1,000 calls per day",
    "Resets at 00:00 UTC",
    "Resets in 3 hours",
    "Try again in a few minutes",
    "Check back in a minute",
    "seats.aero calls today: 12 of 950",
    "Served from this device's cache",
    "next 30 days",
    "Every search runs on your own key",
    // Ask's Stop, spend and pause copy (design §8.1), worded to fit the scan rather than the scan loosened.
    "Stop sends nothing more. It cannot recall a request already sent.",
    "Stopped. Nothing more will be sent for this question. The request already sent to Anthropic still finishes and may be billed.",
    "Your Anthropic organization has reached its spend limit.",
    "Paused while you were away from awardgrid.",
    "上次查看：2 小时前",
    "打开应用时查看",
    "几分钟后再试",
  ];

  it.each(MUST_CATCH)("catches %j", (phrase) => {
    expect(cadenceHits(phrase), `${JSON.stringify(phrase)} slipped past the deny-list`).not.toEqual([]);
  });

  it.each(MUST_ALLOW)("allows %j", (phrase) => {
    expect(cadenceHits(phrase)).toEqual([]);
  });

  it("the name rule bans schedule names but not the watch module's own names", () => {
    const bad = [
      "nextRunAt", "next_run_at", "NEXT_RUN_AT", "#nextRunAt", "nextCheck", "nextCheckAt", "dueAt", "due_at", "isDue",
      "scheduleCron", "schedule_cron", "schedule", "scheduledAt", "ScheduleShape", "cron", "cronExpr", "describeCron",
      "DEFAULT_CRON", "checkIntervalMinutes", "refreshEvery", "everyHours", "recurring", "cadence", "dailyAt",
      "NextRunInfo", "backgroundInterval", "watchFrequency",
    ];
    const good = [
      "dueForCheck", "DueOptions", "checked_recently", "lastCheckedAt", "lastAttemptAt", "sinceLastCheck", "next",
      "nextWindow", "nextMonth", "every", "ttlMinutes", "elapsedMinutes", "#dailyLimit", "SEATS_AERO_DAILY_SOFT_LIMIT",
      "readTimeout", "setInterval", "resetAt", "last_run_at", "residueAt", "acronym", "BGAppRefreshTask",
      "scheduleClose", "schedulePersist", "POLL_INTERVAL_MS", "checkWatches", "WATCH_CHECKS",
    ];
    expect(bad.filter((n) => !SCHEDULE_NAME.test(nameWords(n)))).toEqual([]);
    expect(good.filter((n) => SCHEDULE_NAME.test(nameWords(n)))).toEqual([]);
  });

  it("reads strings from the AST, so a comment that discusses a banned phrase is not a violation", () => {
    const code = [
      "// The web app renders a Next run column and runs every 3 hours; we must not.",
      "/* 下次运行 is the zh string we are avoiding */",
      'export const label = "last checked 2 h ago";',
    ].join("\n");
    const { strings } = extract("virtual.ts", code);
    expect(strings.map((s) => s.text)).toEqual(["last checked 2 h ago"]);
    expect(strings.flatMap((s) => cadenceHits(s.text))).toEqual([]);
  });

  it("joins a template literal across its interpolations", () => {
    const { strings } = extract("virtual.ts", "export const s = (n: number) => `Checks every ${n} hours`;");
    expect(strings.map((s) => s.text)).toEqual(["Checks every {x} hours"]);
    expect(strings.flatMap((s) => cadenceHits(s.text))).not.toEqual([]);
  });

  it("joins JSX text across inline tags, splits it at block tags, and decodes entities", () => {
    const code = [
      "export const A = (cond: boolean) => (",
      "  <section>",
      "    <p>Next <strong>check</strong> in 2 h</p>",
      "    <p>seats.aero&apos;s data, {/* not copy */} last checked</p>",
      "    {cond ? <span>every day</span> : null}",
      "  </section>",
      ");",
    ].join("\n");
    const texts = extract("virtual.tsx", code).strings.map((s) => s.text);
    expect(texts).toEqual(expect.arrayContaining(["Next check in 2 h", "seats.aero's data, last checked", "every day"]));
    expect(texts).not.toContain("check"); // the inline tag was read as part of its sentence, not alone
  });

  it("checks declared names only: a schedule a plugin exposes may be called, not stored", () => {
    const code = [
      "class Store { #nextRunAt = 0; #dailyLimit = 950; }",
      "const every = [1, 2].every((n) => n > 0);",
      "LocalNotifications.schedule({});",
      'type Unit = "minute" | "hour";',
    ].join("\n");
    const flagged = extract("virtual.ts", code).names.filter((n) => SCHEDULE_NAME.test(nameWords(n.text)));
    expect(flagged.map((n) => n.text)).toEqual(["#nextRunAt"]);
  });

  it("reads the landing page's attributes, not only its text", () => {
    const html = '<meta name="description" content="Checks every 3 hours"><p>No <em>guaranteed</em> schedule</p>';
    expect(landingTexts(html)).toEqual(["No guaranteed schedule", "Checks every 3 hours"]);
  });
});

describe("no background check is claimed while none is built", () => {
  /*
   * A CLAIM, not a mention. "There is no background check" is the honest sentence and must pass;
   * "and in the background when the system allows" is what the landing page said before Phase 4
   * found there would be no background check, and must fail. Negations are let through by a
   * lookbehind on no / not / never (没有 / 不 / 无 in Chinese).
   */
  const BACKGROUND_CLAIM: RegExp[] = [
    /\bin\s+the\s+background\b/i,
    /(?<!\bno\s)(?<!\bnot\s)(?<!\bnever\s)\bbackground\s+(?:refresh|check|update|sync)(?:es|s|ing)?\b/i,
    /\bwhen\s+(?:the\s+system|iOS|the\s+OS)\s+allows\b/i,
    // Reaching the user when something changes needs a check that runs without them.
    /(?<!\b(?:not|never|cannot|can't|won't)\s)\b(?:notif(?:y|ies)|alerts?|messages?|pings?|emails?)\s+you\s+(?:when|as\s+soon\s+as|the\s+moment)\b/i,
    /\b(?:get|be)\s+notified\s+(?:when|as\s+soon\s+as|the\s+moment)\b/i,
    // The same promise without the word "notify". Ask's copy and prompt must never make it; an answer that does
    // gets a note from core/ask/guard.ts, because model output is not scanned here.
    /\b(?:I|we)(?:'ll|\s+will)\s+let\s+you\s+know\s+(?:when|as\s+soon\s+as|if)\b/i,
    /(?<!没有)(?<!不)(?<!无)后台(?:查看|检查|刷新|运行|更新)/,
    /(?<!不)(?:时|就|会|将)(?:通知|提醒)(?:你|您)/,
  ];
  const claims = (text: string) => BACKGROUND_CLAIM.filter((re) => re.test(text)).map(String);

  it("the shell and the landing page make no background claim unless one is built", async () => {
    const { WATCH_CHECKS } = await import("./watch/capabilities");
    expect(WATCH_CHECKS.onOpen).toBe(true);
    if (WATCH_CHECKS.inBackground) return; // a background check that exists may be described

    const offenders: string[] = [];
    for (const file of [...sourceFiles(SHELL_SRC), ...sourceFiles(CORE_WATCH), ...sourceFiles(CORE_ASK)]) {
      for (const { text, line } of extract(file).strings) {
        for (const c of claims(text)) offenders.push(`${path.relative(SHELL_SRC, file)}:${line} ${JSON.stringify(text)} matches ${c}`);
      }
    }
    for (const { page, text } of siteTexts()) {
      for (const c of claims(text)) offenders.push(`sites/landing/${page} ${JSON.stringify(text)} matches ${c}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the approved rows the shell renders through copy() are scanned too, in both languages (T11)", () => {
    // copy("key", locale) renders core COPY's sentence; the scan above sees only the key. Every call's key is read
    // from the source, and must be a literal, so no row reaches the screen unscanned.
    const keys = new Set<string>();
    const dynamic: string[] = [];
    for (const file of sourceFiles(SHELL_SRC)) {
      const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "copy" && node.arguments.length > 0) {
          const arg = node.arguments[0]!;
          if (ts.isStringLiteralLike(arg)) keys.add(arg.text);
          else dynamic.push(`${path.relative(SHELL_SRC, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(dynamic).toEqual([]);
    expect(keys.size).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const key of keys) {
      const row = COPY[key as CopyKey];
      expect(row, `copy("${key}") has no approved row`).toBeDefined();
      for (const lang of ["en", "zh"] as const) {
        const text = row[lang];
        for (const hit of [...cadenceHits(text), ...claims(text)]) offenders.push(`${key} (${lang}) ${JSON.stringify(text)} matches ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the copy() scan would catch a scheduled-check row if the shell rendered one", () => {
    // COPY holds the web's scheduled-check rows; they must fail the scan the moment the shell renders them.
    for (const key of ["watch.scheduled_only", "watch.scheduled_with_push"] as const) {
      const row = COPY[key as CopyKey];
      if (!row) continue;
      expect([...cadenceHits(row.en), ...claims(row.en), ...cadenceHits(row.zh), ...claims(row.zh)], key).not.toEqual([]);
    }
  });

  it.each([
    "It checks when you open it, and in the background when the system allows.", // the pre-Phase-4 landing sentence
    "Checks in the background when iOS allows", // PIVOT §3's original sanctioned line, now untrue
    "It checks for changes when iOS allows",
    "Background refresh keeps your watches current",
    "We'll alert you when prices drop",
    "We'll let you know when a seat opens",
    "Get notified as soon as a seat opens",
    "应用会在后台检查",
    "后台刷新",
    "有新座位时通知你",
  ])("catches the claim %j", (phrase) => {
    expect(claims(phrase)).not.toEqual([]);
  });

  // The web app can message you when seats appear, because it has a server; this app cannot.
  it.each(byLanguage(["saved.dialog.save_body"]))("catches the claim in $lang $key", ({ text }) => {
    expect(claims(text)).not.toEqual([]);
  });

  it.each([
    "There is no background check.",
    "No background refresh.",
    "awardgrid cannot notify you when a seat opens.",
    "Shows error messages when the key is missing",
    "There is no background check, so a change is found the next time you open the app, not when it happens.",
    "Paused while you were away from awardgrid.",
    "没有后台检查",
    "打开应用时才会看到变化",
  ])("allows %j", (phrase) => {
    expect(claims(phrase)).toEqual([]);
  });
});
