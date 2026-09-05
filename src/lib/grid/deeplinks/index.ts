/**
 * "Open in program" link resolution (kickoff §4.4). Priority:
 *   1. seats.aero's own booking link on the row (booking_url)
 *   2. a program-specific search-page builder — only AA in v1 (§12 "Deeplinks in v1: AA only")
 *   3. nothing: the UI shows the program name as text and the user searches manually.
 * Every result carries the mandatory caveat; links open search pages, never book anything.
 */
import { buildAaAwardSearchUrl } from "@/lib/grid/deeplinks/aa";
import { programDisplayName } from "@/lib/grid/ranking";
import type { AvailabilityRow } from "@/lib/grid/types";

/** Exact kickoff §4.4 wording — shown next to every "Open in program" link. Do not paraphrase. */
export const DEEPLINK_CAVEAT =
  "Confirm on the program's site before transferring any points — cached data can be stale and awards disappear.";

export type DeeplinkKind = "seats_aero_booking_link" | "program_search" | "none";

export interface Deeplink {
  url: string | null;
  label: string;
  kind: DeeplinkKind;
  caveat: string;
}

/**
 * Programs whose award-search URL shape is NOT implemented yet (BACKLOG.md "Deeplinks for programs
 * other than AA"). No URLs are invented for them: rows from these programs resolve to the
 * seats.aero booking link when present, else `kind: "none"`.
 */
export const STUB_PROGRAMS = [
  "alaska",
  "aeroplan",
  "united",
  "flyingblue",
  "delta",
  "virginatlantic",
  "qantas",
] as const;

type ProgramBuilder = (row: AvailabilityRow) => string;

/** Program-specific search-page builders. cabin is left empty on purpose (kickoff URL shape). */
const PROGRAM_BUILDERS: Record<string, ProgramBuilder> = {
  american: (row) => buildAaAwardSearchUrl({ origin: row.origin, dest: row.dest, date: row.date }),
};

export function hasProgramBuilder(program: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROGRAM_BUILDERS, program);
}

export function resolveDeeplink(row: AvailabilityRow): Deeplink {
  const name = programDisplayName(row.program);
  if (row.booking_url) {
    return {
      url: row.booking_url,
      label: `Open booking link (${name})`,
      kind: "seats_aero_booking_link",
      caveat: DEEPLINK_CAVEAT,
    };
  }
  const builder = PROGRAM_BUILDERS[row.program];
  if (builder) {
    return {
      url: builder(row),
      label: `Search on ${name}`,
      kind: "program_search",
      caveat: DEEPLINK_CAVEAT,
    };
  }
  return { url: null, label: `Search ${name} manually`, kind: "none", caveat: DEEPLINK_CAVEAT };
}
