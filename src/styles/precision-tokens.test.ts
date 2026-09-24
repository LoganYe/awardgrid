/**
 * Guards on packages/tokens/precision.css, the Quiet Precision tokens (UI/UX v1 T04; acceptance A06).
 *
 * The CSS is what every surface reads; packages/tokens/quiet-precision.json is the approved design reference it must
 * equal, value for value, in both themes. The 32 contrast pairs are recomputed here from the CSS itself (W3C sRGB
 * relative luminance, unrounded), not copied from the design check. tokens.css keeps its own guard
 * (tokens.test.ts); nothing here touches it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEATS_SOURCES, SOURCE_NAMES } from "@awardgrid/core/seatsaero/types";

const DIR = path.join(import.meta.dirname, "..", "..", "packages", "tokens");
const raw = readFileSync(path.join(DIR, "precision.css"), "utf8");
const design = JSON.parse(readFileSync(path.join(DIR, "quiet-precision.json"), "utf8"));
const contrastCsv = readFileSync(path.join(DIR, "quiet-precision-contrast.csv"), "utf8");

interface Rule {
  media: string | null;
  selector: string;
  decls: Map<string, string>;
}

/** Top-level rules and rules one level inside @media, with comments removed. Enough for a token file. */
function parse(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const decls = (body: string) => new Map([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
  let i = 0;
  const readBlock = (from: number): [string, number] => {
    let depth = 0;
    for (let j = from; j < text.length; j++) {
      if (text[j] === "{") depth++;
      if (text[j] === "}" && --depth === 0) return [text.slice(from + 1, j), j + 1];
    }
    throw new Error("unbalanced braces in precision.css");
  };
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim().replace(/\s+/g, " ");
    const [body, next] = readBlock(open);
    if (prelude.startsWith("@media")) {
      for (const inner of parse(body)) rules.push({ ...inner, media: prelude.slice("@media".length).trim() });
    } else {
      rules.push({ media: null, selector: prelude, decls: decls(body) });
    }
    i = next;
  }
  return rules;
}

const rules = parse(raw);
const find = (selector: string, media: string | null = null) => {
  const r = rules.filter((x) => x.selector === selector && x.media === media);
  expect(r, `${media ?? ""} ${selector}`).toHaveLength(1);
  return r[0]!.decls;
};

const LIGHT = find(':root, [data-theme="light"]');
const DARK = find('[data-theme="dark"]');
const SYSTEM_DARK = find(':root:not([data-theme="light"]):not([data-theme="dark"])', "(prefers-color-scheme: dark)");
const BASE = find(":root");
const DESKTOP_TYPE = find(":root", "(min-width: 768px)");
const DESKTOP_FINE = find(":root", "(min-width: 768px) and (pointer: fine)");
const REDUCED = find(":root", "(prefers-reduced-motion: reduce)");

const px = (n: number) => `${n}px`;
/** Type sizes are multiplied by the text-scale hook. */
const scaled = (n: number) => `calc(${n}px * var(--ag-text-scale))`;
const colorKeys = (m: Map<string, string>) => [...m.keys()].filter((k) => /^#/.test(m.get(k)!));

describe("precision.css colours equal the approved design, in both themes", () => {
  it.each(Object.entries(design.color.light as Record<string, string>))("light %s", (role, hex) => {
    expect(LIGHT.get(`--ag-${role}`)).toBe(hex);
  });
  it.each(Object.entries(design.color.dark as Record<string, string>))("dark %s", (role, hex) => {
    expect(DARK.get(`--ag-${role}`)).toBe(hex);
  });
  it("the explicit and the system dark blocks are identical", () => {
    expect([...SYSTEM_DARK.entries()]).toEqual([...DARK.entries()]);
  });
  it("light and dark define the same colour tokens, and nothing else is a colour", () => {
    expect(colorKeys(LIGHT).sort()).toEqual(colorKeys(DARK).sort());
    expect(colorKeys(LIGHT).sort()).toEqual(Object.keys(design.color.light).map((r) => `--ag-${r}`).sort());
    for (const decls of [BASE, DESKTOP_TYPE, DESKTOP_FINE, REDUCED]) expect(colorKeys(decls)).toEqual([]);
  });
  it("elevation and scrims follow the design (dark surfaces carry no shadow)", () => {
    expect(LIGHT.get("--ag-shadow-popover")).toBe(design.elevation.popoverLight.replace(/,(?=\S)/g, ", "));
    expect(LIGHT.get("--ag-shadow-sheet")).toBe(design.elevation.sheetLight.replace(/,(?=\S)/g, ", "));
    expect(LIGHT.get("--ag-scrim")).toBe(design.elevation.scrimLight.replace(/,(?=\S)/g, ", "));
    expect(DARK.get("--ag-scrim")).toBe(design.elevation.scrimDark.replace(/,(?=\S)/g, ", "));
    expect(DARK.get("--ag-shadow-popover")).toBe("none");
  });
});

describe("scales equal the design", () => {
  it("spacing", () => {
    for (const [step, value] of Object.entries(design.spacing as Record<string, number>)) {
      if (step === "0") continue;
      expect(BASE.get(`--ag-space-${step}`), `space-${step}`).toBe(px(value));
    }
  });

  it("radius, with the web card at 12 and dialogs at 16 (spec §10, docs/02 D11)", () => {
    for (const [name, value] of Object.entries(design.radius as Record<string, number>)) expect(BASE.get(`--ag-radius-${name}`), name).toBe(px(value));
    expect(BASE.get("--ag-radius-card-desktop")).toBe("12px");
    expect(BASE.get("--ag-radius-dialog")).toBe("16px");
  });

  it("sizes: phone defaults, smaller controls only with a fine pointer on a wide screen", () => {
    const s = design.size as Record<string, number>;
    const phone: Array<[string, string]> = [
      ["--ag-touch-target", "touch-target-min"],
      ["--ag-button-height", "button-mobile"],
      ["--ag-input-height", "input-mobile"],
      ["--ag-chip-height", "chip-visual"],
      ["--ag-chip-slot", "chip-touch-slot"],
      ["--ag-gutter", "mobile-page-gutter"],
      ["--ag-gutter-desktop", "desktop-page-gutter"],
      ["--ag-header-height", "mobile-header"],
      ["--ag-query-summary-min", "mobile-query-summary-min"],
      ["--ag-tabbar-height", "mobile-tabs"],
      ["--ag-card-min", "mobile-availability-card-min"],
      ["--ag-desktop-row", "desktop-result-row"],
      ["--ag-nav-rail", "desktop-nav-rail"],
      ["--ag-panel-assistant", "desktop-assistant-panel"],
      ["--ag-panel-detail", "desktop-detail-panel"],
      ["--ag-watch-card-min", "watch-card-min"],
      ["--ag-card-gap", "mobile-card-gap"],
    ];
    for (const [css, key] of phone) expect(BASE.get(css), css).toBe(px(s[key]!));
    expect(DESKTOP_FINE.get("--ag-button-height")).toBe(px(s["button-desktop"]!));
    expect(DESKTOP_FINE.get("--ag-input-height")).toBe(px(s["input-desktop"]!));
    // Spec §10: desktop chip 32, icon button 36, segmented 40; a touch screen keeps the phone values at any width.
    expect(DESKTOP_FINE.get("--ag-chip-height")).toBe("32px");
    expect(DESKTOP_FINE.get("--ag-icon-button")).toBe("36px");
    expect(DESKTOP_FINE.get("--ag-segmented-height")).toBe("40px");
    expect(BASE.get("--ag-icon-button")).toBe("44px");
    expect(BASE.get("--ag-segmented-height")).toBe("44px");
    expect(BASE.get("--ag-content-max")).toBe(px(design.breakpoints.contentMax));
    expect(BASE.get("--ag-focus-width")).toBe("2px");
    expect(BASE.get("--ag-focus-offset")).toBe("2px");
  });

  it("type: phone sizes on :root, desktop sizes from 768px", () => {
    const t = design.typography as Record<string, Record<string, number>>;
    const map: Array<[string, string]> = [
      ["page-title", "page-title"],
      ["compact-title", "compact-title"],
      ["section", "section-title"],
      ["route", "route"],
      ["miles", "miles"],
      ["body", "body"],
      ["reading", "reading"],
      ["meta", "meta"],
      ["control", "control"],
      ["label", "short-label"],
    ];
    for (const [css, key] of map) {
      const spec = t[key]!;
      const phoneLeading = spec.lineHeightMobile ?? spec.lineHeight;
      const deskLeading = spec.lineHeightDesktop ?? spec.lineHeight;
      expect(BASE.get(`--ag-type-${css}`), css).toBe(scaled(spec.mobile!));
      expect(BASE.get(`--ag-leading-${css}`), css).toBe(scaled(phoneLeading!));
      const deskSize = DESKTOP_TYPE.get(`--ag-type-${css}`) ?? BASE.get(`--ag-type-${css}`);
      const deskLine = DESKTOP_TYPE.get(`--ag-leading-${css}`) ?? BASE.get(`--ag-leading-${css}`);
      expect(deskSize, `${css} desktop`).toBe(scaled(spec.desktop!));
      expect(deskLine, `${css} desktop leading`).toBe(scaled(deskLeading!));
    }
    expect(BASE.get("--ag-text-scale")).toBe("1");
    expect(BASE.get("--ag-weight-title")).toBe(String(t["page-title"]!.weight));
    expect(BASE.get("--ag-font-sans")).toMatch(/^system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"/);
  });

  it("motion, and zero under reduced motion", () => {
    expect(BASE.get("--ag-motion-feedback")).toBe(`${design.motion.feedbackMs}ms`);
    expect(BASE.get("--ag-motion-popover")).toBe(`${design.motion.popoverMs}ms`);
    expect(BASE.get("--ag-motion-sheet")).toBe(`${design.motion.sheetMs}ms`);
    expect(BASE.get("--ag-ease")).toBe(design.motion.easing.replace(/,(?=\S)/g, ", "));
    for (const k of ["--ag-motion-feedback", "--ag-motion-popover", "--ag-motion-sheet"]) expect(REDUCED.get(k)).toBe("0ms");
  });

  it("layers (docs/02 D11)", () => {
    expect(["base", "sticky", "nav", "overlay", "modal", "toast"].map((l) => BASE.get(`--ag-z-${l}`))).toEqual(["0", "20", "30", "40", "50", "60"]);
  });
});

/** W3C relative luminance of an sRGB hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("the 32 contrast pairs, recomputed from precision.css", () => {
  const rows = contrastCsv.trim().split("\n").slice(1).map((line) => line.split(","));
  it("has all 32 pairs", () => expect(rows).toHaveLength(32));
  it.each(rows)("%s %s on %s", (mode, fg, _fgHex, bg, _bgHex, ratio, threshold) => {
    const decls = mode === "dark" ? DARK : LIGHT;
    const measured = contrast(decls.get(`--ag-${fg}`)!, decls.get(`--ag-${bg}`)!);
    expect(measured).toBeGreaterThanOrEqual(Number(threshold));
    expect(measured).toBeCloseTo(Number(ratio), 3);
  });
});

describe("precision.css", () => {
  it("names no airline or loyalty program anywhere, comments included (no brand-colour hints)", () => {
    const lower = raw.toLowerCase();
    const names = new Set<string>([...SEATS_SOURCES, ...Object.values(SOURCE_NAMES as Record<string, string>).map((n) => n.toLowerCase())]);
    for (const name of names) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      expect(re.test(lower), `"${name}" appears in precision.css`).toBe(false);
    }
  });
});
