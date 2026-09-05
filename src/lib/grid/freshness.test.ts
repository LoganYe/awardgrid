import { describe, expect, it } from "vitest";
import {
  AGING_MAX_MS,
  FRESH_MAX_MS,
  ageMs,
  formatAge,
  formatAgeCompact,
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
  });
});

describe("tier", () => {
  it("uses the exported thresholds (2h / 6h)", () => {
    expect(FRESH_MAX_MS).toBe(2 * H);
    expect(AGING_MAX_MS).toBe(6 * H);
  });

  it("fresh < 2h, aging at exactly 2h and up to exactly 6h, stale beyond 6h", () => {
    expect(tier(minus(FRESH_MAX_MS - 1), now)).toBe("fresh");
    expect(tier(minus(FRESH_MAX_MS), now)).toBe("aging");
    expect(tier(minus(AGING_MAX_MS), now)).toBe("aging");
    expect(tier(minus(AGING_MAX_MS + 1), now)).toBe("stale");
    expect(tier("not-a-date", now)).toBe("stale");
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

  it("compact form for cells", () => {
    expect(formatAgeCompact(minus(2 * H), now)).toBe("2h");
    expect(formatAgeCompact(minus(3 * 24 * H), now, "zh")).toBe("3天");
    expect(formatAgeCompact(minus(0), now)).toBe("now");
  });
});
