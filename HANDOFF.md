# awardgrid — handoff

**Written 2026-09-08. `main` is `e716963`, clean, level with `origin`, no open pull requests.**

This is the document to read before touching this repository. It has three parts:

1. [What has shipped](#1-what-has-shipped) — every change, and the defect each one closed.
2. [For the next agent](#2-for-the-next-agent) — the environment, the house rules, and the open work in the order I would take it.
3. [The homepage entry point](#3-the-homepage-entry-point) — a requirement to build, because the product does not have one.

Everything below was verified against the repository and the GitHub API while writing it. Where a number appears, it was read, not remembered.

That claim did not survive its own audit unamended. Before this was committed, 141 checkable claims in it were re-checked at source by five independent passes: 123 held, 16 did not, and all 16 are corrected here. Every one was a citation or attribution slip — eight off-by-N line numbers, one stale count (569 i18n keys, now 592), one symbol that does not exist (`diffCells`, actually `diffSnapshots`), two misattributions and two mechanism errors — and none changed an engineering decision. The load-bearing numbers were re-confirmed independently: 298 committed PNGs, 24 Linux baselines, 15 commits in `v0.2.0..main`, 12 open issues, `HEAD` = `e716963`. Treat a line number here as a strong hint and the surrounding sentence as the claim.

---

## The product in four lines

awardgrid turns one natural-language question — in Chinese or English — into one table of origins × destinations × dates, each cell the cheapest award seat with its miles, fees, seats left, program and freshness. It is private, invite-only, fewer than ten users, non-commercial, and **every user brings their own paid seats.aero Pro key**. There is no shared key and no server key.

The eight boundaries in the kickoff brief's §0.2 are not style preferences and no change may cross them: no scraping airline or program sites; no shared or default key, and the cache is per user; no seats.aero Live Search; no airline logos, wordmarks or brand colours anywhere, text names only, and "Data: seats.aero" stays visible; no credential-based toolkit skills in hosted mode; **no money** — no paywall, cost-sharing or subscription logic anywhere; never invent an API parameter; keys encrypted at rest, never logged, only the last four characters ever shown.

---

## Where the releases sit

| | | |
|---|---|---|
| **v0.1.0** | 2026-09-06 | Phases 0–5: the two lanes, the scheduler, auth, the CLI, Docker. 7 commits. |
| **v0.2.0** | 2026-09-06 | Phase 6, the UI. 9 commits. |
| **`main` today** | 2026-09-08 | 15 further merges, all of them below. |

---

## 1. What has shipped

Fifteen pull requests since v0.2.0. They fall into four groups.

### The v0.2.0 review — looking at what was actually built

#### #38 → no issue — Close out the UI phase after the v0.2.0 release

Docs only. Records that PR #29 merged, that main was green on all five CI jobs, that v0.2.0 was tagged and released, and that the deferred UI work was filed as issues #30–#37.

**Why it mattered.** The v0.2.0 release left a pile of known-but-unfixed UI defects with no written home. Without this the eight follow-up issues would have existed only in a reviewer's head, and every PR after it (#39–#46) is one of those eight.

<sub>commit 1f7e8ed, merged 2026-09-06T16:46:04Z; closes no issue; docs only, no gate change.</sub>

#### #39 → issues #30, #31 — Fix what the screenshots showed, and rewrite the Chinese copy

Six reviewers eyeballed 246 of the then-394 committed screenshots against docs/UI_PLAN.md and a seventh read all 569 Chinese strings; 48 of 51 UI defects and all 25 string defects are fixed. Two were invisible to tests: the Programs editor showed every checkbox unticked while its own chip read "all 26" ("all" is stored as an empty array, so the list ticked from an empty set), and all four edit-drawer captures contained no drawer, because Playwright's animations:"disabled" freezes a running 200 ms slide-in where it is rather than completing it, so the panel was photographed off-screen at x=1440 while toBeVisible() passed.

**Why it mattered.** A user opening the Programs editor saw a control that flatly contradicted the summary above it, and could not tell which one was lying. The Chinese defects were grammatical, not cosmetic: 「seats.aero 于{age}查看」 is broken Chinese when {age} is 刚刚 or 未知 because 于 takes a time point, and the legend told readers to look for 「"动态定价"字样」 while the cell actually prints 「动态」. Three UI_PLAN contradictions (sticky-header ground, the missing --scrim token, the password floor) were resolved rather than left for the next reader to re-discover.

<sub>commit 40ef346, merged 2026-09-06T19:45:23Z. PR gates: typecheck clean, lint 0 errors, 1046 unit tests, 484 e2e passed, 69 axe audits with no violations, all 394 screenshots re-captured.</sub>

#### #40 → issue #32 — The four things a thumb found that a viewport could not

Driven on a real iPhone 17 Pro simulator (iOS 26.5, Mobile Safari, 402×874 pt) against a production build. Four touch-only defects fixed: the tooltip was armed from mouseenter and from any focus, so on iOS — which synthesises mouseenter on tap and never sends the matching mouseleave — a tap left a tooltip parked over the row below with no pointer left to dismiss it (now gated on (hover:hover) and (pointer:fine) plus :focus-visible); columns now snap clear of the sticky date column below 768 px; the grid chains its scroll to the page on touch instead of overscroll-behavior:contain; and 100dvh replaces 100vh, which on iOS Safari is the toolbars-hidden height. Also: the drawer's primary button read "Open in Singapore" (a country) and now reads "Open in Singapore KrisFlyer", and the 40 px touch floor gained (pointer: coarse) beside its width query.

**Why it mattered.** The half-scrolled column was the dangerous one: with the tail of a cell peeking past the sticky column, the end of "84,000" renders as a miles value of 0 — a confidently wrong price, not an ugly one. The 100vh error put the last rows permanently under Safari's floating toolbar. The touch floor keyed to width alone meant the same phone rotated to landscape (874 px) and every tablet dropped back to 24–32 px controls under the same thumb. e2e/grid.spec.ts had been SKIPPING the tooltip case with a comment asserting in prose that tooltips never open on touch; there is a mobile test now.

<sub>commit 0f3aa75, merged 2026-09-06T20:36:11Z. PR gates: typecheck clean, lint 0 errors, 1046 unit tests, 487 e2e passed (two new mobile tests), 69 axe audits with no violations.</sub>

### Making the record and the gates trustworthy

#### #42 → issue #34 — One owner for every screenshot, and the guard in CI

Every capture call was removed from the seven feature specs so e2e/screenshots.spec.ts is the sole writer, and scripts/screenshot-index.ts --strict --check is now a step in the checks job. Matrix entries 39 → 61, declared captures 152 → 238, total PNGs 394 → 290. Every assertion in the feature specs stayed (test/expectation counts identical before and after). DETAIL_PAGES — the folder exempt from the completeness check — is gone; its 13 duplicate stems were pixel-diffed and deleted, its 14 unowned states declared on the page they belong to.

**Why it mattered.** 21 of the 39 declared stems had two writers producing the same filename in the same Playwright worker in arbitrary order, and the two disagreed about fullPage — so which bytes survived was a race. That is how shell/legal-*.png shipped as a viewport shot cut off mid-sentence while the matrix declared it full page. Two further bugs surfaced: settleDrawers answered "settled" for exactly the window the defect lives in (DrawerShell renders data-state="closed" for two frames during entry, so every() over an empty list is true), and --strict never policed the frozen before/ folder, so a new state parked there passed.

<sub>commit 974983e, merged 2026-09-06T23:14:45Z. PR gates: typecheck clean, lint 0 errors, 1027 unit tests, 522 e2e passed, --strict --check exits 0. Guard re-run read-only on today's tree: 298 PNGs, exit 0.</sub>

#### #43 → issue #33 (prerequisite, does not close) — The queries table's columns stopped following the clock

A 96 px min-width floor on the Queries table's Last run and Next run columns, which holds the widest relative-time reading at 13 px. A regression test in e2e/queries.spec.ts substitutes each of "due now", "in 22 minutes" and "55 seconds ago" into the Next run cell and asserts the Name column does not move; the CSS was reverted to watch it fail before being restored.

**Why it mattered.** Main run 34058508996 (commit 0f3aa75) failed queries-expanded.png on desktop-light and desktop-dark by 3 % of pixels on a tree that had passed on the PR branch an hour earlier, with no code change between. queries.css gives every column but the first width:1px, so Name absorbs all slack; the Next run column was 27 px wider in one run than the other and the query name wrapped to two lines. timeMasks masks the reading, but nothing can mask the layout that reading produced — the mask box moved with it. A visual job that fails on the wall clock can never be made blocking.

<sub>commit 496bac6, merged 2026-09-06T23:52:18Z; failing run 34058508996, 2 of 24 visual snapshots failed. Ledger in the PR: b0acca1 24 passed, 1f7e8ed 24, 40ef346 24, 0f3aa75 2 failed, f927f93 24, 974983e 24.</sub>

#### #44 → issue #33 (prerequisite, does not close) — Make the suite independent of what time it runs

Two Linux baselines moved (queries-expanded on desktop-light and desktop-dark), taken from the visual-snapshots artifact of the CI run that caused them rather than regenerated on a Mac. Second commit: scripts/seed-e2e.ts now writes tomorrow's api_usage row as well as today's, one extra insert per user.

**Why it mattered.** The quota seed keyed the "quota" user's 950 calls to the UTC day the seed ran. The first CI run of this PR started at 23:58 UTC and reached the quota tests at 00:05, so the app asked about a day nobody had written, read 0 calls, and every quota state silently rendered as an ordinary grid — failing grid-quota in the axe, before, grid and screenshots specs across all four projects. Neither this nor #43 was visible from reading the code; both had to go before a job that is about to be required could be trusted.

<sub>commit 96eef58, merged 2026-09-07T08:05:06Z. Baseline source run 34066965790 (visual job, queries-expanded-actual.png); midnight failure reproduced in run 34068335365. The other 22 baselines compared clean.</sub>

#### #55 → issue #33 — The visual comparison is blocking

`continue-on-error` removed from the visual job's comparison step, so a pixel diff turns the job red instead of being buried in its log. It survives only on the generate path, which is a one-off bootstrap for a repo with no committed baselines. The five green runs the DECISIONS 6.6 policy required are recorded with their ids, read from job logs rather than job conclusions — with continue-on-error the conclusion is `success` whatever the comparison did.

**Why it mattered.** The count was never what was blocking it: two determinism defects (#43's unfloored time columns, #44's UTC-midnight quota seed) made the comparison fail on a schedule nobody controlled. The clock defect reached main twice — 0f3aa75 and again 974983e — and nobody noticed either time, which is exactly what a non-blocking job hides. The PR is also explicit about what it does not buy: `gh api repos/LoganYe/awardgrid/branches/main/protection` returns 403 ("Upgrade to GitHub Pro or make this repository public"), so a required check in the branch-protection sense is unavailable on this plan; what a red job buys is that it is red. The recovery procedure is recorded too — read the visual-snapshots artifact and replace a stale baseline from its -actual.png, never by regenerating on a Mac.

<sub>commit f130177, merged 2026-09-07T15:11:59Z. Five green runs cited: 96eef58/34098709246, caa4ac6/34100885712, 8fcfe5a/34104426383, 403dd91/34130621005, 06d4476/34132693007 — each 24 passed / 0 failed.</sub>

#### #53 → no issue (records #19 as a watch item) — Correct six claims the triage found stale

Six prose claims in the docs corrected against the code: deeplinks have no program-homepage fallback (resolveDeeplink returns url:null, kind:"none"); the MixedCabinPct badge already ships and is merely unreachable; the "56 % of viewport" mobile figure predates two query-bar fixes and nothing measures it; the release-window rationale cited JAL and ANA, neither of which is one of the 26 seats.aero sources; pnpm find → pnpm grid was done in Phase 5, not pending; and the §6.2 wireframe's "header 32" has been 48 since 6.2. Issue #19 is recorded here as a watch item with its trigger stated as a conjunction.

**Why it mattered.** Each stale claim would have sent the next reader down a wrong path — the release-window one in particular justified an unbuilt feature with two programs the grid cannot query at all, and the "the UI does not expose min_cabin_pct" framing understated what #18 actually had to do. #19's payoff claim was also wrong in two ways: the runtime image keeps node_modules because the CLIs run through tsx at runtime, and @node-rs/argon2 ships a native binary regardless.

<sub>commit 403dd91, merged 2026-09-07T14:01:09Z. Docs only — no code, no pixels; CI run 34130621005 green on all five jobs and one of the five green visual runs #55 cites.</sub>

### Product work

#### #41 → issue #37 — Record calls_used on every query run

One nullable query_runs column, one write in the run path, one read in toRunSummary. QueryRunResult.apiCallsUsed was already computed and simply never reached the database. Failure paths record what is actually known: 0 when the run was refused before any HTTP request (no key, quota exhausted, invalid query), null when a throw may have spent calls the facade cannot report. mergeRunCalls is deleted, since the server can now answer the question directly.

**Why it mattered.** The Queries page had shipped a "Calls used" column since Phase 6 that showed an en dash for every stored run — the one column whose job is to be honest about a 950/day quota was blank. Choosing nullable over NOT NULL DEFAULT 0 matters for the same reason: every pre-existing row would otherwise have claimed it made zero calls, fabricating a number in exactly that column.

<sub>commit f927f93, merged 2026-09-06T21:11:29Z. PR gates: typecheck clean, lint 0 errors, 1044 unit tests, 484 e2e passed. E2e seed carries real counts (0, 27, 24) asserted in queries.spec.ts.</sub>

#### #45 → issue #36 — Say what the search is waiting for, and stop blaming the quota for an upstream failure

The issue asked for per-program progressive fill; a design panel read the pipeline and found it unbuildable against this API, and the reason is written into DECISIONS.md rather than deferred a third time. What ships instead: one live-region sentence naming what is being asked ("Asking seats.aero about all 26 mileage programs…", or the named programs at 1–3, or a count at 4+), replaced after 12 s by "Still asking seats.aero. Wide date ranges take longer." And a live defect: ResilientRoutesCatalog.ensureLoaded put a source whose Get Routes call had failed into both `failed` and `skipped`, and runFind turned any skip into the notice "skipped to stay within today's quota".

**Why it mattered.** An upstream 500 on one program's route list was telling users their daily allowance had run out when it had not — the call was made and answered with an error. The quota sentence now keeps only sources the budget really stopped (skipped − failed) and disappears when every skip was a failure; failures get their own notice naming the programs. Progressive fill was refused for concrete reasons: planFind sends one Cached Search whose sources parameter is the whole program list, splitting it per program would multiply the daily quota by up to 26 and permanently disable the cache (coverage rows key on the exact sorted program set), and page-progressive streaming can print a confidently wrong cheapest, because availabilityToRows expands one row per cabin while upstream order_by ranks the availability object by its cheapest cabin. warnings is rebuilt from the notices because uiNotices drops the whole strip back to English unless the two arrays are the same length — one unpaired notice would untranslate every warning for a Chinese reader.

<sub>commit caa4ac6, merged 2026-09-07T08:29:46Z. PR gates: typecheck clean, lint 0 errors, 1036 unit tests, 528 e2e passed, screenshot guard exits 0.</sub>

#### #46 → issue #35 — Show both cabins at once, inside the cell

A `Cells: Best | Per cabin` toolbar toggle that draws one 16 px line per selected cabin inside the existing cell, reusing the mobile line verbatim ([J] 60,000 ●45m). Both axis splits the issue asked for — J/F rows, or split route columns — were proposed by a design panel, scored by three independent judges, and lost. The grid's shape does not move: aria-rowcount/colcount/rowindex/colindex, moveFocus, PAGE_ROWS, both virtualizers and their thresholds, transposeGrid, cellAt, iterateCells, gridStats, csv.ts, the ?q= codec and diff-cells.tsx are all untouched.

**Why it mattered.** types.ts already documents GridCell.all as every row across programs and selected cabins, and buildGrid confirms it — both prices were already in the cell at render time and only the renderer threw one away, so an axis split would have paid 2× rows or columns for data already in hand. Interleaving J and F down a column turns "cheapest business across 30 dates" into a read of every other row and makes ArrowDown stop meaning "next date"; splitting columns halves the axis the product exists for (one route eats 296 px of a 390 px phone). A real defect surfaced while building it: dropClause/replaceClause in src/lib/grid/aria.ts build their RegExp with no g flag, so composing two cabin clauses into one sentence and dropping the empties leaked U+E000/U+E001/U+E002 sentinels into the announced screen-reader text — reproduced first, then fixed, with the regression test kept.

<sub>commit 8fcfe5a, merged 2026-09-07T09:09:24Z. PR gates: 1042 unit tests, 542 e2e passed; CI run 34104426383 read 106 unit test files and 546 e2e passed, visual 24 passed. Accepted cost: tablet rows grow 32 → 40 px at two cabins. The control is absent, not disabled, at one cabin — the cabin-J and cabin-F baselines do not move, which is the proof.</sub>

#### #56 → issue #18 — Mixed cabin — thread min_cabin_pct through the query, the plan and the cache scope

min_cabin_pct becomes a field on QueryObject, an eighth chip, part of the cache scope, and is forwarded to Cached Search, Bulk Availability and Get Trips alike. No migration: the flags ride in existing string columns (#pct<N> on rows, pct<N> in the programs key), written only when the value is not 100, and absent decodes as 100 everywhere — so every stored query, shared ?q= link and saved standing query keeps its exact current meaning and scope.

**Why it mattered.** seats.aero's default of 100 means no mixed-cabin distance allowed. Every call the product made went out at 100, so a long-haul flown in business with one regional economy leg came back as nothing and the grid rendered `none`, indistinguishable from genuinely no availability — and the MixedCabinPct badge that would have explained it already shipped in the drawer and was unreachable. The issue's framing ("the client supports it; the UI does not expose it") was wrong in the way that mattered: the parameter reached only the HTTP types and the query-string encoder, not the cache scope. The trap there is load-bearing: scopeWhere selects the unfiltered scope with notLike(program,'%#filtered'), anchored at the end, so a row stored as `alaska#pct70` does not end in #filtered and would have been handed to a 100 % query. It lives as a chip rather than in the toolbar because include_filtered's non-default state is self-evidencing in the grid (the dyn tag), while min_cabin_pct's effect is on cells that are not there — and below 768 px the toolbar is inside a Filters sheet that is closed by default. Two copy defects: at the default the chip read "Mixed cabin off" next to "Direct only off", two "off"s meaning opposite things, and now reads "not allowed" / 「不允许」; the editor hint was one static sentence, false at 0.

<sub>commit a2448cb, merged 2026-09-07T16:05:35Z. PR gates: typecheck clean, lint 0 errors, 1072 unit tests, 551 e2e passed, screenshot guard exits 0; CI run 34141576471 read 107 unit test files, 551 e2e passed, visual 24 passed. Measured layout cost recorded in UI_PLAN §6.4: the modified state moves down 48 px at 390 and 36 px at 1440.</sub>

#### #57 → issue #49 — Sequence the demo itinerary on an absolute clock

The demo generator carried one cursor in local minutes across time zones and clamped each arrival to max(cursor + 1, …). It now sequences on an absolute clock and derives each leg's local times from it. Removing the clamp exposed two more: connecting-leg distances were geography-blind (int(rand, 500, 1800) miles whatever the airports), and hubs were not required to be on the way — a hub must now be at least 300 miles closer to SEA than the origin, with the generator throwing if any origin drops below two candidates. The taxi constant went from distance/8.6 + 15 to +30.

**Why it mattered.** Every committed cell-drawer capture ended with a physically impossible leg: `NH914 ICN 13:06 → SEA 13:07 781`. The clamp existed for a real constraint — a connection must never depart before the leg that fed it — but expressing it in local time is what was wrong, because crossing the date line eastbound lands earlier in the local day than it departed. With the clamp gone the hidden defects surfaced as a segment departing the day before its itinerary did, and as `AC596 NRT 09:40 → TPE 09:44` — a 2,000-mile flight printed as four minutes, because TPE is further from SEA than NRT is and the leg floored at the 300-mile minimum. Across all 664 segments true elapsed time is now 44 min to 13 h 14, median 9 h 35, and no segment departs before its itinerary's date.

<sub>commit d366c98, merged 2026-09-07T17:10:37Z. PR gates: typecheck clean, 1089 unit tests, 551 e2e passed, screenshot guard exits 0; CI run 34146497738 read 107 unit test files, 551 e2e passed, visual 24 passed with the visual job blocking, as it has been since #55.</sub>

#### #58 → issue #52 — Write Get Trips fees back into availability_cache

Expanding a cell calls Get Trips, the only source of real fees, currency and booking URL; getTripsForUser returned all three to the client and dropped them although availability_cache already had the columns. The write now persists them through a new store method whose scope argument (include_filtered and min_cabin_pct) is mandatory and matched in both directions, and it touches neither computed_last_seen nor fetched_at.

**Why it mattered.** Fees showed as a hole in every cell and fees_asc sorted on nothing. The freshness decision is the interesting one: the mark answers "how old is what I am looking at", and the oldest thing in the cell is the availability — which Cached Search observed and Get Trips did not re-observe — so restamping would draw a fresh dot on three-day-old availability because someone priced it an hour ago. An adversarial review found four defects: a fee inherited the row's previous currency when the new one was empty, and seats.aero sends "" for USD, so a EUR row re-priced in USD was stored 5000+"EUR" while the drawer printed $50.00 and the CSV exported the wrong one; booking_url was persisted even when Get Trips found no trip in that cabin, permanently switching a row off its program deeplink on the strength of a call that found nothing; the write was an untransacted read-modify-write, so a concurrent refresh landing in the await gap was rolled back — including one that had DELETED a row, which came back with stale miles and a stale freshness mark (reproduced twice against the real SQLite store, now a targeted UPDATE with no insert fallback); and borrowed dynamic:true rows could never learn a fee, because the drawer asked in the query's scope while those rows live in the include_filtered one — precisely the rows whose real fees matter most. The PR also declines to claim fees_asc is now honest: on a first render zero rows carry a fee, and there is a test pinning that zero-coverage claim.

<sub>commit e716963, merged 2026-09-07T19:02:51Z. PR gates: typecheck clean, lint 0 errors, 1084 unit tests, 551 e2e passed, screenshot guard exits 0. Its own CI run 34154055151 is the head of main and read 107 unit test files, 1101 unit tests passed / 2 skipped, 551 e2e passed / 133 skipped, visual 24 passed, all five jobs success.</sub>

### Infrastructure

#### #54 → issue #11 (partial; #11 stays open) — Start the worker container in the docker smoke, and assert it booted

`docker compose up -d` with no service name (it previously named `app` only), plus an assertion that the worker logs {"event":"worker.start", … ,"transport":"mock"} within 60 s, with both services' logs dumped on failure.

**Why it mattered.** The worker container had never run anywhere — not in CI, not locally, since the build host has no Docker. Everything in docker-compose.yml lines 26–43 was untested end to end: the `tsx src/cli/worker.ts` command line, the depends_on: service_healthy gate, the shared /data volume, and tsx surviving into the runtime image. If any of it were wrong, a real deployment would serve the grid perfectly and silently never run a single standing query — the failure nobody notices for days. Asserting "transport":"mock" is also what guarantees the smoke can never send a real Telegram message.

<sub>commit 06d4476, merged 2026-09-07T14:23:30Z; docker smoke job success in CI run 34132693007. #11 remains open for the human half (real volume permissions, real Docker Desktop/colima).</sub>

### Where the gates stand now

Read from CI run 34154055151 on main (commit e716963, head of main, 2026-09-07T19:02:54Z, 23m12s, all jobs success) and from the working tree.

Unit tests (`pnpm test`, vitest, fixtures only, no network): 107 test files, 1101 passed / 2 skipped (1103 total).

E2e (`pnpm e2e`, Playwright against the demo mock, 4 projects: desktop-light, desktop-dark, mobile-light, mobile-dark): 551 passed, 133 skipped, 21.3 min.

Axe: e2e/axe.spec.ts declares 17 audits (login, register, legal, grid-results, grid-per-cabin, grid-chip-editors, grid-cell-drawer, grid-ask-drawer, grid-quota, grid-no-key, grid-empty-results, grid-parse-failure, queries, queries-expanded, queries-edit-drawer, queries-empty, settings). 51 ran and passed in that run (3 projects × 17); the 17 mobile-dark instances are skipped by a `test.skip` against `AUDITED_PROJECTS` (e2e/axe.spec.ts:127, 137). Each logs {"critical":0,"serious":0,"moderate":0,"minor":0}.

Visual: 24 Linux baselines under e2e/__screenshots__ (24 PNGs on disk), 24 passed / 0 failed in 36.3 s.

Screenshots: 298 committed PNGs under docs/screenshots/v0.2/** — 246 matrix-declared plus 52 frozen before/. `pnpm exec tsx scripts/screenshot-index.ts --strict --check` re-run read-only on today's tree: "298 PNGs, 27.6 MB, largest 295 KB", exit 0. It runs as a step in the checks job.

CI jobs (.github/workflows/ci.yml, on push to main and on every pull_request) — five, all of which fail the workflow if they fail:
1. `checks` (typecheck · lint · test) — typecheck, lint, build:plugin, vitest, the screenshot guard, a `next build` + grep of .next for fixture key strings, and a tracked-.env/SQLite check.
2. `e2e (Playwright, demo mock)` — no network, no keys.
3. `visual (Playwright snapshots)` — the comparison step's `continue-on-error` was removed in #55 (commit f130177), so a pixel diff now turns the job red. `continue-on-error` survives only on the baseline-generate path, which runs only when no baselines are committed.
4. `gitleaks` (secret-scan).
5. `docker smoke` — compose build, `up -d` with no service name so app AND worker start, /api/health poll, /login 200, and a worker.start log line asserting transport "mock".

None is a *required* check in GitHub's branch-protection sense: `gh api repos/LoganYe/awardgrid/branches/main/protection` returns 403 ("Upgrade to GitHub Pro or make this repository public"), recorded in #55 rather than papered over.


Scope: 15 commits on main after tag v0.2.0 (b0acca1, 2026-09-06 09:05 -0700), listed by `git log --oneline v0.2.0..main`. Every one is a squashed merge of a numbered PR: #38, #39, #40, #41, #42, #43, #44, #45, #46, #53, #54, #55, #56, #57, #58. Nothing merged outside a PR.

Issues closed in this window (gh issue list --state closed): #18, #19, #30, #31, #32, #33, #34, #35, #36, #37, #49, #52. #19 was closed by hand and recorded as a watch item in BACKLOG.md (:105) by #53, not fixed. #33 was closed by #55 with an explicit carve-out (branch protection unavailable on this plan). #11 is still open after #54 — the PR did the CI half and left the real-machine half.

Twelve issues remain open: #11–#17, #20, #47, #48, #50, #51. Three of them (#50, #51, and #48's re-measurement) were created by the work in this window rather than inherited: #50 in particular records that `cell.best` is best-across-cabins, a gap #46's per-cabin cells exposed.

Gate-number caveat, and it matters for reading the evidence fields: the "Gates" line each PR body quotes is a local run, and it does not always match the CI run on the merge commit. #46 claims 1042 unit / 542 e2e while CI run 34104426383 read 106 test files and 546 e2e passed; #57 claims 1089 unit and #58 claims 1084, while CI on #58's merge commit read 1101 passed / 2 skipped. Where the two disagree I have quoted both and marked which is which. The gates_now figures are all from CI run 34154055151 or from re-reading the tree, never from a PR body.

Read-only was honoured: only `git log`/`git show`, `gh pr/issue/run view`, file reads, and one read-only re-run of `scripts/screenshot-index.ts --strict --check` (which reads the committed tree — no browser, no build, nothing written). The full unit and e2e suites were not re-run locally; their numbers come from the CI run on the head of main.

DECISIONS.md ("Post-v0.2 issues", lines 272 onward) carries the reasoning for #32, #34, #35, #37, #33 and the later entries for #18, #49 and #52; #36's entries sit earlier, at lines 152-160 under "Phase 6 — UI". Several judgements would be lost without it — notably why the axis split was rejected for per-cabin cells, why progressive per-program fill cannot be built against this API, and the scopeWhere `notLike(program,'%#filtered')` trap that made min_cabin_pct a cache-scope change rather than a UI one.

Relevant absolute paths: /Users/yegaoyang/Desktop/workspace/awardgrid/DECISIONS.md, /Users/yegaoyang/Desktop/workspace/awardgrid/.github/workflows/ci.yml, /Users/yegaoyang/Desktop/workspace/awardgrid/e2e/matrix.ts, /Users/yegaoyang/Desktop/workspace/awardgrid/e2e/axe.spec.ts, /Users/yegaoyang/Desktop/workspace/awardgrid/scripts/screenshot-index.ts, /Users/yegaoyang/Desktop/workspace/awardgrid/docs/UI_PLAN.md.
---

## 2. For the next agent

### 2.1 Read these first, in this order

`README.md` (what it is, how to run it) → `ARCHITECTURE.md` (the two lanes and the data model) → `DECISIONS.md` (why anything is the way it is; newest at the bottom) → `docs/UI_PLAN.md` (binding for anything visual) → `BACKLOG.md` (what was deliberately not done).

`DECISIONS.md` is the important one. Most of what looks arbitrary in this codebase is a recorded decision with a reason, and several of them are decisions *against* the obvious thing.

### 2.2 The environment will waste your first day if you let it

- Use the arm64 Node, not the system one. `/usr/local/bin/node` is v22.16.0 **x64** (Rosetta) and pnpm is not on the default PATH at all — I verified `@node-rs/argon2` fails there with "Cannot find native binding" while it loads fine under `~/.local/node-arm64/bin/node` (v22.23.2 arm64, pnpm 12.3.4). Fix, in every shell before anything else: `export PATH="$HOME/.local/node-arm64/bin:$PATH"`. (better-sqlite3 happens to load under both; argon2 does not, so auth/session tests die first.)

- `pnpm find` is not this repo's CLI. pnpm ≥ 10 reserves it for registry search and builtins beat package.json scripts — verified: `pnpm find` prints `ERR_PNPM_MISSING_SEARCH_QUERY … Usage: pnpm search <keyword>`. Use `pnpm grid "<query>"` (same script) or `pnpm run find`.

- `pnpm test` is not reliably green on this Mac even though CI is. Two runs of the unmodified tree gave two different failures, both the 15 s `testTimeout` in vitest.config.ts:15: `scripts/build-plugin.test.ts` "output is deterministic" (a second full plugin build, 27.4 s observed) and `src/app/api/auth/auth-routes.test.ts:255` "a successful login resets the counter" (20 argon2id hashes at 64 MiB). The same commit is green in CI (run 34154055151). Re-run the single file before believing a red; do not "fix" the code for these two.

- `pnpm e2e` is a long trip: ~11 min locally (FINAL_REPORT.md:146 — 14 specs, 600 tests, 484 passed / 116 skipped) and 23 min in the CI e2e job, with `workers: 1` and `fullyParallel: false` (playwright.config.ts:89-90). Run `pnpm build` first; otherwise `e2e/start-app.sh` runs `next build` inside the webServer start-up window (600 s budget).

- Two `pnpm e2e` runs in one checkout destroy each other: fixed ports 3400 (app) and 3999 (mock), one throwaway SQLite at `os.tmpdir()/awardgrid-e2e/e2e.db` deleted and re-seeded with `--fresh` on every start (e2e/start-app.sh), and `test-results/` cleared. Worse than a crash: `reuseExistingServer: !isCI` (playwright.config.ts:68,78) means the second run silently attaches to the first run's app server and tests the other tree's build.

- Parallel work = one git worktree per topic **plus three env overrides**, not just a branch. `git worktree add ../awardgrid-<topic>`, then `git submodule update --init --recursive` in it (`vendor/travel-hacking-toolkit` is a submodule and `pnpm build:plugin` reads it; CI checks out with `submodules: true`), then export `E2E_APP_PORT`, `E2E_MOCK_PORT` **and** `E2E_DB_PATH` (playwright.config.ts:20-25). Ports alone are not enough — the DB default lives in the shared `os.tmpdir()`, so two worktrees still fight over one SQLite file. The mock port is propagated for you (`MOCK_SEATS_PORT=${MOCK_PORT}` in the webServer command).

- Visual baselines are Linux-only and there is no platform suffix in the path (`snapshotPathTemplate`, playwright.config.ts:97). The 24 committed PNGs are `e2e/__screenshots__/{desktop-light,desktop-dark,mobile-light}/visual.spec.ts/*.png`. macOS rasterises fonts differently, so `VISUAL=1 pnpm e2e:update` on this Mac produces baselines that are guaranteed to fail CI — useful to look at, never to commit. Rebaseline the documented way: push, let the `visual` job run, download its `visual-snapshots` / `visual-baselines` artifact, unzip into `e2e/__screenshots__/`, commit with the reason in the message.

- The `visual` CI job is BLOCKING as of f130177 (#33). `continue-on-error` now survives only on the one-off bootstrap generate path in .github/workflows/ci.yml; the comparison step has none, so a pixel diff turns the job red and blocks the merge. Current state on main is genuinely green: run 34154055151's visual job = 24 passed / 8 skipped in 2m16s, and no baseline is pending despite the rebaseline DECISIONS.md predicted for #52.

- Do not compare a whole-suite VISUAL run against CI's numbers. CI runs `VISUAL=1 pnpm e2e -g visual` alone on a freshly seeded DB; locally `VISUAL=1 pnpm e2e` first runs the drawer specs, which click "Show flights" and write a learned fee into the shared per-user cache (DECISIONS "#52"), so the cell-drawer shots legitimately differ. Reproduce CI's conditions with `-g visual` before calling anything a regression.

- Every screenshot has one declared owner, enforced in CI. `pnpm exec tsx scripts/screenshot-index.ts --strict --check` is a required step in the `checks` job; I ran it on the current tree — 298 PNGs, 27.6 MB, exit 0. A PNG under `docs/screenshots/v0.2/` that is not declared in `e2e/matrix.ts`, or a name breaking `<page>/<state>-<viewport>-<theme>[-zh].png`, fails the build. To add a capture: add a `MatrixShot` in e2e/matrix.ts and, if the state is new, a helper in e2e/states.ts — never a `page.screenshot()` in a feature spec.

- `.env` here holds only `MASTER_KEY`, `DATABASE_PATH`, `APP_URL`, `COOKIE_SECURE` — no `ANTHROPIC_API_KEY` and no seats.aero key. `set -a && . ./.env && set +a` therefore gives you nothing for the Ask or parser lanes (issue #12 was corrected for exactly this). Also: `next dev`/`next start` read `.env` themselves, the tsx CLIs (`pnpm grid`, `admin`, `worker`, `db:migrate`) do not — export first.

- **Two `pnpm worker` processes have been running on this Mac since 2026-09-06 05:17** — left over from an earlier session, ticking every minute against `data/runtime/awardgrid.db` (the real one from `.env`, not the e2e throwaway) and holding a 366 KB WAL open. They are harmless: mock transport, `"considered":0,"due":0` on every tick, no saved query in that database. But they explain scheduler ticks appearing in logs you did not start, and they hold the runtime SQLite. `ps aux | grep '[s]rc/cli/worker.ts'` finds them; killing the two `node-arm64` PIDs is safe and `pnpm worker` restarts one.

- gitleaks runs on every commit of a PR, not just the tip, so a hex- or `sk-`-looking literal you push and then remove still fails the scan (squash before re-pushing). Keep fake credentials low-entropy the way the harness does: `"e".repeat(64)` for the e2e master key, `demo-key-normal`, `demo-password-1`.


### 2.3 House rules

These are enforced by the repo, not by taste. A change that breaks one will be caught, but knowing them first saves a round trip.

- Decisions are recorded in DECISIONS.md, in its own voice, and never rewritten. The format is stated at the top of the file: `- **topic**: decision. _Why:_ rationale.`, newest at the bottom. Post-v0.2 work also gets a long-form `### #NN <title>` section explaining what was rejected and why. Superseded entries are amended in place (strikethrough plus "_Amended by issue #NN_"), not deleted — see the `min_cabin_pct` and `visual` job entries.

- Deferred work is filed as a GitHub issue, not left as prose. BACKLOG.md carries a one-line entry ending in the issue number and the source of the deferral; the closing commits for each phase (`docs: close out the UI phase — v0.2.0 released, deferred items filed as issues`) are literally that filing step. A finding you cannot act on now becomes an issue with the file:line evidence in it.

- Commit-message register: lowercase type prefix (`feat:`, `fix:`, `ci:`, `docs:`, `test:`, `ui:`), then a plain declarative sentence in the same voice as the docs ("the queries table's columns stopped following the clock"), no emoji, no imperative shouting, ending with the issue number and then the PR number — `feat: write Get Trips fees back into availability_cache (#52) (#58)`. One PR per issue, squash-merged to main.

- The test follows the UI, not the reverse. DECISIONS.md:233 records this explicitly ("`before.spec.ts` follows the UI it photographs") — when the UI legitimately changes, the spec's assertion is updated to the new truth; a UI detail is never bent to keep a green assertion. The paired case: `e2e/keyboard-walk.spec.ts` and docs/UI.md §8 are one contract — change a step in one and you change it in the other.

- e2e selectors are roles and visible text, never `data-testid` (e2e/README.md:104). If a state is hard to select, that is usually a missing accessible name, which is also an axe finding.

- One owner per screenshot (#34): `e2e/screenshots.spec.ts` writes every capture under docs/screenshots/v0.2/ from the single declaration in `e2e/matrix.ts`; feature specs assert but photograph nothing, and there are no per-feature folders. The frozen `before/` record of the v0.1 UI is never regenerated.

- Visual baselines are only ever generated on Linux CI, and the commit that moves one says why in its message ("visual: rebaseline — cell line height changed in <PR>").

- Never invent an API field, parameter or SDK option (kickoff §0.2 #7). Where the docs are silent the repo records an explicit assumption instead of guessing — `ComputedLastSeen` else `UpdatedAt`, `TotalDuration` shown as an opaque unit-labelled integer, the quota reset labelled "assumed 00:00 UTC". Tighten one of those only against a recorded real response.

- Tests must pass with no network and no keys, and must not depend on what time they run. Two clock-dependent defects reached main before the visual job became blocking (see DECISIONS "#33"); date-sensitive fixtures are shifted relative to an injected today, and TZ is pinned to UTC in vitest.config.ts and playwright.config.ts.

- Fake secrets stay low-entropy so gitleaks stays quiet, and nothing real is ever on a screenshot: the e2e master key is 64 × `e`, the passwords are `demo-password-1` / `password123`, and the seeded seats.aero keys (`demo-key-normal`, `demo-key-slow`, …) are scenario selectors for the mock. Quoting one of those literals in a **root** file is a merge blocker in a way that is easy to miss: `next.config.ts` excludes root markdown from `.next/standalone` **by name**, so a new root `.md` is traced into the build output and `scripts/check-no-secrets-in-bundle.sh` greps it. This very document failed CI that way and had to be added to `outputFileTracingExcludes`.

- UI work is bound by docs/UI_PLAN.md and the tokens in src/styles/tokens.css: achromatic tokens plus the freshness colours only, no shadows, no logos, wordmarks or brand colours anywhere, sentence case in both languages, and "Data: seats.aero" stays visible. New copy goes through docs/COPY.md's glossary and both dictionaries — `src/lib/i18n/i18n.test.ts` fails on unequal key sets or mismatched placeholders (592 keys each today).

- The accessibility floor is enforced, not aspirational: `e2e/axe.spec.ts` asserts zero serious or critical WCAG 2.x A/AA violations by default across desktop-light, desktop-dark and mobile-light, and writes the per-impact counts to docs/screenshots/v0.2/axe-summary.json (currently zero at every impact). `E2E_AXE_STRICT=0` is a reporting escape hatch for debugging, not a way to land a violation.


### 2.4 The open work

Twelve open issues. Five need nothing but time; seven are waiting on something only the owner can supply. I would take them in this order.

#### Unblocked — start here

##### #47 — Standing queries freeze their dates and go silent within 92 days  <sub>(a day)</sub>

**First change.** src/lib/scheduler/run.ts:261-262 — after `QueryObject.parse(JSON.parse(savedQuery.queryJson))` and before the `findGridForUser` call at :272, re-anchor `date_from`/`date_to` from `now` when the new `offset_from`/`offset_to` columns are set; add them in a new `drizzle/0003_*.sql` (0002_query_runs_calls_used.sql is the current head) beside `query_json`.

**Watch out.** The migration is the easy half; the diff semantics are the trap. Once the window rolls, yesterday's first date is gone by construction, so `diffSnapshots` reports it as `dropped` and `shouldNotify` (run.ts:131-142, used at :316) would fire a false 'price drop / gone' digest every day. Define dropped as dropped *inside the overlap* before writing the migration. Absolute dates must stay the default so no existing saved query changes behaviour.

##### #48 — Mobile grid: re-measure the query block against §6.4's two-chip-row budget  <sub>(hours)</sub>

**First change.** e2e/responsive.spec.ts — at `NARROW` (:31), beside the existing `cellShape` evaluator (:51), add one test that reads `getBoundingClientRect().top` of the first `td[role="gridcell"]` at 390×844 and asserts it against §6.4's budget.

**Watch out.** Measure before editing any layout: the 56 % figure still sitting in BACKLOG.md predates two fixes (`rows={1}` textarea at query-bar.tsx:88, one truncated "Parsed from" line at :113-118), so it is not current. If the number is now inside budget, close the BACKLOG line with the measurement. If it is not, the remaining cause is the eight chips wrapping — and moving chips into the Filters sheet contradicts UI_PLAN §6.4's promise that the chips are the single visible source of truth, so that is a UI_PLAN amendment and its own decision, not a polish edit.

##### #15 — Deeplinks for non-AA programs  <sub>(more than a day)</sub>

**First change.** src/lib/grid/deeplinks/index.ts:70 — `resolveDeeplink` returns `{ url: null, kind: "none" }` today; add a program builder beside the AA one only for a program whose parameterised award-search URL you can cite from the program's own documentation.

**Watch out.** BACKLOG.md calls the current null the boundary-correct answer on purpose: a guessed search URL that 404s is worse than no button, and no URL may be discovered by scraping a program site (§0.2 #1). Also note the interaction with #52: `resolveDeeplink` prefers a stored `row.booking_url` over every program builder, so a new builder will not appear on cells that learned a seats.aero link.


#### Blocked on the owner

Each of these is stalled on a credential, a purchase or a machine. None of them is stalled on engineering. They are listed with what has to arrive first, because a coding agent cannot unblock any of them and should not start one.

##### #50 — `cell.best` is best-across-cabins, so Per cabin shows two prices and everything else names one  <sub>(more than a day)</sub>

**Blocked by.** Not technically blocked, but the honest fix needs an owner decision: making `best` cabin-aware changes what the standing-query diff and the Telegram digest consider a change.

**Then the first change is.** Decide the shape first, then edit src/lib/grid/pivot.ts:163-180 (where the single `best` row is chosen) — or, for the cheap option, leave `best` alone and make only the per-cabin-visible surfaces cabin-aware via the existing `bestPerCabin` helper (pivot.ts:110): `gridStats.cheapest` (:291-292), the CSV `best` flag (src/lib/grid/csv.ts:77,103) and the cell's freshness tier (src/components/grid/cell.tsx:178,266).

**Watch out.** The cheap option touches no persisted snapshot and no baseline semantics; the full option ripples into `query_runs.cells_json` and the digest, which is precisely why #35 deferred it. Either way the drawer's lead program and the Ask context pill must agree with what the cell is showing, and the change moves committed Linux visual baselines — plan the CI rebaseline into the same PR.

##### #14 — Write the live parser harness (then verify the model choice against it)  <sub>(more than a day)</sub>

**Blocked by.** Steps 1-2 are keyless. Only step 3 is blocked on the owner for an Anthropic key from console.anthropic.com (a few cents); the host session's OAuth token cannot substitute.

**Then the first change is.** New `scripts/parser-smoke.ts` gated exactly like scripts/ask-smoke.ts:127-131 (`AWARDGRID_LIVE_SMOKE=1` + a real key, skip otherwise), driving the real parser over `test/fixtures/queries/cases.json`; then add free-form bilingual cases that the deterministic parser is supposed to fail on.

**Watch out.** The issue's original wording is wrong and was corrected: there is no harness to run a key against — `test/query/cases.test.ts:51,75` always injects a fake parse client, and only 2 of 36 cases touch the LLM branch at all. Writing the cases is the cost, not the runner. There is a clock: DECISIONS.md pins `claude-haiku-4-5-20251001` with a retirement horizon of no sooner than 2026-10-15 and nothing verifies it can still return a valid QueryObject.

##### #12 — Live Ask smoke with a real ANTHROPIC_API_KEY  <sub>(hours)</sub>

**Blocked by.** Blocked on the owner for a console.anthropic.com API key (≤ $0.50 for the run). A Claude subscription/OAuth token cannot be used: src/lib/ask/options.ts:90-96,123 rebuilds the subprocess env from a fixed allowlist. The current credential returns 403 `Request not allowed`.

**Then the first change is.** Do the keyless half first: add a `--dry-run` to scripts/ask-smoke.ts before the gate at :127-131 that builds the plugin and prints `buildSessionEnv`'s key *names* plus the tool gate's verdicts on a canned tool list — that catches plugin/option regressions today and shortens the paid run to one command.

**Watch out.** What is unproven is not the plugin pruning (test/ask/init-assertions.test.ts already asserts a recorded real init message) but that the gate ever *allows* a useful call: in the recorded fixture `gate_decisions` and `tools_used` are both `[]`, so the Ask lane could stream nothing and the suite would stay green. Success = `smoke-result.json` with `subtype: "success"`, `cost_usd > 0`, `mentions_program` and `mentions_transfer_partner` true. Never print or commit the key.

##### #13 — Record real seats.aero fixtures with a Pro key (≤ 40 calls)  <sub>(a day)</sub>

**Blocked by.** Blocked on the owner for a seats.aero Pro key; `SEATS_AERO_API_KEY` and `SEATS_AERO_API_KEY_TEST` are both unset here. The calls come out of a real 1,000/day quota.

**Then the first change is.** Keyless, and do it before the key arrives: `test/fixtures/seatsaero/availability.json` is literally `{}` (3 bytes, verified) and nothing loads it — hand-build a Bulk Availability envelope and add a schema-shape test that parses it through the zod union at src/lib/seatsaero/types.ts:186, plus a raw `--record` path so the paid session captures envelopes rather than rendered grids.

**Watch out.** FINAL_REPORT.md:64's recording command cannot produce a fixture: `pnpm grid --json` emits the normalised grid document (src/cli/find-main.ts:382-393), not the raw Cached Search envelope the fixtures are in — following it literally wastes the paid session. Use curl. Scrub ids before committing, and take the /routes timing for #51 in the same sitting.

##### #51 — Measure the real routes-phase latency, then decide on the one honest flush  <sub>(more than a day)</sub>

**Blocked by.** Blocked on the owner for the same seats.aero key as #13 — the gate is a live cold-run measurement of per-call `/routes` latency (below ~77 ms per call the phase is under 2 s and no second transport is justified).

**Then the first change is.** No product code yet: time the serial `/routes` walk that `ResilientRoutesCatalog.ensureLoaded` performs (src/lib/seatsaero/routes.ts:143-166, one `client.getRoutes(source)` per source, driven from src/lib/server/find.ts) against the live API with a real key, in a scratch script.

**Watch out.** Do not build the transport first. `POST /api/find/stream`, the `onRowsSettled` hook and `buildGrid`'s `pending_routes` option are designed on paper and exist nowhere in src/ — building them before the measurement is the failure mode this issue was written to prevent. The flush is only honest at that boundary: the rows are already final, so it costs no quota, writes no cache record and revises no number.

##### #11 — Docker local smoke: run docker compose build/up on a dev machine  <sub>(hours)</sub>

**Blocked by.** Blocked on the owner for a machine with Docker + Compose installed; Docker is not on this Mac.

**Then the first change is.** No edit — run `docker compose build && docker compose up -d` with **no service name**, then `curl -fsS localhost:3000/api/health`, `docker compose logs worker`, `docker compose down -v`. `.env` must exist (docker-compose.yml:14,31 declare `env_file: .env`); the local one already has `MASTER_KEY`.

**Watch out.** `up -d app` proves nothing about the thing under test — the worker container is the surface no test touched. CI now starts both and greps for `"event":"worker.start"` with `"transport":"mock"` (commit 06d4476), so this is a confirmation on real hardware rather than a discovery; expect `worker.start` plus the mock transport line, and do not let a real `TELEGRAM_BOT_TOKEN` into that `.env` or the smoke will send a message.

##### #20 — Telegram real-bot check  <sub>(hours)</sub>

**Blocked by.** Blocked on the owner for a real bot token from @BotFather (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME`). No seats.aero key is needed — the mock accepts any `Partner-Authorization` (scripts/mock-seatsaero.ts:240).

**Then the first change is.** No edit — run the three-terminal recipe in the issue (mock, app, worker, all with the arm64 Node on PATH), link the chat in Settings, then save a query and press Run now twice with the stored seats.aero key switched from `demo-key-partial` to `demo-key-normal` between the runs.

**Watch out.** One worker tick can never produce a digest: the first run of a saved query returns `first_run` and only sets the baseline (src/lib/scheduler/run.ts:311). You need two runs with a change between them, which is what the key swap manufactures. This is the only delivery path in the product that has never run for real, so read the message itself — link markup and HTML escaping are what it proves.

##### #16 — cpp_desc sort (needs a Duffel cash reference)  <sub>(more than a day)</sub>

**Blocked by.** Blocked on the owner for a Duffel account and API key; `cpp_desc` needs a cash reference fare per cell and there is no source for one in the repo.

**Then the first change is.** `FutureSortBy` in src/lib/query/schema.ts and `isImplementedSortBy` in src/lib/grid/ranking.ts already reserve the value — the sort comparator in ranking.ts is where it would land, once a fare source exists.

**Watch out.** The shape is the problem, not the comparator: a cents-per-point sort needs one cash fare *per cell*, i.e. a second per-cell API fan-out on top of the seats.aero quota, for a grid that can be 31 dates × 7 pairs. Price that (and its interaction with boundary §0.2 #6, no money) before writing anything.

##### #17 — Release-window standing-query mode (timed refinement)  <sub>(more than a day)</sub>

**Blocked by.** Blocked on the owner for a verified (seats.aero source → release day offset → local time-of-day → IANA zone) table for 26 sources, with provenance. The only such data on disk is `vendor/travel-hacking-toolkit/data/sweet-spots.json` `booking_windows`: 12 airline names, day offsets only, no time or zone, ~170 days stale, read by nothing under src/. It can only come from T&Cs, published notices or the owner's own observation — never scraping.

**Then the first change is.** Do #47 first and stop there: `offset_from = offset_to = 331` on the rolling window it adds is this feature minus the per-program clock, and captures most of the value. Come back here only with the verified table.

**Watch out.** The scheduler cannot express local-timezone firing at all — src/lib/scheduler/cron.ts matches entirely in UTC (`matchesMinute`, :141-152, all `getUTC*`) with one UTC tick, so this needs a `tz` field in the matcher or a per-timezone tick. Also note the motivating example in BACKLOG was wrong and is fixed: JAL and ANA are not seats.aero sources (src/lib/seatsaero/types.ts:16-43 lists the 26 that are).
---

## 3. The homepage entry point

**Status: specified, not built.** This is a requirement for the next agent, and it carries three questions only the owner can answer — they are at the end, and the third one may make half the work unnecessary.

### 3.1 What exists today

`src/app/page.tsx` is six lines:

```tsx
import { redirect } from "next/navigation";

/** The app has one real page: the grid. */
export default function Home(): never {
  redirect("/grid");
}
```

An unauthenticated visitor is then bounced from `/grid` to `/login` by `src/lib/auth/next.ts:26`. So there is no entry point at all: someone who is sent the bare host lands on a password form that explains nothing — not what this is, not that they need an invite code, and not that they need to bring their own paid seats.aero key.

That last one is a real disclosure gap, not a cosmetic one. `README.md:99` tells the operator to "send them the code and the URL"; the Pro key requirement first appears at step 3, *after* the invitee has created an account against a single-use invite. And the two dictionary strings that would have said so — `auth.login.subtitle` and `auth.register.subtitle` — are referenced nowhere in `src/` or `e2e/`. So is `app.tagline`.

### 3.2 The decision


**Build the hybrid, resolved as a session branch on one route: `/` stays a redirect for anyone who is signed in (`redirect("/grid")`, the single hop it is today), and renders a signed-out arrival page for anyone who is not. Proposal A's page, with three design corrections; Proposal B's answer to "what does a returning user land on" is kept in the only form the code supports — the grid it already was. No new nav item, no wordmark change, no `?text=` param, no `/` in the visual-baseline suite.**

Verified facts decided it. (1) The primary user opens the app to search: today `/` → `/grid` is one hop and `src/app/grid/page.tsx` + `grid-app.tsx` put them in the box immediately. B moves `listSavedQueries` + a per-row `lastRunDiff` (the N+1 `src/app/queries/data.ts` already pays on a page nobody opens under time pressure) onto the search path, and buys back speed only for a user with standing queries. (2) B needs a new `?text=` input surface on `/grid`, contradicts `docs/UI_PLAN.md` §6.1 (wordmark links to `/grid`, three nav items — `NAV_ITEMS` drives the underline, so home would have none), and its "unread" accent is not backed by data: `query_runs.notified` means the Telegram digest went out, not that anyone looked. (3) The signed-out half is cheap and fixes a real disclosure gap I confirmed: `README.md:99` step 2 is "Send them the code and the URL", the Pro key requirement appears only at step 3 (after argon2id + a consumed single-use invite), and the two dictionary strings that would have said so — `auth.login.subtitle`, `auth.register.subtitle` — are referenced nowhere in `src/` or `e2e/` (grep clean), so `/login` says none of it. `app.tagline` is likewise an orphan (`src/lib/i18n/dictionaries/en.ts:16`, `zh.ts:15`, no reference outside the dictionaries). The page costs the signed-in user nothing: they never render it.

### 3.3 The requirement

**Routing** — `src/app/page.tsx` becomes an async server component; nothing else in the routing graph changes (`requireUser` still bounces `/grid` to `/login`; `/login` and `/register` still redirect a signed-in user to `/grid`; no middleware, no route group, no layout change). Shape:

```
  export default async function Home() {
    const user = await getCurrentUser().catch(() => null);   // src/lib/auth/next.ts:16
    if (user) redirect("/grid");
    const { t } = await getT();                              // src/lib/i18n/server.ts
    return (<PageColumn className="py-8"> … </PageColumn>);
  }
```

The `.catch(() => null)` is required and mirrors `src/app/layout.tsx:34`: a SQLite blip must render the front door at the app's root URL, never a 500. No `searchParams` at all (see NOT list). No `export const metadata`: the layout default title "awardgrid" applies; a `title` here would render "Home | awardgrid" through the `%s` template.

Prerequisite, one line, in the same change: wrap `getCurrentUser` in React `cache()` in `src/lib/auth/next.ts`. `layout.tsx:34` already calls it on every request and it is not memoised, so `/` would otherwise do two identical better-sqlite3 session reads per hit (as `/login` and `/register` do today).

**Visitor States** — signed out: the page renders, 200, no redirect. Session cookie absent, expired, revoked or malformed: identical (getSessionUser returns null). Signed in, with a seats.aero key: 307 to `/grid`, one hop, page body never renders. Signed in, no key: also 307 to `/grid`, where the existing `grid.empty.no_key` state handles them — the front door must not duplicate it. Invited, not yet registered: if the operator sent `/register?code=…` they never touch `/`; if the operator sent the bare host (README step 2) they land here, learn they need a code and their own paid key, and click through to `/register`. DB unreachable: the signed-out page.

**Wireframe, 1440 px, signed out** (`PageColumn`, max 880 px, left-aligned inside the 16 px gutters, `py-8`; PageColumn's own `gap-6` supplies the 24 px between blocks):

```
  ┌──────────────────────────────────────────────────────────────┐ 48  signed-out bar: awardgrid …… EN 中文  System
  ├──────────────────────────────────────────────────────────────┤ 1px --line
  │ One question, one grid of award seats                        │ h1, t-title 20/28, --fg
  │                                                              │ 24
  │ Ask in Chinese or English for a set of origins,              │ p, t-body 14/20, --fg, max-w-[72ch]
  │ destinations and dates. awardgrid returns one table: the     │
  │ cheapest award seat in each cell, with the miles, the fees,  │
  │ the seats left, the program that sells it, and how old the   │
  │ data is.                                                     │
  │                                                              │ 24
  │ Invite only                                                  │ h2, t-section 16/24 600
  │ There is no public signup. You need an invite code from      │ 8 below; p t-body
  │ whoever runs this server.                                    │
  │                                                              │ 24
  │ Your own key                                                 │ h2
  │ Every search runs on your own seats.aero Pro key. You add    │
  │ it in settings after you log in. There is no shared key and  │
  │ no server key.                                               │
  │                                                              │ 24
  │ What it does not do                                          │ h2
  │ It reads the seats.aero cache and nothing else. It never     │
  │ opens an airline site for you, and it never asks for an      │
  │ airline or bank password.                                    │
  │                                                              │ 24
  │ ┌──────────┐                                                 │
  │ │  Log in  │   Create account with an invite                  │ 36 px primary (--bg on --fg) + accent link, 16 px gap
  │ └──────────┘                                                 │
  ├──────────────────────────────────────────────────────────────┤ 1px --line
  │ Data: seats.aero │ v0.2.0 │ Legal                            │ 32, unchanged Footer
  └──────────────────────────────────────────────────────────────┘
```

Three corrections to Proposal A's drawing, on the design system's own terms: (a) no horizontal rules between blocks — §4 gives a border only where two kinds of information meet, and §6.8 Settings is the precedent (heading + 24 px space, no rules, no cards); (b) the block labels are `h2` at `t-section` (16/24, 600), not 12 px muted text — §3 has a role for a section heading and a heading below body size is a tell; (c) the paragraphs cap at 72ch, because 880 px at 14 px is ~100 characters.

**Wireframe, 390 px, signed out**: identical single column, 16 px gutters, nothing reflows except the action row — the primary button is full width and the register link becomes its own row under it, each ≥ 40 px:

```
  │ One question, one grid of award seats     │ h1 wraps to two lines
  │ Ask in Chinese or English for a set of …  │
  │ Invite only / There is no public signup…  │
  │ Your own key / Every search runs on …     │
  │ What it does not do / It reads the …      │
  │ ┌───────────────────────────────────────┐ │ 40 px, full width
  │ │               Log in                  │ │
  │ └───────────────────────────────────────┘ │
  │ Create account with an invite             │ 40 px row, --accent
  │ Data: seats.aero │ v0.2.0 │ Legal         │ footer already grows to hold its 40 px target
```

**Markup** — both controls are `Button` with `nativeButton={false} render={<Link href="…" />}` (the precedent is `src/components/queries/SaveQueryDialog.tsx:162`). This matters for the touch floor: that primitive emits `data-slot="button"`, which `src/app/globals.css:262` grows to `--row-touch` (40 px) under `(max-width: 767px), (pointer: coarse)`; a bare `<a className="link">` in `<main>` is covered by no rule there and would fail `e2e/responsive.spec.ts`'s measured floor. Primary: `<Button size="lg" nativeButton={false} render={<Link href="/login" />}>` (h-9, matches the auth submit at `auth-form.tsx:161`), `className="w-full md:w-auto"`. Secondary: `variant="link"` with `render={<Link href="/register" />}`.

**Strings** — nine new keys, en and zh, plus one reuse. Reused unchanged: `app.tagline` — en "One question, one grid of award seats" / zh 「一句话，一张里程票表格」 — becomes the `h1` and stops being an orphan. The footer's `footer.attribution` / `footer.version` / `footer.legal` render as they already do; the page does not repeat "Data: seats.aero".

```
  home.lead
    en  "Ask in Chinese or English for a set of origins, destinations and dates. awardgrid returns one table: the cheapest award seat in each cell, with the miles, the fees, the seats left, the program that sells it, and how old the data is."
    zh  「用中文或英文写下出发地、目的地和日期。awardgrid 返回一张表格：每格是最便宜的里程票，含里程数、税费、余位、售票的里程计划，以及数据的新鲜程度。」
  home.invite.label   en "Invite only"          zh 「仅限邀请」
  home.invite.body    en "There is no public signup. You need an invite code from whoever runs this server."
                      zh 「没有公开注册。你需要本站管理员提供的邀请码。」
  home.key.label      en "Your own key"         zh 「你自己的密钥」
  home.key.body       en "Every search runs on your own seats.aero Pro key. You add it in settings after you log in. There is no shared key and no server key."
                      zh 「每次搜索都使用你自己的 seats.aero Pro 密钥。登录后在设置里添加。本站没有公用密钥，也没有服务器密钥。」
  home.limits.label   en "What it does not do"  zh 「它不做的事」
  home.limits.body    en "It reads the seats.aero cache and nothing else. It never opens an airline site for you, and it never asks for an airline or bank password."
                      zh 「它只读取 seats.aero 的缓存数据。它不会替你打开航司网站，也不会索取航司或银行密码。」
  home.login_link     en "Log in"                        zh 「登录」
  home.register_link  en "Create account with an invite" zh 「用邀请码创建账号」
```

"after you log in" is deliberate: §8's same-verb rule ("Log out", never "Sign out") runs the other way too. The two control keys are named `home.login_link` / `home.register_link` because `CONTROL_KEY_PATTERNS` in `src/lib/i18n/copy-allowlist.ts` already ends with `(\.|_)(…|register_link|login_link|…)$` — both start with a capital and carry no trailing period, so `copy-rules.test.ts` passes with **no allowlist edit**. Checked clause by clause against that test: no ALL-CAPS token of 4+ letters, no `→`/`->`, no " · ", no "...", no please/sorry, no `—` in en and no `——` in zh, no two adjacent plain-capitalised words (awardgrid, seats.aero and Pro are already in `PROPER_NOUNS`), zh uses only full-width punctuation adjacent to CJK and ends every sentence with 「。」, every zh value contains CJK.

**Empty And Error States** — the page reads no user data, so it has no empty state, and that is the specification, not an omission: nothing on it varies by user, key, quota or locale beyond the two dictionaries. The three failure modes it does have: (1) session lookup throws → the `.catch(() => null)` above renders the signed-out page; (2) a signed-in user whose session expires between the layout's read and the page's read → the cached lookup makes both reads the same value, so the two cannot disagree within a request; (3) no JavaScript → the whole page works (server-rendered text and two links); only the header's locale and theme toggles need JS, exactly as on `/login` today. There is no client component, no fetch, no `role="status"`, no toast.

**A11y Floor** — exactly one `h1` (the tagline); three `h2`s after it in DOM order, no level skipped; landmarks come from the layout (`header` / `main` / `footer`), so the page adds none. Reading order equals visual order; the only tab stops in `main` are the two links, in the order Log in → Create account. Focus is the global 2 px `--accent` ring at `:focus-visible`, offset 1 px. Colour: `--fg` body, `--fg-muted` nowhere required, `--accent` on the register link only (6.09:1 light / 8.04:1 dark per §2), `--bg` on `--fg` for the primary button. Nothing conveys meaning by colour alone; there is no image, no icon, no glyph appended to any label. 40 px minimum target on `(max-width: 767px), (pointer: coarse)` for both links. `html lang` is set by the layout from `ag_locale`. No motion of any kind on this page, so `prefers-reduced-motion` needs no handling. Floor: zero serious or critical axe violations on desktop-light, desktop-dark and mobile-light.

**Test Surface** — add three `axe.spec.ts` entries under one `test("home")` (the file's harness runs each audited project). Extend `e2e/responsive.spec.ts` with a signed-out `/` case in the 40 px touch-target test, the 390 px overflow test and the zh-leak test — its `PAGES` loops call `loginAs`, so `/` needs its own signed-out test rather than an entry in that array. Do **not** add `/` to `e2e/visual.spec.ts` (its `toHaveScreenshot` baselines are Linux-CI-only) and do not declare it in `e2e/matrix.ts` unless the PNGs land in the same commit — `scripts/screenshot-index.ts --strict --check` fails on a declared-but-missing capture (`screenshot-index.ts:122`). No existing test navigates to `/`, so nothing breaks.

**Deliberately Not On The Page** — an explicit cap: one title, one lead, three blocks, two links, and no more. Not on it, each for a reason: no screenshot or example grid; no feature list, changelog or roadmap; no user count, testimonial or "free"; no price, no plan comparison, no link to seats.aero's pricing page (naming the Pro plan in plain text is the prerequisite disclosure — linking to where it is sold is the funnel boundary 6 forbids); no contact form, no email address, no mailing list, no analytics, no cookie banner; no airline or program logo, wordmark or brand colour, and no program name at all; no `?code=` forwarding (an invite code is a single-use secret and a redirect hop writes it into the access log of the app's root URL — the operator keeps sending `/register?code=…`, and `/?code=…` is simply ignored, never read, never rendered, never logged); no session-dependent content of any kind (no quota line, no "you still need a key" banner, no recent searches — there is no table for those: `src/lib/db/schema.ts` records no ad-hoc find); no `footer.caveat` on this page (it is pinned by `src/lib/notify/format.test.ts` for the Telegram digest, and a caveat belongs where a number is shown); no marketing subtitle under any heading beyond the three factual blocks; no change to the top bar, the footer, `NAV_ITEMS`, the wordmark's `/grid` target, or `robots: { index: false, follow: false }`.

### 3.4 Acceptance criteria

Each of these is checkable by a test or by a reviewer looking at the diff.

1. GET / with no session cookie returns 200 and renders an h1 whose text is app.tagline in the request locale (en and zh both asserted); no redirect, no Location header.
2. GET / with a valid session cookie returns a single 307 to /grid — asserted for a user with a seats.aero key and for the `nokey` fixture user — and the front-door markup never appears in the response body.
3. GET / with an expired, revoked or malformed session cookie renders the signed-out page: 200, no redirect, no 500, no loop.
4. getCurrentUser in src/lib/auth/next.ts is wrapped in React cache(); a unit test with a stubbed db asserts two calls inside one request scope perform one session lookup.
5. Forcing the session lookup to throw makes GET / render the signed-out page rather than an error page (mirrors the .catch at src/app/layout.tsx:34).
6. pnpm vitest src/lib/i18n passes unchanged with the nine new keys present in both dictionaries, identical key sets, and zero edits to src/lib/i18n/copy-allowlist.ts.
7. app.tagline is referenced by src/app/page.tsx: grep for "app.tagline" outside src/lib/i18n/dictionaries returns at least one hit.
8. axe on /: zero serious or critical violations on desktop-light, desktop-dark and mobile-light, recorded under a `home` key in axe-summary.json.
9. The page has exactly one h1 and three h2s, in source order title → Invite only → Your own key → What it does not do, with no skipped heading level.
10. At 390 px and under (pointer: coarse), every interactive element on / measures at least 40 px on both axes using responsive.spec.ts's existing smallTargets helper, and document.scrollWidth is not greater than innerWidth.
11. With ag_locale=zh, no English dictionary value is visible on / (the existing leak-candidate check, run signed out) and <html lang> is zh-CN.
12. src/app/page.tsx contains no "use client", declares no searchParams parameter, imports nothing that is a client component, and issues no fetch or API call.
13. The new file uses only design tokens: no hex colour, no shadow utility, no bg-accent, no border on any block, no icon or glyph, and both controls render through Button with nativeButton={false} render={<Link/>} so they carry data-slot="button".
14. GET /?code=SOMETHING renders byte-identical markup to GET / and the value appears in no log line and nowhere in the DOM.
15. pnpm exec tsx scripts/screenshot-index.ts --strict --check still passes, and e2e/visual.spec.ts gains no new toHaveScreenshot baseline.
16. A signed-in user's path to a search is unchanged: an e2e run that logs in and opens / reaches the grid query box in one navigation, as it does today.

### 3.5 Plan amendment

Needed, three small edits. (1) Add §6.10 "Front door (/)" with the two wireframes above and the rule that the page is signed-out only, capped at one title, one lead, three blocks and two links. (2) Amend §8's removal note — "Page subtitles that explain the product … are removed; a page title needs no pitch under it" — with a scoped exemption: the ban stands on every page a user reaches after signing in; the front door is the one screen where the product has not been explained anywhere else, and its blocks are constraints and limitations, never benefit claims. Without this the page reads as a contradiction of a rule the plan states twice (§8 and §10, Headings row). (3) Add to §11: `/` branches on the session (signed in → /grid, unchanged; signed out → the front door); §6.1 is untouched — the wordmark still links to /grid, the nav stays three items, and `/` has no nav underline because it is not a signed-in destination; `getCurrentUser` becomes `cache()`-wrapped; `/` is deliberately absent from the §9 capture matrix and the visual subset, with the reason (a static text page audited by axe and the responsive floor, against Linux-only baselines the dev host cannot regenerate).

### 3.6 Three questions for the owner

These are decisions I should not make for you. The third one is the one to answer first — a "no" to it makes most of §3.3 unnecessary and replaces it with a one-line change.

1. Should `/` be reachable at all without a session? README.md:206 binds port 3000 to 127.0.0.1 behind Tailscale or Cloudflare Access and layout.tsx sets robots index:false, so this is never a public page — but it does state to anyone who clears the perimeter that this instance exists, is invite-only, and needs a paid key. The alternative is one line, `redirect(user ? "/grid" : "/login")`, which also fixes today's double hop. This is a privacy call, not a design one.

2. When you add a friend, do you send the bare host or always /register?code=…? README step 2 says "the code and the URL", which is what gives this page an audience. If you always send the prefilled register link, the page has no visitor and the one-line redirect above is the right build.

3. Is naming "seats.aero Pro" in plain text, with no link and no price, the disclosure you want? It is the one place the page touches money, and boundary 6 forbids going any further — but a friend who reads it still has to go find out on their own what the plan costs.
---

## 4. Two things I got wrong, so you do not repeat them

**A baseline prediction is not a baseline measurement.** Twice in this batch a change predicted that Linux visual baselines would move — twelve of them in #56, one in #58 — and both times the blocking visual job compared 24 and passed. Both predictions were made on macOS by simulating the state. The only trustworthy measurement of a Linux baseline is a Linux run, which means: push, read the job, and *then* decide.

**Read the run you think you read.** The first ledger I posted on #33 recorded `974983e` as green; it was 2 failed. I had read that commit's *pull request* run instead of its *main* run. The correction is in the issue. When a claim rests on a CI number, name the run id you read it from.

---

## 5. If you only do one thing

Answer question 3 in §3.6 — whether `/` should be reachable without a session at all. If the answer is that you always send friends `/register?code=…`, then the front door has no visitor, and the right change is one line:

```tsx
export default async function Home() {
  const user = await getCurrentUser().catch(() => null);
  redirect(user ? "/grid" : "/login");
}
```

which also removes today's double hop for signed-out visitors. If the answer is that you sometimes send the bare host, build §3.3.

Either way, #47 is the open issue that matters most: standing queries freeze their dates, so within 92 days every one of them returns an empty grid, reports every cell as dropped, sends no notification, and records a clean run. Nothing in the product is 92 days old yet. That is the only reason it has not happened.
