/**
 * Monospace ASCII rendering of a Grid for the CLI (kickoff §8 "monospace numerics").
 * Cell format: `80k · $56 · 2 · alaska · 2h` (miles · fees · seats · program code · age);
 * `—` for none, `n/m` for pairs seats.aero does not monitor. Output is deterministic given `now`.
 */
import { formatAgeCompact, tier, type Lang } from "./freshness";
import type { Grid, GridCell } from "./types";

export interface AsciiOptions {
  /** Clock for ages — required so output is reproducible. */
  now: Date | string;
  lang?: Lang;
  /** Max line width; columns are chunked into several tables when the grid is wider. */
  width?: number;
}

export const NONE_MARK = "—";
export const UNMONITORED_MARK = "n/m";
/** Suffix on the age of a stale (> 6h) cell so staleness is visible in plain text. */
export const STALE_MARK = "*";
const SEP = " · ";
const GAP = "  ";

/** 80000 → "80k", 112500 → "112.5k", 7500 → "7.5k", 500 → "500". */
export function formatMilesCompact(miles: number): string {
  if (miles < 1000) return String(miles);
  const k = Math.round(miles / 100) / 10;
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
}

/**
 * "$56" for USD; "56 EUR" otherwise; "—" when fees are unknown. A null currency (the API sent
 * no/empty `TaxesCurrency`) is rendered as USD by the recorded Phase 0 assumption (DECISIONS.md
 * "TotalTaxes unit") — the same rule the web UI documents in its fees tooltip.
 */
export function formatFees(feesCents: number | null, currency: string | null): string {
  if (feesCents === null) return NONE_MARK;
  const amount = Math.round(feesCents / 100);
  return currency === null || currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
}

export function formatCell(cell: GridCell, now: Date | string, lang: Lang = "en"): string {
  if (cell.status === "unmonitored") return UNMONITORED_MARK;
  const b = cell.best;
  if (!b) return NONE_MARK;
  // Unknown freshness ("?" age) keeps the caveat mark: it was "stale" before the tier existed.
  const t = tier(b.computed_last_seen, now);
  const age = formatAgeCompact(b.computed_last_seen, now, lang) + (t === "stale" || t === "unknown" ? STALE_MARK : "");
  return [
    formatMilesCompact(b.miles),
    formatFees(b.fees_cents, b.currency),
    String(b.seats_left),
    b.program,
    age,
  ].join(SEP);
}

/** Terminal column width: CJK and fullwidth characters occupy two cells. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    w +=
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
        ? 2
        : 1;
  }
  return w;
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

const STRINGS: Record<
  Lang,
  {
    date: string;
    route: string;
    legend: string;
    none: string;
    nm: string;
    stale: string;
    data: string;
  }
> = {
  en: {
    date: "date",
    route: "route",
    legend: "miles · $fees · seats · program · age",
    none: `${NONE_MARK} none`,
    nm: `${UNMONITORED_MARK} not monitored by seats.aero`,
    stale: `${STALE_MARK} stale (>6h)`,
    data: "Data: seats.aero",
  },
  zh: {
    date: "日期",
    route: "航线",
    legend: "里程 · $税费 · 座位 · 计划 · 数据时间",
    none: `${NONE_MARK} 无`,
    nm: `${UNMONITORED_MARK} seats.aero 未监控`,
    stale: `${STALE_MARK} 过期 (>6小时)`,
    data: "数据来源: seats.aero",
  },
};

function renderTable(
  label: string,
  labelWidth: number,
  rowLabels: readonly string[],
  cols: readonly { label: string; width: number }[],
  text: readonly (readonly string[])[],
): string {
  const line = (first: string, cells: readonly string[]): string =>
    [pad(first, labelWidth), ...cells.map((c, ci) => pad(c, cols[ci]?.width ?? 0))]
      .join(GAP)
      .trimEnd();
  const out = [
    line(
      label,
      cols.map((c) => c.label),
    ),
  ];
  rowLabels.forEach((rl, ri) => out.push(line(rl, text[ri] ?? [])));
  return out.join("\n");
}

/** Split column indexes into runs whose rendered width fits `width` (at least one column per run). */
function chunkColumns(
  labelWidth: number,
  colWidths: number[],
  width: number | undefined,
): number[][] {
  if (width === undefined) return [colWidths.map((_, i) => i)];
  const chunks: number[][] = [];
  let current: number[] = [];
  let used = labelWidth;
  colWidths.forEach((cw, i) => {
    const next = used + GAP.length + cw;
    if (current.length > 0 && next > width) {
      chunks.push(current);
      current = [];
      used = labelWidth;
    }
    current.push(i);
    used += GAP.length + cw;
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function renderAscii(grid: Grid, opts: AsciiOptions): string {
  const lang = opts.lang ?? "en";
  const t = STRINGS[lang];
  const label = grid.orientation === "dates" ? t.date : t.route;
  const text = grid.cells.map((row) => row.map((cell) => formatCell(cell, opts.now, lang)));
  const labelWidth = [label, ...grid.rows].reduce((w, s) => Math.max(w, displayWidth(s)), 0);
  const colWidths = grid.cols.map((c, ci) =>
    text.reduce((w, row) => Math.max(w, displayWidth(row[ci] ?? "")), displayWidth(c)),
  );

  const tables = chunkColumns(labelWidth, colWidths, opts.width).map((idxs) =>
    renderTable(
      label,
      labelWidth,
      grid.rows,
      idxs.map((i) => ({ label: grid.cols[i] ?? "", width: colWidths[i] ?? 0 })),
      text.map((row) => idxs.map((i) => row[i] ?? "")),
    ),
  );
  const legend = [t.legend, t.none, t.nm, t.stale, t.data].join("   ");
  return `${tables.join("\n\n")}\n\n${legend}\n`;
}
