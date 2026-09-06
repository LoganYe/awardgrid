/** Public surface of the grid module: pivot, ranking, freshness, format, aria, keyboard, CSV, ASCII, deeplinks. */
export type * from "@/lib/grid/types";
export * from "@/lib/grid/ranking";
export * from "@/lib/grid/freshness";
export * from "@/lib/grid/format";
export * from "@/lib/grid/aria";
export * from "@/lib/grid/keyboard";
export * from "@/lib/grid/pivot";
export * from "@/lib/grid/csv";
// The ASCII renderer keeps its own compact `formatFees` ("$56"); the display one lives in format.ts.
export {
  NONE_MARK,
  STALE_MARK,
  UNMONITORED_MARK,
  displayWidth,
  formatCell,
  formatFees as formatFeesCompact,
  formatMilesCompact,
  renderAscii,
  type AsciiOptions,
} from "@/lib/grid/ascii";
export * from "@/lib/grid/deeplinks/aa";
export * from "@/lib/grid/deeplinks/index";
