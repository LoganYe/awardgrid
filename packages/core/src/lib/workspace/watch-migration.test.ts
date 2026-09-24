/**
 * Watch migration (UI/UX v1 T14; docs/02 D05; docs/03 SavedQueryV2; acceptance A24): a text watch becomes a structured
 * query and a date rule, built only from what the parser proves. A relative window moves with the day; a fixed one
 * keeps its dates; a phrase that means something else on another day is kept as it was and marked for review.
 * Edited structured fields are what a check runs, never the old text read again over them.
 */
import { describe, expect, it } from "vitest";
import { resolveDraft } from "./query-editor";
import { fixtureQuery } from "../../../test/fixtures/uiux/factory";
import { dateRuleFromText, draftForWatch, migrateLegacyWatch } from "./watch-migration";

it("relative date moves while edited filters are preserved", async () => {
  const w = await migrateLegacyWatch({ id: "synthetic-watch", name: "Example", enabled: true, text: "HKG to SEA next 30 days business" }, "2026-09-23");
  w.draft!.query.direct_only = true;
  w.draft!.query.min_cabin_pct = 100;
  const q = resolveDraft(w.draft!, "2026-09-24");
  expect(q.date_from).toBe("2026-09-24");
  expect(q.direct_only).toBe(true);
  expect(q.min_cabin_pct).toBe(100);
});

describe("migrateLegacyWatch", () => {
  it("keeps the watch's identity and text, and needs no review when the parser proves the rule", async () => {
    const w = await migrateLegacyWatch({ id: "w1", name: "HKG to SEA", enabled: false, text: "HKG to SEA next 30 days business" }, "2026-09-23");
    expect(w).toMatchObject({ schemaVersion: 2, id: "w1", title: "HKG to SEA", enabled: false, legacyRawText: "HKG to SEA next 30 days business" });
    expect(w.review).toBeUndefined();
    expect(w.draft!.dates).toEqual({ kind: "relative_days", days: 30, clock: "UTC" });
    expect(w.draft!.query.origins).toEqual(["HKG"]);
    expect(w.draft!.query.destinations).toEqual(["SEA"]);
    expect(w.draft!.query.cabins).toEqual(["J"]);
  });

  it("legacy fixed dates keep their meaning: the same dates on any later day", async () => {
    const w = await migrateLegacyWatch({ id: "w2", name: "Fixed", enabled: true, text: "HKG to SEA 2026-10-01 to 2026-10-30 business" }, "2026-09-23");
    expect(w.review).toBeUndefined();
    expect(w.draft!.dates).toEqual({ kind: "fixed", from: "2026-10-01", to: "2026-10-30" });
    const later = resolveDraft(w.draft!, "2026-10-05");
    expect([later.date_from, later.date_to]).toEqual(["2026-10-01", "2026-10-30"]);
  });

  it("Chinese relative phrases move too", async () => {
    const w = await migrateLegacyWatch({ id: "w3", name: "中文", enabled: true, text: "香港到西雅图 未来两周 商务舱" }, "2026-09-23");
    expect(w.draft!.dates).toEqual({ kind: "relative_days", days: 14, clock: "UTC" });
  });

  it("a phrase that is neither (a month name read again each day) is not guessed: kept as text, marked for review", async () => {
    const w = await migrateLegacyWatch({ id: "w4", name: "October", enabled: true, text: "HKG to SEA October business" }, "2026-10-05");
    expect(w.review).toBe("dates");
    expect(w.legacyRawText).toBe("HKG to SEA October business");
    // The draft shows what the text means today, for the person to confirm; it is not what a check runs until then.
    expect(w.draft!.query.date_from).toBe("2026-10-05");
  });

  it("a month name, or a date without a year, migrated before its dates is not taken for fixed dates (T14 review MIG-02)", async () => {
    for (const text of ["HKG to SEA October business", "HKG to SEA 十月 商务舱", "HKG to SEA December business", "HKG to SEA Oct 1 - Oct 30 business"]) {
      const w = await migrateLegacyWatch({ id: "w7", name: text, enabled: true, text }, "2026-09-24");
      expect({ text, review: w.review, legacyRawText: w.legacyRawText }).toEqual({ text, review: "dates", legacyRawText: text });
    }
    // A full date keeps its meaning on any day, before, during and after it.
    for (const today of ["2026-09-24", "2026-10-15", "2026-11-02"]) {
      const w = await migrateLegacyWatch({ id: "w8", name: "ISO", enabled: true, text: "HKG to SEA 2026-10-01 to 2026-10-30 business" }, today);
      expect(w.review).toBeUndefined();
      expect(w.draft!.dates).toEqual({ kind: "fixed", from: "2026-10-01", to: "2026-10-30" });
    }
  });

  it("a text the parser cannot read is kept, never dropped: no draft, marked for review", async () => {
    const w = await migrateLegacyWatch({ id: "w5", name: "Somewhere", enabled: true, text: "somewhere warm sometime" }, "2026-09-23");
    expect(w).toMatchObject({ schemaVersion: 2, id: "w5", title: "Somewhere", legacyRawText: "somewhere warm sometime", review: "unparsed", draft: null });
  });

  it("all the text's structured fields are carried: programs, nonstop, mixed cabin, mileage cap", async () => {
    const w = await migrateLegacyWatch({ id: "w6", name: "All", enabled: true, text: "HKG to SEA next 30 days business nonstop under 80000 miles aeroplan" }, "2026-09-23");
    expect(w.draft!.query).toMatchObject({ direct_only: true, max_miles: 80000, programs: ["aeroplan"] });
    expect(w.draft!.query.min_cabin_pct).toBe(100);
  });
});

describe("dateRuleFromText", () => {
  it("relative only on proof: the window starts today and tomorrow alike, with the same length", () => {
    expect(dateRuleFromText("next 60 days", "2026-09-23")).toEqual({ kind: "relative", rule: { kind: "relative_days", days: 60, clock: "UTC" } });
    expect(dateRuleFromText("2026-11-01 to 2026-11-10", "2026-09-23")).toEqual({ kind: "fixed", rule: { kind: "fixed", from: "2026-11-01", to: "2026-11-10" } });
    expect(dateRuleFromText("October", "2026-10-05").kind).toBe("unclear");
    expect(dateRuleFromText("October", "2026-09-24").kind).toBe("unclear");
    expect(dateRuleFromText("no dates here", "2026-09-23").kind).toBe("none");
  });
});

describe("draftForWatch: a new watch of the search on screen", () => {
  const base = fixtureQuery();

  it("a search the editor made with 'next N days' keeps a relative rule; its structured fields as they are", () => {
    const query = { ...base, date_from: "2026-09-23", date_to: "2026-10-22", raw_text: "HKG to SEA, next 30 days, business", direct_only: true, max_miles: 90000 };
    const draft = draftForWatch(query, "2026-09-23");
    expect(draft.dates).toEqual({ kind: "relative_days", days: 30, clock: "UTC" });
    expect(draft.query).toBe(query);
    expect(resolveDraft(draft, "2026-09-25")).toMatchObject({ date_from: "2026-09-25", date_to: "2026-10-24", direct_only: true, max_miles: 90000 });
  });

  it("a month name, or a sentence that does not give these dates, keeps the dates the search ran with", () => {
    const october = { ...base, date_from: "2026-10-05", date_to: "2026-10-31", raw_text: "HKG to SEA October business" };
    expect(draftForWatch(october, "2026-10-05").dates).toEqual({ kind: "fixed", from: "2026-10-05", to: "2026-10-31" });
    const edited = { ...base, date_from: "2026-09-25", date_to: "2026-10-10", raw_text: "HKG to SEA, next 30 days, business" };
    expect(draftForWatch(edited, "2026-09-23").dates).toEqual({ kind: "fixed", from: "2026-09-25", to: "2026-10-10" });
  });
});
