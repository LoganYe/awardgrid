/**
 * Pure labels for the Ask drawer (spec §3.6): the two context pills and the tool-activity list.
 *
 * Spec §3.6 sketches the grid pill with middle dots; §1.2 lists "meta strings joined with middle
 * dots" as a generic-template tell and the copy lint forbids " · " inside a translation, so the
 * pill follows docs/UI_PLAN.md §6.6 instead and separates its three facts with the locale's own
 * comma: "Current grid: 4 routes, Oct 1–30, J and F".
 *
 * Tool labels map an SDK tool name or a plugin skill id to a human sentence
 * ("Checked seats.aero cached search", "Read transfer-partners"). An unknown name is rendered
 * verbatim — never a dictionary key, never a tool input.
 */
import type { AskCellContext } from "@/app/api/ask/wire";
import { formatGridDate, formatMiles, intlLocale, programShortName, type FormatLocale } from "@/lib/grid/format";
import type { I18nKey, Translate } from "@/lib/i18n";
import type { Cabin, QueryObject } from "@/lib/query/schema";

/** The separator between the facts inside a pill, in the locale's own punctuation. */
export function pillSeparator(locale: FormatLocale): string {
  return locale === "zh" ? "，" : ", ";
}

/** "J and F" / 「J和F」 — the cabins the grid shows, joined the way the locale joins a list. */
export function cabinList(cabins: readonly Cabin[], locale: FormatLocale): string {
  // "long" spells the conjunction ("J and F"); "short" would render the ampersand the plan avoids.
  return new Intl.ListFormat(intlLocale(locale), { style: "long", type: "conjunction" }).format(cabins);
}

function labelPrefix(label: string, locale: FormatLocale): string {
  return locale === "zh" ? `${label}：` : `${label}: `;
}

/** "Oct 1–30" inside one month, "Oct 28–Nov 5" across two; zh keeps both full dates. */
export function formatPillDateRange(from: string, to: string, locale: FormatLocale = "en"): string {
  const start = formatGridDate(from, locale);
  if (from === to) return start;
  const end = formatGridDate(to, locale);
  if (locale === "en" && from.slice(0, 7) === to.slice(0, 7)) {
    const d = new Date(`${to}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      const day = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", timeZone: "UTC" }).format(d);
      return `${start}–${day}`;
    }
  }
  return `${start}–${end}`;
}

/** How many route pairs the current grid covers (columns of the grid). */
export function routeCount(q: QueryObject): number {
  return q.origins.length * q.destinations.length;
}

/** "Current grid: 4 routes, Oct 1–30, J and F" (docs/UI_PLAN.md §6.6). */
export function gridPillLabel(q: QueryObject, t: Translate, locale: FormatLocale = "en"): string {
  const routes = routeCount(q);
  const parts = [
    routes === 1 ? t("ask.pill.route_one") : t("ask.pill.routes", { n: routes }),
    formatPillDateRange(q.date_from, q.date_to, locale),
    cabinList(q.cabins, locale),
  ];
  return `${labelPrefix(t("ask.context.query"), locale)}${parts.join(pillSeparator(locale))}`;
}

/** "Selected: SEA→NRT Oct 15 F 80,000 Alaska" (spec §3.6, verbatim format). */
export function cellPillLabel(c: AskCellContext, t: Translate, locale: FormatLocale = "en"): string {
  const parts = [`${c.origin}→${c.dest}`, formatGridDate(c.date, locale), c.cabin, formatMiles(c.miles, locale), programShortName(c.program)];
  return `${labelPrefix(t("ask.context.cell"), locale)}${parts.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Tool activity
// ---------------------------------------------------------------------------

/** Names that mean "the lane read seats.aero cached search", however the toolkit spells them. */
const CACHED_SEARCH = new Set(["seats-aero-cached-search", "seats_aero_cached_search", "cached-search", "cached_search", "CachedSearch"]);
const BULK_AVAILABILITY = new Set(["seats-aero-bulk-availability", "seats_aero_bulk_availability", "bulk-availability", "bulk_availability", "BulkAvailability"]);
const TRIPS = new Set(["seats-aero-trips", "seats_aero_trips", "get-trips", "get_trips", "GetTrips"]);
const READ_TOOLS = new Set(["Read", "Glob", "NotebookRead"]);
const SEARCH_TOOLS = new Set(["Grep", "Search"]);
const WEB_TOOLS = new Set(["WebFetch", "WebSearch"]);

/** `mcp__<server>__<tool>` → the server name, or null. */
function mcpServer(name: string): string | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const sep = rest.indexOf("__");
  return sep > 0 ? rest.slice(0, sep) : null;
}

/** A plugin skill id (`travel-hacker:transfer-partners`) → its skill name. */
function skillName(name: string): string | null {
  const i = name.indexOf(":");
  if (i <= 0 || i === name.length - 1) return null;
  const skill = name.slice(i + 1);
  return /^[a-z0-9][a-z0-9-]*$/.test(skill) ? skill : null;
}

/**
 * One human line for a tool event. Unknown names fall back to the raw name so the list never
 * shows a dictionary key and never invents an activity that did not happen.
 */
export function toolLabel(name: string, t: Translate): string {
  const clean = name.trim();
  if (clean.length === 0) return "";
  if (CACHED_SEARCH.has(clean)) return t("ask.tool.cached_search");
  if (BULK_AVAILABILITY.has(clean)) return t("ask.tool.bulk_availability");
  if (TRIPS.has(clean)) return t("ask.tool.trips");
  if (READ_TOOLS.has(clean)) return t("ask.tool.read");
  if (SEARCH_TOOLS.has(clean)) return t("ask.tool.search");
  if (WEB_TOOLS.has(clean)) return t("ask.tool.web");
  if (clean === "Bash") return t("ask.tool.bash");
  if (clean === "Skill") return t("ask.tool.skill_generic");
  const server = mcpServer(clean);
  if (server) return t("ask.tool.mcp", { server });
  const skill = skillName(clean);
  if (skill) return t("ask.tool.skill", { name: skill });
  return clean;
}

/** Every tool line for a finished or streaming answer, in first-seen order. */
export function toolLabels(names: readonly string[], t: Translate): string[] {
  return names.map((n) => toolLabel(n, t)).filter((s) => s.length > 0);
}

/** Keys this module can render, for the dictionary completeness check. */
export const TOOL_LABEL_KEYS: readonly I18nKey[] = [
  "ask.tool.cached_search",
  "ask.tool.bulk_availability",
  "ask.tool.trips",
  "ask.tool.read",
  "ask.tool.search",
  "ask.tool.web",
  "ask.tool.bash",
  "ask.tool.skill",
  "ask.tool.skill_generic",
  "ask.tool.mcp",
];
