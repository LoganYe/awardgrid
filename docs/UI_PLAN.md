# awardgrid UI plan (Phase 6.0)

The design every Phase 6 sub-phase (6.1–6.6) implements. Where this plan and the Phase 6 spec disagree, the spec wins; where both are silent, pick the quieter option and log it in `DECISIONS.md`. Pixel values here are the contract for `styles/tokens.css`, `lib/grid/freshness.ts` and the Playwright suite.

## 1. Principles

1. **An instrument, not a dashboard.** The user already knows what 60,000 miles in J means. Every pixel shows data, says how much to trust it, or lets the user act. No hero, no marketing copy, no "insights".
2. **Boldness lives in one place: the grid cell.** The miles figure (13 px, weight 600, tabular) and the freshness mark are the only loud things on any page. Shell, chips, drawers, settings are typographically flat.
3. **Structure encodes information.** Grid lines *are* the table. A border appears only where two different kinds of information meet (query vs. results, page vs. drawer). Nothing gets a border for looking like a component.
4. **Trust is visible.** Age text is always present next to every figure; a stale number is visibly quieter than a fresh one; unknowns say "?", never blank.
5. **Motion answers actions.** A drawer, popover or newly landed result moves for 150–200 ms because the user did something. Nothing animates on load, on hover, or on its own.
6. **Two languages, one system.** Chinese and English strings share every measurement; the CJK fallback is part of the font stack, never an afterthought.
7. **Nothing borrowed.** No logos, wordmarks or brand colors; program names are text. "Data: seats.aero" stays in the footer on every page.

## 2. Color tokens

Warmth decision: **none**. All neutrals are strictly achromatic (R = G = B). The freshness hues and the single blue accent supply every bit of color on the page, which keeps them legible as signals instead of decoration. Light `--bg` is true white and dark `--bg` is `#111111` (not tinted, not "near-black navy"). Tokens live in `src/styles/tokens.css`; the Tailwind `@theme inline` block in `globals.css` maps them, and the shadcn variables (`--background`, `--border`, `--ring`, …) become aliases of these so existing primitives pick them up.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#111111` | Page, grid cells, inputs, drawers |
| `--bg-raised` | `#F4F4F4` | `#1E1E1E` | Sticky header row + row headers, hovered/selected cell, skeleton, popover ground, disabled controls |
| `--line` | `#E2E2E2` | `#2C2C2C` | Grid lines, top bar and footer rules, section dividers |
| `--line-strong` | `#8A8A8A` | `#707070` | Input/switch borders, chip outlines at rest, "not fetched" dotted outline, "not monitored" hatch stripes (≥ 3:1 non-text contrast on both grounds) |
| `--fg` | `#171717` | `#EDEDED` | All primary text, miles figure, active-nav underline; ground of the primary button and the switch-on track (text/thumb in `--bg`) |
| `--fg-muted` | `#5C5C5C` | `#A3A3A3` | Meta, labels, fees/seats line, program name, en dash, stale miles |
| `--accent` | `#1F5FBF` | `#7DAAF5` | Link text and link buttons, focus ring, modified-chip outline. Never a fill |
| `--fresh` | `#1B7A3E` | `#5FC77E` | Freshness ≤ 2 h mark + age text |
| `--aging` | `#8F5800` | `#E3A93C` | Freshness 2–6 h mark + age text; quota 800–949 |
| `--stale` | `#9B4A4A` | `#D48C8C` | Freshness > 6 h ring + age text |
| `--error` | `#B42318` | `#F17A72` | Inline errors, chip error state, quota ≥ 950, destructive confirm |

Rules: text uses only `--fg`, `--fg-muted`, `--accent`, the freshness trio and `--error`. Backgrounds use only `--bg`, `--bg-raised` and — for the primary button and the switch-on track only — `--fg` with `--bg` text or thumb (the page inverted, which is what the current black button already is). There is no tinted cell background per tier (the current `bg-fresh/10` tints go away; the mark and age text carry the tier). `--accent` never fills anything: it marks the three things that are interactive but are not buttons (link text, the focus ring, a modified chip's outline), so a blue on the page always means "this is where you are" or "this changed", never "this is our brand". Disabled = `--fg-muted` on `--bg-raised`, no opacity fades. Selection: `--fg` at 15 %. Eleven tokens per theme (six neutrals, one accent, three freshness, one error); nothing derived, nothing tinted.

Contrast (WCAG 2.x relative luminance; computed with the script in `docs/ui-plan-assets/contrast.mjs`, AA threshold 4.5:1 for text, 3:1 for non-text):

| Pair | Light on `--bg` | Light on `--bg-raised` | Dark on `--bg` | Dark on `--bg-raised` |
|---|---|---|---|---|
| `--fg` | 17.93 | 16.30 | 16.13 | 14.24 |
| `--fg-muted` | 6.69 | 6.08 | 7.49 | 6.61 |
| `--accent` (text and 2 px ring) | 6.09 | 5.54 | 8.04 | 7.10 |
| `--fresh` | 5.38 | 4.90 | 8.95 | 7.90 |
| `--aging` | 5.89 | 5.36 | 9.00 | 7.94 |
| `--stale` | 6.05 | 5.50 | 7.13 | 6.29 |
| `--error` | 6.57 | 5.98 | 6.98 | 6.17 |
| `--bg` on `--fg` (primary button text, switch thumb) | 17.93 | – | 16.13 | – |
| `--line-strong` (control borders, dotted outline, hatch stripes; non-text) | 3.45 | 3.14 | 3.81 | 3.37 |
| `--line` (grid lines, decorative) | 1.30 | 1.18 | 1.35 | 1.19 |

Every text pair clears 4.5:1 in both themes; every control border and the hatch stripe clear 3:1 on both grounds. Grid lines are deliberately below 3:1: they are structure, and the cell's own edge is never the only carrier of meaning. The hatch is drawn in `--line-strong` rather than a faint seventh neutral because a not-monitored cell has no text — the pattern is the visible carrier and must be seen in grayscale; the tooltip and `aria-label` are the accessible one. Stale cells drop the miles figure from `--fg` to `--fg-muted` — still ≥ 6:1 in both themes on both grounds (6.08 is the lowest), so "one contrast step down" never becomes illegible. All numbers recomputed in review (`node docs/ui-plan-assets/contrast.mjs`); none of the originally quoted values needed correction.

## 3. Typography

One family: self-hosted **Inter** (variable, OFL, `public/fonts/InterVariable.woff2`, 352 KB). Verified from the file's GSUB table: `tnum`, `pnum`, `zero`, `cv11`, `ss01` present, `fvar` present (weights 100–900 from one file). No monospace anywhere — the current `.num` / `font-mono` classes are removed in 6.1 because Inter's tabular figures do the job.

```css
@font-face {
  font-family: "InterVariable";
  src: url("/fonts/InterVariable.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  /* Latin, Latin-1, Latin Ext-A/B, general punctuation, currency, arrows used in route headers.
     CJK code points are outside this range, so Chinese text never waits for the download. */
  unicode-range: U+0000-00FF, U+0100-024F, U+2000-206F, U+20A0-20CF, U+2190-2199, U+2212, U+2026;
}
:root {
  --font-sans: "InterVariable", Inter, -apple-system, "Segoe UI", Roboto,
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
}
html { font-family: var(--font-sans); font-variant-numeric: tabular-nums; }
```

Why the CJK faces sit *after* the Latin faces and still render Chinese in a CJK face: browsers resolve fonts per character, walking the stack until a face contains the glyph. Inter, the system UI faces, Segoe and Roboto have no Han glyphs, so every Chinese character falls through to PingFang (macOS/iOS), Hiragino, YaHei (Windows), Noto/Source Han (Linux, Android) — while Latin letters and digits inside Chinese strings (`HKG`, `60,000`) stay in Inter with tabular figures. Listing CJK faces first would do the opposite: they carry Latin glyphs of their own, so `60,000` would render in PingFang's proportional digits. `unicode-range` on the `@font-face` guarantees the CJK path never blocks on the woff2 download.

| Role | Size / line | Weight | Extra |
|---|---|---|---|
| Page title | 20 / 28 | 600 | one per page, `h1` |
| Section heading | 16 / 24 | 600 | `h2`; 24 px space above, 8 below |
| Body, controls, chips | 14 / 20 | 400 | buttons and inputs 500 |
| Grid cell | 13 / 16 | 400; miles 600 | route headers 13/16 500; row headers 13/16 400 |
| Meta, age, footer, "Parsed from" | 12 / 16 | 400 | `--fg-muted` unless it is an age (tier color) |

`tabular-nums` is set on `html` and inherited everywhere; no element opts out. No stylistic sets or character variants are switched on (`cv11` single-storey a, `ss01`, `zero`): at 13 px a single-storey a sits one pixel from an o, and a slashed zero is decoration on a page that never needs to tell 0 from O. Inter's defaults are the legible ones. Chinese never uses `font-style: italic` or `<em>` (emphasis in zh is weight 500). Sentence case in both languages; no tracked-out uppercase anywhere, including the provenance badges (`det`/`llm` become the 12 px words "parsed" / "guessed" in sentence case). `zh` line-height is the same as `en` (the 16/20/24/28 grid holds; Chinese at 13 px in PingFang fits a 16 px line). Root font size returns to 16 px; every role above is stated in px so the 14 px root hack in `globals.css` is dropped.

## 4. Spacing, density, radii, borders

- 4 px base unit. Component gaps: 4 (inside a chip), 8 (between chips, between fields), 16 (between blocks), 24 (between page sections), 32 (above the footer).
- Top bar 48 px, footer 32 px single line. Page gutters 16 px at every breakpoint. Grid page is full-bleed; Queries and Settings max 880 px, left-aligned inside the gutters; auth column 360 px centered both axes.
- Grid rows: 48 px at ≥ 1280 (three 16 px lines — the spec's three-line anatomy cannot fit its 32 px figure at 13/16, and the anatomy is the point of the page); 32 px at 768–1279 (two-line cells, the spec's number honored where two lines exist); 40 px under `(pointer: coarse)` (one-line cells). No density toggle in the toolbar — the toolbar holds exactly what spec §3.3 lists. Minimum column 112 px; sticky row-header column 96 px (80 px at 768–1279, 72 px below). Logged in §11.
- Radii: 4 px on inputs, buttons, chips, switches; 6 px on popovers and drawers; 0 on the grid, its cells and its sticky headers; 9999 on the freshness dots only (they are circles).
- Borders: 1 px `--line` between grid cells, under the top bar, above the footer, between the query block and the grid, on the drawer's page-facing edge. 1 px `--line-strong` on inputs, chips and outline buttons. No border on sections, tables' outer edges, the Settings sections, or the auth form. No shadow anywhere; popovers separate from the page by `--bg-raised` ground + 1 px `--line-strong`.
- Focus ring: 2 px solid `--accent`, `outline-offset: 1px`, on `:focus-visible` only; inside the grid the ring is drawn inset so it is not clipped by the scroll container.

## 5. Freshness encoding

Constants in `src/lib/grid/freshness.ts` (existing thresholds kept: fresh `< 2 h`, aging `2–6 h`, stale `> 6 h`; an unparseable timestamp is `unknown`, a new fourth tier that replaces today's "treat as stale").

| Tier | Mark (8 × 8 inline SVG, `aria-hidden`) | Color | Miles weight/color | Age text |
|---|---|---|---|---|
| fresh | filled circle r=4 | `--fresh` | 600 `--fg` | `45m` / `2h` |
| aging | left half filled (path), right half 1 px stroke | `--aging` | 600 `--fg` | `3h` |
| stale | 1.25 px stroke ring, no fill | `--stale` | 600 `--fg-muted` | `1d` |
| unknown | 1.25 px stroke ring, no fill | `--fg-muted` | 600 `--fg-muted` | `?` |

Age text format (existing `formatAgeCompact`): under 1 min `now` / `刚刚`; minutes `45m` / `45分钟`; hours `2h` / `2小时`; days `1d` / `1天`; unparseable `?`. Age is always rendered, in the tier color, 12/16, right-aligned on the cell's last line, mark 4 px to its left. The text alone conveys the tier, so the encoding survives grayscale, and the shapes differ so it survives color blindness. Tooltip on the mark: "seats.aero last saw this: 2 h ago" / 「seats.aero 查看时间：2 小时前」. The frame has to take a bare noun, because `formatAge` also returns "unknown" / 「未知」 and 「刚刚」.

Aria wording (cell `aria-label`, en): `SEA to NRT, October 15, business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago.` Stale adds `, stale` after the age; unknown reads `freshness unknown`. zh: `SEA 到 NRT，10 月 15 日，商务舱，60,000 里程，税费 $5.60，2 个座位，Alaska，2 小时前查看。`

## 6. Wireframes

### 6.1 App shell (1440 wide; 48 px top bar, 32 px footer)

```
┌─────────────────────────────────────────────────────────────────────────────────┐ 48
│ awardgrid   Grid  Queries  Settings          312 / 1,000 today  EN 中文  System  alice ▾ │
│             ‾‾‾‾                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤ 1px --line
│ 16px gutter │                     page content                     │ 16px gutter │
├─────────────────────────────────────────────────────────────────────────────────┤ 1px --line
│ Data: seats.aero │ v0.2.0 │ Legal                                                │ 32
└─────────────────────────────────────────────────────────────────────────────────┘
```
Product name is 14/500 `--fg` plain text, a link to `/grid`. Current nav link is underlined 2 px `--fg` (not a pill, not the accent — the underline says "you are here", the accent says "this changed"). The theme control is a text button whose label is the current state word (`System` / `Light` / `Dark`); a click cycles to the next state; `aria-label` "Theme: system. Switch to light". Nothing in the bar is an icon: the spec's "no icons" for the nav extends to the whole bar, and a word costs 48 px against a sun glyph that needs a tooltip to be understood. `alice ▾` is a menu button (username + `Log out`); the chevron is the one functional glyph in the bar. Footer "│" is a 1 px `--line` rule 12 px tall, the only separator glyph in the app. The current footer's caveat sentence moves into the cell drawer (spec §3.5) and the "not affiliated" sentence moves to the Legal page; the footer is those three items and nothing else.

### 6.2 Grid page, ≥ 1280 (drawer closed)

```
│ ┌──────────────────────────────────────────────────────────────────┐ ┌──────┐            │
│ │ HKG, SHA, TYO, SEL to SEA, next 30 days, first                     │ │ Run  │  Examples  │ 36 (grows to 76 = 3 × 20 + 16)
│ └──────────────────────────────────────────────────────────────────┘ └──────┘            │ Examples is a link, not a button
│ Parsed from: 香港,上海,东京,首尔到西雅图 未来一个月 头等                                   │ 12/16 muted
│                                                                                            │
│ [Origins HKG, PVG/SHA, NRT/HND, ICN] [Destinations SEA] [Dates Oct 1 – Oct 30 (30 days)]   │ chips 28 h
│ [Cabins J F] [Programs all 24] [Direct only off] [Sort miles]     Reset to parsed    Run  │ Run appears only when modified
│ ─────────────────────────────────────────────────────────────────────────────────────────── │ 1px --line
│ Rows: Dates | Routes   J  F  Both      ○ Show dynamic pricing        Save as standing query  Export CSV │ 32
│ Asking seats.aero about all 26 mileage programs…                                   8s     │ 12/16, only while loading
│ ┌──────────┬────────────────┬────────────────┬────────────────┬────────────────┬───────── │
│ │          │ HKG → SEA      │ PVG → SEA      │ NRT → SEA      │ ICN → SEA      │ HND → S  │ header 32, sticky
│ │          │ 3 programs     │ 2 programs     │ 3 programs     │ 1 program      │ not moni │ 12 muted
│ ├──────────┼────────────────┼────────────────┼────────────────┼────────────────┼───────── │
│ │ Wed Oct 1│ J 60,000       │ –              │ F 80,000       │ ░░░░░░░░░░░░░░ │ ▒▒▒▒▒▒▒▒ │ row 48; ISO date on hover
│ │          │ $5.60   2 seats│                │ $112.30 1 seat │ ░░░░  ░░░░░░░░ │ ▒▒▒▒▒▒▒▒ │  (1) avail  (2) none
│ │          │ Alaska    ●45m │                │ Aeroplan  ◐3h  │ ░░░░░░    ░░░░ │ ▒▒▒▒▒▒▒▒ │  (6) loading (3) hatch
│ ├──────────┼────────────────┼────────────────┼────────────────┼────────────────┼───────── │
│ │ Thu Oct 2│ J 57,500       │ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │ J 70,000 dynamic│ J 75,000       │ ▒▒▒▒▒▒▒▒ │
│ │          │ $31.10  4 seats│ ┈ not fetched ┈│ $5.60   9 seats│ $5.60   1 seat │ ▒▒▒▒▒▒▒▒ │  (4) dotted (5) filtered
│ │          │ American  ○1d  │ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │ United    ●20m │ Alaska    ○?   │ ▒▒▒▒▒▒▒▒ │  (stale, unknown)
│ ├──────────┼────────────────┼────────────────┼────────────────┼────────────────┼───────── │
│ │  96 px   │    ≥112 px     │                                                              │
```
Cell states drawn: (1) available three-line anatomy; (2) en dash centered, `--fg-muted`; (3) hatch (`repeating-linear-gradient(45deg, var(--line-strong) 0 1px, transparent 1px 6px)` on `--bg-raised`), tooltip "Not monitored by seats.aero"; (4) 1 px dotted `--line-strong` inset outline, text "not fetched" 12 px muted, tooltip with the reason; (5) muted anatomy (miles `--fg-muted` 600) plus a 12 px `dynamic` tag after the miles; (6) skeleton: three `--bg-raised` bars 6 px tall at the exact line positions, no shimmer under reduced motion. The middle line justifies fees left and seats right with no glyph between. Stale: miles in `--fg-muted`.

Hover on a cell (after 300 ms) or focus (at once) shows a tooltip listing every program for that cell sorted by miles, one per line, each with its own mark and age (`Alaska  60,000  ●45m` / `Aeroplan  75,000  ◐3h`) — the same list the drawer shows, without the actions. Column headers are `HKG → SEA` 13/16 500 with the monitored-program count below in 12 `--fg-muted`; row headers are `Wed Oct 1` with the ISO date as `title`. Loading: the whole grid is the skeleton, with the row count taken from the Dates chip and the columns from origins × destinations, so the real grid lands in place without a jump. Under the toolbar, one status line: the sentence names what is being **asked** ("Asking seats.aero about all 26 mileage programs…", or the programs themselves when the query names one to three of them, a count when it names more), swapping after 12 s for "Still asking seats.aero. Wide date ranges take longer." The elapsed seconds sit in an `aria-hidden` sibling of that `role="status"` sentence, never inside it, so a screen reader is not made to re-read the sentence once a second. The line never claims arrival: one request carries every program, so nothing lands program by program (§11). Toolbar buttons are text only — no icons on Save, Export, Rows or the cabin chips.

Page-level states replace the grid area: **No key** — 14 px sentence + `Open settings` link button, 48 px from the toolbar, left-aligned, no box. **Parse failure** — one line under the query bar in `--error` with the raw text preserved in the bar and a `Build it with chips instead` link. **Empty results** — the sentence from the spec followed by three links on one line. **Quota exceeded** — 40 px banner above the toolbar, `--bg-raised` ground, 1 px `--error` left edge, text in `--fg`; Run and Save disabled with tooltips; the quota indicator in the top bar turns `--error`. **Modified, not run** — chips outlined `--accent`, toolbar disabled, grid at 80 % opacity, a 24 px strip "Run to refresh" across the grid top.

### 6.2a Chip editors (popover under the chip, 320 px, `--bg-raised` ground, 1 px `--line-strong` edge)

```
[Origins HKG, PVG/SHA, NRT/HND, ICN]          [Dates Oct 1 – Oct 30 (30 days)]
┌──────────────────────────────────┐          ┌──────────────────────────────────┐
│ Search city or airport           │ 36 input │ Next 30 days  Next 60 days  Next 90 days │ presets, link buttons
│ HKG  Hong Kong                 × │ 32 rows  │  October 2026        November 2026     │ two months, 7 × 28 px cells
│ SHA  Shanghai  ▸ PVG ✓  SHA ✓  × │ group row│  Mo Tu We Th Fr Sa Su   Mo Tu We …    │ range band --selection between --line-strong rules, ends --fg
│ TYO  Tokyo     ▸ NRT ✓  HND ✓  × │          │  …                                    │
│ ICN  Seoul                     × │          │ Oct 1 – Oct 30, 30 days               │ 12 muted; "92 days is the most
│ Add IATA code  ___               │ free entry│                                       │  seats.aero searches at once" when capped
└──────────────────────────────────┘          └──────────────────────────────────┘
Cabins: four toggles J F W Y (at least one; the last one cannot be switched off).
Programs: search input + checkbox list from the user's routes catalog, "All" at the top; chip shows "all 24" or "3 of 24".
Direct only: one switch. Sort: one select bound to sort_by (Fewest miles, Lowest fees, Most seats, Earliest date — the four values of `SortBy` in `src/lib/query/schema.ts`).
Empty Origins/Destinations: chip in --error with "Add at least one airport" under the list.
```

A city group is one row (`SHA  Shanghai`) whose `▸` expands the member airports; the group toggle checks all members, the per-airport toggles refine; its accessible name is `SHA Shanghai, every airport`, so it is never confused with the Hongqiao airport toggle beside it. The Examples popover is the same surface with three rows (zh and en of the canonical query plus one each way), each a button that fills the bar and closes. It is anchored to the **bottom of the whole query-bar row**, not to the `Examples` link inside it: a popover that covers the field it fills, or the Run button next to it, is a bug.

**Range band.** In-range days are `--selection` (the `--fg` tint the page already uses for text selection) between 1 px `--line-strong` rules top and bottom; the rules are what identify the range, and they clear 3:1 on the `--bg-raised` popover ground in both themes (`src/styles/tokens.test.ts`). The first draft filled the range with `--bg-raised` on a `--bg-raised` surface — 1.1:1, invisible — and gave unselected days the identical fill on hover; hover is now a 1 px `--line-strong` ring and nothing else uses a fill. Every day cell carries its full localized date as its accessible name, and the line under the calendar is a live region reading exactly what the chip reads (`Oct 1 – Oct 30 (30 days)`), on the clamped range: a pick longer than 92 days is stored clamped, so the calendar, the count and the query never disagree.

**Deviation, logged:** `data/places.json` expands the `SEL` metro to `ICN` **and** `GMP`, so the spec's own placeholder (`… SEL to SEA …`) produces a seventh, permanently hatched `GMP → SEA` column. Spec §3.2's worked example, §7's demo dataset and the §6.2 wireframe all end the origin list at `ICN`. The seed is right about Seoul and stays as it is; the e2e canonical query names `ICN`/`仁川` explicitly (`e2e/fixtures.ts`) so the demo grid is the six routes the fixtures carry.

### 6.3 Grid page, 768–1279 (two-line cells, 32 px rows, drawers overlay)

```
│ ┌───────────────────────────────────────────────┐ ┌─────┐          │
│ │ HKG, SHA, TYO, SEL to SEA, next 30 days, first  │ │ Run │ Examples │
│ └───────────────────────────────────────────────┘ └─────┘          │
│ Parsed from: …                                                       │
│ [Origins 5] [Destinations SEA] [Dates Oct 1 – 30] [Cabins J F]        │ chips wrap
│ [Programs all 24] [Direct only off] [Sort miles]         Reset  Run  │
│ ──────────────────────────────────────────────────────────────────── │
│ Dates | Routes  J F Both  ○ Show dynamic pricing  Save as standing query  Export CSV │
│ ┌────────┬───────────┬───────────┬───────────┬───────────┬──────── │
│ │        │ HKG → SEA │ PVG → SEA │ NRT → SEA │ ICN → SEA │ HND → S │ 32
│ │ Oct 1  │ J 60,000  │ –         │ F 80,000  │ ░░░░░░░░░ │ ▒▒▒▒▒▒▒ │ 32
│ │        │ Alaska●45m│           │ Aeroplan◐3h│ ░░░░ ░░░ │ ▒▒▒▒▒▒▒ │
│ │ Oct 2  │ J 57,500  │ ┈┈┈┈┈┈┈┈┈ │ J 70,000 d│ J 75,000  │ ▒▒▒▒▒▒▒ │
│ │        │ American○1d│ ┈┈┈┈┈┈┈┈┈ │ United●20m│ Alaska ○? │ ▒▒▒▒▒▒▒ │
│ │  80 px │  ≥112 px  │ 
```
Fees and seats move to the tooltip and the drawer. Chips show counts when their value would exceed 160 px. The drawer overlays the grid (no push) with a `--scrim` veil (black at 40 %, the same in both themes — see the revision log).

### 6.4 Grid page, < 768 (one-line cells, 40 px rows, Filters sheet)

```
┌───────────────────────────────┐ 48
│ awardgrid    312/1,000   ≡    │
├───────────────────────────────┤
│ ┌───────────────────────────┐ │
│ │ HKG, SHA, TYO, SEL to SEA…│ │ 40
│ └───────────────────────────┘ │
│ [ Run ]              Examples │
│ Parsed from: 香港,上海…         │
│ [Origins 5][Dest SEA][Oct 1–30]│ chips wrap, 32 h touch
│ [J F][all 24][Direct off][miles]│
│ Filters                  Run  │ toolbar collapsed into a sheet; "Filters" is a plain button
│ ┌──────┬─────────┬─────────┬─ │
│ │      │ HKG→SEA │ PVG→SEA │ N│ 40
│ │ Oct 1│ 60,000●45m│ –     │ 8│ 40
│ │ Oct 2│ 57,500○1d│ ┈┈┈┈┈┈┈│ 7│
│ │ 72px │ ≥112px  │ scrolls → │
└───────────────────────────────┘
      ┌───────────────────────┐
      │ Filters             × │  bottom sheet: Rows, cabins J/F/Both,
      │ Rows   Dates | Routes │  dynamic pricing switch, Save, Export
      │ Cabins  J  F  Both    │
      │ ○ Show dynamic pricing│
      │ Save as standing query│
      │ Export CSV            │
      └───────────────────────┘
```
Cabin tag stays (`J 60,000`) when both cabins are shown; the program name moves to the drawer. Top bar keeps name, quota and a menu (nav + language + theme + log out).

### 6.5 Cell drawer (480 px, right; full-height sheet < 768)

```
┌──────────────────────────────────────────────┐
│ HKG → SEA                                  × │ 20/28 600
│ Wednesday, October 15, J and F               │ 14 muted, localized date, comma not dot
├──────────────────────────────────────────────┤
│ Alaska               ●  seats.aero last saw this: 45 m ago
│ 60,000 miles   $5.60   2 seats   Direct      │ 14; miles 600
│ Operated by Alaska (AS)                      │ 12 muted
│ Show flights                                 │ link button
│   ┌ skeleton rows while loading ┐            │
│   AS 24   HKG 08:05 → SEA 06:40   nonstop   A330 │ 13/16 tabular
│ ──────────────────────────────────────────── │ --line
│ Aeroplan             ◐  seats.aero last saw this: 3 h ago
│ 75,000 miles   $112.30   1 seat   1 stop     │
│ Show flights                                 │
│ ──────────────────────────────────────────── │
│ American             ○  seats.aero last saw this: 1 d ago  (miles in --fg-muted)
│ 80,000 miles   $31.10   4 seats   Direct     │
├──────────────────────────────────────────────┤
│ Confirm on the program's site before         │ 14 body, --fg
│ transferring any points. Cached data can be  │
│ stale and awards disappear.                  │
│ ┌────────────────┐ Copy details  Save as standing query │
│ │ Open in Alaska │                                       │ primary button (--bg on --fg)
│ └────────────────┘                                       │
└──────────────────────────────────────────────┘
```
Programs sorted by miles. The drawer edge is 1 px `--line`; the body scrolls, the header and action block are fixed.

### 6.6 Ask drawer (420 px, right; bottom sheet with 32 × 4 px drag handle < 768)

```
┌────────────────────────────────────────┐
│ Ask                                  × │
│ [× Current grid: 4 routes, Oct 1–30, J and F] │ context pills, removable
│ [× Selected: SEA→NRT Oct 15 F 80,000 Alaska]  │
│                                        │
│ Which program should I book the cheapest F cell with, and what transfers into it? │ 3 suggestion buttons, 14, --bg-raised
│ Is this a good price compared to the last month? │
│ Plan Tokyo and Seoul in one trip.      │
│ ──────────────────────────────────────  │
│ You  Which program…                    │ 14
│ Claude  The cheapest F cell is …        │ streaming markdown
│   ▸ Checked seats.aero cached search   │ 12 muted, collapsed tool list
│   ▸ Read transfer-partners             │
│                                   Stop │ while streaming
│ ──────────────────────────────────────  │
│ ┌──────────────────────────────┐ ┌────┐│
│ │ Ask about this grid…         │ │Send││ 36; disabled at cap with reason inline
│ └──────────────────────────────┘ └────┘│
│ Today $0.42 of $2.00   History stays in this browser tab │ 12 muted
└────────────────────────────────────────┘
```
At the cap the input is disabled and the meter line reads "Daily limit reached ($2.00). Resets at 00:00 UTC."

### 6.7 Queries page (max 880)

```
Standing queries                                                    20/28
────────────────────────────────────────────────────────────────────────
Name             Schedule        Notifies on   Last run          Next run   Enabled  Actions
HKG → SEA J/F    every 3 hours   new, dropped  2 h ago  +2 −1    in 58 m    (● on)   Run now  Edit  Delete
▾ Tokyo F only   daily at 08:00  new           1 d ago  no change tomorrow   (○ off)  Run now  Edit  Delete
  │ Last diff                                                                       │ expanded row, --bg-raised
  │ New      ┌────────┐ ┌────────┐      Dropped  ┌────────┐                          │ real grid cells, 112 px
  │          │F 80,000│ │J 60,000│               │J 57,500│                          │
  │          │$112 1s │ │$5.60 2s│               │$31  4s │                          │
  │          │Aerop ◐3h│ │Alaska●45m│            │Amer  ○1d│                         │
  │ Last 20 runs                                                                      │
  │ Oct 15 08:00   4 calls   +2 −1                                                    │ 13/16 tabular
  │ Oct 15 05:00   0 calls   skipped: quota                                           │
  │ …                                                                                 │
  Delete "Tokyo F only"?   Delete   Keep                                              │ inline confirm replaces the Actions cell
```
Empty state: "No standing queries yet. Save one from the grid." + `Go to grid` link button, left-aligned, no box. Edit opens a 480 px drawer with the same seven chip editors.

### 6.8 Settings page (max 880, four sections, no cards)

```
Settings                                                            20/28

API keys                                                            16/24
seats.aero Pro   Checked with seats.aero just now   ••••1234   added Sep 1   Replace  Remove
Duffel           Not added                                                   Add key
Ignav            Not added                                                   Add key
312 / 1,000 calls today. Resets at 00:00 UTC.                        12 muted

Telegram
Not linked.   [Link Telegram]        ┌────────┐
                                     │ QR     │  128 px, in-repo encoder, --fg on --bg
                                     └────────┘
Quiet hours   22:00  to  07:00   Asia/Shanghai (detected)             two <input type=time>

Account
Username  alice
Change password   Current ________  New ________  [Update password]

Language and theme
Language   ( ) EN  (•) 中文
Theme      (•) System  ( ) Light  ( ) Dark
```
Sections are separated by the 16/24 heading and 24 px of space only. Rows inside a section are 40 px with no rules.

### 6.9 Login / register (360 px column, centered)

```
                  awardgrid                     14, 500, 32 px above the form
                  Log in                        20/28
                  Username
                  ┌──────────────────────┐
                  └──────────────────────┘      36 h, --line-strong
                  Password
                  ┌──────────────────────┐
                  └──────────────────────┘
                  Wrong username or password.   12 --error, under the field
                  ┌──────────────────────┐
                  │        Log in        │      primary (--bg on --fg), full width
                  └──────────────────────┘
                  No account? Create one        12 muted, link in --accent
```
Register adds Invite code above Username and the hint "At least 8 characters" under Password (turns `--fg` when satisfied; no meter). No card, no border, no shadow.

## 7. Interaction rules

- **Chip modified state:** editing any chip sets `modified`; the edited chip gets a 1 px `--accent` outline (replacing its `--line-strong` border), a `Run` button appears at the row end, the toolbar disables, the grid dims to 80 % with the "Run to refresh" strip. Enter in the query bar or the Run button re-runs; `Reset to parsed` restores the parser output and clears the state. Chips are the single source of truth; the URL `?q=` updates on run, not on every edit.
- **Grid keyboard model:** `role="grid"`, one tab stop (roving `tabindex`, the focused cell has `tabindex=0`, all others `-1`; initial focus is the first available cell). Arrow keys move one cell and scroll it into view; Home/End go to the first/last cell of the row; Ctrl+Home/End to the grid corners; PageUp/PageDown move 7 rows; Enter or Space opens the cell drawer; Esc closes whichever drawer is open and returns focus to the cell that opened it. Column and row headers are not focusable; their text is announced through `aria-colindex`/`aria-rowindex` and the cell label. Hover and focus highlight the row header and column header with a 1 px inset `--line-strong` edge (the resting header ground is already `--bg-raised`, per §2 — see the revision log).
- **Focus ring:** 2 px solid `--accent`, offset 1 px, `:focus-visible` only; inset inside grid cells and inside the sticky header.
- **Drawers:** cell drawer and Ask drawer are mutually exclusive; opening one closes the other in the same frame. At ≥ 1280 the drawer pushes the grid (the grid container shrinks); at 768–1279 it overlays with a scrim; below 768 it is a full-height sheet (cell) or a bottom sheet with a drag handle (Ask). Focus is trapped inside an overlaying drawer, not inside a pushing one.
- **Motion:** only on user actions — drawer slide 200 ms `ease-out`, popover 150 ms opacity + 4 px translate, result landing 150 ms opacity from the skeleton. No hover transitions, no entrance animation, no shimmer loop by default (the skeleton is static bars; a single 1.2 s shimmer runs only while `prefers-reduced-motion: no-preference`). Under `prefers-reduced-motion: reduce` every duration becomes 0 ms and the shimmer is static.
- **Tooltips** open after 300 ms hover or immediately on focus, never on touch (touch gets the drawer). Text only, `--bg-raised` ground, 1 px `--line-strong` edge, 12/16.
- **Toasts** ("Standing query saved", "CSV exported"): one line of 14 px text on `--bg-raised` with a 1 px `--line-strong` edge, bottom-left, 4 s, no icon, no progress bar, one at a time. `role="status"`.

## 8. Copy rules and examples

Active voice, the same verb through the whole flow, errors say what happened and what to do, empty states invite action, sentence case, no filler, no apology, zh uses full-width punctuation and no italics.

| # | Where | Before (current) | After en | After zh |
|---|---|---|---|---|
| 1 | Save button + toast | "Save query" / "Saved!" | "Save as standing query" → toast "Standing query saved" | 「保存为定时查询」→「定时查询已保存」 |
| 2 | Export button + toast | "Export CSV" / "Exporting…" | "Export CSV" → "CSV exported" | 「导出 CSV」→「CSV 已导出」 |
| 3 | No-key empty state | "Add your seats.aero key in Settings." + "Go to Settings" | "Add your seats.aero Pro key to search." + "Open settings" | 「添加 seats.aero Pro 密钥后即可搜索。」+「打开设置」 |
| 4 | Parse failure | "Could not understand that query." | "Couldn't read the dates in this query." + "Build it with chips instead" | 「无法识别这个查询中的日期。」+「改用筛选条件构建」 |
| 5 | Empty results | "No award seats found for this query." | "No J or F availability on these 4 routes between Oct 1 and Oct 30. Checked 3 programs, 2 h ago." | 「10 月 1 日至 10 月 30 日，这 4 条航线没有商务舱或头等舱里程票。2 小时前检查了 3 个计划。」 |
| 6 | Quota banner | "Quota exceeded (950/1000)" | "seats.aero daily limit reached (950 of 1,000). Resets in 5 h 12 m. Cached results are still shown." | 「已达到 seats.aero 每日上限（950/1,000）。5 小时 12 分后重置。仍显示缓存结果。」 |
| 7 | Network error | "Network error — please try again." | "Couldn't reach awardgrid. Check your connection and retry." | 「无法连接 awardgrid，请检查网络后重试。」 |
| 8 | Key removal confirm | "Remove the {provider} key?" (modal) | Inline: "Remove the seats.aero key? Searches and standing queries stop until you add a new one." + "Remove" / "Keep" | 「删除 seats.aero 密钥？搜索和定时查询会停止，直到你添加新密钥。」+「删除」/「保留」 |
| 9 | Key validation result | "Key saved." | "Checked with seats.aero just now" or "seats.aero rejected this key (401). Check it and try again." | 「刚刚已通过 seats.aero 验证」或「seats.aero 拒绝了此密钥（401），请检查后重试。」 |
| 10 | Queries empty state | "No saved queries." | "No standing queries yet. Save one from the grid." + "Go to grid" | 「还没有定时查询。从表格中保存一个。」+「前往表格」 |
| 11 | Cell drawer program row | "Updated 4h ago" + "Load flights" + "Costs 1 seats.aero API call" | "Seen by seats.aero 4 h ago" + "Show flights" (the call cost goes in the button's `title`, not beside it) | 「seats.aero 于 4 小时前查看」+「显示航班」 |
| 12 | Drawer subtitle | "Every program for this pair and date, sorted by Fewest miles." | dropped — the header already says route, date and cabins; the list is visibly sorted | — |
| 13 | Ask subtitle | "Advisory only — searches, compares and explains; never books or logs in." | "Searches, compares and explains. Never books or logs in." (one muted line under the title) | 「只搜索、比较和解释，不会预订或登录。」 |
| 14 | Account section | "Sign out everywhere" + "Ends every session of this account…" | "Log out everywhere" (same verb as the menu) | 「在所有设备上退出登录」 |
| 15 | Any "WORD — fragment" string (`error.network`, `grid.share_hint`, `ask.subtitle`, zh `——` strings) | "Network error — please try again." / "网络错误——请检查连接后重试。" | Two sentences: "Couldn't reach awardgrid. Check your connection and retry." | 「无法连接 awardgrid，请检查网络后重试。」 |

Also: "Saved queries" nav label becomes "Queries" (the page title stays "Standing queries"); the Ask button reads "Ask" and the send button "Send"; delete confirms with the verb "Delete", never "Confirm"; "Log out" not "Sign out" everywhere. No string joins two clauses with an em dash (en) or `——` (zh): split into two sentences or use `，`. Page subtitles that explain the product ("Your own keys, your own quota…", "Private, invite-only. Bring your own seats.aero key.", "Standing queries run on your own key on a schedule…") are removed; a page title needs no pitch under it. Please/sorry never appear.

## 9. Screenshots and visual regression

Path: `docs/screenshots/v0.2/<page>/<state>-<viewport>-<theme>[-zh].png`; viewports `1440x900` and `390x844`; themes `light` and `dark`; the grid page additionally `-zh`. Pages and states:

| Page | States |
|---|---|
| `grid` | `loaded`, `no-key`, `parse-failure`, `loading`, `empty-results`, `quota-exceeded`, `modified`, `cell-drawer`, `ask-drawer`, `ask-cap`, `chip-origins-open`, `chip-dates-open` |
| `queries` | `table`, `expanded`, `delete-confirm`, `empty`, `edit-drawer` |
| `settings` | `default`, `key-adding`, `key-error`, `telegram-linking`, `telegram-linked` |
| `login` | `default`, `error` |
| `register` | `default`, `error` |
| `legal` | `default` |

That is 27 states × 2 viewports × 2 themes = 108 PNGs, plus 12 grid states × 2 × 2 in zh = 48, total 156. `scripts/screenshots.ts` generates `docs/screenshots/v0.2/README.md` as a contact sheet (one table per page, thumbnails 240 px wide). Every capture uses `DEMO=1` mock data with the clock frozen at the demo epoch (`page.clock.setFixedTime`) so ages are deterministic, `animations: "disabled"`, `reducedMotion: "reduce"`, and waits for `document.fonts.ready`.

Baselines: `toHaveScreenshot` snapshots are generated **only on Linux CI** (Chromium on Ubuntu; the `visual` job uploads `test-results/` as an artifact and `pnpm e2e:update` in CI commits under `test/e2e/__screenshots__/linux/`). Local macOS runs compare against the same Linux baselines with `maxDiffPixelRatio: 0.02` and `threshold: 0.3` so font hinting differences do not fail the run; CI compares strictly (`maxDiffPixelRatio: 0.001`). The `visual` job is non-blocking until five consecutive green runs (§11 of the spec). Baseline updates need the reason in the commit message.

## 10. Self-check against §1.2

Reviewed axis by axis with the question the spec asks: *would any generic data app have produced this choice?* Where the answer was yes and the axis was free, the choice was revised (marked **revised in review**); where the answer was yes and the spec or a hard constraint pins it, the row says so instead of pretending otherwise.

| Axis | The generic default | This plan |
|---|---|---|
| Background | Off-white `#FAFAFA` light, tinted navy `#0F172A` dark | True white and `#111111`; every neutral is R = G = B so the three freshness hues and the accent are the only color on the page. Raised surfaces are one neutral step, never a tint. Not generic. |
| Type family | Inter | **Inter, kept, and that is the generic choice.** The constraints (tabular figures, variable weights, OFL, self-hosted, offline, already committed in `public/fonts/`) leave little room and the family is not where this product spends its identity. What is not generic is the use: a five-role scale with no display size and no italic, weight 600 only on miles and headings, no mono, no stylistic sets, and the CJK stack ordered after Latin under `unicode-range`. |
| Accent | One blue, used as the primary-button fill, the switch track and the link color | Blue kept for link text, focus ring and the modified-chip outline — the least branded hue for "interactive" in both cultures. **Revised in review:** the accent is no longer a fill. The primary button and the switch-on track are `--bg` on `--fg` (the page inverted), so the page has no blue rectangle anywhere; a blue mark always means "here" or "changed", never "brand". The active-nav underline is `--fg`, not the accent, for the same reason. `--on-accent` (which was a tinted near-black in dark, itself a §1.2 tell) is gone. |
| Radius | One radius on everything (`0.4rem` today), or zero everywhere for "broadsheet" | Three values by role: 4 px controls, 6 px popovers/drawers, 0 for the grid because it is a table. Not generic. |
| Shadows | `shadow-md` under popovers and cards | None. Surfaces separate by ground and a 1 px `--line-strong` edge. |
| Eyebrows / badges | Tracked-out uppercase labels (`DET`, `LLM`, `required`, `optional`, `no change` badges exist today) | All removed. Provenance becomes a 12 px sentence-case note beside "Parsed from"; required/optional is a plain word in the row; run results are text in the Last run cell. |
| Separators | Middle dots between meta (`$5.60 · 2 · direct`, `oldest 3d ago · newest 26m ago`, footer) | Cells justify fees left and seats right with space; drawers use sentences; the footer uses a 1 px vertical rule. No `·` remains anywhere. |
| Arrows and glyphs on controls | `→` after link text; `▶`, `▾`, icons on buttons | Route headers use `→` because it is the data. **Revised in review:** the `▶ Run` and `Filters ▾` drawn in the first draft were the tell; both are plain words now. Toolbar buttons, nav and the top bar carry no icons; the theme toggle is a word. The user-menu chevron is the one functional glyph. |
| Numbering | 01/02/03 markers on sections or steps | None; run history, program lists and suggestions are unnumbered lists. |
| Headings | One accented word, or a hero title with a subtitle pitch under it | 20/28 page titles in `--fg`, plain words, no color, and no subtitle: the current "Your own keys, your own quota…" and "Private, invite-only…" lines are removed (§8). |
| Cards | Every section is a bordered rounded card with a title and description; the auth form is a card | Cards removed: Settings sections are heading + rows, chips are inline, the drawer's program rows are separated by rules, auth is a bare column. Borders remain only between different kinds of information. |
| Empty states | Centered dashed box with an illustration or icon and a button | A left-aligned sentence and a link button, no box, no icon (`Open settings`, `Go to grid`). |
| Icons | An icon on every button and nav item | None outside the freshness marks (which are data) and the user-menu chevron. |
| Motion | Hover color transitions on everything, fade-in on mount, looping shimmer | Only three action-answering motions (drawer, popover, result landing), one 1.2 s shimmer, all 0 ms under reduced motion. |
| Feedback | A toast stack in the corner with icons and progress bars | One text-only line, one at a time (§7). |
| Hatch / patterns | A 5 % tinted fill for "unavailable" | Diagonal 1 px `--line-strong` stripes on `--bg-raised` — a pattern that survives grayscale and clears 3:1. **Revised in review:** the first draft used a faint seventh neutral (`--hatch`, 1.4:1) that only worked as decoration. |

## 11. Decisions resolved here (copy into `DECISIONS.md`)

- **Font**: self-hosted Inter variable (OFL, already in `public/fonts/`) is the one sans; `font-display: swap`, Latin-only `unicode-range`, `tnum` verified present in the file. _Why:_ true tabular figures + offline builds; no `next/font`, no network.
- **Theme persistence**: `ag_theme` cookie (`system|light|dark`, 1 year, read in the root layout to set `data-theme` before paint) plus an additive `users.theme` column (`text, default 'system'`) written through `PUT /api/settings`; the cookie wins on the current device, the column seeds a new device. _Why:_ no flash, per-user, additive migration only.
- **Quota endpoint**: `GET /api/usage` → `{ used, limit, hardLimit, resetAt, providers: { seatsaero: {used, limit} } }`, read-only, no-store. The top-bar indicator polls it on focus and after every run. _Why:_ the indicator is on every page; `getTodayUsage` only exists server-side today.
- **"Dynamic" cell state**: derived client-side from the row's `include_filtered` cache scope flag (`AvailabilityRow.include_filtered`); when the toggle is off, rows only present in the `include_filtered=true` scope render as state 5. No extra API calls. _Why:_ the flag already exists on the row.
- **Progressive fill**: not buildable against seats.aero, not merely out of scope (issue #36, settled). One Cached Search request carries every program in a single comma-joined `sources` parameter, and omits it entirely — all 26 programs — for a query that names none, so no program ever answers before the others. Splitting the request per program multiplies the daily quota by up to 26 and permanently disables the cache, whose coverage rows are keyed on the exact sorted program set. The grid also has no program axis to fill: its axes are dates × route pairs. What ships instead is the status line above — what is being asked and how long it has taken. The skeleton's no-jump contract (§6.2) and the 150 ms landing fade (§7) are unchanged. _Why:_ the per-program `✓` line from spec §3.4 describes a transport this API does not have; see `DECISIONS.md` and `BACKLOG.md` for the one flush that would be honest.
- **Telegram QR**: rendered by a small in-repo QR encoder (`src/lib/qr/`, byte mode, EC level M, versions 1–10, ~300 lines, unit-tested against known vectors) as an inline SVG in `--fg` on `--bg`. _Why:_ spec allows no new runtime dependency; deep links are under 200 bytes.
- **Change password**: `POST /api/auth/password { currentPassword, newPassword }` → 200 / 400 `weak_password` / 401 `wrong_password`; rotates all other sessions. Additive. _Why:_ spec §5 requires it; nothing existed.
- **Row height at ≥ 1280**: 48 px (three 16 px lines); 32 px at 768–1279 (two lines); 40 px under `(pointer: coarse)` (one line). No density toggle. _Why:_ spec §3.4 asks for a three-line cell and a 32 px row in the same section; three 13/16 lines cannot fit 32 px, and the anatomy is the product. The 32 px figure is honored wherever the cell has two lines. The toolbar keeps exactly the controls spec §3.3 lists.
- **Accent is never a fill**: `--accent` is used for link text, the focus ring and the modified-chip outline only; the primary button and switch-on track are `--bg` on `--fg`; `--on-accent` is dropped. _Why:_ §1.2 review — a blue primary button and blue switch are the generic default of every data app, and the current black button already does the job with no new color.
- **Hatch color**: not-monitored stripes are `--line-strong` on `--bg-raised` (3.14:1 light, 3.37:1 dark); the `--hatch` token is dropped. _Why:_ the cell has no text, so the pattern must clear 3:1 on its own; six neutrals is the spec's ceiling.
- **Theme toggle**: a text button in the top bar showing the current state word (System / Light / Dark), cycling on click. _Why:_ no icons anywhere in the bar; the Settings radios remain the explicit control.
- **No OpenType stylistic sets**: `font-feature-settings` is not set; `font-variant-numeric: tabular-nums` only. _Why:_ `cv11`/`zero` were an unjustified stylistic default; legibility at 13 px favors Inter's defaults.
- **Freshness tiers**: a fourth `unknown` tier replaces "unparseable = stale" so the ring-with-"?" state exists in the type system. _Why:_ spec §3.4 lists four encodings.
- **Cell backgrounds**: no per-tier tint; tier is carried by mark + age text + miles contrast. _Why:_ §1.2 (no color washes), AA against a single ground, and the grid reads as one surface.
- **Provenance badges**: the `det`/`llm`/`def` uppercase badges become a single 12 px sentence-case note next to the "Parsed from" line ("dates guessed") shown only when the LLM path filled a field. _Why:_ §1.2 eyebrow tell.
- **Ask entry point** (6.2 review): spec §3.3 lists the toolbar's five controls and no trigger for the Ask drawer (§6.6); the trigger is a text-only "Ask" button at the right end of the grid toolbar, after Export CSV (inside the Filters sheet below 768 px). The toolbar therefore holds the five spec controls plus this one entry point. _Why:_ the drawer belongs to the grid page and the top bar (§6.1) stays as drawn.
- **Dynamic tag** (6.2 review): the state-5 tag reads `dyn` / `动态` at every density; "dynamic" does not fit the 112 px minimum column beside a cabin tag and six-digit miles, and the full word lives in the cell's title and aria label. The tag is drawn on mobile too (§6.4 wireframe amended in spirit: `60,000 dyn ●2h`), so the muted color is never the only signal.
- **Column-header count** (6.2 review): "N programs" is the routes catalog's monitoring count and appears only when the catalog knows every requested program; otherwise the header reads "N with availability" from the cells.

## 12. What the current UI gets wrong against this plan (from `docs/screenshots/v0.2/before/`)

1. Monospace everywhere — product name, dates, miles, chips, quota text, drawer numbers (`.num`, `font-mono`). Remove; Inter tabular figures replace all of it (6.1).
2. Tinted cell backgrounds per freshness tier (green/amber/red washes on every available cell) and a `stale` word in red. Remove; the mark, the age text and the miles contrast step carry the tier (6.2).
3. Middle dots as the universal joiner: cells (`— · 2 · direct`), header bar (`oldest 3d ago · newest 26m ago`), quota box, queries Last run (`3 new · 1 gone`), footer. Remove everywhere; cells justify, prose uses sentences, the footer uses a rule (6.1–6.5).
4. Tracked uppercase badges (`DET`, `DEF`, `LLM`) on every chip label, plus pill badges `required` / `optional` / `no change` / `served from cache`. Remove; provenance is one sentence-case note, the rest are plain words in the row (6.3, 6.5).
5. The card kit: chips section, all four Settings sections, the quota box, the auth form, the Ask textarea and each drawer program row are rounded bordered cards with a title and a description; the grid itself has a rounded border. Remove all of them; sections are heading + space, the grid edge is the grid line (6.1, 6.4, 6.5).
6. The chip row is a form (From/To IATA inputs, two date inputs with `→`, cabin buttons, a "Max miles" field, a sort select) — not seven summary chips with popover editors; "Max miles" is not one of the seven and goes. Replace with §6.2a; the modified state, "Reset to parsed" and the URL-on-run rule are new (6.3).
7. Icons on Save query / Ask / Rows / Export, boxed example strings, a `Search` button instead of `Run`, and a status line (`0 calls this render`, `27 / 950 seats.aero calls today`) above the grid. Text-only buttons named per §8; the quota moves to the top bar; the render stats go (6.1, 6.3).
8. Rows are content-height (28–70 px) so the grid never lines up; dates render as `2026-09-06` and column headers as `HKG–SEA` with no program count; "not monitored" is a text label; the sticky header has no program count line. Fixed 48/32/40 px rows, `Wed Oct 1` with ISO on hover, `HKG → SEA` + `3 programs`, hatch fill (6.2).
9. Legend and share-hint sentence under the grid and a three-part footer (attribution, caveat, "Not affiliated…", Legal). Footer becomes `Data: seats.aero │ v0.2.0 │ Legal`; the caveat moves above the drawer's action button; the affiliation sentence moves to the Legal page (6.1, 6.4).
10. Drawer copy and structure: subtitle "Every program for this pair and date, sorted by Fewest miles.", `Updated 4h ago`, `Load flights` + "Costs 1 seats.aero API call", program code in mono beside the name, cabin letter as a badge. Use §6.5: `Seen by seats.aero 4 h ago`, `Show flights`, the confirmation line above `Open in <program>`, plus `Copy details` and `Save as standing query` (6.4).
11. Nav uses a filled pill for the current page and "Saved queries"; Settings has Language as a select, no Theme section, no change-password, quiet hours as a three-field row with a timezone select, "Sign out everywhere"; every page has a pitch subtitle. Underline nav, "Queries", radios for language and theme, §5 sections in order, "Log out everywhere", no subtitles (6.1, 6.5).
12. Ask drawer: "Advisory only — …" fragment subtitle, a context switch with a mono query string instead of removable pills, no suggested questions, `Tools used: none yet` and `This answer: —` placeholders, a fixed 2000-character counter, and `Data: seats.aero` repeated inside the drawer. Use §6.6 (6.4).

## 13. Review log (6.0 adversarial pass)

Every change made to this document by the review, with the reason.

- **Contrast table recomputed** (`node docs/ui-plan-assets/contrast.mjs` plus an independent one-liner). All 36 quoted ratios were correct; none changed. Added the missing `--line-strong` on `--bg-raised` (3.14 / 3.37) and `--line` on `--bg-raised` (1.18 / 1.19) columns because chips, popovers and the hatch sit on the raised ground; replaced the `--on-accent` row with `--bg` on `--fg` and the `--hatch` row with the new stripe color (see below). `contrast.mjs` updated to print exactly the rows the table quotes.
- **Accent demoted from fill to mark** (§2 rules, token table, §6.5/§6.9 button notes, §10, §11). A blue primary button, a blue switch and a blue nav underline are what every generic data app ships; the spec pins "one accent for interactive/focus", not that it fills controls. Primary button and switch-on are now `--bg` on `--fg`, which the current UI's black button already is. `--on-accent` (dark value `#0B1B33`, a tinted near-black — itself a §1.2 tell) is removed.
- **`--hatch` token removed** (§2, §6.2, §11). It was a seventh neutral — over the spec's 4–6 — and at 1.4:1 it made the only text-free cell state rely on the tooltip. Stripes are now `--line-strong`, which clears 3:1 on `--bg-raised` in both themes.
- **`cv11` stylistic set removed** from the `html` rule (§3, §11). It was switched on without a reason; a single-storey a is less distinct from o at 13 px.
- **Row-height toolbar toggle removed** (§4, §11). The first draft added a "Fees and seats" toolbar control that spec §3.3 does not list, to make the 32 px figure reachable on desktop. The toolbar now holds exactly the spec's controls; ≥ 1280 rows are 48 px, and the 32 px figure is honored at 768–1279 where two-line cells exist. The conflict between spec §3.4's three-line anatomy and its 32 px row is recorded honestly in §11 instead of being papered over with a new control.
- **Theme toggle changed from a cycling icon button to a cycling text button** (§6.1, §11). A sun glyph that needs a tooltip is the generic pattern, and the bar has no other icons.
- **Active-nav underline fixed to `--fg`** — the token table said `--accent`, §6.1 said `--fg`; §6.1 was right (the accent marks change, not location).
- **`▶ Run` and `Filters ▾` glyphs removed** from the §6.2 and §6.4 wireframes (§1.2: glyphs appended to button text). `Examples` redrawn as a link, as spec §3.1 says, not a boxed button.
- **Query bar growth corrected** from 84 px to 76 px (three 20 px lines plus 16 px padding).
- **§6.2a added**: the seven chip editors and the Examples popover were not drawn anywhere although spec §3.2 specifies them and §9 screenshots two of them.
- **§6.2 gained** the hover tooltip contents (spec §3.4), the ISO-on-hover row header, the column-header program count, the loading skeleton's real shape (spec §3.7) and "no icons on toolbar buttons".
- **§6.3 tablet toolbar labels restored** to `Show dynamic pricing` and `Save as standing query` — the draft had shortened them to `Dynamic` and `Save query`, breaking the same-verb rule (§1.3) it states in §8.
- **§6.5 freshness line** corrected to `Seen by seats.aero 45 m ago` (spec §3.5 wording); button annotations updated for the accent change.
- **§7 gained** tooltip and toast specifications (text only, one at a time) so 6.4/6.5 do not reach for a toast library's defaults.
- **§8 copy**: row 5 zh rewritten (「已检查 3 个计划，2 小时前。」 was a dangling fragment); rows 11–15 added for drawer strings, the two subtitles, "Sign out everywhere", and the "WORD — fragment" pattern that the current dictionaries use in at least 14 strings (`——` in zh); page subtitles ruled out.
- **§10 rewritten** as an honest table: the Type row now says plainly that Inter is the generic choice and why it stays; the Numbering row's "Yes — none needed" was rewritten; the Arrows row admits the draft's own `▶`/`▾` tells; rows added for empty states, icons, motion, feedback and the hatch.
- **§12 added** (twelve findings from the before screenshots) and this log.
- **§6.2a range fill corrected** (6.3 review). "Range fill `--bg-raised`" on a `--bg-raised` popover was 1.10:1 in light and 1.13:1 in dark — the plan had written down the defect. The band is now `--selection` between `--line-strong` rules, and the hover state on unselected days is a ring, not the same fill.
- **§6.2a Examples anchor pinned** (6.3 review): to the query-bar row, not the link, after the popover was measured covering the textarea at 390 px and clipping the Run button at 1440 px.
- **§6.2a SEL/GMP deviation logged** (6.3 review), with the decision to name `ICN` in the e2e canonical query rather than edit the places seed.
- Not changed, checked and confirmed: 48 px bar, 360 px auth column, 880 px max content, 480/420 px drawers, 112 px minimum column, seven chips in the spec's order, toolbar contents, footer vertical rule, cell anatomy (fees left / seats right, mark + age right), six cell states, four freshness tiers with shape + text, all six page-level states, Queries columns and inline delete, Settings section order, the 156-PNG screenshot matrix arithmetic, sentence case and full-width zh punctuation in every "After" string.

### Revisions from the v0.2 screenshot review (issues #30 / #31)

- **Sticky headers sit on `--bg-raised`, and the hover/focus highlight moved to an edge.** §2 has always assigned `--bg-raised` to "sticky header row + row headers", but `.ag-table th` painted `--bg` and only `th[data-hl="true"]` raised it, so in dark the header band and the sticky date column were separated from the data by `--line` alone (1.35:1) and content scrolling under the sticky column had no value separation from it. The resting ground is now `--bg-raised`; the highlight §7 describes is a 1 px inset `--line-strong` edge, because two states cannot both be the same ground. §7 amended above.
- **The scrim is its own token, not 40 % `--fg`.** §6.3's literal reading gave dark mode a veil that composites to `#696969` over `#111111` — brighter than both the page it dims and the sheet in front of it, so elevation read inverted. `--scrim` (black at 40 %) is theme-stable and darkens in both themes; in light it is pixel-identical to what §6.3 asked for. §6.3 amended above.
- **The password hint was always 8 characters.** §6.9 said 12; the validator, both dictionaries and three test files say 8. The plan was the stale side, so the plan changed and nothing in the app did.
- **The Run button has three labels, not two.** §6.2 shows one busy label; parsing and searching are two phases and the status line 20 px below the button already distinguished them, so the button reads Run / Parsing… / Running… and reserves the widest of the three so it cannot resize mid-submit.
- **The quota banner's third sentence is conditional.** §6.2's "Cached results are still shown" is only true when a previously fetched grid is on screen; hitting the limit on the first search of the day left the sentence describing a blank page. It is a separate string now, and the no-cache case gets the left-aligned empty state §6.2 gives every other page-level state.
- Not changed, re-checked: the eleven colour tokens, the three radii, the 112 px minimum column, the seven chips and their order, the six cell states, the four freshness tiers, the drawer widths and the four presentations, the Queries columns, the Settings section order.
