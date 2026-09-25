/**
 * T20 Step 4: the capability sentence and the run health, beyond the plan's three cases (A33).
 */
import { describe, expect, it } from "vitest";
import { COPY } from "./present";
import { capabilityMessageKey, runHealth } from "./watch-capabilities";

describe("capabilityMessageKey", () => {
  it("every combination has an approved sentence, and push is only said with a schedule", () => {
    const keys = new Set<string>();
    for (const checkOnForeground of [true, false])
      for (const scheduledChecks of [true, false])
        for (const pushEnabled of [true, false]) {
          const key = capabilityMessageKey({ checkOnForeground, scheduledChecks, pushEnabled });
          keys.add(key);
          expect(COPY[key]).toBeDefined();
          if (!scheduledChecks) expect(key === "watch.scheduled_with_push" || key === "watch.scheduled_only").toBe(false);
        }
    expect([...keys].sort()).toEqual(["watch.foreground_only", "watch.scheduled_only", "watch.scheduled_with_push", "watch.unavailable"]);
  });

  it("a schedule without push says push is not enabled; push without a schedule is never claimed", () => {
    expect(capabilityMessageKey({ checkOnForeground: false, scheduledChecks: true, pushEnabled: false })).toBe("watch.scheduled_only");
    expect(capabilityMessageKey({ checkOnForeground: true, scheduledChecks: false, pushEnabled: true })).toBe("watch.foreground_only");
    expect(capabilityMessageKey({ checkOnForeground: false, scheduledChecks: false, pushEnabled: true })).toBe("watch.unavailable");
  });

  it("the configured sentence says to check the last run: configuration is not a health guarantee", () => {
    expect(COPY["watch.scheduled_with_push"].en).toMatch(/last run/i);
    expect(COPY["watch.scheduled_with_push"].zh).toContain("最近运行状态");
  });
});

describe("runHealth", () => {
  const now = "2026-10-18T08:30:00Z";
  const day = 24 * 60 * 60 * 1000;
  it("only recorded runs say how it is going; configuration alone is never ok", () => {
    expect(runHealth(null, now, day)).toBe("unknown");
    expect(runHealth({ finishedAt: null, ok: null }, now, day)).toBe("never");
    expect(runHealth({ finishedAt: "2026-10-18T08:00:00Z", ok: false }, now, day)).toBe("failed");
    expect(runHealth({ finishedAt: "2026-10-18T08:00:00Z", ok: true }, now, day)).toBe("ok");
    expect(runHealth({ finishedAt: "2026-10-16T08:00:00Z", ok: true }, now, day)).toBe("stale");
    expect(runHealth({ finishedAt: "2026-10-18T08:00:00Z", ok: null }, now, day)).toBe("unknown");
    expect(runHealth({ finishedAt: "not a time", ok: true }, now, day)).toBe("unknown");
    // A run in the future proves nothing (a clock set wrong); a minute of skew between two processes is fine.
    expect(runHealth({ finishedAt: "2027-10-18T08:30:00Z", ok: true }, now, day)).toBe("unknown");
    expect(runHealth({ finishedAt: "2026-10-18T08:31:00Z", ok: true }, now, day)).toBe("ok");
  });
});
