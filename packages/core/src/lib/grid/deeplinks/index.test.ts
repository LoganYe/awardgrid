import { describe, expect, it } from "vitest";
import { makeRow } from "../../../../test/fixtures/grid/rows";
import {
  DEEPLINK_CAVEAT,
  STUB_PROGRAMS,
  hasProgramBuilder,
  resolveDeeplink,
} from "@/lib/grid/deeplinks/index";

const CAVEAT =
  "Confirm on the program's site before transferring any points — cached data can be stale and awards disappear.";

describe("resolveDeeplink", () => {
  it("prefers seats.aero's booking link even for a program with a builder", () => {
    const link = resolveDeeplink(
      makeRow({ program: "american", booking_url: "https://seats.aero/go/abc" }),
    );
    expect(link.kind).toBe("seats_aero_booking_link");
    expect(link.url).toBe("https://seats.aero/go/abc");
    expect(link.caveat).toBe(CAVEAT);
  });

  it("falls back to the AA search builder for american", () => {
    const link = resolveDeeplink(
      makeRow({
        program: "american",
        origin: "SEA",
        dest: "NRT",
        date: "2026-10-15",
        booking_url: null,
      }),
    );
    expect(link.kind).toBe("program_search");
    expect(link.url?.startsWith("https://www.aa.com/booking/search?")).toBe(true);
    expect(link.label).toBe("Search on American Airlines AAdvantage");
    expect(link.caveat).toBe(CAVEAT);
  });

  it("returns none (no invented URL) for stubbed programs without a booking link", () => {
    for (const program of STUB_PROGRAMS) {
      const link = resolveDeeplink(makeRow({ program, booking_url: null }));
      expect(link.kind).toBe("none");
      expect(link.url).toBeNull();
      expect(link.caveat).toBe(CAVEAT);
      expect(hasProgramBuilder(program)).toBe(false);
    }
    expect(resolveDeeplink(makeRow({ program: "unknownprog", booking_url: null })).label).toBe(
      "Search unknownprog manually",
    );
  });

  it("caveat is the exact kickoff wording and labels are text only", () => {
    expect(DEEPLINK_CAVEAT).toBe(CAVEAT);
    expect(hasProgramBuilder("american")).toBe(true);
    expect(resolveDeeplink(makeRow({ booking_url: "" })).kind).toBe("none"); // empty string is not a link
  });
});
