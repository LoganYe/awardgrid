/**
 * `min_cabin_pct` (issue #18) is a NEW field on an OLD contract: every `?q=` link already in a
 * chat, every `saved_queries.query_json` already on disk and every LLM parse were written
 * before it existed. `.default(100)` is what keeps their meaning — and, because the value is
 * part of the cache scope, their CACHE SCOPE — exactly what it was. These tests pin that at the
 * one place the divergence could be introduced.
 */
import { describe, expect, it } from "vitest";
import { QueryObject, QueryObjectLLM } from "@/lib/query/schema";

/** A stored payload exactly as it was written before the field existed. */
const legacy = {
  origins: ["HKG"],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"],
  direct_only: false,
  include_filtered: false,
  sort_by: "miles_asc",
  raw_text: "HKG to SEA in business next month",
  language: "en",
};

describe("min_cabin_pct defaults", () => {
  it("a stored query written before the field existed parses to 100", () => {
    const parsed = QueryObject.parse(legacy);
    expect(parsed.min_cabin_pct).toBe(100);
  });

  it("a saved_queries.query_json round trip keeps 100 and stays byte-stable at 100", () => {
    const first = QueryObject.parse(JSON.parse(JSON.stringify(legacy)));
    const second = QueryObject.parse(JSON.parse(JSON.stringify(first)));
    expect(second.min_cabin_pct).toBe(100);
    expect(second).toEqual(first);
  });

  it("an explicit 100 and an absent value produce the same object", () => {
    expect(QueryObject.parse({ ...legacy, min_cabin_pct: 100 })).toEqual(QueryObject.parse(legacy));
  });

  it("keeps a non-default value through the round trip", () => {
    const q = QueryObject.parse({ ...legacy, min_cabin_pct: 70 });
    expect(q.min_cabin_pct).toBe(70);
    expect(QueryObject.parse(JSON.parse(JSON.stringify(q))).min_cabin_pct).toBe(70);
  });

  it("accepts only the documented 0-100 integer range", () => {
    expect(QueryObject.parse({ ...legacy, min_cabin_pct: 0 }).min_cabin_pct).toBe(0);
    expect(QueryObject.safeParse({ ...legacy, min_cabin_pct: 101 }).success).toBe(false);
    expect(QueryObject.safeParse({ ...legacy, min_cabin_pct: -1 }).success).toBe(false);
    expect(QueryObject.safeParse({ ...legacy, min_cabin_pct: 70.5 }).success).toBe(false);
  });

  it("is NOT a field the LLM may emit — it is a UI-only control, like include_filtered", () => {
    expect(Object.keys(QueryObjectLLM.shape)).not.toContain("min_cabin_pct");
    expect(Object.keys(QueryObjectLLM.shape)).not.toContain("include_filtered");
  });

  it("a query the LLM path produced (no such key anywhere) still lands on 100", () => {
    const fromLlm = QueryObjectLLM.parse({
      origins: ["HKG"],
      destinations: ["SEA"],
      date_from: "2026-10-01",
      date_to: "2026-10-30",
      cabins: ["J"],
      programs: null,
      direct_only: false,
      max_miles: null,
      sort_by: "miles_asc",
    });
    const q = QueryObject.parse({
      ...fromLlm,
      programs: undefined,
      max_miles: undefined,
      raw_text: "x",
      language: "en",
    });
    expect(q.min_cabin_pct).toBe(100);
  });
});
