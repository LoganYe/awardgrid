/**
 * The line that says a watch's last state (T14; docs/04 S07: low quota, cache period, key refused and failure each
 * give the accurate reason). Each case is one the T14 review found said wrongly.
 */
import { describe, expect, it } from "vitest";
import type { Watch } from "@awardgrid/core/watch";
import { draftFromQuery } from "@awardgrid/core/workspace/query-editor";
import { fixtureQuery } from "@awardgrid/core/test-fixtures/uiux/factory";
import { statusLine } from "./WatchesScreen";
import { WATCHES } from "./watches-copy";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const en = WATCHES.en;

function watch(over: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    name: "HKG to SEA",
    text: "HKG to SEA",
    draft: { ...draftFromQuery(fixtureQuery()), dates: { kind: "fixed", from: "2026-11-01", to: "2026-11-15" } },
    lastCheckedAt: hoursAgo(3),
    baseline: [],
    dropThresholdPct: 10,
    enabled: true,
    createdAt: hoursAgo(100),
    ...over,
  };
}

describe("statusLine", () => {
  it("a failure that holds the next check back is still the news: never 'cached results are still valid' (RUN-02, UX-02)", () => {
    const failed = watch({ lastAttemptAt: hoursAgo(0.2), lastResult: { at: hoursAgo(0.2), status: "failed", firstCheck: false, message: "seats.aero unavailable (HTTP 500)" } });
    const line = statusLine(failed, NOW, en, { status: "skipped", reason: "checked_recently" }, "en");
    expect(line.text).toBe("Check failed; previous baseline kept (12 min ago): seats.aero unavailable (HTTP 500)");
    const refused = watch({ lastAttemptAt: hoursAgo(0.2), lastResult: { at: hoursAgo(0.2), status: "failed", firstCheck: false, refused: true } });
    expect(statusLine(refused, NOW, en, { status: "skipped", reason: "checked_recently" }, "en").text).toBe(en.refused);
    // After a success, the cache-period skip is what happened.
    const fresh = watch({ lastCheckedAt: hoursAgo(0.2), lastResult: { at: hoursAgo(0.2), status: "checked", firstCheck: false, compared: null } });
    expect(statusLine(fresh, NOW, en, { status: "skipped", reason: "checked_recently" }, "en").text).toBe("Skipped while cached results are still valid (last checked 12 min ago).");
  });

  it("'these dates have passed' is not said once the dates were edited (UX-03)", () => {
    const edited = watch({ lastCheckedAt: null, lastResult: null });
    expect(statusLine(edited, NOW, en, { status: "skipped", reason: "dates_passed" }, "en").text).toBe(en.notChecked);
    const passed = watch({ draft: { ...watch().draft!, dates: { kind: "fixed", from: "2026-09-01", to: "2026-09-30" } } });
    expect(statusLine(passed, NOW, en, { status: "skipped", reason: "dates_passed" }, "en").text).toBe(en.skipDatesPassed);
  });

  it("a baseline is said to be kept only when there was one (UX-04)", () => {
    const first = watch({ lastCheckedAt: null, lastResult: { at: hoursAgo(0), status: "failed", firstCheck: true, message: "seats.aero unavailable (HTTP 500)" } });
    const line = statusLine(first, NOW, en, { status: "failed", message: "seats.aero unavailable (HTTP 500)" }, "en");
    expect(line.text).toBe("Last attempt failed just now: seats.aero unavailable (HTTP 500)");
    expect(line.text).not.toMatch(/baseline/);
    const refused = watch({ lastCheckedAt: null, lastResult: { at: hoursAgo(0), status: "failed", firstCheck: true, refused: true } });
    expect(statusLine(refused, NOW, en, undefined, "en").text).toBe("Not checked: seats.aero did not accept the key.");
    expect(statusLine(refused, NOW, WATCHES.zh, undefined, "zh").text).not.toMatch(/基线/);
  });

  it("conditions that cannot be run say so, and to edit them (RUN-03)", () => {
    const w = watch({ lastResult: { at: hoursAgo(0), status: "failed", firstCheck: false, unresolved: true } });
    expect(statusLine(w, NOW, en, undefined, "en").text).toBe(en.unresolved);
  });

  it("low quota, in Chinese punctuation on a Chinese screen (UX-08)", () => {
    const w = watch();
    expect(statusLine(w, NOW, WATCHES.zh, { status: "skipped", reason: "quota_low" }, "zh").text).toBe("额度不足，暂缓检查。未检查：今天剩余的 seats.aero 调用不足 25 次，这些留给你自己的查询。");
    expect(statusLine(w, NOW, en, { status: "skipped", reason: "quota_low" }, "en").text).toMatch(/^Deferred due to low quota\. Not checked: /);
  });
});
