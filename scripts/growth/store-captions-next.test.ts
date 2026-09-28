/**
 * The next version's App Store screenshots (docs/release/appstore/next/<locale>/): the words rendered into them, and
 * the committed images.
 *
 *   - Every caption and corner label (scripts/growth/appstore-captions-next.ts) passes the public-claims gate against the
 *     current registry, so a caption edit, or a registry change that retires what a caption says, fails here even
 *     though the screenshot spec itself only runs by hand.
 *   - Each locale has exactly one image per shot, 1320×2868, with no alpha channel.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGE_SIZE, SHOTS, STORE_SHOTS_NEXT, type StoreShotLocale } from "./appstore-captions-next";
import { formatFinding, scanContent } from "./validate-public-claims.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, "growth", "product-facts.json"), "utf8"));
const IMAGES = path.join(ROOT, "docs", "release", "appstore", "next");
const LOCALES = Object.keys(STORE_SHOTS_NEXT) as StoreShotLocale[];

/** Width, height and colour type from a PNG's IHDR chunk, which the format puts first. */
function pngHeader(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex"), file).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString("latin1"), file).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

describe("the next version's App Store screenshot captions", () => {
  it("cover en-US and zh-Hans, with a caption for every shot", () => {
    expect(LOCALES).toEqual(["en-US", "zh-Hans"]);
    for (const locale of LOCALES) expect(Object.keys(STORE_SHOTS_NEXT[locale].captions).sort(), locale).toEqual([...SHOTS].sort());
    expect(STORE_SHOTS_NEXT["en-US"].sample).toBe("Sample data");
    expect(STORE_SHOTS_NEXT["zh-Hans"].sample).toBe("示例数据");
  });

  it.each(LOCALES)("%s: every caption and the corner label pass the public-claims gate", (locale) => {
    const { sample, captions } = STORE_SHOTS_NEXT[locale];
    const findings = [sample, ...Object.values(captions)].flatMap((text) =>
      scanContent(text, { logical: "caption.md", registry: REGISTRY, root: ROOT }).map((f) => `${text}: ${formatFinding(f)}`),
    );
    expect(findings).toEqual([]);
  });

  it("would refuse a caption that claims what the app does not do", () => {
    const rules = (text: string) => scanContent(text, { logical: "caption.md", registry: REGISTRY, root: ROOT }).map((f: { rule: string }) => f.rule);
    expect(rules("Live award availability for every route")).toContain("LIVE");
    expect(rules("The cheapest award seat in each cell")).toContain("PENDING_CLAIM_TEXT");
  });
});

describe("the committed next-version screenshots", () => {
  it.each(LOCALES)("%s: one 1320×2868 image per shot, with no alpha channel", (locale) => {
    const dir = path.join(IMAGES, locale);
    expect(readdirSync(dir).filter((f) => !f.startsWith(".")).sort()).toEqual(SHOTS.map((s) => `${s}.png`).sort());
    for (const shot of SHOTS) {
      const { width, height, colourType } = pngHeader(path.join(dir, `${shot}.png`));
      expect({ shot, width, height }).toEqual({ shot, ...IMAGE_SIZE });
      // 0 is greyscale and 2 truecolour, both without alpha (4 and 6 carry it; 3 may, through tRNS).
      expect([0, 2], `${locale}/${shot}.png colour type`).toContain(colourType);
    }
  });
});
