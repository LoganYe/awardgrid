/**
 * The account's workspace preferences on this browser (UI/UX v1 T19): the view it chose by hand, and whether keyboard
 * shortcuts are on. Conveniences, not data: kept per account (the same namespace rule as ./storage.ts), left in place
 * at logout, and a browser that keeps nothing simply gets the defaults.
 */
import type { QueryObject } from "@awardgrid/core/query/schema";

export const PREFS_STORE = "awardgrid-prefs-v1";

export type WorkspaceView = "list" | "calendar" | "matrix";
const VIEWS: readonly WorkspaceView[] = ["list", "calendar", "matrix"];

function backing(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const keyOf = (userId: string, name: string) => JSON.stringify([PREFS_STORE, userId, name]);

function read(userId: string, name: string, store: Storage | null): unknown {
  try {
    const raw = store?.getItem(keyOf(userId, name));
    return raw == null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(userId: string, name: string, value: unknown, store: Storage | null): void {
  try {
    store?.setItem(keyOf(userId, name), JSON.stringify(value));
  } catch {
    // Storage full or switched off: the preference lasts for this page only.
  }
}

/** The view chosen by hand, or null when none was (the default then follows the query). */
export function readViewChoice(userId: string, store: Storage | null = backing()): WorkspaceView | null {
  const value = read(userId, "view", store);
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value) ? (value as WorkspaceView) : null;
}

export function writeViewChoice(userId: string, view: WorkspaceView, store: Storage | null = backing()): void {
  write(userId, "view", view, store);
}

/** Shortcuts are on unless turned off. */
export function readShortcutsOn(userId: string, store: Storage | null = backing()): boolean {
  return read(userId, "shortcuts", store) !== false;
}

export function writeShortcutsOn(userId: string, on: boolean, store: Storage | null = backing()): void {
  write(userId, "shortcuts", on, store);
}

/** The view to show: the one chosen by hand, else the matrix for a search of more than one route, else the list. */
export function effectiveView(choice: WorkspaceView | null, query: Pick<QueryObject, "origins" | "destinations"> | null): WorkspaceView {
  if (choice) return choice;
  return query && query.origins.length * query.destinations.length > 1 ? "matrix" : "list";
}
