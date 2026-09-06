/**
 * The Phase 6.6 capture matrix (spec §9), declared once.
 *
 * `e2e/screenshots.spec.ts` walks this list to produce every PNG, and
 * `scripts/screenshot-index.ts` walks the same list to build the contact sheet and to fail on a
 * file that does not belong. Keep this module dependency-free (no Playwright, no Next, no `src/`):
 * a plain `tsx` run has to be able to import it.
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
 * Per-feature detail folders written by the feature specs (`ask-drawer.spec.ts`,
 * `cell-drawer.spec.ts`, `chips.spec.ts`). They follow the same naming rule and are listed in the
 * contact sheet under their own heading; they are not part of the completeness check.
 */
export const DETAIL_PAGES = ["ask-drawer", "cell-drawer", "chips"] as const;

/** Files under `SHOT_ROOT` that are not captures. */
export const NON_CAPTURE_FILES = ["README.md", "axe-summary.json"] as const;

export interface MatrixShot {
  page: MatrixPage;
  /** File-name stem, before `-<viewport>-<theme>`. */
  state: string;
  /** One line for the contact sheet: what the reader is looking at. */
  what: string;
  /** Adds the `-zh` suffix (the grid page is captured in both languages, spec §8). */
  zh?: boolean;
  /** Defaults to both viewports. */
  viewports?: readonly Viewport[];
  /** Full-page capture. Drawer / popover states stay viewport-sized: `fullPage` paints a
   *  fixed-position backdrop over the first viewport height only, which looks like a bug. */
  fullPage?: boolean;
}

export const MATRIX: readonly MatrixShot[] = [
  // ---- shell (spec §2) ---------------------------------------------------
  { page: "shell", state: "login", what: "Log in — the 360 px column", fullPage: true },
  { page: "shell", state: "register", what: "Create account, with the invite code prefilled", fullPage: true },
  { page: "shell", state: "legal", what: "Legal, in the 880 px reading column", fullPage: true },

  // ---- grid (spec §3) ----------------------------------------------------
  { page: "grid", state: "results", what: "The canonical query, both cabins" },
  { page: "grid", state: "results", what: "The canonical query in Chinese", zh: true, viewports: ["desktop"] },
  { page: "grid", state: "hover-tooltip", what: "Hover: highlighted headers and the per-program tooltip", viewports: ["desktop"] },
  { page: "grid", state: "focus-ring", what: "Keyboard focus: the 2 px accent ring on a cell" },
  { page: "grid", state: "rows-routes", what: "Rows toggle: routes down the side, dates across" },
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
  { page: "grid", state: "cell-drawer-flights", what: "Cell drawer after Show flights (§3.5)" },
  { page: "grid", state: "ask-open", what: "Ask drawer: context pills and three suggestions (§3.6)" },
  { page: "grid", state: "ask-streaming", what: "Ask drawer mid-stream, with Stop (§3.6)" },
  { page: "grid", state: "ask-cap", what: "Ask drawer at the daily cap: input disabled (§3.6)" },
  { page: "grid", state: "origins", what: "Origins chip editor: city groups and search (§3.2)" },
  { page: "grid", state: "dates", what: "Dates chip editor: two months and the presets (§3.2)" },
  { page: "grid", state: "programs", what: "Programs chip editor: search and the count (§3.2)" },

  // ---- queries (spec §4) -------------------------------------------------
  { page: "queries", state: "list", what: "One row per standing query", fullPage: true },
  { page: "queries", state: "expanded", what: "Row expanded: the last diff as real grid cells, and the runs", fullPage: true },
  { page: "queries", state: "delete-confirm", what: "Delete confirms inline in the row, never in a modal" },
  { page: "queries", state: "edit-drawer", what: "Edit drawer: the grid's own chips" },
  { page: "queries", state: "run-now", what: "Run now leaves its result in the row" },
  { page: "queries", state: "empty", what: "No standing queries yet", fullPage: true },

  // ---- settings (spec §5) ------------------------------------------------
  { page: "settings", state: "default", what: "Four sections, headings and space, no cards", fullPage: true },
  { page: "settings", state: "keys-add", what: "Adding an optional provider's key" },
  { page: "settings", state: "keys-error", what: "A key seats.aero rejects, inline" },
  { page: "settings", state: "telegram-unlinked", what: "Link Telegram: the deep link, the QR, the waiting line" },
  { page: "settings", state: "telegram-linked", what: "A linked account with quiet hours", fullPage: true },
  { page: "settings", state: "change-password", what: "Account: change password" },
  { page: "settings", state: "language-theme", what: "Language and theme", fullPage: true },
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
