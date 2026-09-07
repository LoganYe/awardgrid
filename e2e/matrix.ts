/**
 * The Phase 6.6 capture matrix (spec §9), declared once.
 *
 * `e2e/screenshots.spec.ts` walks this list to produce every PNG, and
 * `scripts/screenshot-index.ts` walks the same list to build the contact sheet and to fail on a
 * file that does not belong. Keep this module dependency-free (no Playwright, no Next, no `src/`):
 * a plain `tsx` run has to be able to import it.
 *
 * **One owner per capture** (#34): every PNG under `SHOT_ROOT` outside the frozen `before/` is
 * declared here and written by `screenshots.spec.ts`. The feature specs assert; they do not
 * photograph. `scripts/screenshot-index.ts --strict --check` runs in CI and fails on a capture
 * this list does not declare, so a new state cannot be photographed without being named here.
 *
 * Naming rule (spec §9), enforced by `FILE_RE` and by `shotFile()`:
 *
 *     docs/screenshots/v0.2/<page>/<state>-<viewport>-<theme>[-zh].png
 */

export type Viewport = "desktop" | "mobile";
export type Theme = "light" | "dark";

export const VIEWPORTS: readonly Viewport[] = ["desktop", "mobile"];
export const THEMES: readonly Theme[] = ["light", "dark"];

/** Root of the v0.2 capture tree, relative to the repository root. */
export const SHOT_ROOT = "docs/screenshots/v0.2";

/** The four pages of the matrix, in the order the contact sheet lists them. */
export const MATRIX_PAGES = ["shell", "grid", "queries", "settings"] as const;
export type MatrixPage = (typeof MATRIX_PAGES)[number];

/**
 * The frozen v0.1 "before" record (Phase 6.0). It is never regenerated, so its contents are listed
 * here and `scripts/screenshot-index.ts --strict` fails on anything else in that folder: without
 * this, `before/` was the one directory a new state could be parked in to dodge the matrix (#34).
 */
export const BEFORE_FILES: readonly string[] = [
  "grid-ask-drawer-desktop-dark.png", "grid-ask-drawer-desktop-light.png",
  "grid-ask-drawer-mobile-dark.png", "grid-ask-drawer-mobile-light.png",
  "grid-cell-drawer-desktop-dark.png", "grid-cell-drawer-desktop-light.png",
  "grid-cell-drawer-mobile-dark.png", "grid-cell-drawer-mobile-light.png",
  "grid-empty-desktop-dark.png", "grid-empty-desktop-light.png",
  "grid-empty-mobile-dark.png", "grid-empty-mobile-light.png",
  "grid-empty-results-desktop-dark.png", "grid-empty-results-desktop-light.png",
  "grid-empty-results-mobile-dark.png", "grid-empty-results-mobile-light.png",
  "grid-nokey-desktop-dark.png", "grid-nokey-desktop-light.png",
  "grid-nokey-mobile-dark.png", "grid-nokey-mobile-light.png",
  "grid-quota-desktop-dark.png", "grid-quota-desktop-light.png",
  "grid-quota-mobile-dark.png", "grid-quota-mobile-light.png",
  "grid-results-desktop-dark.png", "grid-results-desktop-light.png",
  "grid-results-mobile-dark.png", "grid-results-mobile-light.png",
  "legal-desktop-dark.png", "legal-desktop-light.png",
  "legal-mobile-dark.png", "legal-mobile-light.png",
  "login-desktop-dark.png", "login-desktop-light.png",
  "login-mobile-dark.png", "login-mobile-light.png",
  "queries-desktop-dark.png", "queries-desktop-light.png",
  "queries-empty-desktop-dark.png", "queries-empty-desktop-light.png",
  "queries-empty-mobile-dark.png", "queries-empty-mobile-light.png",
  "queries-mobile-dark.png", "queries-mobile-light.png",
  "register-desktop-dark.png", "register-desktop-light.png",
  "register-mobile-dark.png", "register-mobile-light.png",
  "settings-desktop-dark.png", "settings-desktop-light.png",
  "settings-mobile-dark.png", "settings-mobile-light.png",
] as const;

/** Files under `SHOT_ROOT` that are not captures. */
export const NON_CAPTURE_FILES = ["README.md", "axe-summary.json"] as const;

export interface MatrixShot {
  page: MatrixPage;
  /** File-name stem, before `-<viewport>-<theme>`. */
  state: string;
  /** One line for the contact sheet: what the reader is looking at. */
  what: string;
  /** Adds the `-zh` suffix: the same state again with the UI in Chinese (spec §8). */
  zh?: boolean;
  /** Defaults to both viewports. */
  viewports?: readonly Viewport[];
  /** Full-page capture. Drawer / popover states stay viewport-sized: `fullPage` paints a
   *  fixed-position backdrop over the first viewport height only, which looks like a bug. */
  fullPage?: boolean;
  /**
   * Capture the top `clip` px of the viewport at full width instead of the whole viewport, for a
   * state whose subject is a strip of chrome (the 48 px top bar, the menu that drops out of it).
   * A viewport shot of those would be a picture of whatever page happened to be underneath.
   */
  clip?: number;
}

export const MATRIX: readonly MatrixShot[] = [
  // ---- shell (spec §2) ---------------------------------------------------
  { page: "shell", state: "topbar", what: "The signed-in top bar on /grid: nav with Grid current, quota, language, theme, account (§2)", clip: 48 },
  { page: "shell", state: "topbar-menu", what: "Below 768 px the nav, the toggles and Log out are one panel (§6)", viewports: ["mobile"] },
  { page: "shell", state: "topbar-user-menu", what: "The account menu: who is logged in, and Log out (§2)", viewports: ["desktop"], clip: 160 },
  { page: "shell", state: "login", what: "Log in — the 360 px column", fullPage: true },
  { page: "shell", state: "login-error", what: "A wrong password: the inline error under the field it belongs to", fullPage: true },
  { page: "shell", state: "register", what: "Create account, with the invite code prefilled", fullPage: true },
  { page: "shell", state: "register-error", what: "An invite code that is spent: the error on the code field, password rule met", fullPage: true },
  { page: "shell", state: "legal", what: "Legal, in the 880 px reading column", fullPage: true },

  // ---- grid (spec §3) ----------------------------------------------------
  { page: "grid", state: "results", what: "The canonical query, both cabins" },
  { page: "grid", state: "results", what: "The canonical query in Chinese", zh: true },
  { page: "grid", state: "examples", what: "The Examples popover on an empty bar, clear of the field it fills (§3.1)" },
  { page: "grid", state: "hover-tooltip", what: "Hover: highlighted headers and the per-program tooltip", viewports: ["desktop"] },
  { page: "grid", state: "focus-ring", what: "Keyboard focus: the 2 px accent ring on a cell" },
  { page: "grid", state: "rows-routes", what: "Rows toggle: routes down the side, dates across" },
  { page: "grid", state: "cells-per-cabin", what: "Both cabins stacked in one cell: one line each, J then F (§6.2b)" },
  { page: "grid", state: "cabin-J", what: "Business only — no cabin tag" },
  { page: "grid", state: "cabin-F", what: "First only — no cabin tag" },
  { page: "grid", state: "dynamic-on", what: "Dynamic pricing shown (the filtered cells become live)" },
  { page: "grid", state: "no-key", what: "No seats.aero key: the plain empty state (§3.7)" },
  { page: "grid", state: "parse-failure", what: "Parse failure: what could not be read, text kept (§3.7)" },
  { page: "grid", state: "loading", what: "Skeleton in the shape the chips describe (§3.7)" },
  { page: "grid", state: "empty-results", what: "No availability: the sentence and three suggestions (§3.7)" },
  { page: "grid", state: "quota", what: "Quota exceeded: the persistent banner (§3.7)" },
  { page: "grid", state: "modified", what: "Edited chip: outline, Run affordance, dimmed grid (§3.7)" },
  { page: "grid", state: "not-fetched", what: "One program's Get Routes failed: dotted cells (§3.4)" },
  { page: "grid", state: "cell-drawer", what: "Cell drawer: every program for the cell, sorted by miles (§3.5)" },
  { page: "grid", state: "cell-drawer", what: "Cell drawer in Chinese: the copy fits the panel (§8)", zh: true },
  { page: "grid", state: "cell-drawer-flights", what: "Cell drawer after Show flights (§3.5)" },
  { page: "grid", state: "cell-drawer-loading", what: "Show flights in flight: the button waits, the rows are skeletons (§3.5)" },
  { page: "grid", state: "cell-drawer-error", what: "Get Trips failed: the reason on the program row, with Retry (§3.5)" },
  { page: "grid", state: "cell-drawer-copied", what: "Copy details: the confirmation under the action block (§3.5)" },
  { page: "grid", state: "ask-open", what: "Ask drawer: the grid context pill and three suggestions (§3.6)" },
  { page: "grid", state: "ask-open", what: "Ask drawer in Chinese: pills and suggestions in the UI language (§8)", zh: true },
  { page: "grid", state: "ask-with-cell", what: "Both context pills: the grid, and the cell that was selected (§3.6)" },
  { page: "grid", state: "ask-streaming", what: "Ask drawer mid-stream, with Stop (§3.6)" },
  { page: "grid", state: "ask-answered", what: "The finished answer: markdown, the source link, collapsed tool activity (§3.6)" },
  { page: "grid", state: "ask-answered", what: "The finished answer in Chinese: CJK line-breaking in the answer body (§8)", zh: true },
  { page: "grid", state: "ask-tools", what: "Tool activity expanded: what the answer actually did (§3.6)" },
  { page: "grid", state: "ask-stopped", what: "Stop: the answer cut short, and the reason above the prompt (§3.6)" },
  { page: "grid", state: "ask-no-key", what: "Ask with no key: what to add, and the link to settings (§3.6)" },
  { page: "grid", state: "ask-cap", what: "Ask drawer at the daily cap: input disabled (§3.6)" },
  { page: "grid", state: "origins", what: "Origins chip editor: city groups and search (§3.2)" },
  { page: "grid", state: "dates", what: "Dates chip editor: two months and the presets (§3.2)" },
  { page: "grid", state: "programs", what: "Programs chip editor: search and the count (§3.2)" },
  { page: "grid", state: "chips-error", what: "An emptied Origins chip: red chip, the reason under the row, Run disabled (§3.2)" },
  { page: "grid", state: "chips-manual", what: "'Build it with chips instead': seven chips, three of them blocking (§3.7)" },

  // ---- queries (spec §4) -------------------------------------------------
  { page: "queries", state: "list", what: "One row per standing query", fullPage: true },
  { page: "queries", state: "expanded", what: "Row expanded: the last diff as real grid cells, and the runs", fullPage: true },
  { page: "queries", state: "delete-confirm", what: "Delete confirms inline in the row, never in a modal" },
  { page: "queries", state: "edit-drawer", what: "Edit drawer: the grid's own chips" },
  { page: "queries", state: "edit-saved", what: "After Save: one toast on the list, and no dialog" },
  { page: "queries", state: "run-now", what: "Run now leaves its result in the row" },
  { page: "queries", state: "run-now-error", what: "A run that could not start: the reason inline in the same row" },
  { page: "queries", state: "empty", what: "No standing queries yet", fullPage: true },

  // ---- settings (spec §5) ------------------------------------------------
  { page: "settings", state: "default", what: "Four sections, headings and space, no cards", fullPage: true },
  { page: "settings", state: "keys-add", what: "Adding an optional provider's key" },
  { page: "settings", state: "keys-error", what: "A key seats.aero rejects, inline" },
  { page: "settings", state: "telegram-unlinked", what: "Link Telegram: the deep link, the QR, the waiting line" },
  { page: "settings", state: "telegram-linked", what: "A linked account with quiet hours", fullPage: true },
  { page: "settings", state: "change-password", what: "Account: change password" },
  { page: "settings", state: "language-theme", what: "Language and theme", fullPage: true },
  { page: "settings", state: "language-theme", what: "The whole settings page in Chinese", zh: true, fullPage: true },
];

/** `<state>-<viewport>-<theme>[-zh].png`. */
export function shotFile(state: string, viewport: Viewport, theme: Theme, zh = false): string {
  return `${state}-${viewport}-${theme}${zh ? "-zh" : ""}.png`;
}

/** The naming rule as a pattern, for the check in scripts/screenshot-index.ts. */
export const FILE_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-(desktop|mobile)-(light|dark)(-zh)?\.png$/;

/** Every file this matrix promises, as `<page>/<file>`, in matrix order then viewport/theme order. */
export function expectedFiles(): string[] {
  const out: string[] = [];
  for (const shot of MATRIX) {
    for (const viewport of shot.viewports ?? VIEWPORTS) {
      for (const theme of THEMES) out.push(`${shot.page}/${shotFile(shot.state, viewport, theme, shot.zh)}`);
    }
  }
  return out;
}
