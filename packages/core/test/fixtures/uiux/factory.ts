/**
 * Typed synthetic workspace objects for tests (plan 01 T02). Built from the frozen handoff JSON beside this file;
 * every value is invented, and nothing here is reachable from a production bundle (apps/ios build check, ESLint).
 *
 *   fixtureSnapshot(overrides?)  a complete ResultSnapshot of availability-rows.json's query and rows
 *   fixturePrefs(overrides?)     default ViewPreferences
 *
 * Relative imports only: the iOS vitest config has no "@" alias, and this file is imported from there as
 * "@awardgrid/core/test-fixtures/uiux/factory".
 */
import type { AvailabilityRow } from "../../../src/lib/grid/types";
import { QueryObject } from "../../../src/lib/query/schema";
import { rowKey, scopeKey } from "../../../src/lib/workspace/identity";
import { rowTimeEvidence } from "../../../src/lib/workspace/semantics";
import type { ResultSnapshot, ViewPreferences, WorkspaceRow } from "../../../src/lib/workspace/types";
import availability from "./availability-rows.json";

export const FIXTURE_NOW: string = availability.now;

/** The synthetic query, parsed by the real schema. */
export function fixtureQuery(): QueryObject {
  return QueryObject.parse(availability.query);
}

/**
 * The synthetic rows as freshly decoded rows. The JSON carries a provider ComputedLastSeen for every row
 * (its timeEvidence[0] case), so they are marked with that basis, as normalize.ts would.
 */
export function fixtureRows(): AvailabilityRow[] {
  return availability.rows.map((row) => ({ ...(row as AvailabilityRow), time_basis: "provider_last_seen" as const }));
}

export function fixtureSnapshot(overrides: Partial<ResultSnapshot> = {}): ResultSnapshot {
  const query = overrides.query ?? fixtureQuery();
  const scope = scopeKey(query);
  const rows: WorkspaceRow[] = fixtureRows().map((value) => ({
    key: rowKey(value, scope),
    value,
    time: rowTimeEvidence(value, FIXTURE_NOW),
  }));
  return {
    schemaVersion: 1,
    id: "fixture-snapshot-1",
    revision: 1,
    query,
    scopeKey: scope,
    createdAt: FIXTURE_NOW,
    rows,
    coverage: {
      state: "complete",
      scopeKey: scope,
      slices: query.origins.flatMap((origin) =>
        query.destinations.map((destination) => ({
          origin,
          destination,
          dateFrom: query.date_from,
          dateTo: query.date_to,
          cabins: [...query.cabins],
          programs: query.programs && query.programs.length > 0 ? [...query.programs] : null,
          state: "complete" as const,
          reason: "exhausted" as const,
        })),
      ),
    },
    receipt: { sentCalls: 1, fromCache: false },
    ...overrides,
  };
}

export function fixturePrefs(overrides: Partial<ViewPreferences> = {}): ViewPreferences {
  return { kind: "list", calendarCabin: "J", sort: "miles_asc", localFilter: {}, ...overrides };
}
