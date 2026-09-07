# BACKLOG

Ideas explicitly **out of scope** for v0.1.0 and v0.2.0 (kickoff §0.3 / Phase 6 §0.3 "never expand scope"). One line
each; the source of each deferral is in parentheses (DECISIONS.md, ARCHITECTURE.md, FINAL_REPORT.md, or the code
comment that points here).

## Grid / fast lane

- Deeplinks for programs other than AA (Alaska/Atmos Rewards, Aeroplan, United, Flying Blue, …): `src/lib/grid/deeplinks/index.ts` falls back to the seats.aero booking URL or the program homepage. (§12: AA only in v1)
- `cpp_desc` sort (cents-per-point): needs a Duffel cash reference fare per cell; `FutureSortBy` in `src/lib/query/schema.ts` and `isImplementedSortBy` in `src/lib/grid/ranking.ts` already reserve it. (§4.5)
- Write Get Trips results back into `availability_cache`: `fees_cents`, `currency`, `booking_url` are returned to the client on cell expand (`getTripsForUser`) but never persisted, so `fees_asc` and the CSV only see fees for cells expanded in this render. (DECISIONS "Fees per cell")
- A real `include_filtered` column on `availability_cache` instead of the `program#filtered` suffix encoding in `src/lib/db/stores/cache.ts` (needs a migration; PK change). (DECISIONS "`include_filtered` scope")
- `min_cabin_pct` as an advanced setting (query-level, default 100, forwarded to Cached Search / Bulk Availability / Get Trips) plus the `MixedCabinPct` badge in the cell drawer. (ARCHITECTURE §2.6, DECISIONS "Get Trips params")
- Use `Route.NumDaysOut` as a "not yet monitored" hint once its semantics are confirmed against a live fixture. (DECISIONS "NumDaysOut")
- Prefer `ComputedLastSeen` for freshness if the live API turns out to send it; confirm `TotalDuration` units and the Bulk Availability envelope with a recorded smoke (the 40-call test-key smoke never ran). (ARCHITECTURE §8)
- Round-trip / multi-city queries (v1 is one-way grid only). Multiple passengers (`RemainingSeats` is shown; no pax filter).
- Holiday date phrases (`国庆`, `Thanksgiving`, …) in the deterministic parser instead of the LLM fallback. (§4.2)
- More locales than `en` / `zh-CN`; more cities/aliases in `data/places.json` (editable today).

## UI (deferred by Phase 6)

- ~~**Per-cabin split rows in the grid.**~~ **Shipped (issue #35), as `Cells: Best | Per cabin`** — a stacked cell, not
  a split axis (docs/UI_PLAN.md §6.2b, DECISIONS "#35"). With both cabins shown, `Per cabin` draws one 16 px line per
  cabin inside the same cell; `Best` stays the default and is unchanged. `GridCell.all` already held every cabin's rows,
  so both prices were a rendering question and `src/lib/grid/pivot.ts` needed one pure helper (`bestPerCabin`) rather
  than a second axis. Rejected alternatives: **split rows** (J and F interleaved down one column, so "cheapest business
  across 30 dates" becomes a read of every other row, ArrowDown stops meaning "next date", and a 30-day phone grid
  becomes 60 rows) and **split columns** (halves the route axis, the axis the product exists for, and re-keys
  `grid.cols`, which silently breaks the pair-keyed not-monitored / not-fetched column sub-labels).
  Still open from it: `cell.best` is best-across-cabins, so `gridStats.cheapest`, the CSV `best` flag, the drawer's lead
  program and the Ask context pill name ONE winner while the user is looking at two. Making `best` cabin-aware ripples
  into the standing-query diff and the notification digest, so it is deferred.
- **Progressive per-program fill: closed, not deferred.** Spec §3.4 wants cells to land as each program returns, with
  an `Alaska ✓ American ✓ Aeroplan …` status line. It cannot be built against seats.aero without breaking kickoff
  §0.2. One Cached Search request carries every program in a single comma-joined `sources` parameter
  (`src/lib/seatsaero/find.ts:120`, `src/lib/seatsaero/client.ts:154`) and omits it entirely for a query that names
  none, so all 26 programs answer in that one request: splitting it multiplies the daily quota by up to 26.
  Per-program coverage rows can also never satisfy an all-programs query (`src/lib/db/stores/cache.ts:67-74`,
  `src/lib/seatsaero/cache.ts:152-154`), so it would disable the cache for good. And there is no program axis to fill:
  the grid is dates × route pairs, with `not_fetched` per pair (`src/lib/grid/pivot.ts:171-180`). What shipped instead
  is a status line that says what is being asked and how long it has taken (#36). (DECISIONS "Progressive per-program
  fill")
- **One flush before the routes phase (gated, unbuilt).** The honest streaming opportunity is not the search but the
  phase after it: when some requested pair has zero rows, `ResilientRoutesCatalog.ensureLoaded`
  (`src/lib/server/find.ts` over `src/lib/seatsaero/routes.ts:145-166`) walks the sources one at a time, up to 26
  serial `/routes` calls, *after* the rows are already final. Flushing the finished grid once at that boundary costs
  no extra quota, writes no per-program cache record and revises no number. It needs `POST /api/find/stream` (three
  events: `partial`, `done`, `error`), one optional `onRowsSettled` hook in `runFind`, and a `pending_routes` option
  in `buildGrid` so a cell that would read "no availability" reads `loading` until the routes phase settles. Gate: a
  real cold-run measurement of that phase. Offline it is 26 sequential calls whose wall-clock is pure round-trip
  count, crossing 2 s at about 77 ms per call; a query whose every pair returns rows makes zero routes calls and would
  see no flush at all. (DECISIONS "The measurement that gates the one honest flush")
- **Page-progressive fill is unsafe for a separate reason worth remembering.** Rows are expanded one per cabin
  (`src/lib/seatsaero/normalize.ts:36-64`) while upstream orders by the availability OBJECT's lowest mileage
  (`src/lib/seatsaero/find.ts:118`), and `buildGrid` takes `best = shown[0]` per cell. A partially-filled cell's
  headline price can therefore revise downward under ANY sort, not only `fees_asc` / `seats_desc`. A grid whose one
  job is "cheapest per cell" must not print a confidently wrong cheapest. (#36 design panel)
- **Per-program actions in the cell drawer.** The footer ("Open in …", "Copy details", "Save as standing query",
  "Ask about this cell") acts on the cheapest program in the cell. Acting on any other program needs a selection
  affordance the spec does not describe. (DECISIONS 6.4)
- **The mobile grid page spends 56 % of the viewport before the first data row.** At 390 x 844 the query block runs to
  y = 476: the top bar, a three-line textarea, "Parsed from", the `llm_off` hint, the seven chips wrapping to five rows,
  then the Filters row — leaving about four 40 px data rows on first paint against §6.4's budget of two chip rows. The
  v0.2 review's cheap half is done ("Parsed from" is one truncated line now); the rest is a layout decision, not a
  polish edit: keeping Origins / Destinations / Dates inline and moving the other four chips into the Filters sheet
  changes what §6.4 promises about the chips being the single visible source of truth, so it needs a plan amendment
  first. (#30 finding 17)
- **The demo generator can emit a one-minute final leg.** `fixtures/demo/generate.ts` clamps a date-line-crossing
  arrival to `cursor + 1`, so every connecting itinerary in the published cell-drawer captures ends with an impossible
  "NH914 ICN 13:06 → SEA 13:07". The renderer half is fixed (`flights-list.tsx` now dates each side of a leg
  independently, so a real overnight or date-line leg carries its own day marker); the generator is outside the fixer
  pass's edit scope (`src/**`, `e2e/**`, `docs/**`, `scripts/**`). One change: compute the true local arrival and let
  the day marker explain it. (#30 finding 5)
- **Density control in the grid toolbar.** Row height follows the breakpoint (48 / 32 / 40 px) with no user override;
  the toolbar deliberately holds exactly the controls spec §3.3 lists. A "compact" toggle would let a desktop user get
  the two-line cell. (DECISIONS 6.0 "Row height")
## Standing queries / notifications

- Release-window mode: see the section below. (§6, documented not built)
- Telegram webhook mode (`setWebhook` + `secret_token`) as an alternative to `getUpdates` long polling for deployments that do have a public HTTPS endpoint. (ARCHITECTURE §9.5)
- Persist the poller's `getUpdates` offset so a worker crash cannot replay one already-used `/start` (today it only yields a "link expired" reply). (DECISIONS Phase 3 "Poller shutdown")
- Per-query notification digest preferences (only cheapest N, per-cabin) and a "pause until" control.

## Ask lane

- Multi-turn Ask conversations: every question is a fresh SDK session (`persistSession: false`); follow-ups re-send the grid context. (DECISIONS Phase 4 "Session env")
- Live-verified model turn: the recorded `test/fixtures/ask/smoke-result.json` is an auth error (only the Claude Code host token was available); re-run `scripts/ask-smoke.ts` with a real key and refresh the fixture. (FINAL_REPORT §3/§4)
- Ship the toolkit's `transfer-bonuses` refresh (`scripts/refresh-transfer-bonuses.py` is not copied), or a cron that refreshes `data/transfer-bonuses.json` from upstream, so the bundled bonus data does not go stale. (ARCHITECTURE §6.2)
- Parser model switch when `claude-haiku-4-5-20251001` retires (not sooner than 2026-10-15): re-run the fixture suite on the next cheapest model and change the default; `AWARDGRID_PARSER_MODEL` is the stopgap. (DECISIONS "Parser model watch")
- Hotels are out of scope (`compare-hotels`, Airbnb MCP and `liteapi` dropped); `premium-hotels` / `hotel-chains` remain as reference only. (DECISIONS "MCP servers kept")

## Auth / UI / ops

- DB-backed (shared) login rate limiter: `src/lib/server/rate-limit.ts` is in-memory per process, fine for one app container, wrong for two. (DECISIONS Phase 2 "Login rate limiting")
- ~~Dropdown user menu in the header~~ — shipped in 6.1 (`user-menu.tsx`: username + account line + Log out). Links to Settings / Queries / Legal live in the nav and the mobile menu instead.
- Verify the grid on a real phone: 6.6 photographs and asserts it at 390 × 844 in a desktop browser's emulation, but sticky-column behaviour, momentum scrolling and touch targets have never been checked on physical hardware. (§8)
- Admin CLI: `reset-password --user`, `delete-user --user`, `revoke-invite <code>`; today only invite / users / invites / revoke-sessions.
- Second factor (TOTP) for the web login — the deployment relies on Tailscale/Access as the second wall. (§2: no passkeys/OAuth/email, decided)
- Revisit the `node:sqlite` driver (`drizzle-orm/node-sqlite`) instead of `better-sqlite3` when drizzle-orm 1.0 is `latest` (today only in the 1.0 RC, with a different migration folder layout) — removes the native module. (ARCHITECTURE §9.1 / §7 #21, DECISIONS "SQLite driver")
- Docker image size: the runtime stage keeps the full `node_modules` because the worker/migrate/admin CLIs run through the `tsx` devDependency; precompiling `src/cli/*.ts` would allow a production prune. (DECISIONS Phase 5)
- Quota reset boundary: assumed 00:00 UTC and labelled as such; confirm with seats.aero and show the exact reset. (DECISIONS "Quota reset boundary")
- Duffel / Ignav keys are stored but only used by the Ask lane; a cash-price column in the grid would use them in the fast lane (prerequisite for `cpp_desc`).
- Record price drops per run: `query_runs` counts new and dropped cells only, so a stored run whose sole change was a price drop is summarised from `notified` ("prices dropped") rather than a count. The expanded row rebuilds the real drops from the snapshots, so only the per-run summary is approximate. Same migration shape as `calls_used` (drizzle/0002), which is now done and can be copied.
- Diff cells cannot offer "Show flights" or a booking link: `cells_json` snapshots keep only key + miles + fees + seats + last-seen, so the rebuilt `AvailabilityRow` has no `source_id`, `booking_url`, airlines or currency. Widening the snapshot (or storing the row id) would make the expanded row's cells as actionable as the grid's. (DECISIONS 6.5)
- `error.wrong_password` and `saved.edit.chips_locked` are now unused in both dictionaries (the password route answers `invalid_current`; PATCH accepts `query`), as is `saved.subtitle` (the Queries page dropped its subtitle per §8). Sweep them in a single i18n pass rather than one at a time.
- The Telegram link route mints a deep link only when a bot token is configured; with just `TELEGRAM_BOT_USERNAME` set it could hand out a link and let the QR render without a running bot. `e2e/settings.spec.ts` stubs that one POST until then. (DECISIONS 6.5)

## Release-window mode (documented, not built)

Most programs open award inventory ~330–360 days out at a fixed local time
(e.g. JAL ~10:00 JST, ANA ~09:00 JST, AA/Alaska ~331 days, United ~337 days).
A "release-window" standing query would, once a day just after the program's
release time, run Cached Search for only the newly opened date on each
monitored route — roughly **1 seats.aero call per route per day** — and push
the new cells immediately. Needs a per-program release-time table and a
worker schedule expressed in the program's local timezone.
