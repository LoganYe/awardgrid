/**
 * "Today" as the person's own calendar shows it (PR-D). The app turns an instant into a calendar day in one place,
 * here: the day on this device's clock, in its own time zone. Before, each screen sliced the UTC timestamp
 * (`toISOString().slice(0, 10)`), so in the US evening "today" was already tomorrow: at 22:53 in California on
 * 6 October, "next 14 days" searched 7 to 20 October, a plan or a saved search ending on the 6th read as past, and
 * sample data left the 6th out.
 *
 * Everything after this stays calendar arithmetic on YYYY-MM-DD strings (core's resolveDates, sample/shared.ts
 * addDays), done in UTC so it never shifts with the zone. What stays UTC on purpose: seats.aero's daily call count,
 * which resets at midnight UTC (core seatsaero/quota.ts), and instants stored as ISO timestamps.
 */

/** The calendar day (YYYY-MM-DD) that `at` falls on in this device's time zone. */
export function localDate(at: Date): string {
  const y = at.getFullYear();
  const m = at.getMonth() + 1;
  const d = at.getDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The local calendar day of a stored instant (an ISO timestamp such as a snapshot's createdAt): the day it was made
 * on this device. An unreadable timestamp keeps its own first ten characters, as before.
 */
export function localDateOf(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso.slice(0, 10) : localDate(at);
}
