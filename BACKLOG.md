# BACKLOG

Ideas explicitly **out of scope** for v0.1.0 (kickoff §0.3 "never expand scope"). One line each; the source of each
deferral is in parentheses (DECISIONS.md, ARCHITECTURE.md, FINAL_REPORT.md, or the code comment that points here).

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
- Dropdown user menu in the header (`src/components/shell/user-menu.tsx` is username + logout inline) with links to Settings / Saved queries / Legal.
- Mobile screenshot check of the grid (sticky first column + horizontal scroll is implemented in `grid-table.tsx` but was never verified on a real phone or at 375 px). (§8)
- Admin CLI: `reset-password --user`, `delete-user --user`, `revoke-invite <code>`; today only invite / users / invites / revoke-sessions.
- Second factor (TOTP) for the web login — the deployment relies on Tailscale/Access as the second wall. (§2: no passkeys/OAuth/email, decided)
- Revisit the `node:sqlite` driver (`drizzle-orm/node-sqlite`) instead of `better-sqlite3` when drizzle-orm 1.0 is `latest` (today only in the 1.0 RC, with a different migration folder layout) — removes the native module. (ARCHITECTURE §9.1 / §7 #21, DECISIONS "SQLite driver")
- Docker image size: the runtime stage keeps the full `node_modules` because the worker/migrate/admin CLIs run through the `tsx` devDependency; precompiling `src/cli/*.ts` would allow a production prune. (DECISIONS Phase 5)
- Quota reset boundary: assumed 00:00 UTC and labelled as such; confirm with seats.aero and show the exact reset. (DECISIONS "Quota reset boundary")
- Duffel / Ignav keys are stored but only used by the Ask lane; a cash-price column in the grid would use them in the fast lane (prerequisite for `cpp_desc`).

## Release-window mode (documented, not built)

Most programs open award inventory ~330–360 days out at a fixed local time
(e.g. JAL ~10:00 JST, ANA ~09:00 JST, AA/Alaska ~331 days, United ~337 days).
A "release-window" standing query would, once a day just after the program's
release time, run Cached Search for only the newly opened date on each
monitored route — roughly **1 seats.aero call per route per day** — and push
the new cells immediately. Needs a per-program release-time table and a
worker schedule expressed in the program's local timezone.
