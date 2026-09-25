/**
 * T22 (U-042): the appearance chosen in Settings reaches the native side, which paints the web view's own background
 * (below the tab bar, over the home indicator) and sets the window's interface style. The page posts it; in a browser
 * (the fixture host, tests) there is no native side and nothing is posted. The native half is checked on the
 * Simulator (evidence T22).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { installAppearanceBridge, parseColor, postAppearance } from "./appearance";

const g = globalThis as { window?: unknown };
const withNative = (extra: Record<string, unknown> = {}) => {
  const postMessage = vi.fn();
  g.window = { webkit: { messageHandlers: { agAppearance: { postMessage } } }, ...extra };
  return postMessage;
};

afterEach(() => {
  delete g.window;
});

describe("parseColor", () => {
  it("reads rgb(), rgba() and #rrggbb; a transparent or unknown colour is null", () => {
    expect(parseColor("rgb(26, 33, 48)")).toEqual({ r: 26, g: 33, b: 48 });
    expect(parseColor("rgba(255, 255, 255, 1)")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("#1A2130")).toEqual({ r: 26, g: 33, b: 48 });
    expect(parseColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(parseColor("oklch(0.2 0.02 260)")).toBeNull();
  });
});

describe("postAppearance", () => {
  it("posts the chosen scheme and the page's bottom surface colour, as numbers", () => {
    const post = withNative();
    postAppearance("dark", () => ({ r: 26, g: 33, b: 48 }));
    expect(post).toHaveBeenCalledWith({ scheme: "dark", r: 26, g: 33, b: 48 });
  });

  it("'system' is posted as it is, so the native side follows the device again", () => {
    const post = withNative();
    postAppearance("system", () => ({ r: 255, g: 255, b: 255 }));
    expect(post).toHaveBeenCalledWith({ scheme: "system", r: 255, g: 255, b: 255 });
  });

  it("without a colour it can read, it still posts the scheme", () => {
    const post = withNative();
    postAppearance("light", () => null);
    expect(post).toHaveBeenCalledWith({ scheme: "light" });
  });

  it("does nothing, and reads nothing, where there is no native side", () => {
    const read = vi.fn(() => null);
    g.window = {};
    expect(() => postAppearance("dark", read)).not.toThrow();
    delete g.window;
    expect(() => postAppearance("dark", read)).not.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("a native side that throws never breaks the page", () => {
    g.window = { webkit: { messageHandlers: { agAppearance: { postMessage: () => { throw new Error("gone"); } } } } };
    expect(() => postAppearance("dark", () => null)).not.toThrow();
  });
});

describe("installAppearanceBridge", () => {
  it("posts at once, again when the device's appearance changes, and stops when removed", () => {
    let listener: (() => void) | null = null;
    const query = { addEventListener: vi.fn((_: string, fn: () => void) => (listener = fn)), removeEventListener: vi.fn() };
    const post = withNative({ matchMedia: () => query });
    const remove = installAppearanceBridge(() => "system", () => ({ r: 1, g: 2, b: 3 }));
    expect(post).toHaveBeenCalledTimes(1);
    listener!();
    expect(post).toHaveBeenCalledTimes(2);
    remove();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", listener);
  });
});
