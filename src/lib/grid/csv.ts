/**
 * CSV export (kickoff §4.4). RFC 4180: CRLF line endings, fields quoted only when they contain
 * a comma, quote, CR or LF, quotes doubled. Optional UTF-8 BOM so Excel opens Chinese program
 * names correctly. Rows are emitted in canonical (date, pair) order whatever the orientation.
 */
import { programDisplayName } from "@/lib/grid/ranking";
import { iterateCells } from "@/lib/grid/pivot";
import type { AvailabilityRow, Grid, GridCell } from "@/lib/grid/types";

export const UTF8_BOM = "\uFEFF";
const CRLF = "\r\n";

export interface CsvOptions {
  /** Prefix the output with a UTF-8 BOM (Excel + non-ASCII program names). Default false. */
  bom?: boolean;
}

export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(fields: readonly (string | number | boolean | null | undefined)[]): string {
  return fields.map(csvField).join(",");
}

const ROW_HEADER = [
  "date",
  "origin",
  "dest",
  "program",
  "program_name",
  "cabin",
  "miles",
  "fees_cents",
  "currency",
  "seats_left",
  "direct",
  "airlines",
  "last_seen",
  "best",
  "booking_url",
] as const;

function rowFields(r: AvailabilityRow, best: boolean): (string | number | boolean | null)[] {
  return [
    r.date,
    r.origin,
    r.dest,
    r.program,
    programDisplayName(r.program),
    r.cabin,
    r.miles,
    r.fees_cents,
    r.currency,
    r.seats_left,
    r.direct,
    r.airlines.join(" "),
    r.computed_last_seen,
    best,
    r.booking_url,
  ];
}

function finish(lines: string[], opts: CsvOptions): string {
  return (opts.bom ? UTF8_BOM : "") + lines.join(CRLF) + CRLF;
}

/** One line per (pair, date, program, cabin) row; `best` = true on the cell's winning row. */
export function toCsv(grid: Grid, opts: CsvOptions = {}): string {
  const lines: string[] = [csvLine(ROW_HEADER)];
  for (const cell of iterateCells(grid)) {
    for (const r of cell.all) lines.push(csvLine(rowFields(r, r === cell.best)));
  }
  return finish(lines, opts);
}

const CELL_HEADER = [
  "date",
  "origin",
  "dest",
  "status",
  "program",
  "program_name",
  "cabin",
  "miles",
  "fees_cents",
  "currency",
  "seats_left",
  "direct",
  "airlines",
  "last_seen",
  "programs_available",
  "rows_available",
  "booking_url",
] as const;

function cellFields(cell: GridCell): (string | number | boolean | null)[] {
  const b = cell.best;
  return [
    cell.date,
    cell.origin,
    cell.dest,
    cell.status,
    b?.program ?? null,
    b ? programDisplayName(b.program) : null,
    b?.cabin ?? null,
    b?.miles ?? null,
    b?.fees_cents ?? null,
    b?.currency ?? null,
    b?.seats_left ?? null,
    b?.direct ?? null,
    b ? b.airlines.join(" ") : null,
    b?.computed_last_seen ?? null,
    // `all` holds one row per (program, cabin); the kickoff's cell semantics are per program.
    new Set(cell.all.map((r) => r.program)).size,
    cell.all.length,
    b?.booking_url ?? null,
  ];
}

/** One line per cell (best row only); empty cells keep their status so the export is complete. */
export function toCsvCells(grid: Grid, opts: CsvOptions = {}): string {
  const lines: string[] = [csvLine(CELL_HEADER)];
  for (const cell of iterateCells(grid)) lines.push(csvLine(cellFields(cell)));
  return finish(lines, opts);
}
