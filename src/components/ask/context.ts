/**
 * Pure helpers that turn the grid's state into Ask context (kickoff §7 point 6: the current
 * QueryObject and the selected cell are injected as context) and into chip labels.
 */
import type { AvailabilityRow, GridCell } from "@awardgrid/core/grid/types";
import type { QueryObject } from "@awardgrid/core/query/schema";
import type { AskCellContext, AskContext } from "@/app/api/ask/wire";

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
