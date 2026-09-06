/**
 * Parse-failure copy mapping (spec §3.7) and the Examples popover's three queries.
 *
 * Pure only: the components themselves are exercised by e2e/chips.spec.ts. What matters here is
 * that every `missing` field name /api/parse can return becomes exactly one sentence, and that
 * the examples exist in both dictionaries in the language the user is reading.
 */
import { describe, expect, it } from "vitest";
import { EXAMPLE_KEYS } from "@/components/grid/examples-popover";
import { missingSentenceKeys } from "@/components/grid/parse-failure";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

describe("missingSentenceKeys", () => {
  it("maps each missing field to its own sentence", () => {
    expect(missingSentenceKeys(["origins"])).toEqual(["grid.parse_failure.origins"]);
    expect(missingSentenceKeys(["destinations"])).toEqual(["grid.parse_failure.destinations"]);
    expect(missingSentenceKeys(["date_from"])).toEqual(["grid.parse_failure.dates"]);
  });

  it("says 'the dates' once when both bounds are missing", () => {
    expect(missingSentenceKeys(["date_from", "date_to"])).toEqual(["grid.parse_failure.dates"]);
  });

  it("keeps the order the server reported and drops nothing else", () => {
    expect(missingSentenceKeys(["date_to", "origins"])).toEqual(["grid.parse_failure.dates", "grid.parse_failure.origins"]);
  });

  it("falls back to one generic sentence when the server named no field", () => {
    expect(missingSentenceKeys(undefined)).toEqual(["grid.parse_failure.generic"]);
    expect(missingSentenceKeys([])).toEqual(["grid.parse_failure.generic"]);
    expect(missingSentenceKeys(["something_new"])).toEqual(["grid.parse_failure.generic"]);
  });

  it("every sentence key exists in both dictionaries", () => {
    const keys = [...missingSentenceKeys(["origins", "destinations", "date_from"]), "grid.parse_failure.generic"];
    for (const key of keys) {
      expect(en[key as keyof typeof en], key).toBeTruthy();
      expect(zh[key as keyof typeof zh], key).toBeTruthy();
    }
  });
});

describe("examples popover", () => {
  it("offers three examples in both languages", () => {
    expect(EXAMPLE_KEYS).toHaveLength(3);
    for (const key of EXAMPLE_KEYS) {
      expect(en[key as keyof typeof en], key).toBeTruthy();
      expect(zh[key as keyof typeof zh], key).toBeTruthy();
    }
  });

  it("leads with the canonical example, which is also the placeholder", () => {
    expect(en["grid.example.one"]).toBe(en["grid.query_placeholder"]);
    expect(zh["grid.example.one"]).toBe(zh["grid.query_placeholder"]);
  });
});
