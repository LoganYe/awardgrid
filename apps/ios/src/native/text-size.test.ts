/**
 * T22 (A35's native half): the system's text size (Dynamic Type) drives the page's --ag-text-scale, from 100% to the
 * 200% T21 verified. Found on the Simulator: the app ignored it (evidence T22). The WebKit half is checked there.
 */
import { afterEach, describe, expect, it } from "vitest";
import { installSystemTextSize, textScaleFor } from "./text-size";

afterEach(() => {
  delete (globalThis as { CSS?: unknown }).CSS;
});

describe("textScaleFor", () => {
  it("is the system body size over iOS's default 17, two decimals, from 1 to 2", () => {
    expect(textScaleFor(17)).toBe(1);
    expect(textScaleFor(19)).toBe(1.12);
    expect(textScaleFor(23)).toBe(1.35);
    expect(textScaleFor(28)).toBe(1.65);
    expect(textScaleFor(33)).toBe(1.94);
    // Beyond 200% it stops at the largest size the layout was verified at; below 100% it stays at 100%.
    expect(textScaleFor(53)).toBe(2);
    expect(textScaleFor(14)).toBe(1);
    expect(textScaleFor(Number.NaN)).toBe(1);
  });
});

describe("installSystemTextSize", () => {
  it("does nothing where the system body font is unknown (a browser, the fixture host, tests)", () => {
    expect(() => installSystemTextSize()()).not.toThrow();
    (globalThis as { CSS?: unknown }).CSS = { supports: () => false };
    expect(() => installSystemTextSize()()).not.toThrow();
  });
});
