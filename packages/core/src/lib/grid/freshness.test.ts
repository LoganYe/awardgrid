import { describe, expect, it } from "vitest";
import {
  AGING_MAX_MS,
  FRESHNESS_SPEC,
  FRESHNESS_TIERS,
  FRESH_MAX_MS,
  ageMs,
  formatAge,
  formatAgeCompact,
  formatAgeLong,
  markFor,
  milesContrastStep,
  tier,
} from "@/lib/grid/freshness";

const now = new Date("2026-10-01T12:00:00.000Z");
const minus = (ms: number) => new Date(now.getTime() - ms).toISOString();
const H = 3_600_000;

describe("ageMs", () => {
  it("measures elapsed ms and clamps future timestamps to 0", () => {
    expect(ageMs(minus(90_000), now)).toBe(90_000);
    expect(ageMs(minus(-5_000), now)).toBe(0);
    expect(ageMs("garbage", now)).toBeNaN();
    expect(ageMs(null, now)).toBeNaN();
    expect(ageMs(undefined, now)).toBeNaN();
  });
});

describe("tier", () => {
  it("uses the exported thresholds (2h / 6h)", () => {
    expect(FRESH_MAX_MS).toBe(2 * H);
    expect(AGING_MAX_MS).toBe(6 * H);
    expect(FRESHNESS_SPEC.thresholds).toEqual({ fresh_max_ms: 2 * H, aging_max_ms: 6 * H });
  });

  it("fresh < 2h, aging at exactly 2h and up to exactly 6h, stale beyond 6h, unknown when unparseable", () => {
    expect(tier(minus(FRESH_MAX_MS - 1), now)).toBe("fresh");
    expect(tier(minus(FRESH_MAX_MS), now)).toBe("aging");
    expect(tier(minus(AGING_MAX_MS), now)).toBe("aging");
    expect(tier(minus(AGING_MAX_MS + 1), now)).toBe("stale");
    expect(tier("not-a-date", now)).toBe("unknown");
    expect(tier(null, now)).toBe("unknown");
    expect(tier("", now)).toBe("unknown");
  });
});

describe("FRESHNESS_SPEC / markFor / milesContrastStep", () => {
  it("encodes every tier with a shape + a token, never color alone", () => {
    expect(FRESHNESS_TIERS).toEqual(["fresh", "aging", "stale", "unknown"]);
    expect(markFor("fresh")).toEqual({ shape: "dot", colorToken: "--fresh" });
    expect(markFor("aging")).toEqual({ shape: "half", colorToken: "--aging" });
    expect(markFor("stale")).toEqual({ shape: "ring", colorToken: "--stale" });
    expect(markFor("unknown")).toEqual({ shape: "ring", colorToken: "--fg-muted" });
    // stale and unknown share the ring shape but differ by token AND age text ("1d" vs "?")
    expect(FRESHNESS_SPEC.unknownAge).toBe("?");
  });

  it("drops the miles figure one contrast step only for stale and unknown", () => {
    expect(milesContrastStep("fresh")).toBe(0);
    expect(milesContrastStep("aging")).toBe(0);
    expect(milesContrastStep("stale")).toBe(1);
    expect(milesContrastStep("unknown")).toBe(1);
    expect(FRESHNESS_SPEC.milesContrastStep).toEqual({ fresh: 0, aging: 0, stale: 1, unknown: 1 });
  });
});

describe("formatAge", () => {
  it("en", () => {
    expect(formatAge(minus(35 * 60_000), now)).toBe("35m ago");
    expect(formatAge(minus(2 * H + 59 * 60_000), now, "en")).toBe("2h ago");
    expect(formatAge(minus(3 * 24 * H), now)).toBe("3d ago");
    expect(formatAge(minus(20_000), now)).toBe("just now");
    expect(formatAge("bad", now)).toBe("unknown");
  });

  it("zh", () => {
    expect(formatAge(minus(35 * 60_000), now, "zh")).toBe("35分钟前");
    expect(formatAge(minus(2 * H), now, "zh")).toBe("2小时前");
    expect(formatAge(minus(3 * 24 * H), now, "zh")).toBe("3天前");
    expect(formatAge(minus(0), now, "zh")).toBe("刚刚");
  });

  it("compact form for cells: 45m, 2h, 1d, ? when unknown", () => {
    expect(formatAgeCompact(minus(45 * 60_000), now)).toBe("45m");
    expect(formatAgeCompact(minus(2 * H), now)).toBe("2h");
    expect(formatAgeCompact(minus(24 * H), now)).toBe("1d");
    expect(formatAgeCompact(minus(3 * 24 * H), now, "zh")).toBe("3天");
    expect(formatAgeCompact(minus(0), now)).toBe("now");
    expect(formatAgeCompact("bad", now)).toBe("?");
    expect(formatAgeCompact(undefined, now, "zh")).toBe("?");
  });

  it("long form for aria labels", () => {
    expect(formatAgeLong(minus(2 * H), now)).toBe("2 hours");
    expect(formatAgeLong(minus(1 * H), now)).toBe("1 hour");
    expect(formatAgeLong(minus(45 * 60_000), now)).toBe("45 minutes");
    expect(formatAgeLong(minus(60_000), now)).toBe("1 minute");
    expect(formatAgeLong(minus(3 * 24 * H), now)).toBe("3 days");
    expect(formatAgeLong(minus(0), now)).toBe("less than a minute");
    expect(formatAgeLong(minus(2 * H), now, "zh")).toBe("2 小时");
    expect(formatAgeLong(minus(0), now, "zh")).toBe("不到 1 分钟");
    expect(formatAgeLong("bad", now)).toBeNull();
  });
});
