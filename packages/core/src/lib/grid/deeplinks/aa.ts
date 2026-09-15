/**
 * American Airlines parameterized award search (kickoff §4.4 — the only program deeplink in v1).
 * Shape, verbatim from the kickoff:
 *   https://www.aa.com/booking/search?locale=en_US&pax=1&adult=1&child=0&type=OneWay&searchType=Award
 *     &cabin=&carriers=ALL&slices=[{"orig":"SEA","origNearby":true,"dest":"NRT","destNearby":true,"date":"2026-10-15"}]
 *     &maxAwardSegmentAllowed=2
 * `slices` is JSON encoded with encodeURIComponent. This is a search page, never a booking action.
 */
export const AA_AWARD_SEARCH_BASE = "https://www.aa.com/booking/search";

export interface AaAwardSearchInput {
  origin: string; // IATA
  dest: string; // IATA
  date: string; // YYYY-MM-DD
  /** aa.com cabin parameter; the kickoff shape leaves it empty ("" = any). Kept as a string for future use. */
  cabin?: string;
  pax?: number; // adults; default 1
}

const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildAaAwardSearchUrl({
  origin,
  dest,
  date,
  cabin = "",
  pax = 1,
}: AaAwardSearchInput): string {
  if (!IATA_RE.test(origin) || !IATA_RE.test(dest))
    throw new Error("origin/dest must be 3-letter IATA codes");
  if (!DATE_RE.test(date)) throw new Error("date must be YYYY-MM-DD");
  if (!Number.isInteger(pax) || pax < 1) throw new Error("pax must be a positive integer");

  const slices = [{ orig: origin, origNearby: true, dest, destNearby: true, date }];
  const params = [
    "locale=en_US",
    `pax=${pax}`,
    `adult=${pax}`,
    "child=0",
    "type=OneWay",
    "searchType=Award",
    `cabin=${encodeURIComponent(cabin)}`,
    "carriers=ALL",
    `slices=${encodeURIComponent(JSON.stringify(slices))}`,
    "maxAwardSegmentAllowed=2",
  ];
  return `${AA_AWARD_SEARCH_BASE}?${params.join("&")}`;
}
