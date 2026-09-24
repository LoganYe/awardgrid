/**
 * Every sentence and label the query editor shows (UI/UX v1 T06), in one place so apps/ios/src/honesty.test.ts reads
 * them all and T11 can move them into the i18n dictionaries. English until the shell has a locale (T11); strings with
 * an approved key in the handoff copy (fixtures/copy.zh-en.json) say which.
 */
import { type DraftErrorCode, type DraftField, MAX_SPAN_DAYS } from "@awardgrid/core/workspace/query-editor";

export const EDITOR = {
  title: "Edit search",
  back: "Back",
  intro: "Change the conditions directly. No AI is used.",
  origins: "Departure airports",
  destinations: "Arrival airports",
  addAirport: "Add airport",
  addAirportHelp: "Type a city, an airport name or a 3-letter code.",
  noPlaceMatch: "No airport or city matches that.",
  typedCode: (code: string) => `Use the code ${code}`,
  allAirports: (codes: readonly string[]) => `All airports: ${codes.join(", ")}`,
  removeAirport: (code: string, name: string) => (name === code ? `Remove ${code}` : `Remove ${code} ${name}`),
  dates: "Departure dates",
  datesHelp: "Calendar dates at the departure airport.",
  dateMode: "Date range",
  fixed: "Fixed dates",
  relative: "Next days",
  start: "Start",
  end: "End",
  days: "Days from today",
  relativeRange: (from: string, to: string) => `${from} to ${to}, counted in UTC from today.`,
  dayCount: (days: number, cap: number) => `${days} ${days === 1 ? "day" : "days"} (up to ${cap}).`,
  quickDays: "Quick picks",
  nextDays: (days: number) => `Next ${days} days`,
  cabins: "Cabins",
  direct: "Nonstop only",
  mixed: "Mixed cabin",
  // help.mixed
  mixedHelp: "One itinerary can include different cabins. Check every segment.",
  mixedOptions: [
    [100, "Every segment in the chosen cabin"],
    [75, "At least 75% of the distance"],
    [50, "At least 50% of the distance"],
    [0, "Any mix of cabins"],
  ] as ReadonlyArray<readonly [number, string]>,
  programs: "Programs",
  programsAll: "All programs",
  programsCount: (n: number) => `${n} selected`,
  programsDone: "Done",
  // help.program
  programsHelp: "The membership program used to redeem; it may not operate the flight.",
  more: "More",
  dynamic: "Include dynamic-priced results",
  miles: "Mileage cap",
  milesHelp: "Leave empty for no limit.",
  // query.submit
  submit: "Find award options",
  submitNote: "Uses your own seats.aero quota · No AI",
  discardTitle: "Discard your changes?",
  discardBody: "Your edits to this search have not been run.",
  // query.discard / query.keep_editing
  discard: "Discard changes",
  keepEditing: "Keep editing",
  editSearch: "Edit search",
  editWhileRunning: "A search is running. Edit it when it has finished.",
  unchosen: "Choose an airport from the list, or clear this text.",
} as const;

const FIELD_ERRORS: Record<DraftField, Partial<Record<DraftErrorCode, string>>> = {
  origins: { required: "Add at least one departure airport.", unchosen_text: EDITOR.unchosen },
  destinations: {
    required: "Add at least one arrival airport.",
    unchosen_text: EDITOR.unchosen,
    same_as_origin: "An airport cannot be both a departure and an arrival.",
  },
  dates: {
    invalid_calendar_date: "Enter a real calendar date.",
    end_before_start: "The end date is before the start date.",
    span_exceeds_core_limit: `The range is longer than ${MAX_SPAN_DAYS} days. Shorten it or split the search.`,
    invalid_relative_days: `Enter a number of days from 1 to ${MAX_SPAN_DAYS}.`,
    ends_in_past: "These dates have already passed.",
  },
  cabins: { required: "Choose at least one cabin." },
  max_miles: { invalid_miles: "Enter a whole number of miles above 0, or leave it empty." },
};

export function fieldErrorText(field: DraftField, code: DraftErrorCode): string {
  return FIELD_ERRORS[field][code] ?? "Check this field.";
}
