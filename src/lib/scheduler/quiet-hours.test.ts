import { describe, expect, it } from "vitest";
import { inQuietHours, localMinutes } from "./quiet-hours";

const shanghai = (start: string | null, end: string | null) => ({ quietHoursStart: start, quietHoursEnd: end, timezone: "Asia/Shanghai" });

describe("localMinutes", () => {
  it("converts to the user's zone (UTC+8) and falls back to UTC on an unknown zone", () => {
    expect(localMinutes(new Date("2026-10-01T15:30:00Z"), "Asia/Shanghai")).toBe(23 * 60 + 30);
    expect(localMinutes(new Date("2026-10-01T16:00:00Z"), "Asia/Shanghai")).toBe(0); // midnight, not 24:00
    expect(localMinutes(new Date("2026-10-01T15:30:00Z"), "UTC")).toBe(15 * 60 + 30);
    expect(localMinutes(new Date("2026-10-01T15:30:00Z"), "Not/AZone")).toBe(15 * 60 + 30);
  });
});

describe("inQuietHours", () => {
  it("window crossing midnight in the user's zone", () => {
    const u = shanghai("22:00", "07:00");
    expect(inQuietHours(u, new Date("2026-10-01T13:59:00Z"))).toBe(false); // 21:59
    expect(inQuietHours(u, new Date("2026-10-01T14:00:00Z"))).toBe(true); // 22:00 (inclusive)
    expect(inQuietHours(u, new Date("2026-10-01T18:00:00Z"))).toBe(true); // 02:00
    expect(inQuietHours(u, new Date("2026-10-01T22:59:00Z"))).toBe(true); // 06:59
    expect(inQuietHours(u, new Date("2026-10-01T23:00:00Z"))).toBe(false); // 07:00 (exclusive)
  });

  it("same-day window, no window when unset, one-sided, or start == end", () => {
    expect(inQuietHours(shanghai("09:00", "17:00"), new Date("2026-10-01T04:00:00Z"))).toBe(true); // 12:00
    expect(inQuietHours(shanghai("09:00", "17:00"), new Date("2026-10-01T12:00:00Z"))).toBe(false); // 20:00
    expect(inQuietHours(shanghai(null, null), new Date("2026-10-01T18:00:00Z"))).toBe(false);
    expect(inQuietHours(shanghai("22:00", null), new Date("2026-10-01T18:00:00Z"))).toBe(false);
    expect(inQuietHours(shanghai("22:00", "22:00"), new Date("2026-10-01T18:00:00Z"))).toBe(false);
    expect(inQuietHours(shanghai("garbage", "07:00"), new Date("2026-10-01T18:00:00Z"))).toBe(false);
  });
});
