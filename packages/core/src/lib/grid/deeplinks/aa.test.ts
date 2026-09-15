import { describe, expect, it } from "vitest";
import { buildAaAwardSearchUrl } from "@/lib/grid/deeplinks/aa";

const KICKOFF_EXAMPLE =
  'https://www.aa.com/booking/search?locale=en_US&pax=1&adult=1&child=0&type=OneWay&searchType=Award&cabin=&carriers=ALL&slices=[{"orig":"SEA","origNearby":true,"dest":"NRT","destNearby":true,"date":"2026-10-15"}]&maxAwardSegmentAllowed=2';

describe("buildAaAwardSearchUrl", () => {
  it("matches the kickoff §4.4 example exactly once slices is decoded", () => {
    const url = buildAaAwardSearchUrl({ origin: "SEA", dest: "NRT", date: "2026-10-15" });
    expect(decodeURIComponent(url)).toBe(KICKOFF_EXAMPLE);
  });

  it("encodes slices with encodeURIComponent and round-trips to the same JSON", () => {
    const url = buildAaAwardSearchUrl({ origin: "SEA", dest: "NRT", date: "2026-10-15" });
    const raw = new URL(url).searchParams.get("slices");
    expect(url).not.toContain("[{");
    expect(url).toContain(
      "slices=" +
        encodeURIComponent(
          '[{"orig":"SEA","origNearby":true,"dest":"NRT","destNearby":true,"date":"2026-10-15"}]',
        ),
    );
    expect(JSON.parse(raw ?? "")).toEqual([
      { orig: "SEA", origNearby: true, dest: "NRT", destNearby: true, date: "2026-10-15" },
    ]);
  });

  it("cabin is empty by default and overridable; pax sets adult too", () => {
    const params = new URL(
      buildAaAwardSearchUrl({
        origin: "HKG",
        dest: "SEA",
        date: "2026-11-01",
        cabin: "BUSINESS",
        pax: 2,
      }),
    ).searchParams;
    expect(params.get("cabin")).toBe("BUSINESS");
    expect(params.get("pax")).toBe("2");
    expect(params.get("adult")).toBe("2");
    expect(params.get("child")).toBe("0");
    expect(params.get("maxAwardSegmentAllowed")).toBe("2");
  });

  it("rejects malformed input instead of building a broken URL", () => {
    expect(() =>
      buildAaAwardSearchUrl({ origin: "sea", dest: "NRT", date: "2026-10-15" }),
    ).toThrow();
    expect(() =>
      buildAaAwardSearchUrl({ origin: "SEA", dest: "NRT", date: "10/15/2026" }),
    ).toThrow();
    expect(() =>
      buildAaAwardSearchUrl({ origin: "SEA", dest: "NRT", date: "2026-10-15", pax: 0 }),
    ).toThrow();
  });
});
