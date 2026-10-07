/**
 * The App Store build's wording (3.1.1 remediation, plan step 15), enforced on the source it is made from.
 *
 * Nothing the App Store build can show may sell, unlock or upgrade anything, name a paid plan, call cached data live,
 * or name Ask, Claude, Anthropic, the AI entry or the AI it does not use ("No AI"): the store build has no Ask
 * (src/app/flags.ts STORE), so a note that it does not use AI only points at a feature it has not got; and the account
 * a person connects only changes where results come from. Two deny-lists, PAID and ASK below, in English and Chinese.
 *
 * What is scanned:
 *   - every string the shell's store-reachable source can show — the files src/main.tsx reaches through the imports
 *     that build keeps (test-support/store-graph.ts), read the way honesty.test.ts reads copy
 *     (test-support/source-strings.ts), leaving out what sits in a branch the build compiles out;
 *   - the approved rows (core present.ts COPY) those files render through copy("key"), in both languages.
 *
 * Allowed, each with its reason: the modules of AppServices.ask, which the store build still constructs and never
 * opens (SERVICE_ONLY), and single strings in ALLOWED. scripts/check-store-bundle.mjs checks the bundle itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { COPY, type CopyKey } from "@awardgrid/core/workspace/present";
import { extract } from "./test-support/source-strings";
import { STORE_CONSTANTS, deadRanges, evaluate, isDead, liveImports, parseSource, storeSources } from "./test-support/store-graph";

const SRC = import.meta.dirname;
const MAIN = path.join(SRC, "main.tsx");

/** A paid plan, a purchase or a subscription, an unlock or an upgrade, or cached data called live. */
const PAID = /\bPro\b|Pro 密钥|subscri|订阅|upgrade|unlock|purchas|\bbuy\b|购买|解锁|付费|\bpaid\b|premium|trial|\blive (?:results|data)\b|实时结果/i;
/** Ask, Claude, Anthropic, the AI entry, or a note that no AI is used (simulator QA, plan step 20). */
const ASK = /\bAsk\b|Anthropic|Claude|AI 对话|AI ?辅助|AI assistance|AI（可选）|AI \(optional\)|\bNo AI\b|不使用 AI/;

/**
 * Modules the store build reaches only to construct AppServices.ask (app/bootstrap.ts), which it never opens: no
 * route, link or screen of Ask is in that build. Their sentences are Ask's own (its refusals, its key check, its
 * prompt's labels) and never reach a screen there; check-store-bundle.mjs confirms that the ones a screen would show
 * are gone from the bundle. Kept so both flavours ship the same npm modules and one licenses list (release plan D3).
 */
const SERVICE_ONLY: Record<string, string> = {
  "ask/ask-service.ts": "AppServices.ask itself: built at launch, never asked a question in the store build.",
  "ask/labels.ts": "Ask's sentences, imported by ask-service.ts for its refusals and key-check results.",
  "ask/context.ts": "What a question carries to Anthropic; ask-service.ts builds it.",
  "ask/seats-port.ts": "Ask's way to search seats.aero; ask-service.ts builds it.",
  "store/ask-store.ts": "Ask's conversation file (ask.json), restored at launch by bootstrap.ts.",
  "native/anthropic-key.ts": "The Anthropic Keychain item bootstrap.ts hands to AppServices.ask; never read in this build.",
};

/** Single strings a store-reachable file may hold, with why each is not a claim the deny-lists are for. */
const ALLOWED: ReadonlyArray<{ file: string; text: string; why: string }> = [];

interface Hit {
  file: string;
  line: number;
  text: string;
  rule: "PAID" | "ASK";
}

const rules = (text: string): Array<Hit["rule"]> => [...(PAID.test(text) ? (["PAID"] as const) : []), ...(ASK.test(text) ? (["ASK"] as const) : [])];

/** The strings a file can show in the store build: everything extract() reads, minus what sits in a dead branch. */
function liveStrings(file: string): Array<{ text: string; line: number }> {
  const code = readFileSync(file, "utf8");
  const dead = deadRanges(parseSource(file));
  return extract(file, code).strings.filter((s) => !dead.some(([from, to]) => s.pos >= from && s.pos < to));
}

/** The copy("key") rows a file renders in the store build (literal keys; honesty.test.ts holds that they are). */
function liveCopyKeys(file: string): string[] {
  const sf = parseSource(file);
  const keys: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "copy" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      if (!isDead(node)) keys.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return keys;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

function storeHits(): { hits: Hit[]; allowedUsed: Set<string>; scanned: string[] } {
  const hits: Hit[] = [];
  const allowedUsed = new Set<string>();
  const scanned: string[] = [];
  for (const file of storeSources(MAIN)) {
    const name = rel(file);
    if (name in SERVICE_ONLY) continue;
    scanned.push(name);
    for (const { text, line } of liveStrings(file)) {
      for (const rule of rules(text)) {
        const allowed = ALLOWED.find((a) => a.file === name && a.text === text);
        if (allowed) allowedUsed.add(`${allowed.file}:${allowed.text}`);
        else hits.push({ file: name, line, text, rule });
      }
    }
    for (const key of liveCopyKeys(file)) {
      const row = COPY[key as CopyKey];
      for (const lang of ["en", "zh"] as const) for (const rule of rules(row?.[lang] ?? "")) hits.push({ file: `${name} copy("${key}") ${lang}`, line: 0, text: row[lang], rule });
    }
  }
  return { hits, allowedUsed, scanned };
}

describe("the App Store build's wording", () => {
  const { hits, allowedUsed, scanned } = storeHits();

  it("scans the source the store build is made from, and not the Ask screens it compiles out", () => {
    expect(scanned.length).toBeGreaterThan(50);
    expect(scanned).toEqual(
      expect.arrayContaining(["main.tsx", "app/App.tsx", "screens/SearchScreen.tsx", "screens/SettingsScreen.tsx", "screens/settings-copy.ts", "components/results/copy.ts", "screens/OnboardingScreen.tsx", "screens/watches-copy.ts", "screens/favorites-copy.ts", "search/search.ts"]),
    );
    // The OAuth flavour's connect page and its words are held to the same lists: the reading leaves App.tsx's
    // OAUTH_BUILT unknown, so both connect pages are read, whichever a store build ships.
    expect(scanned).toEqual(expect.arrayContaining(["screens/SeatsConnectScreen.tsx", "screens/oauth-copy.ts", "oauth/kit.ts", "oauth/token-store.ts"]));
    for (const askOnly of ["screens/AskScreen.tsx", "screens/AnthropicKeyScreen.tsx", "screens/anthropic-copy.ts", "ask/ask-surface-copy.ts", "ask/ask-copy.ts", "ask/consent-copy.ts", "components/AskEntry.tsx"]) {
      expect(scanned, askOnly).not.toContain(askOnly);
    }
  });

  it("no store-reachable string names a paid plan, a purchase, an unlock or live data, or Ask, Claude or Anthropic", () => {
    expect(hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${JSON.stringify(h.text)}`)).toEqual([]);
  });

  it("every allowance is still needed, and every service-only module is still reached only to build AppServices.ask", () => {
    expect(ALLOWED.filter((a) => !allowedUsed.has(`${a.file}:${a.text}`))).toEqual([]);
    const reached = storeSources(MAIN).map(rel);
    for (const name of Object.keys(SERVICE_ONLY)) expect(reached, `${name} is no longer reached: remove it from SERVICE_ONLY`).toContain(name);
    // Nothing a screen renders imports them: only bootstrap.ts and the Ask service's own modules do.
    const importers = new Set(
      reached.filter((name) => !(name in SERVICE_ONLY) && liveImports(path.join(SRC, name)).some((target) => rel(target) in SERVICE_ONLY)),
    );
    expect([...importers].sort()).toEqual(["app/bootstrap.ts"]);
  });
});

describe("the deny-lists and the flavour reading are precise", () => {
  it.each([
    "seats.aero Pro key",
    "Paste your Pro key",
    "粘贴你的 Pro 密钥",
    "Add your seats.aero Pro API key in Settings.",
    "the Partner API needs a Pro account.",
    "Check your settings before you subscribe.",
    "订阅之前",
    "Upgrade to see more",
    "Unlock every route",
    "Buy seats.aero Pro",
    "购买会员",
    "解锁全部功能",
    "付费订阅",
    "a paid seats.aero subscription",
    "Start your free trial",
    "Live results from your account",
    "实时结果",
  ])("PAID catches %j", (text) => expect(PAID.test(text)).toBe(true));

  it.each(["AI assistance", "AI assistance (working)", "Ask Claude about this search", "AI辅助", "AI 辅助", "AI 对话", "AI（可选）", "AI (optional)", "Anthropic API key", "Return to AI assistance", "Change the conditions directly. No AI is used.", "Searches the sample data on this device · No AI", "直接修改查询条件，不使用 AI。", "使用你自己的 seats.aero 额度 · 不使用 AI"])(
    "ASK catches %j",
    (text) => expect(ASK.test(text)).toBe(true),
  );

  it.each([
    "Connect your seats.aero account",
    "seats.aero API key",
    "Paste your seats.aero API key",
    "No seats.aero account connected. Try sample data, or connect your seats.aero account in Settings.",
    "seats.aero did not accept the API key. Check it in Settings.",
    "Data: seats.aero",
    "连接你的 seats.aero 账户",
    "Asking seats.aero about 4 mileage programs…",
    "Illustrative data — not live availability",
    "Search stops until you add a key again.",
  ])("passes the neutral %j", (text) => expect(rules(text)).toEqual([]));

  it("reads a store flag the way the build does: STORE ? x : y keeps x; ASK_BUILT ? y : x and !STORE && y drop y", () => {
    const code = [
      'const a = STORE ? "kept" : "dropped one";',
      'const b = ASK_BUILT ? "dropped two" : "kept";',
      'const c = !STORE && "dropped three";',
      'const d = import.meta.env.VITE_AG_STORE !== "1" ? "dropped four" : "kept";',
      'if (E2E) { const e = "dropped five"; }',
      'const f = CAN_CONNECT ? "kept" : "dropped six";',
      'const g = maybe ? "kept" : "kept";',
    ].join("\n");
    const sf = ts.createSourceFile("virtual.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const dead = deadRanges(sf);
    const strings = extract("virtual.ts", code).strings.filter((s) => !dead.some(([from, to]) => s.pos >= from && s.pos < to));
    // The condition's own "1" is read too: it is a string in the source, if never one a person sees.
    expect(strings.map((s) => s.text)).toEqual(["kept", "kept", "1", "kept", "kept", "kept", "kept"]);
    expect(evaluate(ts.factory.createIdentifier("STORE"))).toBe(true);
    expect(evaluate(ts.factory.createIdentifier("somethingElse"))).toBeUndefined();
    expect(STORE_CONSTANTS).toMatchObject({ STORE: true, ASK_BUILT: false, PROBES: false, E2E: false, CAN_CONNECT: true });
  });

  it("the default build reaches the Ask screens through the same reading, so the store result is not an empty walk", () => {
    const full = storeSources(MAIN, { ...STORE_CONSTANTS, STORE: false, ASK_BUILT: true }).map(rel);
    expect(full).toEqual(expect.arrayContaining(["screens/AskScreen.tsx", "screens/AnthropicKeyScreen.tsx", "ask/ask-surface-copy.ts"]));
  });
});
