/**
 * Guards on src/styles/tokens.css (docs/UI_PLAN.md §2): the light and dark palettes define the
 * same set of tokens (both dark copies), the plan's hex values are the ones shipped, and no
 * airline or loyalty-program name (a brand-color hint) appears anywhere in the file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "tokens.css"), "utf8");

/** Return the declaration blocks whose selector matches `selector` (first-level `{ … }` only). */
function blocks(selector: RegExp): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const sel = m[1]!.trim().split("\n").pop()!.trim();
    if (selector.test(sel)) out.push(m[2]!);
  }
  return out;
}

function tokens(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  return map;
}

const COLOR_TOKENS = ["--bg", "--bg-raised", "--line", "--line-strong", "--fg", "--fg-muted", "--accent", "--fresh", "--aging", "--stale", "--error"];

describe("tokens.css", () => {
  const light = tokens(blocks(/^:root$/)[0] ?? "");
  const dark = tokens(blocks(/^\[data-theme="dark"\]$/)[0] ?? "");
  const systemDark = tokens(blocks(/^:root:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\)$/)[0] ?? "");

  it("has one light block, one explicit dark block and one system-dark block", () => {
    expect(light.size).toBeGreaterThan(20);
    expect(dark.size).toBeGreaterThan(0);
    expect(systemDark.size).toBeGreaterThan(0);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  it("every color token defined for light is defined for dark, in both dark copies", () => {
    const lightColors = [...light.keys()].filter((k) => COLOR_TOKENS.includes(k) || k === "--selection");
    expect(lightColors.sort()).toEqual([...COLOR_TOKENS, "--selection"].sort());
    for (const key of lightColors) {
      expect(dark.has(key), `${key} missing from [data-theme="dark"]`).toBe(true);
      expect(systemDark.has(key), `${key} missing from the prefers-color-scheme block`).toBe(true);
    }
    // Nothing is themed in dark that light does not define.
    for (const key of dark.keys()) expect(light.has(key), `${key} only in dark`).toBe(true);
    expect([...dark.entries()].sort()).toEqual([...systemDark.entries()].sort());
  });

  it("ships the plan's exact hex values", () => {
    expect(light.get("--bg")).toBe("#ffffff");
    expect(light.get("--bg-raised")).toBe("#f4f4f4");
    expect(light.get("--line")).toBe("#e2e2e2");
    expect(light.get("--line-strong")).toBe("#8a8a8a");
    expect(light.get("--fg")).toBe("#171717");
    expect(light.get("--fg-muted")).toBe("#5c5c5c");
    expect(light.get("--accent")).toBe("#1f5fbf");
    expect(light.get("--fresh")).toBe("#1b7a3e");
    expect(light.get("--aging")).toBe("#8f5800");
    expect(light.get("--stale")).toBe("#9b4a4a");
    expect(light.get("--error")).toBe("#b42318");
    expect(dark.get("--bg")).toBe("#111111");
    expect(dark.get("--bg-raised")).toBe("#1e1e1e");
    expect(dark.get("--line")).toBe("#2c2c2c");
    expect(dark.get("--line-strong")).toBe("#707070");
    expect(dark.get("--fg")).toBe("#ededed");
    expect(dark.get("--fg-muted")).toBe("#a3a3a3");
    expect(dark.get("--accent")).toBe("#7daaf5");
    expect(dark.get("--fresh")).toBe("#5fc77e");
    expect(dark.get("--aging")).toBe("#e3a93c");
    expect(dark.get("--stale")).toBe("#d48c8c");
    expect(dark.get("--error")).toBe("#f17a72");
  });

  it("neutrals are strictly achromatic (R = G = B) in both themes", () => {
    for (const map of [light, dark]) {
      for (const key of ["--bg", "--bg-raised", "--line", "--line-strong", "--fg", "--fg-muted"]) {
        const hex = map.get(key)!;
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(hex.slice(1, 3), key).toBe(hex.slice(3, 5));
        expect(hex.slice(3, 5), key).toBe(hex.slice(5, 7));
      }
    }
  });

  // The calendar's range band and the "not monitored" hatch are both drawn in --line-strong on
  // the --bg-raised popover ground: WCAG 1.4.11 asks 3:1 for a non-text mark that carries
  // meaning, and these two are the only indication of their state.
  it("--line-strong clears 3:1 on --bg-raised in both themes (range band, hatch)", () => {
    const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
      return (x! + 0.05) / (y! + 0.05);
    };
    for (const [name, map] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      expect(ratio(map.get("--line-strong")!, map.get("--bg-raised")!), `${name}: --line-strong on --bg-raised`).toBeGreaterThanOrEqual(3);
    }
  });

  it("names no airline or loyalty program", () => {
    const names = [
      "alaska", "american", "aadvantage", "united", "mileageplus", "delta", "skymiles", "aeroplan", "air canada",
      "british", "avios", "cathay", "asia miles", "singapore", "krisflyer", "ana", "jal", "lufthansa", "miles & more",
      "emirates", "skywards", "qatar", "privilege club", "virgin", "avianca", "lifemiles", "flying blue", "air france",
      "klm", "turkish", "etihad", "qantas", "southwest", "jetblue", "korean", "asiana", "eva", "china airlines",
      "hainan", "aeromexico", "iberia", "finnair", "sas", "eurobonus", "velocity", "air india", "thai", "vietnam",
    ];
    const lower = css.toLowerCase();
    for (const name of names) {
      const re = new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
      expect(re.test(lower), `"${name}" appears in tokens.css`).toBe(false);
    }
  });

  it("has the spec's sizes and motion values", () => {
    expect(light.get("--topbar-height")).toBe("48px");
    expect(light.get("--footer-height")).toBe("32px");
    expect(light.get("--content-max")).toBe("880px");
    expect(light.get("--auth-width")).toBe("360px");
    expect(light.get("--gutter")).toBe("16px");
    expect(light.get("--type-grid")).toBe("13px");
    expect(light.get("--type-body")).toBe("14px");
    expect(light.get("--type-section")).toBe("16px");
    expect(light.get("--type-title")).toBe("20px");
    expect(light.get("--motion-fast")).toBe("150ms");
    expect(light.get("--motion-slow")).toBe("200ms");
    expect(light.get("--focus-ring-width")).toBe("2px");
    expect(light.get("--focus-ring-offset")).toBe("1px");
    expect(light.get("--hatch")).toContain("var(--line-strong)");
    expect(light.get("--font-stack")).toMatch(/^"InterVariable"/);
    expect(light.get("--font-stack")).toContain("PingFang SC");
  });
});
