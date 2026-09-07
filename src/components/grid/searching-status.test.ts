import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { SEATS_SOURCES, SOURCE_NAMES } from "@/lib/seatsaero/types";
import {
  elapsedSeconds,
  programList,
  searchingSentence,
  SEARCHING_SLOW_AFTER_SECONDS,
  type SearchingQuery,
} from "./searching-status";

/** Only the field the sentence reads. `programs` is OPTIONAL on QueryObject: absent = all. */
const q = (programs?: string[]): SearchingQuery => (programs === undefined ? {} : { programs });

describe("searchingSentence", () => {
  it("no query yet keeps the plain sentence instead of asserting all 26 programs", () => {
    expect(searchingSentence(null, 0, "en")).toEqual({ key: "grid.searching" });
  });

  it("no programs named: every seats.aero program, counted", () => {
    // The canonical "everything" query carries no `programs` key at all over the wire.
    expect(searchingSentence(q(), 0, "en")).toEqual({ key: "grid.searching_all", vars: { n: SEATS_SOURCES.length } });
    expect(searchingSentence(q([]), 0, "en")).toEqual({ key: "grid.searching_all", vars: { n: SEATS_SOURCES.length } });
    expect(t("en", "grid.searching_all", { n: SEATS_SOURCES.length })).toContain(String(SEATS_SOURCES.length));
  });

  it("one to three programs are named, four or more are counted", () => {
    expect(searchingSentence(q(["alaska"]), 0, "en")).toEqual({
      key: "grid.searching_named",
      vars: { programs: SOURCE_NAMES.alaska },
    });
    expect(searchingSentence(q(["alaska", "aeroplan", "united"]), 0, "en").key).toBe("grid.searching_named");
    expect(searchingSentence(q(["alaska", "aeroplan", "united", "american"]), 0, "en")).toEqual({
      key: "grid.searching_some",
      vars: { n: 4 },
    });
  });

  it("lists programs in the locale's own punctuation and leaves an unknown code as it came", () => {
    expect(programList(["alaska", "aeroplan"], "en")).toBe(`${SOURCE_NAMES.alaska} and ${SOURCE_NAMES.aeroplan}`);
    // zh joins a pair with 和 and a longer list with the ideographic comma the dictionary
    // already uses (footer.no_affiliation), never a half-width ", ".
    expect(programList(["alaska", "aeroplan"], "zh")).toBe(`${SOURCE_NAMES.alaska}和${SOURCE_NAMES.aeroplan}`);
    expect(programList(["alaska", "aeroplan", "united"], "zh")).toContain("、");
    expect(programList(["alaska", "aeroplan", "united"], "zh")).not.toContain(", ");
    expect(programList(["not_a_program"], "en")).toBe("not_a_program");
  });

  it("swaps to the slow sentence at 12 s instead of appending to the one already there", () => {
    expect(searchingSentence(q(), SEARCHING_SLOW_AFTER_SECONDS - 1, "en").key).toBe("grid.searching_all");
    expect(searchingSentence(q(), SEARCHING_SLOW_AFTER_SECONDS, "en")).toEqual({ key: "grid.searching_slow" });
    expect(searchingSentence(q(["alaska"]), SEARCHING_SLOW_AFTER_SECONDS, "en")).toEqual({ key: "grid.searching_slow" });
  });

  it("the sentence never carries the elapsed seconds: it is announced, and it must not change every second", () => {
    for (const locale of ["en", "zh"] as const) {
      const seen = new Set<string>();
      for (let s = 0; s < 60; s += 1) {
        const sentence = searchingSentence(q(["alaska"]), s, locale);
        expect(sentence.vars ?? {}).not.toHaveProperty("s");
        seen.add(t(locale, sentence.key, sentence.vars));
      }
      // Exactly two wordings in a minute: the sentence and its slow replacement.
      expect(seen.size).toBe(2);
    }
  });

  it("elapsedSeconds floors, never goes negative and survives a missing stamp", () => {
    expect(elapsedSeconds(1_000, 1_000)).toBe(0);
    expect(elapsedSeconds(1_000, 2_999)).toBe(1);
    expect(elapsedSeconds(5_000, 1_000)).toBe(0);
    expect(elapsedSeconds(Number.NaN, 1_000)).toBe(0);
  });
});
