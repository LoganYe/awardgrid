/** Hand-written row/query factories for grid tests (no network, no keys). */
import type { QueryObject } from "@/lib/query/schema";
import type { AvailabilityRow } from "@/lib/grid/types";

export const NOW = "2026-10-01T12:00:00.000Z";

let seq = 0;

export function makeRow(over: Partial<AvailabilityRow> = {}): AvailabilityRow {
  seq += 1;
  return {
    program: "alaska",
    origin: "HKG",
    dest: "SEA",
    date: "2026-10-15",
    cabin: "J",
    miles: 80_000,
    fees_cents: 5_600,
    currency: "USD",
    seats_left: 2,
    direct: true,
    airlines: ["AS"],
    computed_last_seen: "2026-10-01T10:00:00.000Z", // 2h before NOW
    source_id: `id-${seq}`,
    booking_url: null,
    fetched_at: NOW,
    ...over,
  };
}

export function makeQuery(over: Partial<QueryObject> = {}): QueryObject {
  return {
    origins: ["HKG"],
    destinations: ["SEA"],
    date_from: "2026-10-15",
    date_to: "2026-10-16",
    cabins: ["J", "F"],
    direct_only: false,
    include_filtered: false,
    min_cabin_pct: 100,
    sort_by: "miles_asc",
    raw_text: "test",
    language: "en",
    ...over,
  };
}
