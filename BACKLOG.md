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

- **Per-cabin split rows in the grid.** With both cabins shown, a cell is the best row of the two with a `J`/`F` tag
  (spec §11 "Cabin display"); a mode that splits each date row into a J row and an F row — or each route column into
  two — would show both prices at once. Needs a second axis in `src/lib/grid/pivot.ts` and a rows-toggle value beyond
  Dates ↔ Routes. (Phase 6 §11)
- **Progressive per-program fill.** Spec §3.4 wants cells to land as each program returns, with a
  `Alaska ✓ American ✓ Aeroplan …` status line; `/api/find` answers in one batch, so the line is a single
  "Searching seats.aero…". Needs a streaming find endpoint (SSE, one event per program) and a cell-level merge in
  `grid-app.tsx`; the cell already has a `loading` state to land into. (DECISIONS 6.0 / 6.2)
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
- **Fold the per-feature captures into the matrix, then run `screenshot-index --strict` in CI.** 6.6 declared the
  §9 matrix in `e2e/matrix.ts` but left the earlier per-feature screenshot code in `grid.spec.ts`, `chips.spec.ts`,
  `cell-drawer.spec.ts`, `ask-drawer.spec.ts`, `queries.spec.ts`, `settings.spec.ts` and `shell.spec.ts` alone —
  other engineers were editing those files in the same working tree. The result is the three detail folders
  (`ask-drawer/`, `cell-drawer/`, `chips/`) and ~15 extra stems beside the matrix's own. They all obey the naming
  rule, so the contact sheet lists them; but `scripts/screenshot-index.ts --strict --check` still exits 1, which is
  why the plain `--check` is what the docs promise and neither is wired into the `checks` job yet. Delete the
  redundant captures, drop the detail folders, then add `pnpm exec tsx scripts/screenshot-index.ts --strict --check`
  to CI as the guard that a new state cannot be photographed without being declared. (FINAL_REPORT §9.2)
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
- Record API calls per run: `query_runs` has no calls column, so the Queries page's "Calls used" column is an en dash for every stored run. A "Run now" in this tab now keeps its own count (`mergeRunCalls`), but it is lost on reload and the §4 wireframe's "4 calls" still cannot be shown for history. Needs one migration (`query_runs.calls_used INTEGER`) plus a write in the run path — `QueryRunResult.apiCallsUsed` is already computed and returned by `POST /api/queries/[id]/run`. (DECISIONS 6.5)
- Record price drops per run: `query_runs` counts new and dropped cells only, so a stored run whose sole change was a price drop is summarised from `notified` ("prices dropped") rather than a count. The expanded row rebuilds the real drops from the snapshots, so only the per-run summary is approximate. Same migration shape as the calls column. (DECISIONS "6.5 review fixes")
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
