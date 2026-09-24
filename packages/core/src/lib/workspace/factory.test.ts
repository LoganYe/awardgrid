/**
 * The synthetic workspace factory later tasks build on (plan 01 T02): it must produce a self-consistent,
 * fully typed snapshot from the frozen JSON, with no field invented beyond the recorded time basis.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_NOW, fixturePrefs, fixtureRows, fixtureSnapshot } from "../../../test/fixtures/uiux/factory";
import { QueryObject } from "../query/schema";
import { rowKey, scopeKey } from "./identity";

describe("fixtureSnapshot", () => {
  it("is consistent: one scope, unique row keys derived from it, evidence from the fixture clock", () => {
    const snap = fixtureSnapshot();
    expect(QueryObject.parse(snap.query)).toEqual(snap.query);
    expect(snap.scopeKey).toBe(scopeKey(snap.query));
    expect(snap.coverage.scopeKey).toBe(snap.scopeKey);
    expect(new Set(snap.rows.map((r) => r.key)).size).toBe(snap.rows.length);
    for (const row of snap.rows) {
      expect(row.key).toBe(rowKey(row.value, snap.scopeKey));
      expect(row.time).toEqual({ basis: "provider_last_seen", providerAt: row.value.computed_last_seen, fetchedAt: row.value.fetched_at });
    }
    expect(snap.createdAt).toBe(FIXTURE_NOW);
  });

  it("keeps the fixture's unknowns unknown", () => {
    const [first] = fixtureRows();
    expect(first!.fees_cents).toBeNull();
    expect(first!.currency).toBeNull();
    expect(first!.seats_left).toBe(0);
  });

  it("applies overrides without mutating the defaults", () => {
    expect(fixtureSnapshot({ id: "second", revision: 2 })).toMatchObject({ id: "second", revision: 2 });
    expect(fixtureSnapshot().id).toBe("fixture-snapshot-1");
    expect(fixturePrefs({ kind: "matrix" })).toEqual({ kind: "matrix", calendarCabin: "J", sort: "miles_asc", localFilter: {} });
  });
});
