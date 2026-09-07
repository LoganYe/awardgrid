import { z } from "zod";
import { SEATS_SOURCES } from "@/lib/seatsaero/types";

/** Three-letter IATA airport code (already expanded from metro codes). */
export const IATA = z.string().regex(/^[A-Z]{3}$/, "IATA code must be 3 upper-case letters");
export type IATA = z.infer<typeof IATA>;

/** Calendar date, YYYY-MM-DD. */
export const ISODate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "invalid calendar date");
export type ISODate = z.infer<typeof ISODate>;

/** Cabin letters used throughout awardgrid (seats.aero field prefixes). */
export const Cabin = z.enum(["Y", "W", "J", "F"]);
export type Cabin = z.infer<typeof Cabin>;

/**
 * Canonical cabin DISPLAY order, spec §3.2's "J / F / W / Y". The zod enum's own order is the
 * seats.aero field order (Y W J F) and is not what the UI reads out: the toolbar toggle, the
 * chip editor and the per-cabin cell all order cabins by this list, so the same set always
 * reads the same way ("J, F") whichever control produced it.
 */
export const CABIN_ORDER: readonly Cabin[] = ["J", "F", "W", "Y"];

/**
 * Sort orders. `cpp_desc` (cents-per-point) is reserved for a future Duffel cash reference
 * and is intentionally NOT accepted by the schema yet — see BACKLOG.md.
 */
export const SortBy = z.enum(["miles_asc", "fees_asc", "seats_desc", "date_asc"]);
export type SortBy = z.infer<typeof SortBy>;
export type FutureSortBy = SortBy | "cpp_desc";

/**
 * A seats.aero source code the parser may emit. QueryObject.programs stays an open string list
 * (DECISIONS: unknown codes returned by the API are shown as-is), but the LLM output is closed
 * so the JSON schema carries the enum and a hallucinated program is a schema failure, not a
 * parameter sent upstream.
 */
export const SeatsProgram = z.enum(SEATS_SOURCES);
export type SeatsProgram = z.infer<typeof SeatsProgram>;

/** Fixed defaults (kickoff §12 — do not re-open). */
export const DEFAULT_CABINS: Cabin[] = ["J", "F"];
export const MAX_SPAN_DAYS = 92;

/**
 * The contract between UI, parser and executor. The same QueryObject always yields the
 * same grid. `origins`/`destinations` are airports AFTER city expansion (TYO → NRT, HND).
 */
export const QueryObject = z
  .object({
    origins: z.array(IATA).min(1),
    destinations: z.array(IATA).min(1),
    date_from: ISODate,
    date_to: ISODate, // inclusive
    cabins: z.array(Cabin).min(1),
    /** seats.aero source codes; undefined = every program the key can access. */
    programs: z.array(z.string()).optional(),
    direct_only: z.boolean().default(false),
    /**
     * The seats.aero "include filtered (dynamically-priced) results" flag (kickoff §4.3): a UI
     * toggle, never inferred from the text. It changes what the API returns, so it is part of
     * the cache scope.
     */
    include_filtered: z.boolean().default(false),
    max_miles: z.number().int().optional(),
    sort_by: SortBy.default("miles_asc"),
    raw_text: z.string(),
    /** Detected language of raw_text, e.g. "zh" | "en". */
    language: z.string(),
  })
  .superRefine((q, ctx) => {
    const from = Date.parse(`${q.date_from}T00:00:00Z`);
    const to = Date.parse(`${q.date_to}T00:00:00Z`);
    if (to < from) {
      ctx.addIssue({ code: "custom", path: ["date_to"], message: "date_to must be >= date_from" });
    }
    const span = Math.round((to - from) / 86_400_000) + 1;
    if (span > MAX_SPAN_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["date_to"],
        message: `date span ${span} days exceeds the ${MAX_SPAN_DAYS}-day cap`,
      });
    }
  });
export type QueryObject = z.infer<typeof QueryObject>;
/** What callers may pass in before defaults are applied. */
export type QueryObjectInput = z.input<typeof QueryObject>;

/**
 * The strict JSON-schema shape the LLM parser must emit: QueryObject minus raw_text/language,
 * and with no defaults (structured outputs require every property to be listed as required).
 */
export const QueryObjectLLM = z.object({
  origins: z.array(IATA).min(1),
  destinations: z.array(IATA).min(1),
  date_from: ISODate,
  date_to: ISODate,
  cabins: z.array(Cabin).min(1),
  programs: z.array(SeatsProgram).nullable(),
  direct_only: z.boolean(),
  max_miles: z.number().int().nullable(),
  sort_by: SortBy,
});
export type QueryObjectLLM = z.infer<typeof QueryObjectLLM>;
