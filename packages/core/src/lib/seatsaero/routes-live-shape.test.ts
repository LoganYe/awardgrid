/**
 * What a live Get Routes response may leave out, learned by spending real calls.
 *
 * On 2026-09-23, the first Ask question asked on a real seats.aero Pro key failed its search after
 * two calls. The tool result the app sent Claude carried the reason: "seats.aero routes response did
 * not match the documented schema at \"0.NumDaysOut\": Invalid input: expected number, received
 * undefined." The schema required a field the live API omits, so a parse error threw away rows the
 * calls had already paid for.
 *
 * The OpenAPI snapshot the schema was written from gives `NumDaysOut` and `Distance` a `default: 0`
 * (docs/reference/seatsaero/get-routes-1.md), and nothing in the app reads either field. Both are
 * defaulted now. The regions have no documented default and stay required, so a response that drops
 * one is still a schema error rather than a silent gap.
 */
import { describe, expect, it } from "vitest";
import { Route, RoutesResponse } from "./types";

/** The fields every documented example carries. */
const NAMED = { ID: "2QghXwB1QjGRYbTBKFBkSDD1Wcs", OriginAirport: "SEA", DestinationAirport: "NRT", Source: "alaska" } as const;
const REGIONS = { OriginRegion: "North America", DestinationRegion: "Asia" } as const;

describe("a Get Routes entry as the live API sends it", () => {
  it("parses without NumDaysOut, the field that failed the first paid search, and reads 0", () => {
    const parsed = Route.safeParse({ ...NAMED, ...REGIONS, Distance: 4787 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.NumDaysOut).toBe(0);
  });

  it("parses without Distance, which the same snapshot also defaults, and reads 0", () => {
    const parsed = Route.safeParse({ ...NAMED, ...REGIONS, NumDaysOut: 330 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.Distance).toBe(0);
  });

  it("keeps the values it is given", () => {
    const parsed = Route.safeParse({ ...NAMED, ...REGIONS, NumDaysOut: 330, Distance: 4787 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect([parsed.data.NumDaysOut, parsed.data.Distance]).toEqual([330, 4787]);
  });

  it("still refuses a response missing a region, which the documentation gives no default", () => {
    expect(Route.safeParse({ ...NAMED, DestinationRegion: "Asia", NumDaysOut: 1, Distance: 1 }).success).toBe(false);
    expect(Route.safeParse({ ...NAMED, OriginRegion: "North America", NumDaysOut: 1, Distance: 1 }).success).toBe(false);
  });

  it("parses a whole response where only some entries carry the two fields", () => {
    const parsed = RoutesResponse.safeParse([
      { ...NAMED, ...REGIONS },
      { ...NAMED, ...REGIONS, ID: "second", NumDaysOut: 330, Distance: 4787 },
    ]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.map((r) => r.NumDaysOut)).toEqual([0, 330]);
  });
});
