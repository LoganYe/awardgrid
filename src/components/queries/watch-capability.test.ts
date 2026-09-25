/**
 * The Web's watch capabilities (UI/UX v1 T20; A33): only real signals count. A schedule is confirmed by a worker's
 * heartbeat, push by a real bot with this server's token and a linked account; nothing is inferred from the viewport.
 */
import { describe, expect, it } from "vitest";
import { capabilityMessageKey } from "@awardgrid/core/workspace/watch-capabilities";
import { webWatchCapabilities } from "./watch-capability";

const beat = (transport: "telegram" | "mock") => ({ version: 1 as const, tickAt: "2026-10-18T08:30:00Z", ok: true, transport });

describe("webWatchCapabilities", () => {
  it("no worker seen: nothing is confirmed, whatever else is configured", () => {
    expect(capabilityMessageKey(webWatchCapabilities(null, true, true))).toBe("watch.unavailable");
  });
  it("a worker with a real bot, this server's token and a linked account: scheduled with push", () => {
    expect(capabilityMessageKey(webWatchCapabilities(beat("telegram"), true, true))).toBe("watch.scheduled_with_push");
  });
  it("any link missing in the delivery chain: scheduled only", () => {
    expect(capabilityMessageKey(webWatchCapabilities(beat("mock"), true, true))).toBe("watch.scheduled_only");
    expect(capabilityMessageKey(webWatchCapabilities(beat("telegram"), false, true))).toBe("watch.scheduled_only");
    expect(capabilityMessageKey(webWatchCapabilities(beat("telegram"), true, false))).toBe("watch.scheduled_only");
  });
  it("the Web never claims foreground checks: it is not an app that is opened", () => {
    expect(webWatchCapabilities(beat("mock"), false, false).checkOnForeground).toBe(false);
  });
});
