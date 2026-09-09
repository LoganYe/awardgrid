/**
 * Bridge between the scheduler's SnapshotDiff (cells keyed "program|origin|dest|date|cabin")
 * and src/lib/notify/format.ts's DigestDiff (cells with explicit program/origin/dest/date/cabin
 * fields). `notifyFormatDigest` is the DigestFormatter the worker and the "run now" API inject;
 * `defaultFormatDigest` (./digest.ts) stays as the dependency-free fallback.
 */
import { formatDigest, type DigestCell, type DigestDiff } from "@/lib/notify/format";
import { Cabin } from "@awardgrid/core/query/schema";
import { parseCellKey } from "./diff";
import type { CellSnapshot, DigestFormatter, DigestInput, SnapshotDiff } from "./types";

/** A snapshot cell as the digest formatter wants it; null when the key is malformed. */
export function toDigestCell(cell: CellSnapshot): DigestCell | null {
  const k = parseCellKey(cell.key);
  if (!k) return null;
  const cabin = Cabin.safeParse(k.cabin);
  if (!cabin.success) return null;
  return {
    program: k.program,
    origin: k.origin,
    dest: k.dest,
    date: k.date,
    cabin: cabin.data,
    miles: cell.miles,
    seats_left: cell.seats_left,
    computed_last_seen: cell.computed_last_seen,
  };
}

/** SnapshotDiff → DigestDiff. Cells with unparseable keys are dropped (never produced by snapshot()). */
export function toDigestDiff(diff: SnapshotDiff): DigestDiff {
  const cells = (list: readonly CellSnapshot[]): DigestCell[] => list.map(toDigestCell).filter((c): c is DigestCell => c !== null);
  const price_drops: DigestDiff["price_drops"] = [];
  for (const d of diff.price_drops) {
    const before = toDigestCell(d.before);
    const after = toDigestCell(d.after);
    if (before && after) price_drops.push({ before, after });
  }
  return { new: cells(diff.new), price_drops, dropped: cells(diff.dropped) };
}

/** The production digest: src/lib/notify's bilingual, i18n-backed formatter. */
export const notifyFormatDigest: DigestFormatter = ({ savedQuery, diff, locale, gridUrl, now }: DigestInput): string =>
  formatDigest({ savedQuery: { name: savedQuery.name }, diff: toDigestDiff(diff), locale, gridUrl, now });
