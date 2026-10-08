/**
 * An option's details (UI/UX v1 T10; docs/03 §4 DetailPort): the flight itineraries behind one shown result, read
 * only when asked for.
 *
 *   - **Trusted references only.** A `ResultRef` (snapshot id + row key) is resolved against the workspace's own
 *     snapshots — shown, previous, kept — and nothing else. An unknown reference is refused before anything is sent;
 *     what reaches seats.aero is that row's own source id and cabin, and the scope its snapshot was fetched in.
 *   - **One explicit call.** `load` spends exactly one Get Trips call through the engine (its quota, cache and
 *     transport). A second `load` for the same option while one is in flight joins it. Opening, closing, hovering
 *     and `peek` never send anything.
 *   - **Read again from this device.** What was loaded is kept in memory for this run of the app and shown again
 *     without a call, dated as loaded on this device; in the OAuth flavour for 24 hours at most (`maxAgeMs`), and not
 *     past a Disconnect (`clear`).
 *   - **Only this cabin's itineraries** are the option's; the outbound link is the first trusted one (core
 *     deeplinks/trusted.ts), or none.
 */
import { detailLink, type TrustedLink } from "@awardgrid/core/grid/deeplinks/trusted";
import type { Cabin } from "@awardgrid/core/query/schema";
import type { GetTripsResult, TripSummary } from "@awardgrid/core/seatsaero/trips";
import { CABIN_LETTER_TO_NAME } from "@awardgrid/core/seatsaero/types";
import type { ResultRef, ResultSnapshot, WorkspaceRow } from "@awardgrid/core/workspace/types";
import { refusedByProvider } from "../oauth/refresh-retry";
import type { ApiFailure, ApiResult } from "../search/search";

export interface DetailLoaded {
  /** This cabin's itineraries, cheapest first (runGetTrips' order). */
  trips: TripSummary[];
  link: TrustedLink | null;
  /** When they were loaded on this device (the app's clock). */
  loadedAt: string;
  /** Calls the load sent (from the transport's own count). */
  sentCalls: number;
}

export type DetailOutcome = { kind: "loaded"; value: DetailLoaded } | { kind: "failed"; error: ApiFailure } | { kind: "unknown_ref" };

export interface DetailService {
  /** Forget every loaded itinerary (Disconnect). A load still out when this runs keeps nothing either. */
  clear(): void;
  /** The shown result a reference names, or null: nothing else can be opened. */
  resolve(ref: ResultRef): { snapshot: ResultSnapshot; row: WorkspaceRow } | null;
  /** Itineraries loaded before on this device for this option, if any. Sends nothing. */
  peek(ref: ResultRef): DetailLoaded | null;
  /** Load this option's itineraries: one seats.aero call — none when they are already loaded or loading. */
  load(ref: ResultRef): Promise<DetailOutcome>;
  /** A load of this option already under way (a page reopened while it runs joins it), or null. Sends nothing. */
  pending(ref: ResultRef): Promise<DetailOutcome> | null;
}

export interface DetailServiceDeps {
  workspace: { getState(): { displayedSnapshot: ResultSnapshot | null; previousSnapshot: ResultSnapshot | null }; history(): readonly ResultSnapshot[] };
  getTrips(option: { availabilityId: string; cabin: Cabin; include_filtered: boolean; min_cabin_pct: number }, apiKey: string | null): Promise<ApiResult<GetTripsResult>>;
  readKey(): Promise<string | null>;
  /**
   * The OAuth flavour: a renewed token after seats.aero refused `rejected`, or null (../oauth/refresh-retry.ts
   * renewedKey). The lookup is then sent once more. Absent for a pasted key, which has nothing to renew.
   */
  renewKey?(rejected: string | null): Promise<string | null>;
  now(): Date;
  /**
   * How long loaded itineraries may be shown again, in ms (the OAuth flavour's short-term caching: 24 hours). Older
   * ones are forgotten and loaded again on request. Absent: kept for this run of the app.
   */
  maxAgeMs?: number | null;
}

export function createDetailService(deps: DetailServiceDeps): DetailService {
  const loaded = new Map<string, DetailLoaded>();
  const inFlight = new Map<string, Promise<DetailOutcome>>();
  /** Moves on every clear(): a load started before it keeps nothing. */
  let generation = 0;
  /** What is kept for `key`, unless it is older than the short-term limit (then forgotten). */
  const held = (key: string): DetailLoaded | null => {
    const value = loaded.get(key);
    if (!value) return null;
    if (deps.maxAgeMs != null && deps.now().getTime() - Date.parse(value.loadedAt) > deps.maxAgeMs) {
      loaded.delete(key);
      return null;
    }
    return value;
  };

  const resolve = (ref: ResultRef) => {
    const state = deps.workspace.getState();
    const snapshots = [state.displayedSnapshot, state.previousSnapshot, ...deps.workspace.history()].filter((s): s is ResultSnapshot => s !== null);
    const snapshot = snapshots.find((s) => s.id === ref.snapshotId);
    const row = snapshot?.rows.find((r) => r.key === ref.rowKey);
    return snapshot && row ? { snapshot, row } : null;
  };
  // The same option in the same fetch scope is the same answer, whichever snapshot shows it.
  const keyOf = (snapshot: ResultSnapshot, row: WorkspaceRow) =>
    [row.value.source_id, row.value.cabin, snapshot.query.include_filtered, snapshot.query.min_cabin_pct].join("|");

  return {
    resolve,
    clear() {
      generation += 1;
      loaded.clear();
      inFlight.clear();
    },
    peek(ref) {
      const found = resolve(ref);
      return found ? held(keyOf(found.snapshot, found.row)) : null;
    },
    pending(ref) {
      const found = resolve(ref);
      return found ? (inFlight.get(keyOf(found.snapshot, found.row)) ?? null) : null;
    },
    load(ref) {
      const found = resolve(ref);
      if (!found) return Promise.resolve({ kind: "unknown_ref" });
      const { snapshot, row } = found;
      const key = keyOf(snapshot, row);
      const kept = held(key);
      if (kept) return Promise.resolve({ kind: "loaded", value: kept });
      const pending = inFlight.get(key);
      if (pending) return pending;
      const started = generation;
      const run = (async (): Promise<DetailOutcome> => {
        const option = {
          availabilityId: row.value.source_id,
          cabin: row.value.cabin,
          include_filtered: snapshot.query.include_filtered,
          min_cabin_pct: snapshot.query.min_cabin_pct,
        };
        const apiKey = await deps.readKey();
        let res = await deps.getTrips(option, apiKey);
        // The OAuth flavour: a refused token is renewed and the lookup sent once more (../oauth/refresh-retry.ts).
        if (refusedByProvider(res) && deps.renewKey) {
          const fresh = await deps.renewKey(apiKey);
          if (fresh) res = await deps.getTrips(option, fresh);
        }
        if (!res.ok) return { kind: "failed", error: res };
        const cabinName = CABIN_LETTER_TO_NAME[row.value.cabin];
        const value: DetailLoaded = {
          trips: res.value.trips.filter((t) => t.cabin.toLowerCase() === cabinName),
          link: detailLink(row.value, res.value.booking_links),
          loadedAt: deps.now().toISOString(),
          sentCalls: res.value.api_calls_used,
        };
        // Disconnected meanwhile: shown to the page that asked, never kept.
        if (started === generation) loaded.set(key, value);
        return { kind: "loaded", value };
      })().finally(() => {
        if (inFlight.get(key) === run) inFlight.delete(key);
      });
      inFlight.set(key, run);
      return run;
    },
  };
}
