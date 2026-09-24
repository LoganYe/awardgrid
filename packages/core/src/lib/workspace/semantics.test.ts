/**
 * T02 — truthful fields (plan 01 T02; acceptance A02–A04).
 *
 * Unknown is never a confirmed zero, a local fetch time is never the provider's time, and an identity never
 * depends on array position. The first describe block is the plan's own test; the rest are the counter-examples
 * it asks for.
 */
import { describe, expect, it } from "vitest";
import { availabilityToRows } from "../seatsaero/normalize";
import { Availability } from "../seatsaero/types";
import { ageMs, feesState, isRealDate, knownFees, knownSeats, parseInstant, rowTimeEvidence, toTimeEvidence } from "./semantics";
import { scopeKey, rowKey } from "./identity";
import fixture from "../../../test/fixtures/uiux/availability-rows.json";
import { QueryObject } from "../query/schema";
import type { AvailabilityRow } from "../grid/types";

describe("truthful fields", () => {
  it("keeps unknown apart from a confirmed zero", () => {
    expect(knownSeats(0)).toBeNull();
    expect(knownFees(null, "USD")).toBeNull();
    expect(knownFees(0, "USD")).toEqual({ cents: 0, currency: "USD" });
    expect(knownFees(8620, null)).toBeNull();
  });
  it("local fetch is not provider freshness", () => {
    expect(toTimeEvidence({ fetchedAt: fixture.now, now: fixture.now }).basis).toBe("local_fallback");
    expect(toTimeEvidence({ providerLastSeen: "2099-01-01T00:00:00Z", now: fixture.now }).providerAt).toBeNull();
  });
  it("distinguishes cabins even with the same source id", () => {
    const q = QueryObject.parse(fixture.query);
    const r = fixture.rows[0] as AvailabilityRow;
    expect(rowKey(r, scopeKey(q))).not.toBe(rowKey({ ...r, cabin: "F" }, scopeKey(q)));
  });
});

describe("knownSeats: only a positive whole count is a seat count", () => {
  it.each([
    [undefined, null],
    [null, null],
    [0, null],
    [-1, null],
    [1.5, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [1e21, null],
    [2 ** 53 + 2, null],
    [1, 1],
    [9, 9],
  ])("%s → %s", (input, expected) => {
    expect(knownSeats(input as number | null | undefined)).toBe(expected);
  });
});

describe("knownFees / feesState: amount and currency are separate unknowns", () => {
  it("accepts an explicit zero with a currency, and normalises the code", () => {
    expect(knownFees(0, "USD")).toEqual({ cents: 0, currency: "USD" });
    expect(knownFees(8620, " usd ")).toEqual({ cents: 8620, currency: "USD" });
  });
  it.each([
    [null, "USD"],
    [8620, null],
    [8620, ""],
    [8620, "   "],
    [8620, "US"],
    [8620, "US DOLLAR"],
    [-100, "USD"],
    [86.2, "USD"],
    [Number.NaN, "USD"],
    [1e21, "USD"],
    [2 ** 53 + 2, "USD"],
    [8620, "uſd"],
    [8620, "ınr"],
    [8620, "\u00a0USD\u2003"],
    [8620, "ＵＳＤ"],
  ])("knownFees(%s, %j) is null", (cents, currency) => {
    expect(knownFees(cents as number | null, currency as string | null)).toBeNull();
  });
  it("never keeps a negative zero, which would print as -$0.00", () => {
    expect(Object.is(knownFees(-0, "USD")!.cents, 0)).toBe(true);
    const state = feesState(-0, "USD");
    expect(state.kind === "known" && Object.is(state.cents, 0)).toBe(true);
  });
  it("tells 'no amount' from 'amount without a currency' — neither is free", () => {
    expect(feesState(null, "USD")).toEqual({ kind: "unknown" });
    expect(feesState(null, null)).toEqual({ kind: "unknown" });
    expect(feesState(8620, null)).toEqual({ kind: "currency_missing", cents: 8620 });
    expect(feesState(8620, "")).toEqual({ kind: "currency_missing", cents: 8620 });
    expect(feesState(0, "USD")).toEqual({ kind: "known", cents: 0, currency: "USD" });
    expect(feesState(-1, "USD")).toEqual({ kind: "unknown" });
  });
});

describe("toTimeEvidence: the basis is kept, and a bad or future time is never 'just now'", () => {
  const now = fixture.now; // 2026-10-18T08:30:00Z

  it("matches the fixture's expected basis for each case", () => {
    for (const c of fixture.timeEvidence) {
      const evidence = toTimeEvidence({ ...c, now });
      expect(evidence.basis).toBe(c.expectedBasis);
      expect(evidence.fetchedAt).toBe(c.fetchedAt);
    }
  });

  it("prefers the provider's last-seen time, then its updated time, then the local fetch", () => {
    expect(toTimeEvidence({ providerLastSeen: "2026-10-17T06:00:00Z", providerUpdatedAt: "2026-10-16T00:00:00Z", now })).toEqual({
      basis: "provider_last_seen",
      providerAt: "2026-10-17T06:00:00Z",
      fetchedAt: null,
    });
    expect(toTimeEvidence({ providerLastSeen: null, providerUpdatedAt: "2026-10-16T00:00:00Z", fetchedAt: "2026-10-18T08:00:00Z", now })).toEqual({
      basis: "provider_updated",
      providerAt: "2026-10-16T00:00:00Z",
      fetchedAt: "2026-10-18T08:00:00Z",
    });
    expect(toTimeEvidence({ now })).toEqual({ basis: "unknown", providerAt: null, fetchedAt: null });
  });

  it("falls through a future provider time instead of calling it fresh", () => {
    const evidence = toTimeEvidence({
      providerLastSeen: "2099-01-01T00:00:00Z",
      providerUpdatedAt: "2026-10-18T09:00:00Z", // 30 minutes ahead of now: also future
      fetchedAt: "2026-10-18T08:00:00Z",
      now,
    });
    expect(evidence).toEqual({ basis: "local_fallback", providerAt: null, fetchedAt: "2026-10-18T08:00:00Z" });
  });

  it("tolerates a minute of clock skew, not more", () => {
    expect(toTimeEvidence({ providerLastSeen: "2026-10-18T08:30:45Z", now }).providerAt).toBe("2026-10-18T08:30:45Z");
    expect(toTimeEvidence({ providerLastSeen: "2026-10-18T08:32:00Z", now }).providerAt).toBeNull();
  });

  it("rejects timestamps that are not full ISO instants or not real calendar times", () => {
    for (const bad of ["2026-10-17", "2026-10-17 06:00", "yesterday", "", "2026-02-30T00:00:00Z", "2026-10-17T25:00:00Z", "2026-10-17T06:00:00"]) {
      expect(toTimeEvidence({ providerLastSeen: bad, now }).providerAt).toBeNull();
    }
    expect(toTimeEvidence({ providerLastSeen: "2026-10-17T06:00:00.123456Z", now }).providerAt).toBe("2026-10-17T06:00:00.123456Z");
    expect(toTimeEvidence({ providerLastSeen: "2026-10-17T14:00:00+08:00", now }).providerAt).toBe("2026-10-17T14:00:00+08:00");
  });

  it("does not accept a future local fetch time either", () => {
    expect(toTimeEvidence({ fetchedAt: "2026-10-19T00:00:00Z", now })).toEqual({ basis: "unknown", providerAt: null, fetchedAt: null });
  });

  it("refuses an invalid clock rather than guessing", () => {
    expect(() => toTimeEvidence({ fetchedAt: fixture.now, now: "not a time" })).toThrow();
  });
});

describe("rowTimeEvidence: a cached row proves its provider time only if it recorded the basis", () => {
  const now = fixture.now;
  const base = fixture.rows[2] as AvailabilityRow;

  it("uses the recorded basis", () => {
    expect(rowTimeEvidence({ ...base, time_basis: "provider_last_seen" }, now)).toEqual({
      basis: "provider_last_seen",
      providerAt: base.computed_last_seen,
      fetchedAt: base.fetched_at,
    });
    expect(rowTimeEvidence({ ...base, time_basis: "provider_updated" }, now).basis).toBe("provider_updated");
    expect(rowTimeEvidence({ ...base, time_basis: "local_fallback" }, now)).toEqual({ basis: "local_fallback", providerAt: null, fetchedAt: base.fetched_at });
  });

  it("falls back to the provider's UpdatedAt when the recorded ComputedLastSeen is unusable", () => {
    const row = { ...base, time_basis: "provider_last_seen" as const, computed_last_seen: "2026-10-18T08:35:00Z", provider_updated_at: "2026-10-16T00:00:00Z" };
    expect(rowTimeEvidence(row, now)).toEqual({ basis: "provider_updated", providerAt: "2026-10-16T00:00:00Z", fetchedAt: base.fetched_at });
  });

  it("reads a row with no recorded provenance as unknown — not as a provider time, and not as local_fallback", () => {
    const legacy: AvailabilityRow = { ...base };
    delete legacy.time_basis;
    expect(rowTimeEvidence(legacy, now)).toEqual({ basis: "unknown", providerAt: null, fetchedAt: base.fetched_at });
    const garbled = { ...base, time_basis: "provider" as unknown as AvailabilityRow["time_basis"] };
    expect(rowTimeEvidence(garbled, now).basis).toBe("unknown");
    expect(rowTimeEvidence({ ...legacy, fetched_at: "2099-01-01T00:00:00Z" }, now)).toEqual({ basis: "unknown", providerAt: null, fetchedAt: null });
  });
});

describe("instants and dates are parsed strictly", () => {
  it("rejects a zero-value or pre-1970 time instead of reading it as the 1900s", () => {
    expect(parseInstant("0001-01-01T00:00:00Z")).toBeNull();
    expect(parseInstant("0026-09-20T00:00:00Z")).toBeNull();
    expect(parseInstant("1969-12-31T23:59:59Z")).toBeNull();
    expect(parseInstant("1970-01-01T00:00:00Z")).toBe(0);
    expect(toTimeEvidence({ providerLastSeen: "0001-01-01T00:00:00Z", providerUpdatedAt: "2026-10-16T00:00:00Z", now: fixture.now }).basis).toBe(
      "provider_updated",
    );
  });

  it("uses real Gregorian leap years", () => {
    for (const ok of ["2028-02-29", "2000-02-29", "2026-12-31", "0004-02-29"]) expect(isRealDate(ok)).toBe(true);
    for (const bad of ["2026-02-29", "1900-02-29", "2100-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-01"]) expect(isRealDate(bad)).toBe(false);
  });

  it("gives an age that is never negative, and none for a non-instant", () => {
    expect(ageMs("2026-10-18T08:00:00Z", fixture.now)).toBe(30 * 60_000);
    expect(ageMs("2026-10-18T08:30:30Z", fixture.now)).toBe(0); // inside the skew window
    expect(ageMs("yesterday", fixture.now)).toBeNull();
    expect(ageMs(null, fixture.now)).toBeNull();
  });
});

describe("decoding records the time basis (seatsaero/normalize.ts)", () => {
  const fetchedAt = "2026-10-18T08:00:00Z";
  const payload = (extra: Record<string, unknown>) =>
    Availability.parse({
      ID: "synthetic-decode",
      Route: { ID: "r", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "aeroplan" },
      Date: "2026-10-18",
      JAvailable: true,
      JMileageCost: "75000",
      Source: "aeroplan",
      ...extra,
    });

  it("marks ComputedLastSeen, UpdatedAt and the local fallback apart", () => {
    const [seen] = availabilityToRows(payload({ ComputedLastSeen: "2026-10-17T06:00:00Z", UpdatedAt: "2026-10-16T00:00:00Z" }), { fetchedAt });
    const [updated] = availabilityToRows(payload({ UpdatedAt: "2026-10-16T00:00:00Z" }), { fetchedAt });
    const [none] = availabilityToRows(payload({}), { fetchedAt });
    expect(seen!.time_basis).toBe("provider_last_seen");
    expect(updated!.time_basis).toBe("provider_updated");
    expect(none!.time_basis).toBe("local_fallback");
    // Old consumers keep the field they always read, unchanged.
    expect(none!.computed_last_seen).toBe(fetchedAt);
    expect(rowTimeEvidence(none!, fixture.now)).toEqual({ basis: "local_fallback", providerAt: null, fetchedAt });
    expect(seen!.provider_updated_at).toBe("2026-10-16T00:00:00Z");
    expect("provider_updated_at" in none!).toBe(false);
  });

  it.each(["2026-10-18T08:35:00Z", "", "2026-10-17 06:00", "0001-01-01T00:00:00Z"])(
    "keeps the provider's UpdatedAt usable when ComputedLastSeen is %j",
    (computed) => {
      const [row] = availabilityToRows(payload({ ComputedLastSeen: computed, UpdatedAt: "2026-10-16T00:00:00Z" }), { fetchedAt });
      expect(rowTimeEvidence(row!, fixture.now)).toEqual({ basis: "provider_updated", providerAt: "2026-10-16T00:00:00Z", fetchedAt });
    },
  );
});
