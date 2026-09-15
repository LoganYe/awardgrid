import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n";
import { SEATS_SOURCES, SOURCE_NAMES } from "@/lib/seatsaero/types";
import {
  PROGRAM_SHORT_NAMES,
  cabinName,
  cabinTag,
  formatFees,
  formatGridDate,
  formatLongDate,
  formatMiles,
  formatRowDate,
  formatSeats,
  programShortName,
} from "@/lib/grid/format";

const en = translator("en");
const zh = translator("zh");

describe("formatMiles", () => {
  it("groups thousands in both locales", () => {
    expect(formatMiles(60_000)).toBe("60,000");
    expect(formatMiles(60_000, "en")).toBe("60,000");
    expect(formatMiles(60_000, "zh")).toBe("60,000");
    expect(formatMiles(112_500, "en")).toBe("112,500");
    expect(formatMiles(500, "en")).toBe("500");
  });
});

describe("formatFees", () => {
  it("$ for USD, code for other currencies, dash when unknown", () => {
    expect(formatFees(560, "USD", "en")).toBe("$5.60");
    expect(formatFees(560, null, "en")).toBe("$5.60"); // recorded assumption: no currency = USD
    expect(formatFees(5_600, "EUR", "en")).toBe("56.00 EUR");
    expect(formatFees(5_600, "eur", "en")).toBe("56.00 EUR");
    expect(formatFees(123_456, "JPY", "en")).toBe("1,234.56 JPY");
    expect(formatFees(null, "USD", "en")).toBe("?");
    expect(formatFees(null, null, "zh")).toBe("?");
    expect(formatFees(560, "USD", "zh")).toBe("$5.60");
  });

  it("never prints a symbol for a non-USD currency", () => {
    for (const code of ["EUR", "GBP", "CAD", "JPY", "CNY"]) {
      const s = formatFees(1_000, code, "en");
      expect(s).not.toMatch(/[$€£¥]/);
      expect(s).toContain(code);
    }
  });
});

describe("formatSeats", () => {
  it("pluralises in en and uses the dictionary for unknown", () => {
    expect(formatSeats(2, "en", en)).toBe("2 seats");
    expect(formatSeats(1, "en", en)).toBe("1 seat");
    expect(formatSeats(0, "en", en)).toBe("seats unknown");
    expect(formatSeats(-1, "en", en)).toBe("seats unknown");
    expect(formatSeats(Number.NaN, "en", en)).toBe("seats unknown");
  });

  it("zh", () => {
    expect(formatSeats(2, "zh", zh)).toBe("2 个座位");
    expect(formatSeats(1, "zh", zh)).toBe("1 个座位");
    expect(formatSeats(0, "zh", zh)).toBe("座位数未知");
  });
});

describe("programShortName", () => {
  it("has a short text name for every seats.aero source and keeps the long names in SOURCE_NAMES", () => {
    for (const source of SEATS_SOURCES) {
      const short = programShortName(source);
      expect(short).toBe(PROGRAM_SHORT_NAMES[source]);
      expect(short.length).toBeGreaterThan(0);
      expect(short.length).toBeLessThanOrEqual(15); // fits a 112 px cell at 13 px
      expect(short).not.toMatch(/[·•→—]/); // text only, no glyphs
      expect(SOURCE_NAMES[source].length).toBeGreaterThanOrEqual(short.length);
    }
    expect(programShortName("alaska")).toBe("Alaska");
    expect(programShortName("american")).toBe("American");
    expect(programShortName("aeroplan")).toBe("Aeroplan");
    expect(programShortName("united")).toBe("United");
    expect(programShortName("singapore")).toBe("Singapore");
    expect(programShortName("jetblue")).toBe("JetBlue");
    expect(programShortName("flyingblue")).toBe("Flying Blue");
  });

  it("falls back to the code for unknown sources", () => {
    expect(programShortName("mystery")).toBe("mystery");
  });
});

describe("cabinTag / cabinName", () => {
  it("returns the one-letter tag and the localized name", () => {
    expect(cabinTag("J")).toBe("J");
    expect(cabinTag("F")).toBe("F");
    expect(cabinName("J", en)).toBe("Business");
    expect(cabinName("F", zh)).toBe("头等舱");
  });
});

describe("dates", () => {
  it("formats calendar days in UTC without shifting", () => {
    expect(formatGridDate("2026-10-15", "en")).toBe("Oct 15");
    expect(formatRowDate("2026-10-15", "en")).toBe("Thu, Oct 15");
    expect(formatLongDate("2026-10-15", "en")).toBe("October 15");
    expect(formatLongDate("2026-10-15", "zh")).toBe("10月15日");
    expect(formatGridDate("garbage", "en")).toBe("garbage");
  });
});
