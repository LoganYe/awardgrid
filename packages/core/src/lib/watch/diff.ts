/**
 * Snapshot + diff for standing queries (kickoff §6: diff on (program, origin, dest, date,
 * cabin); notify on new cells / drops ≥ threshold).
 *
 *   cellKey(row)                 "program|origin|dest|date|cabin"
 *   snapshot(rows)               AvailabilityRow[] → CellSnapshot[] (sorted by key, deduped: lowest miles wins)
 *   cellsHash(snapshot)          sha256 over the sorted (key, miles) pairs — order-independent
 *   diffSnapshots(prev, next)    { new, dropped, price_drops, unchanged }
 *   parseSnapshot(json)          cells_json → CellSnapshot[] (tolerant: garbage → [])
 */
// The ONE change this file needed to leave the server (docs/PIVOT.md §3). `node:crypto` does not
// exist in a WebView, and @noble/hashes is an audited, zero-dependency, SYNCHRONOUS sha256 whose
// output is byte-identical to `createHash("sha256")` — verified across ASCII, long input and CJK
// before this swap. Byte-identical matters beyond tidiness: `query_runs.cells_hash` rows already
// written by the web app stay valid, so no standing query reports a spurious change. The Web
// Crypto alternative (`crypto.subtle.digest`) is async and would have forced this whole module,
// and its callers, to become async for no gain.
import { sha256 } from "@noble/hashes/sha2.js";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import type { CellSnapshot, DiffOptions, PriceDrop, SnapshotDiff } from "./types";

export const CELL_KEY_SEPARATOR = "|";

export function cellKey(row: Pick<AvailabilityRow, "program" | "origin" | "dest" | "date" | "cabin">): string {
  return [row.program, row.origin, row.dest, row.date, row.cabin].join(CELL_KEY_SEPARATOR);
}

export interface ParsedCellKey {
  program: string;
  origin: string;
  dest: string;
  date: string;
  cabin: string;
}

/** Inverse of cellKey; null when the key does not have exactly five parts. */
export function parseCellKey(key: string): ParsedCellKey | null {
  const parts = key.split(CELL_KEY_SEPARATOR);
  if (parts.length !== 5) return null;
  const [program, origin, dest, date, cabin] = parts as [string, string, string, string, string];
  return { program, origin, dest, date, cabin };
}

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Rows → sorted, deduplicated cell snapshots. Duplicate keys keep the cheapest row. */
export function snapshot(rows: readonly AvailabilityRow[]): CellSnapshot[] {
  const cells = new Map<string, CellSnapshot>();
  for (const r of rows) {
    const key = cellKey(r);
    const existing = cells.get(key);
    if (existing && existing.miles <= r.miles) continue;
    cells.set(key, {
      key,
      miles: r.miles,
      fees_cents: r.fees_cents,
      seats_left: r.seats_left,
      computed_last_seen: r.computed_last_seen,
    });
  }
  return [...cells.values()].sort(byKey);
}

/** Stable identity of a snapshot: sha256 of "key:miles" lines in key order (input order irrelevant). */
export function cellsHash(cells: readonly CellSnapshot[]): string {
  const lines = [...cells].sort(byKey).map((c) => `${c.key}:${c.miles}`);
  const digest = sha256(new TextEncoder().encode(lines.join("\n")));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Round to 2 decimals without float noise (12.345 → 12.35). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compare a baseline with the current snapshot. A price drop needs the SAME key with a miles
 * decrease of at least `dropThresholdPct` percent of the baseline miles; smaller decreases and
 * any increase count as unchanged. Fees/seats changes never trigger on their own.
 */
export function diffSnapshots(prev: readonly CellSnapshot[], next: readonly CellSnapshot[], opts: DiffOptions): SnapshotDiff {
  const threshold = Number.isFinite(opts.dropThresholdPct) ? Math.max(0, opts.dropThresholdPct) : 0;
  const before = new Map(prev.map((c) => [c.key, c] as const));
  const after = new Map(next.map((c) => [c.key, c] as const));

  const added: CellSnapshot[] = [];
  const priceDrops: PriceDrop[] = [];
  let unchanged = 0;
  for (const cell of [...after.values()].sort(byKey)) {
    const old = before.get(cell.key);
    if (!old) {
      added.push(cell);
      continue;
    }
    if (old.miles > 0 && cell.miles < old.miles) {
      const pct = round2(((old.miles - cell.miles) / old.miles) * 100);
      if (pct >= threshold) {
        priceDrops.push({ key: cell.key, before: old, after: cell, pct });
        continue;
      }
    }
    unchanged += 1;
  }
  const dropped = [...before.values()].filter((c) => !after.has(c.key)).sort(byKey);
  return { new: added, dropped, price_drops: priceDrops, unchanged };
}

function isCell(v: unknown): v is CellSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.key === "string" &&
    typeof o.miles === "number" &&
    (o.fees_cents === null || typeof o.fees_cents === "number") &&
    typeof o.seats_left === "number" &&
    typeof o.computed_last_seen === "string"
  );
}

/** Parse `query_runs.cells_json`; anything malformed yields an empty snapshot rather than a crash. */
export function parseSnapshot(json: string | null | undefined): CellSnapshot[] {
  if (!json) return [];
  try {
    const raw: unknown = JSON.parse(json);
    return Array.isArray(raw) ? raw.filter(isCell) : [];
  } catch {
    return [];
  }
}

export function serializeSnapshot(cells: readonly CellSnapshot[]): string {
  return JSON.stringify(cells);
}
