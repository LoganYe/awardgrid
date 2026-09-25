/**
 * Structured query-change proposals and the trusted scope (UI/UX v1 T16; docs/02 D08; docs/03 §5; acceptance A27).
 *
 * A proposal is a validated QueryObject against the revision it was made for; the model's word is never consent. A
 * search inside the scope the person included runs; anything wider waits for the person to apply a proposal. A
 * proposal made for another revision is stale and cannot apply.
 */
import { describe, expect, it } from "vitest";
import { proposalChanges, proposalStatus, sameAuthorizedScope } from "./proposals";
import { fixtureSnapshot } from "../../../test/fixtures/uiux/factory";

it("stale proposals cannot apply and extended dates need authorization", () => {
  const q = fixtureSnapshot().query;
  const proposed = { ...q, date_to: "2026-11-06" };
  expect(sameAuthorizedScope(proposed, q)).toBe(false);
  expect(sameAuthorizedScope({ ...q, sort_by: "date_asc" }, q)).toBe(true);
  expect(proposalStatus({ id: "p1", baseRevision: 1, proposed, reason: "Example", status: "pending" }, 2)).toBe("stale");
});

describe("sameAuthorizedScope: inside the included search runs; anything wider needs the person", () => {
  const q = { ...fixtureSnapshot().query, origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J", "F"] as ("J" | "F")[], programs: ["aeroplan"] };

  it("a narrower look is inside: fewer days, one cabin, stricter filters", () => {
    expect(sameAuthorizedScope({ ...q, date_from: "2026-10-10", date_to: "2026-10-12", cabins: ["J"] }, q)).toBe(true);
    expect(sameAuthorizedScope({ ...q, direct_only: true, max_miles: 70000, min_cabin_pct: 100 }, q)).toBe(true);
  });

  it("another airport, earlier or later days, another cabin, another program or all programs is outside", () => {
    expect(sameAuthorizedScope({ ...q, destinations: ["YVR"] }, q)).toBe(false);
    expect(sameAuthorizedScope({ ...q, origins: ["HKG", "TPE"] }, q)).toBe(false);
    expect(sameAuthorizedScope({ ...q, date_from: "2026-09-30" }, q)).toBe(false);
    expect(sameAuthorizedScope({ ...q, cabins: ["Y"] }, q)).toBe(false);
    expect(sameAuthorizedScope({ ...q, programs: ["united"] }, q)).toBe(false);
    expect(sameAuthorizedScope({ ...q, programs: undefined }, q)).toBe(false);
  });

  it("a looser filter is outside: nonstop dropped, a higher cap, a lower mixed-cabin share, dynamic pricing added", () => {
    const strict = { ...q, direct_only: true, max_miles: 80000, min_cabin_pct: 100, include_filtered: false };
    expect(sameAuthorizedScope({ ...strict, direct_only: false }, strict)).toBe(false);
    expect(sameAuthorizedScope({ ...strict, max_miles: 90000 }, strict)).toBe(false);
    expect(sameAuthorizedScope({ ...strict, max_miles: undefined }, strict)).toBe(false);
    expect(sameAuthorizedScope({ ...strict, min_cabin_pct: 75 }, strict)).toBe(false);
    expect(sameAuthorizedScope({ ...strict, include_filtered: true }, strict)).toBe(false);
  });

  it("an inverted range is never inside", () => {
    expect(sameAuthorizedScope({ ...q, date_from: "2026-10-20", date_to: "2026-10-10" }, q)).toBe(false);
  });
});

describe("proposalStatus and proposalChanges", () => {
  const q = fixtureSnapshot().query;
  it("pending on its own revision; applied and dismissed stay what they are", () => {
    const p = { id: "p1", baseRevision: 2, proposed: q, reason: "Example", status: "pending" as const };
    expect(proposalStatus(p, 2)).toBe("pending");
    expect(proposalStatus({ ...p, status: "applied" }, 3)).toBe("applied");
    expect(proposalStatus({ ...p, status: "dismissed" }, 3)).toBe("dismissed");
  });

  it("lists the hard conditions changed, from the typed values", () => {
    expect(proposalChanges(q, { ...q, date_to: "2026-11-06", sort_by: "date_asc" })).toEqual(["dates"]);
    expect(proposalChanges(q, { ...q, destinations: ["YVR"], min_cabin_pct: 75 })).toEqual(["route", "min_cabin_pct"]);
    expect(proposalChanges(q, q)).toEqual([]);
  });
});
