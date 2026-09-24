/**
 * What a live Get Trips response may leave out, learned by spending real calls.
 *
 * On 2026-09-23 a `get_flights` lookup on the owner's own Pro key failed after one call. The tool
 * result the app sent Claude carried the reason: "seats.aero could not complete the lookup: seats.aero
 * trips response did not match the documented schema at \"data.0.TaxesCurrency\": Invalid input:
 * expected string, received undefined." The live API omits the key; the documentation's own example
 * for it is the empty string (docs/reference/seatsaero/get-trips.md), which the code has always read
 * as "unknown currency". Only the schema disagreed, and a parse error threw away a paid call.
 *
 * `TotalTaxes` stays required on purpose. The documentation gives it a `default: 0`, but a missing fee
 * amount is not a fee of zero, and `TripSummary.fees_cents` is what the answer prints as the fees. A
 * default there would state a fact seats.aero did not send.
 */
import { describe, expect, it } from "vitest";
import { summarizeTrip } from "./trips";
import { Trip } from "./types";

/** A documented trip, minus the fields under test. */
const TRIP = {
  ID: "trip-1",
  AvailabilityID: "avail-1",
  Stops: 0,
  Carriers: "AS",
  RemainingSeats: 4,
  MileageCost: 95_000,
  TotalTaxes: 600,
  FlightNumbers: "AS123",
  DepartsAt: "2026-10-07T13:20:00Z",
  ArrivesAt: "2026-10-08T16:00:00Z",
  Cabin: "business",
  Source: "alaska",
} as const;

describe("a Get Trips entry as the live API sends it", () => {
  it("parses with no TaxesCurrency, the field that lost a paid lookup, and reads as unknown currency", () => {
    const parsed = Trip.safeParse(TRIP);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.TaxesCurrency).toBeUndefined();
      const summary = summarizeTrip(parsed.data);
      expect(summary.currency).toBeNull();
      expect(summary.fees_cents).toBe(600);
    }
  });

  it("reads the documented empty string the same way", () => {
    const parsed = Trip.safeParse({ ...TRIP, TaxesCurrency: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(summarizeTrip(parsed.data).currency).toBeNull();
  });

  it("keeps a currency it is given", () => {
    const parsed = Trip.safeParse({ ...TRIP, TaxesCurrency: "USD" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(summarizeTrip(parsed.data).currency).toBe("USD");
  });

  it("still refuses a trip with no TotalTaxes, because a missing fee is not a fee of zero", () => {
    const { TotalTaxes: _dropped, ...withoutTaxes } = TRIP;
    expect(Trip.safeParse(withoutTaxes).success).toBe(false);
  });
});
