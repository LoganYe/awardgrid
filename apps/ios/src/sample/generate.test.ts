/**
 * Sample mode's generator (release plan step 16): deterministic, any route between the seed's airports, today to
 * today + 364, all four cabins; nonstop only under 7,500 statute miles, one connection through a hub otherwise; leg
 * times from distance; ids that say what they are; real program names with invented numbers; no links anywhere.
 */
import { SEATS_SOURCES } from "@awardgrid/core/seatsaero/types";
import { describe, expect, it } from "vitest";
import { SAMPLE_AIRPORTS, greatCircleMiles } from "./airports";
import {
  NONSTOP_LIMIT_MILES,
  SAMPLE_CABINS,
  availabilityId,
  connectionHub,
  generateSample,
  legMinutes,
  readAvailabilityId,
  sampleCoversDate,
  sampleItineraries,
  sampleWindow,
  tripId,
} from "./generate";
import { DEMO_PROGRAMS, addDays } from "./shared";

const TODAY = "2026-10-18";
const AIRPORTS = Object.keys(SAMPLE_AIRPORTS);

describe("generateSample", () => {
  it("is deterministic: the same route, day and cabin give the same offers, on any call", () => {
    const q = { origin: "HKG", destination: "SEA", date: "2026-11-02", cabin: "J" as const, today: TODAY };
    expect(generateSample(q)).toEqual(generateSample({ ...q }));
    // `today` decides coverage only, never a price.
    expect(generateSample(q)).toEqual(generateSample({ ...q, today: "2026-10-20" }));
    const days = Array.from({ length: 30 }, (_, i) => addDays(TODAY, i));
    const all = (cabin: "Y" | "J") => days.map((date) => generateSample({ ...q, date, cabin }));
    expect(all("J")).not.toEqual(all("Y"));
  });

  it("covers any route between two of the seed's airports, both ways: every pair has offers in the next 30 days", () => {
    const days = Array.from({ length: 30 }, (_, i) => addDays(TODAY, i));
    const empty: string[] = [];
    for (const origin of AIRPORTS) {
      for (const destination of AIRPORTS) {
        if (origin === destination) continue;
        const found = days.some((date) => SAMPLE_CABINS.some((cabin) => generateSample({ origin, destination, date, cabin, today: TODAY }).length > 0));
        if (!found) empty.push(`${origin}-${destination}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it("covers a metro code as its first airport's route, and nothing outside the seed, the window or a code to itself", () => {
    const has = (origin: string, destination: string, date = "2026-11-02") =>
      SAMPLE_CABINS.some((cabin) => generateSample({ origin, destination, date, cabin, today: TODAY }).length > 0) ||
      Array.from({ length: 30 }, (_, i) => addDays(date, i)).some((d) => SAMPLE_CABINS.some((cabin) => generateSample({ origin, destination, date: d, cabin, today: TODAY }).length > 0));
    expect(has("TYO", "SEL")).toBe(true);
    expect(has("LAX", "TYO")).toBe(true);
    for (const cabin of SAMPLE_CABINS) {
      expect(generateSample({ origin: "LIS", destination: "SEA", date: "2026-11-02", cabin, today: TODAY })).toEqual([]);
      expect(generateSample({ origin: "SEA", destination: "XYZ", date: "2026-11-02", cabin, today: TODAY })).toEqual([]);
      expect(generateSample({ origin: "SEA", destination: "SEA", date: "2026-11-02", cabin, today: TODAY })).toEqual([]);
      expect(generateSample({ origin: "TYO", destination: "NRT", date: "2026-11-02", cabin, today: TODAY })).toEqual([]);
      expect(generateSample({ origin: "HKG", destination: "SEA", date: addDays(TODAY, -1), cabin, today: TODAY })).toEqual([]);
      expect(generateSample({ origin: "HKG", destination: "SEA", date: addDays(TODAY, 365), cabin, today: TODAY })).toEqual([]);
    }
  });

  it("covers today and the 364 days after it, real calendar days only", () => {
    expect(sampleWindow(TODAY)).toEqual({ from: TODAY, to: "2027-10-17" });
    expect(sampleCoversDate(TODAY, TODAY)).toBe(true);
    expect(sampleCoversDate("2027-10-17", TODAY)).toBe(true);
    expect(sampleCoversDate("2027-10-18", TODAY)).toBe(false);
    expect(sampleCoversDate("2026-10-17", TODAY)).toBe(false);
    expect(sampleCoversDate("2026-02-30", "2026-01-01")).toBe(false);
    // The last day still has data on some route.
    const last = sampleWindow(TODAY).to;
    expect(AIRPORTS.slice(0, 10).some((o) => SAMPLE_CABINS.some((cabin) => generateSample({ origin: o, destination: "SEA", date: last, cabin, today: TODAY }).length > 0))).toBe(true);
  });

  it("offers real seats.aero programs with invented, distance-shaped prices in all four cabins", () => {
    const seen = new Set<string>();
    const cabins = new Set<string>();
    const days = Array.from({ length: 60 }, (_, i) => addDays(TODAY, i));
    const priceOf = (origin: string, destination: string) => {
      const miles: number[] = [];
      for (const date of days) for (const offer of generateSample({ origin, destination, date, cabin: "J", today: TODAY })) if (!offer.dynamic) miles.push(offer.miles);
      return miles.reduce((a, b) => a + b, 0) / miles.length;
    };
    for (const date of days) {
      for (const cabin of SAMPLE_CABINS) {
        for (const offer of generateSample({ origin: "LAX", destination: "NRT", date, cabin, today: TODAY })) {
          seen.add(offer.program);
          cabins.add(offer.cabin);
          expect(SEATS_SOURCES).toContain(offer.program);
          expect(offer.miles % 500).toBe(0);
          expect(offer.seats).toBeGreaterThanOrEqual(0);
          if (offer.feesCents !== null) expect(offer.feesCents).toBeGreaterThan(0);
        }
      }
    }
    expect([...seen].sort()).toEqual([...DEMO_PROGRAMS].sort());
    expect([...cabins].sort()).toEqual(["F", "J", "W", "Y"]);
    // A long route costs more miles, and more taxes, than a short one.
    expect(priceOf("HKG", "JFK")).toBeGreaterThan(priceOf("HKG", "TPE") * 2);
    const taxOf = (origin: string, destination: string, program: "aeroplan") => {
      const fees: number[] = [];
      for (const date of days) for (const cabin of SAMPLE_CABINS) for (const o of generateSample({ origin, destination, date, cabin, today: TODAY })) if (o.program === program && o.feesCents !== null) fees.push(o.feesCents);
      return fees.reduce((a, b) => a + b, 0) / fees.length;
    };
    expect(taxOf("HKG", "JFK", "aeroplan")).toBeGreaterThan(taxOf("HKG", "TPE", "aeroplan") * 2);
  });

  it("flies nonstop only under 7,500 miles; longer routes connect once, through the hub that adds the least distance", () => {
    const long = ["SIN", "JFK"] as const;
    expect(greatCircleMiles(...long)!).toBeGreaterThan(NONSTOP_LIMIT_MILES);
    const days = Array.from({ length: 60 }, (_, i) => addDays(TODAY, i));
    const offers = days.flatMap((date) => SAMPLE_CABINS.flatMap((cabin) => generateSample({ origin: long[0], destination: long[1], date, cabin, today: TODAY })));
    expect(offers.length).toBeGreaterThan(0);
    const hub = connectionHub(...long)!;
    for (const offer of offers) {
      expect(offer.direct).toBe(false);
      expect(offer.hub).toBe(hub);
      expect(offer.carriers).toHaveLength(2);
    }
    // No other hub would have been shorter, and both legs are flyable.
    const total = greatCircleMiles(long[0], hub)! + greatCircleMiles(hub, long[1])!;
    expect(greatCircleMiles(long[0], hub)!).toBeLessThanOrEqual(9_000);
    expect(greatCircleMiles(hub, long[1])!).toBeLessThanOrEqual(9_000);
    expect(total).toBeLessThan(greatCircleMiles(...long)! * 1.25);
    // A short route has nonstop offers, and some connections too.
    const short = days.flatMap((date) => generateSample({ origin: "HKG", destination: "SEA", date, cabin: "Y", today: TODAY }));
    expect(short.some((o) => o.direct)).toBe(true);
    expect(short.some((o) => !o.direct)).toBe(true);
  });

  it("every route over 7,500 miles has a connection to make", () => {
    for (const origin of AIRPORTS) {
      for (const destination of AIRPORTS) {
        if (origin !== destination && greatCircleMiles(origin, destination)! >= NONSTOP_LIMIT_MILES) expect(connectionHub(origin, destination), `${origin}-${destination}`).not.toBeNull();
      }
    }
  });
});

describe("ids", () => {
  it("say the route, day and program (and the cabin, for a trip), and read back", () => {
    const id = availabilityId("HKG", "SEA", "2026-11-02", "alaska");
    expect(id).toBe("smp-HKG-SEA-20261102-alaska");
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readAvailabilityId(id)).toEqual({ origin: "HKG", destination: "SEA", date: "2026-11-02", program: "alaska" });
    expect(tripId(id, "J", 2)).toBe("smp-HKG-SEA-20261102-alaska-J-2");
    expect(readAvailabilityId("smp-HKG-SEA-20261102-delta")).toBeNull();
    expect(readAvailabilityId("2abcdefghijklmnopqrstuvwxyz")).toBeNull();
  });
});

describe("sampleItineraries", () => {
  const offerOn = (origin: string, destination: string, cabin: "J" | "Y", want: (direct: boolean) => boolean) => {
    for (let i = 0; i < 120; i += 1) {
      const date = addDays(TODAY, i);
      const offer = generateSample({ origin, destination, date, cabin, today: TODAY }).find((o) => want(o.direct));
      if (offer) return { offer, date };
    }
    throw new Error(`no offer on ${origin}-${destination}`);
  };

  it("draws the offer itself first, then variations, all the same on every call", () => {
    const { offer, date } = offerOn("HKG", "SEA", "J", (d) => d);
    const trips = sampleItineraries("HKG", "SEA", date, offer);
    expect(trips).toEqual(sampleItineraries("HKG", "SEA", date, offer));
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(trips.length).toBeLessThanOrEqual(3);
    expect(trips[0]!.miles).toBe(offer.miles);
    expect(trips[0]!.seats).toBe(offer.seats);
    expect(trips[0]!.legs).toHaveLength(1);
    expect(trips[0]!.id).toBe(tripId(availabilityId("HKG", "SEA", date, offer.program), "J", 1));
  });

  it("times each leg from its distance and sequences a connection on one clock: none leaves before it lands", () => {
    const { offer, date } = offerOn("SIN", "JFK", "J", (d) => !d);
    for (const trip of sampleItineraries("SIN", "JFK", date, offer)) {
      expect(trip.legs).toHaveLength(2);
      expect(trip.legs[0]!.to).toBe(trip.legs[1]!.from);
      let flying = 0;
      for (const leg of trip.legs) {
        expect(leg.miles).toBe(greatCircleMiles(leg.from, leg.to));
        const utc = (iso: string, code: string) => Date.parse(iso) - SAMPLE_AIRPORTS[code]!.utc * 3_600_000;
        expect((utc(leg.arrivesAt, leg.to) - utc(leg.departsAt, leg.from)) / 60_000).toBe(legMinutes(leg.miles));
        flying += legMinutes(leg.miles);
        expect(leg.flightNumber).toMatch(/^[A-Z0-9]{2}\d{2,3}$/);
      }
      const landed = Date.parse(trip.legs[0]!.arrivesAt) - SAMPLE_AIRPORTS[trip.legs[0]!.to]!.utc * 3_600_000;
      const left = Date.parse(trip.legs[1]!.departsAt) - SAMPLE_AIRPORTS[trip.legs[1]!.from]!.utc * 3_600_000;
      expect(left).toBeGreaterThan(landed);
      expect(trip.durationMinutes).toBe(flying + (left - landed) / 60_000);
    }
    expect(legMinutes(860)).toBe(130);
  });

  it("carries no link of any kind", () => {
    const { offer, date } = offerOn("LAX", "NRT", "Y", () => true);
    const text = JSON.stringify([offer, sampleItineraries("LAX", "NRT", date, offer)]);
    expect(text).not.toMatch(/https?:|example\.com|www\./);
  });
});
