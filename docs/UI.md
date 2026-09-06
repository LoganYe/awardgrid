# awardgrid UI

How the interface is built and how to change it without breaking it. Three documents divide the work:

| Document | What it is |
|---|---|
| `docs/UI_PLAN.md` | The **design record** (Phase 6.0): why every token, measurement and wireframe is what it is, plus the review log. Read it when you want the reasoning. |
| `docs/UI.md` (this file) | The **working manual**: the system as shipped, which file renders what, and the procedures — add a string, add a token, take screenshots, update baselines. Read it when you want to change something. |
| `docs/COPY.md` | The **copy contract**: rules, the en ↔ zh glossary, and how to add a string. |

Two rules sit above everything here and are not negotiable: **no airline or program logo, wordmark or brand colour anywhere** (program names are text), and **"Data: seats.aero" stays visible** in the footer on every page. `src/styles/tokens.test.ts` fails if a program name appears in the token file.

---

## 1. The design system

### 1.1 Colour tokens

Every colour in the product is one of eleven CSS custom properties per theme, defined once in `src/styles/tokens.css` and mapped to Tailwind utilities (and to the shadcn aliases the `ui/*` primitives use) by the `@theme inline` block in `src/app/globals.css`. Nothing derives a colour at a call site; nothing is tinted; the six neutrals are strictly achromatic (R = G = B).

| Token | Light | Dark | Where it is used |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#111111` | Page ground, grid cells, inputs, drawers; also the *text* of a primary button and the switch-on thumb |
| `--bg-raised` | `#F4F4F4` | `#1E1E1E` | Sticky header row and row headers, hovered/selected cell, skeleton bars, popover and tooltip ground, expanded query row, disabled controls |
| `--line` | `#E2E2E2` | `#2C2C2C` | Grid lines, the rule under the top bar and above the footer, section dividers, the drawer's page-facing edge |
| `--line-strong` | `#8A8A8A` | `#707070` | Input / switch / chip borders, the "not fetched" dotted outline, the "not monitored" hatch stripes, popover edges (≥ 3:1 non-text contrast on both grounds) |
| `--fg` | `#171717` | `#EDEDED` | All primary text, the miles figure, the active-nav underline; the *ground* of the primary button and of the switch-on track |
| `--fg-muted` | `#5C5C5C` | `#A3A3A3` | Meta and labels, the fees/seats line, program names, the no-availability en dash, stale and unknown miles, the unknown freshness mark |
| `--accent` | `#1F5FBF` | `#7DAAF5` | Link text and link buttons, the focus ring, the modified-chip outline. **Never a fill** |
| `--fresh` | `#1B7A3E` | `#5FC77E` | Freshness ≤ 2 h: mark and age text |
| `--aging` | `#8F5800` | `#E3A93C` | Freshness 2–6 h: mark and age text; the quota indicator at 800–949 |
| `--stale` | `#9B4A4A` | `#D48C8C` | Freshness > 6 h: ring and age text |
| `--error` | `#B42318` | `#F17A72` | Inline errors, chip error state, the quota indicator at ≥ 950, destructive confirmations |

Plus one derived value, `--selection` (`--fg` at 15 %), used for text selection and for the calendar's range band.

Rules that keep the palette meaning something:

- **Text** uses only `--fg`, `--fg-muted`, `--accent`, the freshness trio and `--error`.
- **Backgrounds** use only `--bg` and `--bg-raised` — except the primary button and the switch-on track, which are `--bg` on `--fg` (the page inverted). The QR code inverts the same way in dark mode so phone cameras can still read it.
- **`--accent` is never a fill.** Blue marks the three interactive things that are not buttons: link text, the focus ring, and a chip whose value changed. So blue always means "you are here" or "this changed", never "our brand".
- **Disabled** is `--fg-muted` on `--bg-raised`. No opacity fades — an opacity layer over a cell drops real text contrast below AA (that was a real 6.5 finding).
- **No per-tier cell tints**, no shadows, no gradients.

Contrast was computed for every pair on both grounds with `docs/ui-plan-assets/contrast.mjs`; the table is in `UI_PLAN.md` §2. Every text pair clears 4.5:1 in both themes (lowest 4.90:1); every control border and the hatch stripe clear 3:1 (lowest 3.14:1). Grid lines are deliberately below 3:1 — they are structure, and a cell's edge never carries meaning on its own.

**Theme selection.** `<html data-theme="system|light|dark">` is stamped server-side in `src/app/layout.tsx` from the `ag_theme` cookie (or the stored `users.theme`), then confirmed pre-paint by `THEME_SCRIPT` (`src/lib/theme`), so there is no flash. `[data-theme="dark"]` is explicit dark; the `prefers-color-scheme` block applies only while the attribute is `system` or absent. The dark palette is written twice on purpose (a selector and a media query cannot share a block); `src/styles/tokens.test.ts` asserts the two copies define the same tokens with the same values.

### 1.2 Type

One family: self-hosted **Inter variable** (`public/fonts/InterVariable.woff2`, OFL, `font-display: swap`), with a Latin-only `unicode-range` so Chinese never waits on the download. The stack is `--font-stack` in `tokens.css`:

```
"InterVariable", Inter, -apple-system, "Segoe UI", Roboto,
"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif
```

CJK faces sit **after** the Latin faces on purpose: browsers resolve fonts per character, so Han glyphs fall through to PingFang / Hiragino / YaHei / Noto while the Latin letters and digits inside a Chinese string (`HKG`, `60,000`) stay in Inter with its tabular figures. `font-variant-numeric: tabular-nums` is set on `html` and inherited by everything; no element opts out and there is no monospace anywhere. No stylistic sets. No italics in Chinese (`:lang(zh) em, :lang(zh) i` is weight 500 instead).

Five roles, all in px, exposed as the utilities `t-title`, `t-section`, `t-body`, `t-grid`, `t-meta` in `globals.css`:

| Role | Size / line | Weight | Used for |
|---|---|---|---|
| Page title | 20 / 28 | 600 | one `h1` per page |
| Section heading | 16 / 24 | 600 | `h2`; 24 px above, 8 below |
| Body, controls, chips | 14 / 20 | 400 (buttons and inputs 500) | everything conversational |
| Grid | 13 / 16 | 400; miles 600 | cells, route headers (500), row headers |
| Meta | 12 / 16 | 400 | age, footer, "Parsed from", hints — `--fg-muted` unless it is an age |

Nothing on the page is larger than 20 px. Sentence case in both languages; no tracked-out uppercase anywhere.

### 1.3 Spacing, density, radii, borders

4 px base unit; gaps of 4 (inside a chip), 8 (between chips and fields), 16 (between blocks), 24 (between page sections), 32 (above the footer). Top bar 48 px, footer 32 px, page gutters 16 px at every breakpoint. The grid page is full-bleed; Queries and Settings max out at 880 px, left-aligned; the auth column is 360 px, centred.

Grid density is driven by `data-density` on `.ag-wrap`, set from `matchMedia` in `src/components/grid/use-roving-grid.ts` (SSR default `desktop`):

| Density | Breakpoint | Row height | Row-header column | Cell lines |
|---|---|---|---|---|
| desktop | ≥ 1280 px | 48 px (`--row-desktop`) | 96 px | three |
| tablet | 768–1279 px | 32 px (`--row-tablet`) | 80 px | two |
| mobile | < 768 px | 40 px (`--row-touch`) | 72 px | one |

Minimum column width is 112 px (`--column-min`) at every density. Row heights include the grid line (`.ag-cell-in` is `row − 1 px`) so body rows measure exactly 48 / 32 / 40 px like the header.

Radii by role: 4 px on controls (`--radius-control`), 6 px on popovers and drawers (`--radius-surface`), **0 on the grid** and its cells and sticky headers (`--radius-grid`), 9999 only on the freshness dots, which are circles.

Borders: 1 px `--line` between grid cells, under the top bar, above the footer, between the query block and the grid, and on a drawer's page-facing edge. 1 px `--line-strong` on inputs, chips and outline buttons. No border on sections, table outer edges, Settings sections or the auth form; **no shadow anywhere** — popovers separate from the page by their `--bg-raised` ground plus a 1 px `--line-strong` edge.

### 1.4 Freshness encoding

One source of truth: `FRESHNESS_SPEC` in `src/lib/grid/freshness.ts` carries the thresholds, the mark shape, the colour token and the contrast step; `src/components/grid/freshness-mark.tsx` only draws. Marks are 8 × 8 inline SVGs, `aria-hidden`, coloured by `currentColor` from the enclosing `.ag-age[data-tier]`.

| Tier | Age | Mark (SVG) | Colour | Miles | Age text |
|---|---|---|---|---|---|
| fresh | < 2 h | filled circle, `r=4` | `--fresh` | 600 `--fg` | `45m` / `2h` |
| aging | 2–6 h | left half filled (`M4 0 A4 4 0 0 0 4 8 Z`) inside a 1 px ring | `--aging` | 600 `--fg` | `3h` |
| stale | > 6 h | hollow ring, 1.25 px stroke | `--stale` | 600 `--fg-muted` | `1d` |
| unknown | unparseable | hollow ring, 1.25 px stroke | `--fg-muted` | 600 `--fg-muted` | `?` |

The **age text is always rendered**, in the tier colour, 12/16, right-aligned on the cell's last line with the mark 4 px to its left. So the tier survives grayscale (the words differ), colour blindness (the shapes differ) and a screen reader (the cell's `aria-label` says "seen 2 hours ago", and a stale cell adds ", stale"). `unknown` is a real fourth tier, not "treat as stale": an unparseable timestamp is a fact about our data, not a claim about its age.

Changing a threshold means changing `FRESH_MAX_MS` / `AGING_MAX_MS` in that one file — the cell, the drawer, the tooltip, the CSV, the ASCII renderer and `grid.freshness.legend` all read from it.

### 1.5 Cell states

Six states, each carrying a **pattern and a label**, never colour alone (`src/components/grid/cell.tsx`, styles in `grid-styles.css`):

| State | Pattern | Label / accessible name |
|---|---|---|
| `ok` | the three-line anatomy: miles (600) / fees left + seats right / program + mark + age | full `aria-label` from `src/lib/grid/aria.ts` |
| `none` | a single quiet en dash, `--fg-muted`, centred | "no availability" |
| `unmonitored` | diagonal hatch (`--hatch`: 1 px `--line-strong` stripes at 45° on `--bg-raised`) | title and aria "Not monitored by seats.aero" |
| `not_fetched` | 1 px dotted `--line-strong` inset outline | the reason, as an i18n key on the cell (`grid.cell.not_fetched_quota` / `_error` / generic) |
| `filtered` | muted anatomy plus a `dyn` text tag at every density | the full word "dynamic pricing" in the title and the aria label |
| `loading` | skeleton bars at the eventual line positions (static under reduced motion) | `aria-busy` on the grid |

The `dyn` tag is drawn on mobile too, so the filtered state never rests on the muted colour alone. Fees that are unknown render `?`, not a dash — a dash would read like the no-availability state.

### 1.6 Motion and reduced motion

Motion only ever answers a user action, and there are exactly three: a drawer slides in (200 ms, `ease-out`), a popover appears (150 ms opacity + 4 px translate), and a result lands from its skeleton (150 ms opacity). Durations are `--motion-fast` / `--motion-slow`. No entrance animation on load, no hover transitions, no looping shimmer by default — the skeleton is static bars, and a single 1.2 s shimmer runs only under `prefers-reduced-motion: no-preference`.

`prefers-reduced-motion: reduce` is honoured globally in `globals.css` (`animation-duration: 0s`, `transition-duration: 0s`, `scroll-behavior: auto`, `animation-iteration-count: 1`) and again locally where a component has its own animation (`drawer.css`, `grid-styles.css`, `queries.css`, `cell-drawer.css`). The e2e suite runs with `reducedMotion: "reduce"` and `animations: "disabled"`, so every screenshot is the reduced-motion rendering.

### 1.7 Focus ring

`2 px solid var(--accent)` with `outline-offset: 1px`, on `:focus-visible` only, declared once in `globals.css`. Inside the grid and the sticky header it is drawn inset so the scroll container cannot clip it (`.ag-cell:focus-visible`). Nothing removes an outline without replacing it; a disabled control never loses focus (the locale toggle stays enabled during its refresh and ignores the second press instead).

---

## 2. Component map

Which file renders what. Anything ending in `.ts` next to a `.tsx` is the pure part (model, formatting, state machine) and carries the unit tests.

### Shell — `src/components/shell/`, `src/app/layout.tsx`

| File | Renders |
|---|---|
| `app/layout.tsx` | `<html data-theme lang>`, the pre-paint theme script, `LocaleProvider`, `Header`, `<main>`, `Footer` |
| `header.tsx` | the 48 px top bar: product name, `Nav`, `QuotaIndicator`, `LocaleToggle`, `ThemeToggle`, `UserMenu`, `MobileMenu` |
| `nav.tsx` | Grid · Queries · Settings, the current one underlined 2 px `--fg` |
| `quota-indicator.tsx` + `quota-indicator-state.ts` | `312 / 1,000 today` from `GET /api/usage`; neutral / amber / red thresholds live in the pure module shared with the server |
| `theme-toggle.tsx` | the cycling text button (System → Light → Dark) with the state in its accessible name |
| `locale-toggle.tsx` | EN / 中文 |
| `user-menu.tsx`, `logout-button.tsx`, `mobile-menu.tsx` | username menu with Log out; below 768 px the nav, language and theme collapse into the menu |
| `footer.tsx` | the 32 px line: "Data: seats.aero" │ version │ Legal (the vertical rules are the only separator glyph in the app) |
| `auth-form.tsx` | the 360 px login / register column with inline field errors |
| `page-column.tsx` | the 880 px reading column for Queries, Settings and Legal |
| `markdown.tsx` | the Legal page's renderer |

### Grid — `src/components/grid/`

| File | Renders |
|---|---|
| `grid-app.tsx` | the page orchestrator: query bar → chips → quota banner → toolbar → grid or an empty state; owns the query state, the URL `?q=`, and the drawer slot |
| `query-bar.tsx` | the growing input, Run, the Examples link, "Parsed from:" and the "guessed" provenance note |
| `examples-popover.tsx` | three bilingual example queries, anchored to the whole query row |
| `chip-row.tsx` + `chips-model.ts` | the seven chips in order (Origins · Destinations · Dates · Cabins · Programs · Direct only · Sort), the modified state, Reset to parsed |
| `chip-editors/*.tsx` | one popover editor each: `places-editor` (searchable list, city groups, free IATA entry), `dates-editor` (two-month hand-written calendar + presets, 92-day clamp), `cabins-editor`, `programs-editor`, `direct-editor`, `sort-editor`; `chip-popover.tsx` is the shared surface |
| `toolbar.tsx` | rows toggle, cabin chips, "Show dynamic pricing", Save as standing query, Export CSV, Ask; collapses into a Filters bottom sheet below 768 px |
| `grid-table.tsx` | `<table role="grid">`, sticky header row and first column, virtualization, hover highlight, density |
| `cell.tsx` | one cell: six states, cabin tag, freshness mark, `aria-label`, roving `tabindex` |
| `cell-tooltip.tsx` | the hover/focus tooltip listing every program for the cell with its own mark and age |
| `freshness-mark.tsx` | the 8 × 8 SVG marks |
| `grid-skeleton.tsx` | the loading grid in the query's real shape (rows from the Dates chip, columns from the airports) |
| `empty-states.tsx`, `parse-failure.tsx` | no key, empty results, quota exceeded, parse failure |
| `use-roving-grid.ts` | density from `matchMedia`, roving tabindex, arrows / Home / End / PageUp / PageDown |
| `state.ts`, `date-model.ts`, `places-index.ts`, `api.ts` | URL encoding of the `QueryObject`, date arithmetic, the places index, the fetch wrappers |
| `cell-drawer/` | `cell-drawer.tsx` (header, program list), `program-row.tsx` (miles, fees, seats, stops, freshness), `flights-list.tsx` (Get Trips with skeleton rows), `actions.tsx` (the caveat line, Open in …, Copy details, Save as standing query, Ask about this cell), `copy-details.ts` |

### Drawers — `src/components/drawers/`

`drawer-shell.tsx` is the one shell for both drawers: the caller states a width (480 px cell, 420 px Ask) and a mobile presentation, and the shell picks push (≥ 1280 px), overlay with a scrim (768–1279), full-height sheet or bottom sheet (< 768) from the breakpoint. `use-drawer-state.ts` holds a single slot (`null | {kind:"cell"} | {kind:"ask"}`), which is what makes "mutually exclusive" structural rather than a rule two call sites have to remember; it also keeps `lastCell` so the Ask drawer's "Selected: …" pill survives the switch. `bottom-sheet.tsx` and `drag.ts` are the mobile Ask presentation; `prefill.ts` builds the ±3-day standing query from a cell.

### Ask — `src/components/ask/`

`ask-drawer.tsx` (the panel), `context-pills.tsx` (removable grid / cell context), `suggestions.tsx` (three bilingual questions), `answer.tsx` + `markdown.ts` (progressive markdown, same-origin links only), `tool-activity.tsx` (the collapsed tool list), `cost-meter.tsx` (today's spend and the cap), `sse.ts` / `client.ts` (the stream), `history.ts` (per browser session, cleared on log-in and log-out), `demo.ts` (the scripted e2e stream switch).

### Queries — `src/components/queries/`

`queries-table.tsx` (the one table: name, schedule, notifies on, last run, next run, enabled, actions), `query-row.tsx` (the row and its expansion), `run-history.tsx` (the last 20 runs), `diff-cells.tsx` (new / dropped / cheaper cells rendered with the real grid-cell component), `inline-confirm.tsx` (delete confirms in the row, never in a modal, and returns focus), `edit-query-drawer.tsx` (the same seven chip editors in a drawer), `SaveQueryDialog.tsx`, `format.ts` (schedule labels, run summaries, `mergeRunCalls`).

### Settings — `src/components/settings/`

`section.tsx` (heading + rows, no cards), `keys-section.tsx` (one row per provider, status, `••••1234`, Replace / Remove, validation result), `quota-bar.tsx`, `telegram-section.tsx` + `telegram-link.tsx` + `telegram-link-state.ts` (link / unlink, the in-repo QR, quiet hours as two time fields with the detected zone and a "Change time zone" disclosure), `account-section.tsx` (username, change password, log out everywhere), `language-theme-section.tsx` (the explicit radios), `native-select.tsx`.

### Primitives — `src/components/ui/`

shadcn (base-nova) primitives, unmodified in structure and re-pointed at our tokens through the shadcn aliases in `globals.css`. Prefer composing these over new one-off elements; if a primitive needs a token it does not have, add the alias in `globals.css` rather than a hex value in the component.

---

## 3. How to add a string

Full rules and the en ↔ zh glossary are in `docs/COPY.md`. The short version:

1. **Pick a key** `page.section.thing`, lowercase snake case: `grid.chips.at_least_one_airport`, `settings.telegram.qr_hint`, `saved.dialog.submit`. The first segment is the page or surface — one of `nav`, `footer`, `auth`, `grid`, `saved`, `settings`, `ask`, `common`, `error`, `notice`, `notify`, `quota`, `theme`; the middle segments name the section or component; the last names the thing. Controls end in a verb or control name (`.run`, `.submit`, `_cta`, `.open_link`) — `CONTROL_KEY_PATTERNS` in `src/lib/i18n/copy-allowlist.ts` treats those as labels, so they must not end in a period and must start with a capital, a digit or a placeholder.
2. **Add it to both dictionaries** — `src/lib/i18n/dictionaries/en.ts` and `zh.ts` — with the same `{placeholders}`. The two files are the same 569 keys today and `i18n.test.ts` fails if they diverge. Reuse a glossary term; do not coin a second word for a concept that already has one (`定时查询`, not `已保存查询`).
3. **Never put text in JSX.** Render with `t("key")` — `getT()` from `@/lib/i18n/server` in a server component, `useT()` from `@/lib/i18n/client` in a client one. Compose *data* in components (`SEA → NRT`, `60,000`, an age) and *words* in the dictionary.
4. **Run the copy tests:** `pnpm exec vitest run src/lib/i18n`. `i18n.test.ts` checks that the key sets and the placeholders match; `copy-rules.test.ts` enforces the mechanical half of `COPY.md` §1 and names the offending key. It fails on ALL-CAPS tokens of 4+ letters, `→` / `->`, ` · `, `...` instead of `…`, "sorry" / "oops" / "please" (en) and 抱歉 / 对不起 / 不好意思 / 很遗憾 (zh), an em dash joining clauses (`—` in en, `——` in zh), trailing periods on control keys, Title Case in en, half-width punctuation touching a Chinese character in zh, a zh value with no Chinese in it, and `<i>` / `<em>` markup in zh.
5. **If a proper noun trips a check**, add it to `src/lib/i18n/copy-allowlist.ts` with a reason. Program names come from `SOURCE_NAMES` automatically and are never translated.

The **glossary** in `COPY.md` §2 is the tie-breaker for wording (grid → 表格, standing query → 定时查询, program → 里程计划, "seats.aero last saw this: {age}" → 「seats.aero 查看时间：{age}」, schedule → 频率, this server → 此服务器, Log in / Log out never Sign in / Sign out). Read it before inventing a term.

---

## 4. How to add a token

Adding a token is deliberately a small ceremony, because eleven colours are the budget and each one has to mean something.

1. **Ask whether it is really new.** A new colour needs a meaning no existing token carries. A new *size* usually belongs to the existing 4 px scale.
2. **Define it in `src/styles/tokens.css`** in all three places: the `:root` (light) block, the `[data-theme="dark"]` block, and the `prefers-color-scheme: dark` copy of the dark block. Missing one is the classic bug; `src/styles/tokens.test.ts` fails when the two dark copies disagree.
3. **Compute the contrast** against `--bg` *and* `--bg-raised` in both themes with `node docs/ui-plan-assets/contrast.mjs` — 4.5:1 for text, 3:1 for a border or a pattern that carries meaning. Add the row to the table in `UI_PLAN.md` §2 and to this file's §1.1.
4. **Expose it to Tailwind** by adding `--color-<name>: var(--<name>);` to the `@theme inline` block in `src/app/globals.css`. If a shadcn primitive needs it, alias the shadcn variable to it in the same block instead of touching `ui/*`.
5. **Never write a hex value in a component or a CSS file other than `tokens.css`.** Never name a token after an airline or a program.
6. **Log it in `DECISIONS.md`** under the current sub-phase, with the reason, and run `pnpm exec vitest run src/styles`.

Non-colour tokens (spacing, radii, the type scale, shell measurements, grid density, motion durations, the focus ring, the font stack) live in the same file and follow steps 1, 2, 5 and 6.

---

## 5. Screenshots and visual baselines

### 5.1 What is captured, and where

Everything runs offline: a `DEMO=1` mock seats.aero on `:3999` serving `fixtures/demo/`, and a production `next start` on `:3400` over a throwaway SQLite file seeded by `scripts/seed-e2e.ts`. No key, no network, no real data — the seeded user's fake key is a *scenario selector* for the mock (normal, empty, slow, partial, quota). `e2e/README.md` has the full table.

```sh
export PATH="$HOME/.local/node-arm64/bin:$PATH"
pnpm build            # once: the suite needs a production build (.next/BUILD_ID)
pnpm e2e              # all four projects; writes docs/screenshots/v0.2/**
pnpm e2e -g grid      # one spec
pnpm exec playwright show-report e2e-report
```

Path convention, enforced by `FILE_RE` in `e2e/matrix.ts` and by the index script:

```
docs/screenshots/v0.2/<page>/<state>-<viewport>-<theme>[-zh].png
```

- `<page>` is the surface. Four matrix pages — `shell`, `grid`, `queries`, `settings` — plus three per-feature detail folders the feature specs write (`chips`, `cell-drawer`, `ask-drawer`) and `before/`, the frozen record of the v0.1 UI, which is never regenerated.
- `<state>` is the page state from spec §3.7 / §4 / §5: `results`, `no-key`, `parse-failure`, `loading`, `empty-results`, `quota`, `modified`, `cell-drawer`, `ask-streaming`, `expanded`, `delete-confirm`, `telegram-linked`, …
- `<viewport>` is `desktop` (1440 × 900) or `mobile` (390 × 844); `<theme>` is `light` or `dark`; `-zh` marks the Chinese capture.

**The matrix is declared once**, in `e2e/matrix.ts`: one entry per page and state, with the one-line description the contact sheet prints. `e2e/screenshots.spec.ts` walks it to produce every PNG and `e2e/states.ts` knows how to reach each state — the same helpers `e2e/visual.spec.ts` uses, so a state cannot mean one thing in a screenshot and another in a baseline. To add a capture, add a `MatrixShot` (and a state helper if the state is new); do not add a second screenshotting script. The state helpers never leave a mutation behind — a state that needs a write (Run now, minting a Telegram deep link) intercepts the request — so a capture run leaves the e2e database as it found it.

The contact sheet is generated from the same module, so it can never describe a set of states nobody captures:

```sh
pnpm exec tsx scripts/screenshot-index.ts            # write docs/screenshots/v0.2/README.md
pnpm exec tsx scripts/screenshot-index.ts --check    # check the tree only, write nothing
pnpm exec tsx scripts/screenshot-index.ts --strict   # also fail on a PNG that is not in the matrix
```

It exits 1 on an unknown page directory, a file that breaks the naming rule, or a matrix entry with no PNG on disk. It reads only the file tree — no browser, safe on any machine, offline.

These captures are plain `page.screenshot()` images for human review, regenerated by every run. They are **not** the visual-regression baselines.

### 5.2 Visual-regression baselines (Linux)

`e2e/visual.spec.ts` is the alarm, not the documentation: a curated subset of the matrix — eight states across three projects (desktop light and dark, mobile light), 24 comparisons — held to committed `toHaveScreenshot` baselines. Anything whose text is a clock reading is masked (`timeMasks`: freshness ages, quota counters, the grid's date row headers, relative run times); the box is still compared, only the reading inside it is exempt.

Baselines live under `e2e/__screenshots__/<project>/visual.spec.ts/` with **no platform suffix** (`snapshotPathTemplate` in `playwright.config.ts`), because they are generated and committed from **Linux CI only** — font rasterisation and the CJK fallback differ between macOS and Ubuntu, so a Mac-generated baseline fails on CI for reasons that have nothing to do with the UI. The comparisons are therefore **inert unless `VISUAL=1`**, so a routine `pnpm e2e` on a laptop (or a fresh clone with no baselines yet) never fails on them:

```sh
pnpm e2e                              # the visual tests run; snapshots ignored
VISUAL=1 pnpm e2e -g visual           # compare against the committed Linux baselines
VISUAL=1 pnpm e2e:update -g visual    # rewrite them — reason in the commit message
```

To update baselines:

1. Make the UI change and land it.
2. Let CI's `visual` job run and download its **`visual-snapshots`** artifact — the expected, actual and diff images plus `test-results/`. Look at the diffs by eye.
3. If the new rendering is correct, take the regenerated Linux PNGs and commit them under `e2e/__screenshots__/<project>/visual.spec.ts/` **with the reason in the commit message** — "baseline: cell drawer gained the Ask about this cell action", never "update snapshots".
4. When no baselines are committed at all, the job runs its update path instead and uploads the fresh Linux set as **`visual-baselines`** for a human to download and commit once.
5. `VISUAL=1 pnpm e2e:update` locally is for iterating only; a Mac-generated baseline must not be committed.

Comparison tolerance: `maxDiffPixelRatio: 0.01`, animations disabled (`playwright.config.ts` `expect.toHaveScreenshot`).

The `visual` CI job is **non-blocking** until it has been green on five consecutive runs (spec §11; the promotion is recorded in `DECISIONS.md` § 6.6). A red non-blocking job is still a finding — read it before merging.

---

## 6. Responsive rules

Three breakpoints, one set of numbers, used by the grid density hook (`use-roving-grid.ts`), the drawer shell (`drawer-shell.tsx`) and the toolbar.

**≥ 1280 px — desktop.** Everything at full size. Cells are three lines (miles / fees + seats / program + mark + age); rows 48 px; the row-header column 96 px. Drawers **push**: the panel takes its width (480 px cell, 420 px Ask) and `<main>` gives up exactly that much, so the grid shrinks instead of being covered — and because the page stays usable, a pushing drawer is not `aria-modal` and does not trap focus. The top bar shows name, nav, quota, language, theme and the user menu.

**768–1279 px — tablet.** Cells drop to two lines (miles + program/freshness); fees and seats move to the tooltip and the drawer. Rows 32 px; the row-header column 80 px. Chips wrap and shorten to counts when a value would exceed 160 px. Drawers **overlay** with a 40 % `--fg` scrim: modal, focus trapped, body scroll locked, the scrim contains overscroll.

**< 768 px — mobile.** The grid stays a real table with the sticky date column and horizontal scroll; cells are one line (`60,000 ●2h`, with the cabin tag when both cabins show and the `dyn` tag when filtered) and the program name moves to the drawer. Rows 40 px, the row-header column 72 px, and every control inside a mobile drawer grows to a 40 px touch target. The toolbar collapses into a **Filters** bottom sheet holding rows, cabins, dynamic pricing, Save, Export and Ask. The cell drawer becomes a full-height sheet; the Ask drawer becomes a bottom sheet with a drag handle (initial focus skips the handle — it is the dismiss control). The top bar keeps the product name, the quota indicator and a menu that holds the nav, language, theme and Log out. The Queries table becomes a stacked list.

**Touch, as distinct from narrow.** Three rules key on `(pointer: coarse)` as well as the 768 px
width, because they are about a thumb rather than a viewport (issue #32, verified on an iPhone
running Mobile Safari): the 40 px target floor in `globals.css`, and the grid's scroll chaining and
column snapping in `grid-styles.css`. Width alone let the same phone in landscape — 874 px — and
every tablet fall back to 24–32 px desktop controls. `pointer: coarse` is the PRIMARY pointer, so a
touchscreen laptop keeps the dense controls it is driven with. The cell tooltip is the fourth: its
pointer path asks `(hover: hover) and (pointer: fine)` and its focus path asks `:focus-visible`, so
a tap never leaves one behind while a keyboard still gets one.

All three bands are pinned by `e2e/responsive.spec.ts`, which resizes one desktop context rather than splitting the bands across projects (density is width-driven, so a resized window is the same UI a phone gets): cell lines and row heights per band, the drawer presentation per band, the toolbar collapsing into Filters, chips wrapping at 390 px, the top bar reducing to name + quota + menu, the date column staying sticky while the table scrolls sideways, every interactive element at least 40 px at 390 px, no page scrolling sideways at 390 px, nothing animating under reduced motion, and no English string leaking through in Chinese. The capture matrix then photographs both viewports in both themes; the `chips`, `cell-drawer` and `ask-drawer` captures assert no horizontal overflow in either language, which is where a long zh string shows up first.

---

## 7. The accessibility floor, and how it is enforced

The floor (spec §8):

- **WCAG AA contrast in both themes**, zero serious or critical axe violations.
- **Every interactive element keyboard-reachable**, and the whole grid walk possible without a mouse.
- **No meaning carried by colour alone** — freshness has shape + text, every cell state has a pattern + a label.
- **`prefers-reduced-motion` respected everywhere.**
- **Both dictionaries complete**; numbers and dates through `Intl` in the viewer's locale.

How each is actually enforced:

| Floor | Enforced by |
|---|---|
| Contrast | `src/styles/tokens.test.ts` (the shipped hexes are the plan's, both dark copies agree) + `docs/ui-plan-assets/contrast.mjs` for any new pair + axe at runtime |
| Zero serious/critical | `e2e/axe.spec.ts` — `@axe-core/playwright` with the WCAG 2.x A/AA tags, **enforced by default** since 6.6 (`E2E_AXE_STRICT=0` downgrades it to a report while triaging). The matrix is every page and state: login, register, legal, grid results, the seven chip editors, the cell drawer, the Ask drawer, quota, no key, empty results, parse failure, manual mode, queries (list, expanded, edit drawer, empty) and settings — each on **desktop-light, desktop-dark and mobile-light** (dark is a second palette, and below 768 px the drawers and toolbar become sheets with a different focus order). Counts per impact land in `docs/screenshots/v0.2/axe-summary.json`, offending elements are logged |
| Keyboard | the pure model in `src/lib/grid/keyboard.ts` with `keyboard.test.ts`, the roving tabindex in `use-roving-grid.ts`, and the mouse-free walk in §8 |
| No colour-only meaning | the state table in §1.5 — every state has a pattern and a label; reviewed per PR against the §1.2 self-check |
| Reduced motion | the global block in `globals.css` and the per-component blocks; `e2e/responsive.spec.ts` asserts nothing animates under `prefers-reduced-motion`, and the whole suite runs with `reducedMotion: "reduce"` |
| Touch targets | `e2e/responsive.spec.ts` — every interactive element is at least 40 px at 390 px, and offenders are listed by name |
| i18n completeness | `src/lib/i18n/i18n.test.ts` (identical key sets, identical placeholders) and `copy-rules.test.ts`; `e2e/responsive.spec.ts` checks no English string leaks through in Chinese; zh captures for the grid and both drawers |

Screen-reader details that are easy to break, so they are worth knowing before editing: the grid announces through `role="grid"` with `aria-rowindex` / `aria-colindex` and one `aria-label` per cell (`src/lib/grid/aria.ts`) — the row and column headers are not focusable; the Ask transcript is **not** a live region (a 150 ms delta would re-announce a half-formed sentence), a one-line `role="status"` announces "Thinking…" / "Answer complete." instead, and the failure line is always mounted so it is not inserted together with its text; at the Ask cap the disabled prompt is `aria-describedby` the cost meter so the reason and reset time are read with it; a leaving drawer is `inert`, so the 200 ms exit does not advertise a modal dialog.

---

## 8. Keyboard walk

Spec §8 asks for one thing to be true and written down: a user with no mouse can go from an empty query bar to an opened booking link. This is that walk. Every step below is a real key press, `e2e/keyboard-walk.spec.ts` performs exactly these steps and asserts `document.activeElement` after each one, and nothing in that spec clicks. If a step changes here, it changes there.

Start: signed in, `/grid`, focus on the document (nothing selected).

1. **Tab** until the query bar has focus. It is a `textarea` named "Search awards" (`grid.search`); the top bar's links, the quota indicator and the language, theme and user controls come before it in source order, so they are what you pass through.
2. **Type** the query — `HKG, SHA, TYO, SEL to SEA, next 30 days, business and first`, or the Chinese equivalent. The field grows to three lines and then scrolls.
3. **Enter** runs it. Focus stays in the field: Enter is "run", not "leave". The seven chips appear below with what the parser read, and the grid runs. (**Shift+Enter** inserts a newline instead; while an IME candidate window is open Enter confirms the candidate and never submits.)
4. **Tab** to the chips row. Each chip is a button; the first is **Origins**.
5. **Enter** opens the Origins editor. The popover takes focus, so the editor is reachable without going back to the page.
6. **Tab** through the editor to drop an airport. Tokyo is one city row — `TYO ▸ NRT ✓ HND ✓` — so the control that removes a single airport is that airport's own toggle (named "HND selected"); the row's **×** at the end removes the whole city. **Enter** toggles it. The Origins chip summary updates as you go, and the query is now *modified*: the chip takes the accent outline, and "Reset to parsed" and "Run" appear at the end of the row.
7. **Esc** closes the editor and hands focus back to the Origins chip — never to the page behind it. (Inside the places search, the first **Esc** clears the search text and only the second closes the popover.)
8. **Tab** to the **Run** affordance at the end of the chip row and press **Enter**. The grid re-runs; the toolbar re-enables.
9. **Tab** into the grid. Exactly one cell is tabbable — the roving tabindex — so one Tab enters the grid and one Tab leaves it. The entry cell is the first available one.
10. **Arrow keys** move one cell at a time: ←→ along the row, ↑↓ down the column, no wrapping at the edges. **Home** / **End** go to the ends of the row, **Ctrl+Home** / **Ctrl+End** (**Cmd** on macOS) to the corners of the grid, **PageUp** / **PageDown** seven rows at a time. Focus survives virtualization: a target row that is not mounted yet is scrolled into view and focused on the next frame.
11. **Enter** (or **Space**) on a cell opens the cell drawer, and focus moves into it. At ≥ 1280 px the drawer pushes the grid aside and the grid behind it stays usable; below that it overlays or becomes a sheet and traps Tab inside itself.
12. **Tab** to **"Open in <program>"**. It is a real `<a href>` when the program has a link — seats.aero's own booking URL once "Show flights" has fetched it, otherwise the American award-search URL — so **Enter** opens the program's site in a new tab. The confirmation line ("Confirm on the program's site before transferring any points…") is body text directly above the button, on screen, not in a tooltip a keyboard user cannot open. When no link exists the control is a disabled button and a muted line says why.
13. **Esc** closes the drawer and returns focus to the cell that opened it — the exact cell, even if the drawer was re-pointed at another one while it stayed open.
14. **Tab** once more leaves the grid for the rest of the page.

### Key map

| Key | Where | What it does |
|---|---|---|
| Tab / Shift+Tab | everywhere | Next / previous control. The grid is one stop (roving tabindex); an overlaying drawer or sheet cycles within itself |
| Enter | query bar | Run the query (Shift+Enter: newline; composing: confirm the IME candidate) |
| Enter / Space | chip, cell, button | Open the chip editor, open the cell drawer, press the button |
| ↑ ↓ ← → | grid | One cell; no wrapping |
| ↑ ↓ | places search | Move the active result (`aria-activedescendant`); Enter adds it |
| Home / End | grid | Start / end of the row |
| Ctrl+Home / Ctrl+End (Cmd on macOS) | grid | First / last cell of the grid |
| PageUp / PageDown | grid | Seven rows |
| Esc | popover | Close and return focus to the chip (in the places search: first clears the text) |
| Esc | drawer, sheet | Close and return focus to whatever opened it |

The focus ring is the same everywhere: 2 px `--accent`, 1 px outside the element, and only for keyboard focus (`:focus-visible`). Inside the grid and the sticky headers it is drawn 1 px *inside* the cell instead, so the scroll container never clips it.

**One deviation from the spec's wording**, recorded here rather than papered over: §8's walk says "remove HND … Tab to its × and press Enter". In the shipped editor a metro is one row with per-airport toggles, and the × belongs to the row, so removing HND alone is that airport's toggle (step 6). The × is still keyboard-reachable and still removes the row it belongs to; the walk exercises the control that matches the spec's *intent* — drop one airport, with the keyboard, from inside the Origins editor.
