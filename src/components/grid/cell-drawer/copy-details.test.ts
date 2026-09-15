/**
 * "Copy details" (spec §3.5): the plain-text block the drawer puts on the clipboard, plus the
 * "—" the drawer shows while fees are still unknown.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCopyDetails, copyText, drawerFees, FEES_PENDING } from "@/components/grid/cell-drawer/copy-details";
import { translator } from "@awardgrid/core/i18n";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";

const NOW = Date.parse("2026-03-14T12:00:00Z");

function row(over: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    program: "alaska",
    origin: "HKG",
    dest: "SEA",
    date: "2026-03-20",
    cabin: "J",
    miles: 60_000,
    fees_cents: 560,
    currency: "USD",
    seats_left: 2,
    direct: true,
    airlines: ["AS"],
    computed_last_seen: "2026-03-14T10:00:00Z",
    source_id: "row-1",
    booking_url: null,
    fetched_at: "2026-03-14T10:00:00Z",
    ...over,
  };
}

describe("drawerFees", () => {
  it("formats known fees and marks unknown ones with an em dash, not a blank", () => {
    expect(drawerFees(row(), "en")).toBe("$5.60");
    expect(drawerFees(row({ fees_cents: null, currency: null }), "en")).toBe(FEES_PENDING);
    expect(FEES_PENDING).toBe("—");
  });

  it("names any non-USD currency by its ISO code", () => {
    expect(drawerFees(row({ fees_cents: 11_230, currency: "EUR" }), "en")).toBe("112.30 EUR");
  });
});

describe("buildCopyDetails", () => {
  const t = translator("en");

  it("is one self-describing line per fact, in the drawer's own order", () => {
    const lines = buildCopyDetails({ row: row(), url: "https://example.test/award", now: NOW, locale: "en", t }).split("\n");
    expect(lines).toEqual([
      "HKG → SEA",
      "March 20",
      "Business",
      "Alaska Mileage Plan",
      "60,000 miles",
      "$5.60 fees",
      "2 seats",
      "seats.aero last saw this: 2h ago",
      "https://example.test/award",
      t("grid.deeplink_caveat"),
    ]);
  });

  it("says the program has no link yet instead of leaving the URL line blank", () => {
    const text = buildCopyDetails({ row: row(), url: null, now: NOW, locale: "en", t });
    expect(text).toContain(t("grid.drawer.no_link_yet"));
    expect(text).not.toContain("null");
  });

  it("carries the confirmation line with the link, always last", () => {
    const text = buildCopyDetails({ row: row(), url: "https://example.test/a", now: NOW, locale: "en", t });
    expect(text.endsWith(t("grid.deeplink_caveat"))).toBe(true);
  });

  it("formats numbers, the date and the age in the viewer's language", () => {
    const zh = translator("zh");
    const text = buildCopyDetails({ row: row(), url: null, now: NOW, locale: "zh", t: zh });
    expect(text).toContain("3月20日");
    expect(text).toContain("商务舱");
    expect(text).toContain("60,000");
    expect(text).toContain("2小时前");
  });

  it("shows the pending fees mark when Get Trips has not run yet", () => {
    const text = buildCopyDetails({ row: row({ fees_cents: null, currency: null }), url: null, now: NOW, locale: "en", t });
    expect(text).toContain(`${FEES_PENDING} fees`);
  });

  it("says seats are unknown rather than printing a zero the program never gave", () => {
    const text = buildCopyDetails({ row: row({ seats_left: 0 }), url: null, now: NOW, locale: "en", t });
    expect(text).toContain(t("grid.cell.seats_unknown"));
  });
});

describe("copyText", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, "clipboard");

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(globalThis.navigator, "clipboard", originalClipboard);
    vi.unstubAllGlobals();
  });

  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a textarea when the Clipboard API rejects, and never throws", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.stubGlobal("document", undefined);
    await expect(copyText("hello")).resolves.toBe(false);
  });
});
