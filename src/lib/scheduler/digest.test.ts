import { describe, expect, it } from "vitest";
import type { SavedQuery } from "@/lib/db/schema";
import { TELEGRAM_MAX_MESSAGE_CHARS } from "@/lib/notify/transport";
import { defaultFormatDigest, DIGEST_MAX_LINES } from "./digest";
import type { CellSnapshot, SnapshotDiff } from "./types";

const savedQuery = { name: "fallback" } as SavedQuery;
const NOW = new Date("2026-10-01T12:00:00Z");

function cellAt(i: number): CellSnapshot {
  return { key: `alaska|HKG|SEA|2026-10-${String(i + 1).padStart(2, "0")}|F`, miles: 80_000, fees_cents: null, seats_left: 2, computed_last_seen: NOW.toISOString() };
}

function digest(diff: Partial<SnapshotDiff>, gridUrl: string): string {
  return defaultFormatDigest({ savedQuery, diff: { new: [], dropped: [], price_drops: [], unchanged: 0, ...diff }, locale: "en", gridUrl, now: NOW });
}

describe("defaultFormatDigest length guard", () => {
  it("lists up to DIGEST_MAX_LINES cells and stays under 4096 chars", () => {
    const html = digest({ new: Array.from({ length: 30 }, (_, i) => cellAt(i)) }, "https://ag.example/grid?q=abc");
    expect(html.split("\n").filter((l) => l.startsWith("• "))).toHaveLength(DIGEST_MAX_LINES);
    expect(html).toContain("… (more in the grid)");
    expect(html.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
  });

  it("drops cell lines to fit a long grid URL, and falls back to /queries when the URL alone is too long", () => {
    const news = Array.from({ length: 25 }, (_, i) => cellAt(i));
    const long = digest({ new: news }, `https://ag.example/grid?q=${"A".repeat(3800)}`);
    expect(long.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
    expect(long).toContain("AAAA");
    expect(long.split("\n").filter((l) => l.startsWith("• ")).length).toBeLessThan(DIGEST_MAX_LINES);

    const huge = digest({ new: news }, `https://ag.example/grid?q=${"B".repeat(5000)}`);
    expect(huge.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
    expect(huge).not.toContain("BBBB");
    expect(huge).toContain('<a href="https://ag.example/queries">Open grid</a>');
    expect(huge.split("\n").filter((l) => l.startsWith("• "))).toHaveLength(DIGEST_MAX_LINES);
  });
});
