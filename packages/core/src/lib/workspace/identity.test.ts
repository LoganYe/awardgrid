/**
 * T02 — canonical scope and row identity (plan 01 T02; acceptance A04).
 *
 * A scope key names what the network was asked for; a row key names one aggregate option inside that scope.
 * Neither may depend on array order, display sort, language or the free text the query was typed as.
 */
import { describe, expect, it } from "vitest";
import fixture from "../../../test/fixtures/uiux/availability-rows.json";
import type { AvailabilityRow } from "../grid/types";
import { QueryObject } from "../query/schema";
import { rowKey, scopeKey } from "./identity";

const base = QueryObject.parse(fixture.query);
const q = (patch: Partial<QueryObject>): QueryObject => QueryObject.parse({ ...fixture.query, ...patch });
const rows = fixture.rows as AvailabilityRow[];

describe("scopeKey", () => {
  it("ignores set order and duplicates", () => {
    const a = q({ origins: ["HKG", "PVG"], destinations: ["SEA", "SFO"], cabins: ["J", "F"], programs: ["aeroplan", "united"] });
    const b = q({ origins: ["PVG", "HKG", "PVG"], destinations: ["SFO", "SEA"], cabins: ["F", "J", "F"], programs: ["united", "aeroplan"] });
    expect(scopeKey(a)).toBe(scopeKey(b));
  });

  it("is not changed by sort, free text or language", () => {
    expect(scopeKey(q({ sort_by: "date_asc", raw_text: "something else", language: "zh" }))).toBe(scopeKey(base));
  });

  it("treats 'no programs named' and an empty list as the same scope, as the planner does", () => {
    expect(scopeKey(q({ programs: undefined }))).toBe(scopeKey(q({ programs: [] })));
    expect(scopeKey(q({ programs: undefined }))).not.toBe(scopeKey(base));
  });

  it.each<[string, Partial<QueryObject>]>([
    ["date_from", { date_from: "2026-10-02" }],
    ["date_to", { date_to: "2026-10-29" }],
    ["origins", { origins: ["HKG", "PVG"] }],
    ["destinations", { destinations: ["SFO"] }],
    ["cabins", { cabins: ["J"] }],
    ["programs", { programs: ["aeroplan", "united"] }],
    ["direct_only", { direct_only: true }],
    ["include_filtered", { include_filtered: true }],
    ["min_cabin_pct", { min_cabin_pct: 80 }],
    ["max_miles", { max_miles: 90000 }],
  ])("changes when %s changes", (_field, patch) => {
    expect(scopeKey(q(patch))).not.toBe(scopeKey(base));
  });

  it("encodes a program name that contains a separator without colliding", () => {
    expect(scopeKey(q({ programs: ["a,b"] }))).not.toBe(scopeKey(q({ programs: ["a", "b"] })));
  });
});

describe("rowKey", () => {
  const scope = scopeKey(base);

  it("is distinct for every fixture row, including J and F on one source id", () => {
    const keys = rows.map((r) => rowKey(r, scope));
    expect(new Set(keys).size).toBe(rows.length);
    expect(rows[0]!.source_id).toBe(rows[1]!.source_id);
  });

  it("does not depend on array position", () => {
    const forward = rows.map((r) => rowKey(r, scope));
    const reversed = [...rows].reverse().map((r) => rowKey(r, scope));
    expect(reversed.reverse()).toEqual(forward);
  });

  it("changes with the scope, so one option in two scopes is two references", () => {
    expect(rowKey(rows[0]!, scopeKey(q({ min_cabin_pct: 80 })))).not.toBe(rowKey(rows[0]!, scope));
  });

  it("names the option, not its current values", () => {
    const r = rows[2]!;
    const changedValues: AvailabilityRow = { ...r, miles: 1, fees_cents: null, seats_left: 0, fetched_at: "2026-01-01T00:00:00Z" };
    expect(rowKey(changedValues, scope)).toBe(rowKey(r, scope));
  });

  it.each<[string, Partial<AvailabilityRow>]>([
    ["program", { program: "united" }],
    ["source_id", { source_id: "synthetic-other" }],
    ["origin", { origin: "PVG" }],
    ["dest", { dest: "SFO" }],
    ["date", { date: "2026-10-21" }],
    ["cabin", { cabin: "W" }],
    ["include_filtered", { include_filtered: true }],
    ["min_cabin_pct", { min_cabin_pct: 80 }],
  ])("changes when the row's %s changes", (_field, patch) => {
    expect(rowKey({ ...rows[2]!, ...patch }, scope)).not.toBe(rowKey(rows[2]!, scope));
  });

  it("treats min_cabin_pct 100 and absent as the same row scope, as the cache does", () => {
    const r = { ...rows[2]! };
    delete r.min_cabin_pct;
    expect(rowKey({ ...r, min_cabin_pct: 100 }, scope)).toBe(rowKey(r, scope));
  });

  it("cannot be forged by a value that contains the separator", () => {
    const a = rowKey({ ...rows[2]!, program: "a~b", source_id: "c" }, scope);
    const b = rowKey({ ...rows[2]!, program: "a", source_id: "b~c" }, scope);
    expect(a).not.toBe(b);
    const pair1 = rowKey({ ...rows[2]!, origin: "A-B", dest: "C" }, scope);
    const pair2 = rowKey({ ...rows[2]!, origin: "A", dest: "B-C" }, scope);
    expect(pair1).not.toBe(pair2);
  });

  it("is safe to put in a DOM attribute or a URL", () => {
    const key = rowKey({ ...rows[2]!, program: 'we"ird prog', source_id: "id with space/and|pipe" }, scope);
    expect(key).toMatch(/^[A-Za-z0-9._~%:-]+$/);
  });
});
