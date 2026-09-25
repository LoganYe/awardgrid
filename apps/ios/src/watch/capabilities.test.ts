/**
 * iOS watch capabilities through core's capability sentence (UI/UX v1 T20; A33): foreground only, said with iOS's own
 * approved row; nothing scheduled is ever claimed.
 */
import { describe, expect, it } from "vitest";
import { IOS_WATCH_CAPABILITIES, WATCH_CHECKS, watchCapabilityCopyKey } from "./capabilities";

describe("iOS watch capabilities", () => {
  it("are read from what is built: on open and return only, no schedule, no push", () => {
    expect(IOS_WATCH_CAPABILITIES).toEqual({ checkOnForeground: WATCH_CHECKS.onOpen, scheduledChecks: false, pushEnabled: false });
  });

  it("say iOS's own row for foreground-only checks, and 'unavailable' when there is no capability", () => {
    expect(watchCapabilityCopyKey()).toBe("watch.ios");
    expect(watchCapabilityCopyKey({ checkOnForeground: false, scheduledChecks: false, pushEnabled: false })).toBe("watch.unavailable");
  });

  it("refuse a scheduled sentence iOS has not built", () => {
    expect(() => watchCapabilityCopyKey({ checkOnForeground: true, scheduledChecks: true, pushEnabled: true })).toThrow(/iOS has no scheduler/);
  });
});
