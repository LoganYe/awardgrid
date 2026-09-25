/**
 * The keyboard inset (UI/UX v1 T11; acceptance A20): what counts as the keyboard, and what is published on <html>.
 * The layout that follows it is checked in the browser (e2e/uiux/onboarding.spec.ts); a device is not checked yet.
 */
import { describe, expect, it } from "vitest";
import { KEYBOARD_MIN_PX, installKeyboardInset, keyboardState } from "./keyboard";

describe("keyboardState", () => {
  it("open from the keyboard's own height; the inset is what it covers below the visible part", () => {
    expect(keyboardState({ height: 508, offsetTop: 0, scale: 1 }, 844)).toEqual({ open: true, inset: 336 });
    // WebKit panned up to a field: the keyboard is as tall as before and still up; it covers less of the bottom.
    expect(keyboardState({ height: 508, offsetTop: 100, scale: 1 }, 844)).toEqual({ open: true, inset: 236 });
    // 320 × 568 with a 260 pt keyboard, panned far: open, covering 80 (the review's case).
    expect(keyboardState({ height: 308, offsetTop: 180, scale: 1 }, 568)).toEqual({ open: true, inset: 80 });
    expect(keyboardState({ height: 308, offsetTop: 260, scale: 1 }, 568)).toEqual({ open: true, inset: 0 });
  });

  it("closed with no keyboard, an accessory bar alone, while pinch-zoomed, or with no visualViewport", () => {
    expect(keyboardState({ height: 844, offsetTop: 0, scale: 1 }, 844)).toEqual({ open: false, inset: 0 });
    expect(keyboardState({ height: 844 - (KEYBOARD_MIN_PX - 1), offsetTop: 0, scale: 1 }, 844)).toEqual({ open: false, inset: 0 });
    expect(keyboardState({ height: 400, offsetTop: 0, scale: 2 }, 844)).toEqual({ open: false, inset: 0 });
    expect(keyboardState(null, 844)).toEqual({ open: false, inset: 0 });
  });
});

describe("installKeyboardInset", () => {
  function fakeWindow() {
    const view = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    const props = new Map<string, string>();
    const dataset: Record<string, string> = {};
    const events: string[] = [];
    const revealed: string[] = [];
    const field = { matches: () => true, scrollIntoView: () => revealed.push("field") };
    const win = Object.assign(new EventTarget(), {
      innerHeight: 844,
      visualViewport: view,
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      },
      document: {
        activeElement: field,
        documentElement: {
          dataset,
          style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) },
        },
      },
    });
    win.addEventListener("ag-keyboard", () => events.push(dataset.keyboard ?? "closed"));
    return { win: win as unknown as Window, view, props, dataset, events, revealed };
  }

  it("publishes the inset and the open flag, reveals the focused field when it opens, follows pans, and cleans up", () => {
    const { win, view, props, dataset, events, revealed } = fakeWindow();
    const stop = installKeyboardInset(win);
    expect(props.get("--ag-keyboard-inset")).toBe("0px");
    expect(dataset.keyboard).toBeUndefined();

    view.height = 508;
    view.dispatchEvent(new Event("resize"));
    expect(props.get("--ag-keyboard-inset")).toBe("336px");
    expect(dataset.keyboard).toBe("open");
    expect(revealed).toEqual(["field"]);

    // A pan while it is up changes the inset only: no new reveal, no new event.
    view.offsetTop = 100;
    view.dispatchEvent(new Event("scroll"));
    expect(props.get("--ag-keyboard-inset")).toBe("236px");
    expect(revealed).toEqual(["field"]);
    expect(events).toEqual(["open"]);

    view.height = 844;
    view.offsetTop = 0;
    view.dispatchEvent(new Event("resize"));
    expect(props.get("--ag-keyboard-inset")).toBe("0px");
    expect(dataset.keyboard).toBeUndefined();
    expect(events).toEqual(["open", "closed"]);

    stop();
    expect(props.has("--ag-keyboard-inset")).toBe(false);
    view.height = 400;
    view.dispatchEvent(new Event("resize"));
    expect(props.has("--ag-keyboard-inset")).toBe(false);
  });

  it("does nothing where there is no visualViewport", () => {
    const { win, props } = fakeWindow();
    (win as unknown as { visualViewport: null }).visualViewport = null;
    installKeyboardInset(win)();
    expect(props.size).toBe(0);
  });
});
