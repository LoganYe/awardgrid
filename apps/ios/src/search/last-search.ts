/**
 * The last successful grid search, kept in memory for Ask.
 *
 * Ask offers "Include my last search", and the Search screen keeps its grid when the person goes to Ask and
 * back (design §6.2). Both read this one value. It is never written to disk: the search it describes is already
 * in the availability cache, and a stale "last search" restored at the next launch would offer a context the
 * person no longer has on screen.
 */
import type { FindValue } from "./search";

export interface LastSearchEntry {
  /** The query as the person typed it. */
  text: string;
  /** The search's result, whose `query` is what Ask describes to Claude. */
  value: FindValue;
}

export interface LastSearchStore {
  get(): LastSearchEntry | null;
  set(entry: LastSearchEntry): void;
}

export function createLastSearch(): LastSearchStore {
  let last: LastSearchEntry | null = null;
  return {
    get: () => last,
    set(entry) {
      last = { text: entry.text, value: entry.value };
    },
  };
}
