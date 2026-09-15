/**
 * Copy lint for both dictionaries (Phase 6 §1.3, §8; docs/COPY.md).
 *
 * Fails on: ALL-CAPS words of 4+ letters (except CAPS_ALLOWED), "→" / "->", " · " inside a
 * string, "..." (use "…"), "Sorry" / "Oops" / "Please" in English, apologies in Chinese,
 * em-dash-joined clauses ("—" in en, "——" in zh), half-width punctuation next to Chinese text,
 * untranslated Chinese values, Title Case anywhere in English, and trailing periods on control
 * labels. Every failure names the key so the fix is a one-line edit in the dictionary.
 */
import { describe, expect, it } from "vitest";
import { en } from "./dictionaries/en";
import { zh } from "./dictionaries/zh";
import { CAPS_ALLOWED, CONTROL_KEY_PATTERNS, MIDDLE_DOT_EXEMPT, PROPER_NOUNS } from "./copy-allowlist";

type Dict = Record<string, string>;
const dicts: Array<[string, Dict]> = [
  ["en", en],
  ["zh", zh],
];

const CJK = /[㐀-䶿一-鿿]/;

/** Collect `key: value` offenders so one assertion lists every problem at once. */
function offenders(dict: Dict, test: (value: string, key: string) => boolean): string[] {
  return Object.entries(dict)
    .filter(([key, value]) => test(value, key))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
}

function isControlKey(key: string): boolean {
  return CONTROL_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Words as the reader sees them: split on whitespace, strip surrounding punctuation and quotes.
 * `endsSentence` marks tokens that close a sentence so "Paused. It" is not read as Title Case.
 */
function words(value: string): Array<{ word: string; endsSentence: boolean }> {
  return value
    .split(/\s+/)
    .map((raw) => ({
      word: raw.replace(/^[("'“”‘’[]+|[)"'“”‘’\].,:;!?…]+$/g, ""),
      endsSentence: /[.!?…:]["'”’)]*$/.test(raw),
    }))
    .filter((w) => w.word.length > 0);
}

const isPlainCapitalised = (w: string) => /^[A-Z][a-z]+$/.test(w) && !PROPER_NOUNS.has(w);

describe("copy rules: both languages", () => {
  it("no ALL-CAPS words of 4+ letters outside the allowlist", () => {
    for (const [name, dict] of dicts) {
      const bad = offenders(dict, (v) =>
        (v.match(/\b[A-Z][A-Z_]{3,}\b/g) ?? []).some((token) => !CAPS_ALLOWED.has(token)),
      );
      expect(bad, name).toEqual([]);
    }
  });

  it("no arrows: routes are rendered by components, never spelled with → or ->", () => {
    for (const [name, dict] of dicts) {
      expect(offenders(dict, (v) => /→|->/.test(v)), name).toEqual([]);
    }
  });

  it("no middle-dot joined meta strings", () => {
    for (const [name, dict] of dicts) {
      const bad = offenders(dict, (v, key) => v.includes(" · ") && !(key in MIDDLE_DOT_EXEMPT));
      expect(bad, name).toEqual([]);
    }
  });

  it("uses the ellipsis character, never three dots", () => {
    for (const [name, dict] of dicts) {
      expect(offenders(dict, (v) => v.includes("...")), name).toEqual([]);
    }
  });

  it("never apologises", () => {
    expect(offenders(en, (v) => /\b(sorry|oops|please)\b/i.test(v))).toEqual([]);
    expect(offenders(zh, (v) => /抱歉|对不起|不好意思|很遗憾/.test(v))).toEqual([]);
  });

  it("no em-dash-joined clauses: two sentences instead", () => {
    expect(offenders(en, (v) => v.includes("—"))).toEqual([]);
    expect(offenders(zh, (v) => v.includes("——"))).toEqual([]);
  });

  it("control labels have no trailing period", () => {
    for (const [name, dict] of dicts) {
      const bad = offenders(dict, (v, key) => isControlKey(key) && /[.。]$/.test(v));
      expect(bad, name).toEqual([]);
    }
  });
});

describe("copy rules: English", () => {
  it("no Title Case: two adjacent capitalised words that are not proper nouns", () => {
    const bad = offenders(en, (v) => {
      const ws = words(v);
      return ws.some(
        (w, i) =>
          i > 0 && isPlainCapitalised(w.word) && isPlainCapitalised(ws[i - 1]!.word) && !ws[i - 1]!.endsSentence,
      );
    });
    expect(bad).toEqual([]);
  });

  it("control labels are a capitalised word or phrase, not a fragment or a sentence", () => {
    const bad = offenders(en, (v, key) => isControlKey(key) && !/^[A-Z0-9{]/.test(v));
    expect(bad).toEqual([]);
  });
});

describe("copy rules: Chinese", () => {
  it("uses full-width punctuation next to Chinese text", () => {
    const halfWidthNextToCjk = /[㐀-鿿][,.:;?!()]|[,.:;?!()][㐀-鿿]/;
    const halfWidthEnd = /[,.:;?!]$/;
    const bad = offenders(zh, (v) => halfWidthNextToCjk.test(v) || (CJK.test(v) && halfWidthEnd.test(v)));
    expect(bad).toEqual([]);
  });

  it("every value is translated unless it is identical to English by design", () => {
    const bad = Object.entries(zh)
      .filter(([key, value]) => !CJK.test(value) && value !== (en as Dict)[key])
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    expect(bad).toEqual([]);
  });

  it("no italics markup", () => {
    expect(offenders(zh, (v) => /<i>|<em>|_[㐀-鿿]+_/.test(v))).toEqual([]);
  });
});
