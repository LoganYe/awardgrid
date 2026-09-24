/**
 * Canonical identities for the UI/UX v1 workspace (handoff docs/03 §1).
 *
 *   scopeKey(query)       what the network was asked for: airports, dates, cabins, programs and every filter that
 *                         changes the upstream request or the cache scope. Sets are sorted and de-duplicated; sort
 *                         order, free text and language are left out because they change nothing that was fetched.
 *   rowKey(row, scope)    one aggregate option inside that scope: program + source id + pair + day + cabin + the
 *                         row's own cache scope. Never an array index, never a value (miles, fees, seats) that can
 *                         change while the option stays the same one.
 *
 * max_miles is not sent upstream (seatsaero/find.ts applies it locally), but it changes which rows a snapshot
 * holds, so it is kept in the scope conservatively (docs/03: "默认保守纳入"): two snapshots that differ only in
 * max_miles are never treated as the same result.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type { AvailabilityRow } from "../grid/types";
import { CABIN_ORDER, type QueryObject } from "../query/schema";
import type { RowKey } from "./types";

export const SCOPE_KEY_VERSION = "v1";

/**
 * encodeURIComponent, plus the characters it leaves alone that matter here: !'()* (not attribute/URL-safe everywhere)
 * and ~, the row-key separator — so no value can forge a component boundary.
 */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Sorted, de-duplicated, each part encoded so a separator inside a value cannot forge a boundary. */
function set(values: readonly string[]): string {
  return [...new Set(values)].sort().map(encode).join(",");
}

function cabins(values: QueryObject["cabins"]): string {
  return [...new Set(values)].sort((a, b) => CABIN_ORDER.indexOf(a) - CABIN_ORDER.indexOf(b)).join(",");
}

/** min_cabin_pct: absent and 100 are the same scope, exactly as the cache and the request treat them. */
function pct(value: number | undefined): string {
  return String(value ?? 100);
}

export function scopeKey(query: QueryObject): string {
  const programs = query.programs && query.programs.length > 0 ? set(query.programs) : "*";
  return [
    SCOPE_KEY_VERSION,
    `o=${set(query.origins)}`,
    `d=${set(query.destinations)}`,
    `f=${query.date_from}`,
    `t=${query.date_to}`,
    `c=${cabins(query.cabins)}`,
    `p=${programs}`,
    `dir=${query.direct_only ? 1 : 0}`,
    `flt=${query.include_filtered ? 1 : 0}`,
    `pct=${pct(query.min_cabin_pct)}`,
    `max=${query.max_miles ?? "*"}`,
  ].join("|");
}

/** First 16 hex digits of sha256(scopeKey): short enough for a DOM attribute, wide enough not to collide. */
export function scopeDigest(scope: string): string {
  const digest = sha256(new TextEncoder().encode(scope));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type RowIdentity = Pick<AvailabilityRow, "program" | "source_id" | "origin" | "dest" | "date" | "cabin" | "include_filtered" | "min_cabin_pct">;

/**
 * The key of one aggregate option within one scope. Every component is encoded, so no value (program, source id,
 * airport) can collide with another by containing the separator. Safe in a DOM attribute or URL: only unreserved
 * characters, percent-escapes and the `~` separator.
 */
export function rowKey(row: RowIdentity, scope: string): RowKey {
  return [
    scopeDigest(scope),
    encode(row.program),
    encode(row.source_id),
    encode(row.origin),
    encode(row.dest),
    encode(row.date),
    encode(row.cabin),
    `${row.include_filtered ? "f" : "n"}${pct(row.min_cabin_pct)}`,
  ].join("~");
}
