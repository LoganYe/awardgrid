import { describe, expect, it } from "vitest";
import { Availability, AvailabilityRoute, Route, Trip } from "@/lib/seatsaero/types";

/** The Availability example from the official Concepts page ("Availability Objects"), verbatim. */
const CONCEPTS_AVAILABILITY = {
  ID: "abcdef",
  Route: { ID: "ghijkl", OriginAirport: "SFO", DestinationAirport: "LAX", Source: "alaska" },
  Date: "2024-03-16",
  YAvailable: true,
  YDirect: true,
  YMileageCost: "5000",
  YRemainingSeats: 7,
  YAirlines: "AA, AS",
  JAvailable: true,
  JDirect: true,
  JMileageCost: "10000",
  JRemainingSeats: 3,
  JAirlines: "AA, AS",
  Source: "alaska",
};

describe("seats.aero response schemas", () => {
  it("accepts the Concepts-page Availability example (no RouteID, minimal embedded Route)", () => {
    const parsed = Availability.safeParse(CONCEPTS_AVAILABILITY);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.RouteID).toBeUndefined();
      expect(parsed.data.Route.OriginAirport).toBe("SFO");
      expect(parsed.data.Route.OriginRegion).toBeUndefined();
    }
  });

  it("Get Routes entries stay fully documented, the embedded route is lenient", () => {
    const minimal = { ID: "x", OriginAirport: "SFO", DestinationAirport: "LAX", Source: "alaska" };
    expect(AvailabilityRoute.safeParse(minimal).success).toBe(true);
    expect(Route.safeParse(minimal).success).toBe(false);
    expect(Route.safeParse({ ...minimal, OriginRegion: "North America", DestinationRegion: "North America", NumDaysOut: 60, Distance: 337 }).success).toBe(true);
  });

  it("MixedCabinPct is an integer per the Get Trips OpenAPI (1..100)", () => {
    const base = {
      ID: "t", AvailabilityID: "a", Stops: 0, Carriers: "AS", RemainingSeats: 1, MileageCost: 1, TotalTaxes: 0,
      TaxesCurrency: "USD", FlightNumbers: "AS1", DepartsAt: "2024-03-16T10:00:00Z", Cabin: "business",
      ArrivesAt: "2024-03-16T12:00:00Z", Source: "alaska",
    };
    expect(Trip.safeParse({ ...base, MixedCabinPct: 25 }).success).toBe(true);
    expect(Trip.safeParse({ ...base, MixedCabinPct: 25.5 }).success).toBe(false);
    expect(Trip.safeParse(base).success).toBe(true);
  });
});
