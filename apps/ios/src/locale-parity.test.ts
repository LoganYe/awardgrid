/**
 * English and Chinese parity across the shell's copy tables (UI/UX v1 T11; acceptance A21). Every table has the same
 * keys in both languages, no empty sentence, every function takes the same arguments and answers in its own
 * language, and a sentence left the same in both is one that names something (a product, a code) rather than one
 * nobody translated. The approved rows (core `present.ts` COPY) have their own parity test in core.
 */
import { parseDeterministic } from "@awardgrid/core/query";
import { describe, expect, it } from "vitest";
import { EDITOR_COPY, allFieldErrors } from "./components/query/labels";
import { RESULTS } from "./components/results/copy";
import { CONNECT_ANTHROPIC } from "./screens/AskScreen";
import { COMPARE } from "./screens/compare-copy";
import { FAVORITES } from "./screens/favorites-copy";
import { WELCOME } from "./screens/OnboardingScreen";
import { SETTINGS } from "./screens/settings-copy";
import { WATCHES } from "./screens/watches-copy";

const TABLES: Record<string, { en: unknown; zh: unknown }> = {
  results: RESULTS,
  editor: EDITOR_COPY,
  settings: SETTINGS,
  watches: WATCHES,
  welcome: WELCOME,
  connectAnthropic: CONNECT_ANTHROPIC,
  compare: COMPARE,
  favorites: FAVORITES,
};

/** Any Chinese character or Chinese punctuation: English must have none. */
const CJK = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;
/** At least one Han character: punctuation alone (a full-width colon after English words) is not a translation. */
const HAN = /\p{Script=Han}/u;

/** The same text in both languages is allowed only where it names something. */
const SAME_IN_BOTH = new Set(["seats.aero", "Anthropic", "USD", "·", "—", "AI", "K", "≈"]);

/** Arguments that every copy function here accepts: counts, codes, names, dates or a change count. */
const ATTEMPTS: unknown[][] = [
  [2, 3, 4],
  ["ABC", "Example", "2026-10-18"],
  [["NRT", "HND"]],
  [{ new: 1, dropped: 2, cheaper: 3 }],
  [2, "minute"],
];

/** Functions whose arguments pick a sentence: every choice is said in both languages. */
const CASES: Record<string, unknown[][]> = {
  "results.otherDays": (["hidden", "complete", "unmonitored", "partial", "unknown"] as const).map((kind) => [2, kind]),
  "results.fromCache": [["5 min ago"], [null]],
  "watches.ago": [
    [2, "minute"],
    [2, "hour"],
    [2, "day"],
  ],
  "watches.unseen": [[{ new: 1, dropped: 0, cheaper: 0 }], [{ new: 0, dropped: 2, cheaper: 3 }]],
  "favorites.usage": [[3, 100, "0.4", "5.0"]],
};

function call(fn: (...args: unknown[]) => unknown): { args: unknown[]; out: string } | null {
  for (const attempt of ATTEMPTS) {
    const args = attempt.slice(0, Math.max(fn.length, 1));
    try {
      const out = fn(...args);
      if (typeof out === "string" && out !== "" && !out.includes("undefined") && !out.includes("NaN") && !out.includes("[object")) return { args, out };
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

type Leaf = { path: string; en: unknown; zh: unknown };

function leaves(en: unknown, zh: unknown, path: string, out: Leaf[]): Leaf[] {
  if (typeof en === "object" && en !== null && !Array.isArray(en)) {
    const a = Object.keys(en).sort();
    const b = Object.keys(zh as object).sort();
    expect(b, `${path}: the same keys in both languages`).toEqual(a);
    for (const key of a) leaves((en as Record<string, unknown>)[key], (zh as Record<string, unknown>)[key], `${path}.${key}`, out);
    return out;
  }
  if (Array.isArray(en)) {
    expect(Array.isArray(zh) && zh.length, `${path}: the same length in both languages`).toBe(en.length);
    en.forEach((item, i) => leaves(item, (zh as unknown[])[i], `${path}[${i}]`, out));
    return out;
  }
  out.push({ path, en, zh });
  return out;
}

describe("English and Chinese copy tables", () => {
  for (const [name, table] of Object.entries(TABLES)) {
    it(`${name}: same keys, nothing empty, each language in its own words`, () => {
      const all = leaves(table.en, table.zh, name, []);
      expect(all.length).toBeGreaterThan(0);
      for (const { path, en, zh } of all) {
        expect(typeof zh, `${path}: the same kind of value`).toBe(typeof en);
        if (typeof en === "function") {
          const fnEn = en as (...args: unknown[]) => unknown;
          const fnZh = zh as (...args: unknown[]) => unknown;
          expect(fnZh.length, `${path}: the same arguments`).toBe(fnEn.length);
          const found = call(fnEn);
          const cases = CASES[path] ?? (found ? [found.args] : []);
          expect(cases.length, `${path}: English answers with a sentence`).toBeGreaterThan(0);
          for (const args of cases) {
            const a = fnEn(...args);
            const b = fnZh(...args);
            expect(typeof a === "string" && a !== "", `${path}(${JSON.stringify(args)}): English answers`).toBe(true);
            expect(typeof b === "string" && b !== "", `${path}(${JSON.stringify(args)}): Chinese answers the same arguments`).toBe(true);
            expect(CJK.test(a as string), `${path}: English has no Chinese: ${String(a)}`).toBe(false);
            expect(HAN.test(b as string), `${path}: Chinese is Chinese: ${String(b)}`).toBe(true);
          }
        } else if (typeof en === "string") {
          expect(en.trim(), `${path}: not empty`).not.toBe("");
          expect((zh as string).trim(), `${path}: not empty`).not.toBe("");
          expect(CJK.test(en), `${path}: English has no Chinese: ${en}`).toBe(false);
          if (en === zh) expect(SAME_IN_BOTH.has(en.trim()), `${path}: left untranslated: ${en}`).toBe(true);
          else if (!HAN.test(zh as string)) expect(SAME_IN_BOTH.has((zh as string).trim()) || /^[\s\p{P}\p{S}\d]*$/u.test(zh as string), `${path}: Chinese is Chinese: ${String(zh)}`).toBe(true);
        } else {
          expect(zh, `${path}: the same value`).toEqual(en);
        }
      }
    });
  }

  it("the editor's field errors: the same fields and codes, each said in both languages", () => {
    const en = allFieldErrors("en");
    const zh = allFieldErrors("zh");
    expect(zh.map((e) => `${e.field}:${e.code}`)).toEqual(en.map((e) => `${e.field}:${e.code}`));
    for (const e of zh) expect(HAN.test(e.text), e.text).toBe(true);
    for (const e of en) expect(CJK.test(e.text), e.text).toBe(false);
  });

  it("the check itself: English words with a Chinese colon or full stop are not Chinese", () => {
    expect(HAN.test("Could not save the key on this device：x")).toBe(false);
    expect(HAN.test("Paste your Pro key。")).toBe(false);
    expect(HAN.test("无法保存密钥：x")).toBe(true);
  });

  it("every text-search example, in either language, is read by the parser alone, with nothing missing", () => {
    for (const locale of ["en", "zh"] as const) {
      for (const example of EDITOR_COPY[locale].text.examples) {
        const read = parseDeterministic(example, { today: "2026-09-24" });
        expect(read.missing, `${locale}: ${example}`).toEqual([]);
      }
    }
  });
});
