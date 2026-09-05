import { describe, expect, it } from "vitest";
import { availabilitiesToRows, availabilityToRows, parseMiles, splitAirlines, tripsToFees } from "@/lib/seatsaero/normalize";
import type { Availability, SearchResponse, TripsResponse } from "@/lib/seatsaero/types";
import { loadFixture } from "../../../test/fixtures/seatsaero/helpers";

const search = loadFixture<SearchResponse>("search.json");
const FETCHED_AT = "2026-10-01T12:00:00.000Z";

describe("availabilityToRows", () => {
  it("emits one row per available cabin with a positive cost, skipping '0' and null cabins", () => {
    // Official example row 0: Y 12500, W "0", J 33000, F 33000.
    const rows = availabilityToRows(search.data[0]!, { fetchedAt: FETCHED_AT });
    expect(rows.map((r) => r.cabin)).toEqual(["Y", "J", "F"]);
    const y = rows[0]!;
    expect(y).toMatchObject({
      program: "american",
      origin: "SFO",
      dest: "JFK",
      date: "2023-08-11",
      miles: 12500,
      seats_left: 0,
      direct: true,
      airlines: ["AA", "B6"],
      fees_cents: null,
      currency: null,
      source_id: "2QSaUXJ0ZuSVqgrRWqkSlXhnVbS",
      booking_url: null,
      fetched_at: FETCHED_AT,
    });
    // computed_last_seen falls back to UpdatedAt when ComputedLastSeen is absent
    expect(y.computed_last_seen).toBe("2023-07-10T13:52:23.343425Z");

    const fNull = search.data.find((a) => a.FAvailable === null)!;
    const rows2 = availabilityToRows(fNull, { fetchedAt: FETCHED_AT });
    expect(rows2.map((r) => r.cabin)).toEqual(["Y", "W", "J"]);
    expect(rows2.find((r) => r.cabin === "J")).toMatchObject({ miles: 54200, seats_left: 3, airlines: ["VS"] });
  });

  it("uses the freshness fallback chain ComputedLastSeen ?? UpdatedAt ?? fetchedAt and observed tax fields", () => {
    const base: Availability = { ...search.data[0]! };
    const seen = availabilityToRows({ ...base, ComputedLastSeen: "2026-09-30T00:00:00Z" }, { fetchedAt: FETCHED_AT });
    expect(seen[0]!.computed_last_seen).toBe("2026-09-30T00:00:00Z");
    const noneAtAll = availabilityToRows({ ...base, UpdatedAt: undefined }, { fetchedAt: FETCHED_AT });
    expect(noneAtAll[0]!.computed_last_seen).toBe(FETCHED_AT);

    const taxed = availabilityToRows(
      { ...base, JTotalTaxes: 5600, TaxesCurrency: "USD", JRemainingSeats: null, JDirect: null },
      { fetchedAt: FETCHED_AT },
    );
    const j = taxed.find((r) => r.cabin === "J")!;
    expect(j).toMatchObject({ fees_cents: 5600, currency: "USD", seats_left: 0, direct: false });
    expect(taxed.find((r) => r.cabin === "Y")!.fees_cents).toBeNull();
    // "" currency normalizes to null
    expect(availabilityToRows({ ...base, TaxesCurrency: "" }, { fetchedAt: FETCHED_AT })[0]!.currency).toBeNull();
  });

  it("handles the whole official fixture without throwing and only yields positive miles", () => {
    const rows = availabilitiesToRows(search.data, { fetchedAt: FETCHED_AT });
    expect(rows.length).toBeGreaterThan(42);
    expect(rows.every((r) => r.miles > 0)).toBe(true);
    expect(new Set(rows.map((r) => r.program))).toEqual(new Set(["alaska", "american", "delta", "virginatlantic"]));
  });

  it("helpers", () => {
    expect(splitAirlines("AA, B6")).toEqual(["AA", "B6"]);
    expect(splitAirlines("")).toEqual([]);
    expect(splitAirlines(null)).toEqual([]);
    expect(parseMiles("12500")).toBe(12500);
    expect(parseMiles("0")).toBe(0);
    expect(parseMiles(null)).toBe(0);
    expect(parseMiles("abc")).toBe(0);
  });
});

describe("tripsToFees", () => {
  const trips = loadFixture<TripsResponse>("trips__id.json");

  it("takes the cheapest trip's taxes and the primary booking link", () => {
    const fees = tripsToFees(trips);
    const cheapest = [...trips.data].sort((a, b) => a.MileageCost - b.MileageCost)[0]!;
    expect(fees.fees_cents).toBe(cheapest.TotalTaxes);
    expect(fees.booking_url).toBe("https://www.lifemiles.com/fly/find");
    // Official example has TaxesCurrency "" → null
    expect(fees.currency).toBeNull();
  });

  it("filters by cabin (letter or API name) and returns nulls when nothing matches", () => {
    expect(tripsToFees(trips, "J").fees_cents).not.toBeNull();
    expect(tripsToFees(trips, "business").fees_cents).toBe(tripsToFees(trips, "J").fees_cents);
    expect(tripsToFees(trips, "F")).toEqual({ fees_cents: null, currency: null, booking_url: "https://www.lifemiles.com/fly/find" });
    expect(tripsToFees({ data: [], booking_links: [] }).booking_url).toBeNull();
  });
});
