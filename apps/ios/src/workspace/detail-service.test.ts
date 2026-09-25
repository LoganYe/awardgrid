/**
 * The details service (UI/UX v1 T10; acceptance A17, A18): trusted references only, one explicit call, the option's
 * own source id, cabin and scope sent, this cabin's itineraries kept, and nothing sent to peek or to open again.
 */
import { describe, expect, it } from "vitest";
import { fixtureSnapshot, FIXTURE_NOW } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { GetTripsResult, TripSummary } from "@awardgrid/core/seatsaero/trips";
import type { ResultSnapshot } from "@awardgrid/core/workspace/types";
import type { ApiResult } from "../search/search";
import { createDetailService } from "./detail-service";

const trip = (over: Partial<TripSummary>): TripSummary => ({
  id: "t",
  cabin: "business",
  miles: 75000,
  fees_cents: 5840,
  currency: "USD",
  seats: 2,
  stops: 0,
  carriers: "XX",
  flight_numbers: "XX 123",
  departs_at: "2026-10-18T10:30:00Z",
  arrives_at: "2026-10-18T07:40:00Z",
  duration: 730,
  mixed_cabin_pct: null,
  segments: [],
  ...over,
});

function setup(result: ApiResult<GetTripsResult>, snapshot: ResultSnapshot = fixtureSnapshot()) {
  const calls: Array<{ option: unknown; key: string | null }> = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const service = createDetailService({
    workspace: { getState: () => ({ displayedSnapshot: snapshot, previousSnapshot: null }), history: () => [snapshot] },
    getTrips: async (option, key) => {
      calls.push({ option, key });
      await gate;
      return result;
    },
    readKey: async () => "fixture-key",
    now: () => new Date(FIXTURE_NOW),
  });
  return { service, calls, release, snapshot };
}

const ok = (over: Partial<GetTripsResult> = {}): ApiResult<GetTripsResult> => ({
  ok: true,
  value: {
    availability_id: "synthetic-hkg-sea-option",
    trips: [trip({ id: "j" }), trip({ id: "f", cabin: "first", miles: 110000 })],
    fees_cents: 5840,
    currency: "USD",
    booking_url: null,
    booking_links: [
      { label: "Book on Aeroplan", link: "https://www.aircanada.com/aeroplan/redeem", primary: true },
      { label: "Book via United", link: "https://www.united.com/award", primary: false },
    ],
    api_calls_used: 1,
    ...over,
  },
});

describe("createDetailService", () => {
  it("an unknown snapshot or row is refused before anything is sent", async () => {
    const { service, calls, snapshot } = setup(ok());
    expect(await service.load({ snapshotId: "nope", rowKey: snapshot.rows[0]!.key })).toEqual({ kind: "unknown_ref" });
    expect(await service.load({ snapshotId: snapshot.id, rowKey: "nope" })).toEqual({ kind: "unknown_ref" });
    expect(service.resolve({ snapshotId: snapshot.id, rowKey: "nope" })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("sends the row's own source id, cabin and fetch scope; keeps this cabin's itineraries and its own program's link", async () => {
    const { service, calls, release, snapshot } = setup(ok());
    const row = snapshot.rows[0]!; // Oct 18 Business
    const ref = { snapshotId: snapshot.id, rowKey: row.key };
    expect(service.peek(ref)).toBeNull();
    const first = service.load(ref);
    const second = service.load(ref); // a double tap joins the first
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      option: { availabilityId: row.value.source_id, cabin: "J", include_filtered: false, min_cabin_pct: 100 },
      key: "fixture-key",
    });
    expect(a).toBe(b);
    if (a.kind !== "loaded") throw new Error("not loaded");
    expect(a.value.trips.map((t) => t.id)).toEqual(["j"]);
    expect(a.value.link).toEqual({ url: "https://www.aircanada.com/aeroplan/redeem", host: "www.aircanada.com" });
    expect(a.value.loadedAt).toBe(new Date(FIXTURE_NOW).toISOString());
    // Read again from this device: nothing sent, and a later load answers from it too.
    expect(service.peek(ref)?.trips.map((t) => t.id)).toEqual(["j"]);
    expect(await service.load(ref)).toEqual(a);
    expect(calls).toHaveLength(1);
  });

  it("a page opened while a load is under way can join it instead of sending another", async () => {
    const { service, calls, release, snapshot } = setup(ok());
    const ref = { snapshotId: snapshot.id, rowKey: snapshot.rows[0]!.key };
    expect(service.pending(ref)).toBeNull();
    const first = service.load(ref);
    const joined = service.pending(ref);
    expect(joined).toBe(first);
    release();
    await joined;
    expect(service.pending(ref)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("a failure is reported and nothing is kept", async () => {
    const { service, release, snapshot } = setup({ ok: false, status: 504, error: "network", message: "timed out" });
    release();
    const ref = { snapshotId: snapshot.id, rowKey: snapshot.rows[0]!.key };
    expect(await service.load(ref)).toMatchObject({ kind: "failed", error: { error: "network" } });
    expect(service.peek(ref)).toBeNull();
  });

  it("no trusted link at all: no link, and the details offer to copy the search", async () => {
    const { service, release, snapshot } = setup(ok({ booking_links: [{ label: "x", link: "data:text/html,x", primary: true }] }));
    release();
    const outcome = await service.load({ snapshotId: snapshot.id, rowKey: snapshot.rows[0]!.key });
    expect(outcome.kind === "loaded" && outcome.value.link).toBeNull();
  });
});
