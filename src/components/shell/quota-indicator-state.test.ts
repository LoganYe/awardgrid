import { describe, expect, it } from "vitest";
import { format, formatCompact, formatUsd, resetLabel, stateFor, warnThreshold } from "./quota-indicator-state";

describe("stateFor", () => {
  it("is ok below 800, warn from 800, exceeded from the soft limit (950)", () => {
    expect(stateFor(0, 950, 1000)).toBe("ok");
    expect(stateFor(312, 950, 1000)).toBe("ok");
    expect(stateFor(799, 950, 1000)).toBe("ok");
    expect(stateFor(800, 950, 1000)).toBe("warn");
    expect(stateFor(949, 950, 1000)).toBe("warn");
    expect(stateFor(950, 950, 1000)).toBe("exceeded");
    expect(stateFor(1000, 950, 1000)).toBe("exceeded");
    expect(stateFor(1300, 950, 1000)).toBe("exceeded");
  });

  it("follows a lowered soft limit (env override) and scales the warn line with the hard limit", () => {
    expect(stateFor(500, 500, 1000)).toBe("exceeded");
    expect(stateFor(499, 500, 1000)).toBe("ok");
    expect(warnThreshold(1000)).toBe(800);
    expect(warnThreshold(500)).toBe(400);
    expect(stateFor(400, 475, 500)).toBe("warn");
  });

  it("treats garbage as ok", () => {
    expect(stateFor(Number.NaN, 950, 1000)).toBe("ok");
    expect(stateFor(-5, 950, 1000)).toBe("ok");
    expect(stateFor(900, Number.NaN, Number.NaN)).toBe("ok");
    expect(warnThreshold(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("format", () => {
  it("groups per locale", () => {
    expect(format(312, 1000, "en")).toBe("312 / 1,000");
    expect(format(312, 1000, "zh-CN")).toBe("312 / 1,000");
    expect(format(1000, 1000, "en")).toBe("1,000 / 1,000");
    expect(format(0, 1000, "en")).toBe("0 / 1,000");
  });

  it("compacts thousands for the mobile bar", () => {
    expect(format(312, 1000, "en", { compact: true })).toBe("312/1k");
    expect(format(950, 1000, "en", { compact: true })).toBe("950/1k");
    expect(format(1000, 1000, "en", { compact: true })).toBe("1k/1k");
    expect(formatCompact(1250, "en")).toBe("1.3k");
    expect(formatCompact(1200, "en")).toBe("1.2k");
    expect(formatCompact(999, "en")).toBe("999");
  });

  it("never renders NaN or negatives", () => {
    expect(format(Number.NaN, -1, "en")).toBe("0 / 0");
    expect(format(Number.NaN, -1, "en", { compact: true })).toBe("0/0");
  });

  it("falls back to English on an unknown locale tag", () => {
    expect(format(1234, 1000, "x-not-a-locale-!!")).toBe("1,234 / 1,000");
  });
});

describe("resetLabel", () => {
  const reset = "2026-10-02T00:00:00.000Z";

  it("is a 24-hour wall-clock time in the viewer's zone when the reset is today", () => {
    // 00:00 UTC on Oct 2 is 08:00 on Oct 2 in Shanghai; `now` is also Oct 2 there.
    const now = new Date("2026-10-01T20:00:00.000Z");
    expect(resetLabel(reset, "en", now, { timeZone: "Asia/Shanghai" })).toBe("08:00");
    expect(resetLabel(reset, "zh-CN", now, { timeZone: "Asia/Shanghai" })).toBe("08:00");
    // Seattle: 17:00 on Oct 1, and `now` is Oct 1 afternoon there.
    expect(resetLabel(reset, "en", new Date("2026-10-01T18:00:00.000Z"), { timeZone: "America/Los_Angeles" })).toBe(
      "17:00",
    );
  });

  it("adds the day when the reset is not on today's local date", () => {
    const now = new Date("2026-10-01T10:00:00.000Z"); // Oct 1 in Shanghai; reset is Oct 2 08:00 there
    expect(resetLabel(reset, "en", now, { timeZone: "Asia/Shanghai" })).toBe("Oct 2, 08:00");
    expect(resetLabel(reset, "zh-CN", now, { timeZone: "Asia/Shanghai" })).toBe("10月2日 08:00");
  });

  it("returns an empty string for unparseable input", () => {
    expect(resetLabel("soon", "en", new Date(), { timeZone: "UTC" })).toBe("");
  });
});

describe("formatUsd", () => {
  it("renders dollars per locale and clamps garbage to zero", () => {
    expect(formatUsd(0.42, "en")).toBe("$0.42");
    expect(formatUsd(2, "en")).toBe("$2.00");
    expect(formatUsd(0.42, "zh-CN")).toBe("US$0.42");
    expect(formatUsd(-1, "en")).toBe("$0.00");
    expect(formatUsd(Number.NaN, "en")).toBe("$0.00");
  });
});
