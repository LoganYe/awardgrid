import { describe, expect, it } from "vitest";
import { evaluateQuietHours, inQuietHours, isValidTimeZone, localMinutesInZone, parseHHMM } from "./quiet";

const cfg = (start: string | null, end: string | null, timezone: string | null = "UTC") => ({
  quietHoursStart: start,
  quietHoursEnd: end,
  timezone,
});

describe("parseHHMM", () => {
  it("parses valid and rejects invalid", () => {
    expect(parseHHMM("22:30")).toBe(1350);
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("7:00")).toBeNull();
    expect(parseHHMM("")).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });
});

describe("inQuietHours", () => {
  it("is off when either bound is missing or start === end", () => {
    expect(inQuietHours(cfg(null, null), "2026-09-06T23:00:00Z")).toBe(false);
    expect(inQuietHours(cfg("22:00", null), "2026-09-06T23:00:00Z")).toBe(false);
    expect(inQuietHours(cfg("22:00", "22:00"), "2026-09-06T22:00:00Z")).toBe(false);
    expect(evaluateQuietHours(cfg("22:00", "22:00"), "2026-09-06T22:00:00Z").enabled).toBe(false);
  });

  it("same-day range: start inclusive, end exclusive", () => {
    const c = cfg("13:00", "15:00");
    expect(inQuietHours(c, "2026-09-06T12:59:00Z")).toBe(false);
    expect(inQuietHours(c, "2026-09-06T13:00:00Z")).toBe(true);
    expect(inQuietHours(c, "2026-09-06T14:59:00Z")).toBe(true);
    expect(inQuietHours(c, "2026-09-06T15:00:00Z")).toBe(false);
  });

  it("range crossing midnight (22:00–07:00)", () => {
    const c = cfg("22:00", "07:00");
    expect(inQuietHours(c, "2026-09-06T21:59:00Z")).toBe(false);
    expect(inQuietHours(c, "2026-09-06T22:00:00Z")).toBe(true);
    expect(inQuietHours(c, "2026-09-06T23:30:00Z")).toBe(true);
    expect(inQuietHours(c, "2026-09-07T03:00:00Z")).toBe(true);
    expect(inQuietHours(c, "2026-09-07T06:59:00Z")).toBe(true);
    expect(inQuietHours(c, "2026-09-07T07:00:00Z")).toBe(false);
    expect(inQuietHours(c, "2026-09-07T12:00:00Z")).toBe(false);
  });

  it("uses the user's zone: 23:00 UTC is 07:00 in Asia/Shanghai", () => {
    const at = "2026-09-06T23:00:00Z";
    expect(inQuietHours(cfg("22:00", "07:00", "UTC"), at)).toBe(true);
    expect(inQuietHours(cfg("22:00", "07:00", "Asia/Shanghai"), at)).toBe(false);
    expect(inQuietHours(cfg("22:00", "07:30", "Asia/Shanghai"), at)).toBe(true);
    expect(evaluateQuietHours(cfg("22:00", "07:00", "Asia/Shanghai"), at).localMinutes).toBe(7 * 60);
    // DST-aware zone.
    expect(evaluateQuietHours(cfg("22:00", "07:00", "America/Los_Angeles"), "2026-07-01T05:30:00Z").localMinutes).toBe(
      22 * 60 + 30,
    );
    expect(inQuietHours(cfg("22:00", "07:00", "America/Los_Angeles"), "2026-07-01T05:30:00Z")).toBe(true);
  });

  it("invalid zone falls back to UTC and flags it", () => {
    const r = evaluateQuietHours(cfg("22:00", "07:00", "Mars/Olympus"), "2026-09-06T23:00:00Z");
    expect(r).toMatchObject({ quiet: true, timezone: "UTC", timezoneInvalid: true, enabled: true });
    const ok = evaluateQuietHours(cfg("22:00", "07:00", "Asia/Shanghai"), "2026-09-06T23:00:00Z");
    expect(ok.timezoneInvalid).toBe(false);
    expect(ok.timezone).toBe("Asia/Shanghai");
    // Missing zone is UTC without a flag.
    expect(evaluateQuietHours(cfg("22:00", "07:00", null), "2026-09-06T23:00:00Z")).toMatchObject({
      timezone: "UTC",
      timezoneInvalid: false,
    });
  });

  it("accepts Date and epoch ms; midnight formats as 0 not 24*60", () => {
    expect(localMinutesInZone(new Date("2026-09-06T00:00:00Z"), "UTC")).toBe(0);
    expect(inQuietHours(cfg("22:00", "07:00"), new Date("2026-09-06T00:00:00Z"))).toBe(true);
    expect(inQuietHours(cfg("22:00", "07:00"), Date.parse("2026-09-06T12:00:00Z"))).toBe(false);
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Nope/Nope")).toBe(false);
  });
});
