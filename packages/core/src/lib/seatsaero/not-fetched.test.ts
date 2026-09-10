/**
 * notFetchedPairsFrom, ported from the web facade.
 *
 * A NEW file, next to the port rather than appended to find.test.ts (moved, and untouchable). The
 * cases restate the web's own (src/lib/server/find.test.ts:799-812) over core types, so the two
 * copies are held to one rule while both exist. Pure: no fetch, no clock.
 */
import { describe, expect, it } from "vitest";
import type { AvailabilityRow } from "../grid/types";
import { en } from "../i18n/dictionaries/en";
import { notice } from "../notices";
import { pairsOf } from "./find";
import { NOT_FETCHED_REASON, notFetchedPairsFrom } from "./not-fetched";

/** Three pairs, one state each: HKG-SEA has rows, PVG-SEA has none, seats.aero does not monitor GMP-SEA. */
const pairs = pairsOf({ origins: ["HKG", "PVG", "GMP"], destinations: ["SEA"] });
const base = {
  // Only a row's pair is read, so the rest of the row is not built.
  rows: [{ origin: "HKG", dest: "SEA" } as AvailabilityRow],
  unmonitored_pairs: [{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }],
};

describe("notFetchedPairsFrom", () => {
  it("marks nothing when the run was neither truncated nor stopped by quota headroom", () => {
    expect(notFetchedPairsFrom({ ...base, notices: [] }, pairs)).toEqual([]);
  });

  it("a truncated pull marks only the pairs with no rows that seats.aero monitors", () => {
    for (const truncated of [notice("find.truncated_search", { pages: 3 }), notice("find.truncated_bulk", { pages: 2, source: "alaska" })]) {
      expect(notFetchedPairsFrom({ ...base, notices: [truncated] }, pairs)).toEqual([
        { pair: { origin: "PVG", dest: "SEA" }, reason: "grid.cell.not_fetched" },
      ]);
    }
  });

  it("quota headroom wins over truncation, whichever notice comes first", () => {
    const quota = notice("find.quota_headroom");
    const truncated = notice("find.truncated_search", { pages: 3 });
    for (const notices of [
      [truncated, quota],
      [quota, truncated],
    ]) {
      expect(notFetchedPairsFrom({ ...base, notices }, pairs)).toEqual([
        { pair: { origin: "PVG", dest: "SEA" }, reason: "grid.cell.not_fetched_quota" },
      ]);
    }
  });

  it("leaves pairs with rows and unmonitored pairs alone even when the run was truncated", () => {
    const covered = pairsOf({ origins: ["HKG", "GMP"], destinations: ["SEA"] });
    expect(notFetchedPairsFrom({ ...base, notices: [notice("find.quota_headroom")] }, covered)).toEqual([]);
  });

  it("find.routes_skipped alone yields none: the rows were pulled in full, only the routes check was cut", () => {
    expect(notFetchedPairsFrom({ ...base, notices: [notice("find.routes_skipped", { pairs: 1, skipped: 2 })] }, pairs)).toEqual([]);
  });

  it("every reason is a key the dictionaries define, never English text", () => {
    for (const key of Object.values(NOT_FETCHED_REASON)) expect(en).toHaveProperty([key]);
  });
});
