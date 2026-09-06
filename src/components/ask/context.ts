/**
 * Pure helpers that turn the grid's state into Ask context (kickoff §7 point 6: the current
 * QueryObject and the selected cell are injected as context) and into chip labels.
 */
import type { AvailabilityRow, GridCell } from "@/lib/grid/types";
import type { QueryObject } from "@/lib/query/schema";
import type { AskCellContext, AskContext } from "@/app/api/ask/wire";

export const ASK_EXAMPLE_PROMPT = "which program should I book the cheapest SEA→NRT F cell with, and what transfers into it?";

/** The subset of an AvailabilityRow the ask lane receives (no URLs, no timestamps). */
export function cellContextFromRow(row: AvailabilityRow): AskCellContext {
  return {
    origin: row.origin,
    dest: row.dest,
    date: row.date,
    cabin: row.cabin,
    program: row.program,
    miles: row.miles,
    fees_cents: row.fees_cents,
    seats_left: row.seats_left,
    source_id: row.source_id,
  };
}

/** The best row of a selected cell, or null when the cell has no award. */
export function cellContextFromCell(cell: GridCell | null | undefined): AskCellContext | null {
  if (!cell || !cell.best) return null;
  return cellContextFromRow(cell.best);
}

/** One-line query summary for the context chip: "HKG,PVG,SHA → SEA · 2026-10-01..2026-10-30 · F". */
export function summarizeQuery(q: QueryObject): string {
  const parts = [`${q.origins.join(",")} → ${q.destinations.join(",")}`, `${q.date_from}..${q.date_to}`, q.cabins.join("/")];
  if (q.direct_only) parts.push("direct");
  if (q.programs && q.programs.length > 0) parts.push(q.programs.length <= 3 ? q.programs.join(",") : `${q.programs.length} programs`);
  return parts.join(" · ");
}

/** One-line cell summary: "SEA→NRT 2026-10-15 F · 70,000 mi · $12 · 2 seats · american". */
export function summarizeCell(c: AskCellContext): string {
  const fees = c.fees_cents === null ? "fees ?" : `$${(c.fees_cents / 100).toFixed(0)}`;
  const seats = c.seats_left > 0 ? `${c.seats_left} seats` : "seats ?";
  return `${c.origin}→${c.dest} ${c.date} ${c.cabin} · ${c.miles.toLocaleString("en-US")} mi · ${fees} · ${seats} · ${c.program}`;
}

/** Build the request context honouring the include toggles. */
export function buildAskContext(opts: { query: QueryObject | null; cell: AskCellContext | null; includeQuery: boolean; includeCell: boolean }): AskContext {
  const ctx: AskContext = {};
  if (opts.includeQuery && opts.query) ctx.query = opts.query;
  if (opts.includeCell && opts.cell) ctx.cell = opts.cell;
  return ctx;
}

/** Append a tool name to the "tools used" list without duplicates, preserving first-seen order. */
export function addToolName(list: readonly string[], name: string): string[] {
  const clean = name.trim();
  if (clean.length === 0 || list.includes(clean)) return [...list];
  return [...list, clean];
}

/** "$0.0123" with 4 decimals under a cent, 2 otherwise. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "$?";
  return usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
