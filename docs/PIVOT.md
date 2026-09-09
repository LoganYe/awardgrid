# awardgrid as a client app — transition specification

Written 2026-09-09 against `568b9ae` as a brief for a separate session.

**Status, updated 2026-09-10.** Phases 0 and 1 are built; §0 is still unanswered.

| | |
|---|---|
| **§0 — does seats.aero permit distribution?** | **Still open.** No email sent. It gates distribution, not development. |
| **Phase 0 — the native-HTTP premise** | **Done, and it holds.** `docs/PHASE0.md`; spike in `spikes/phase0-native-http/`. Two findings changed the Phase 2 design: `AbortSignal` does not cancel the native request (an abandoned search still spends quota), while `readTimeout`/`connectTimeout` do work and are the fix. |
| **Phase 1 — the package split** | **Done.** `packages/core` holds the six modules; its 281 tests moved and pass unedited (`git diff --find-renames` shows pure renames). The boundary is lint-enforced both ways. Rationale in `DECISIONS.md` § "Phase 1". |
| **Phases 2–5** | Not started. |

Everything below is the original specification, kept as written. Where the build measured
something the spec inferred, the phase document says so — §2's note that `AbortSignal` may not be
honoured is now a measurement, not a caution.

The proposal, in the owner's words:

1. Every user installs an app and runs it on their own API keys (seats.aero + Claude).
2. The landing page becomes a static site whose only job is driving people to the App Store.
3. Landing page and app get a new design — modern, clean, consistent between them.
4. `https://restful.dowhiz.com` is the design reference.
5. A web version stays possible, unhosted, calling the API locally.

---

## 0. The question that gates everything, and it is not technical

seats.aero's Partner API is licensed for **non-commercial personal use**. The repository's own
vendored copy of their documentation says it twice:

> "The Seats.aero partner API can be used by Pro users for non-commercial purposes and only by
> written agreement for commercial use."
> — `docs/reference/seatsaero/getting-started-p.md:13`

> "The partner API is governed by the Seats.aero terms of use, which prohibit commercial use of
> our APIs without written permission."
> — `docs/reference/seatsaero/getting-started-p.md:25`

`LEGAL.md:3` grounds this entire product on that basis: *"a personal, non-commercial tool for its
author and fewer than ten friends."* Today that claim is true. An App Store listing makes it false
— publicly, in writing, in a place seats.aero can read.

Three facts sharpen it:

- **seats.aero ships its own iOS app** (App Store `id6449265212`). This pivot enters their category,
  against their own free-tier client, on their data.
- **Their sanctioned third-party path is OAuth**, not key-paste — users "look for a 'Connect
  seats.aero' option … logging in and authorizing access". That flow needs a server-side client
  secret, and caps unapproved apps at a small user count. It structurally requires the host this
  pivot exists to delete.
- **A paid app removes all ambiguity.** Restful, the design reference, is USD 2.99. Charging for an
  app whose only function is querying their non-commercial API is commercial use by any reading.

**Do not write code before this is answered.** One email to `support@seats.aero` describing the app
and asking whether distributing it is permitted, and on what terms. Every engineering decision below
is downstream of the answer, and a "no" makes most of this document moot.

---

## 1. What was measured

Not inferred. Each of these was executed against the live system.

**seats.aero sends no CORS headers, from any origin.** Preflights from `https://awardgrid.dowhiz.com`,
`http://localhost:3000` and `https://seats.aero` all returned `204` with **zero**
`Access-Control-Allow-Origin`. No page running in a browser can call it. This single fact decides the
client technology.

**But "native app" is not the escape — native *networking* is.** WKWebView enforces CORS with no
App-Store-safe way to disable it. A Capacitor/Ionic app's JavaScript runs inside WKWebView at
`capacitor://localhost` and is subject to CORS exactly like a web page. It escapes only when the
request is routed through the native bridge to `URLSession`.

| Runtime | Direct seats.aero call |
|---|---|
| Swift `URLSession` | works |
| React Native `fetch` (NSURLSession) | works |
| Capacitor **with** every call through a native-HTTP adapter | works |
| Capacitor calling `fetch()` in the WebView | **blocked by CORS** |
| Chrome MV3 extension **service worker** with `host_permissions` | works |
| Chrome MV3 **content script** | blocked — Chrome's docs exempt only the service worker |
| Static site / PWA in a browser | **blocked by CORS** |

**The core is already portable.** Zero server-only imports in production code:

| Module | Prod lines |
|---|---|
| `src/lib/seatsaero` | 3,202 |
| `src/lib/query` | 1,906 |
| `src/lib/grid` | 2,418 (its only `node:fs` is in a test) |
| `src/lib/qr` | 861 |

**255 tests across 22 files** in those four directories pass today and are runtime-independent —
`vitest.config.ts` pins `environment: node`, `TZ=UTC` and no network. They keep running whatever
the app is built with. **They are the asset. A port that rewrites them has failed.**

Two corrections to that boundary, found by review and not yet verified by measurement: the four
directories do not compile alone (`grid/format.ts` and `grid/aria.ts` import `@/lib/i18n`; five files
import `@/lib/notices`), so the real package is **six** modules and roughly 262 tests; and
`src/lib/query/places.ts:16` reads `../../../data/places.json`, which must become an in-package asset.

**Deletable in a single-user app: ~5,500 lines.** `auth` (1,326), `server` (3,319), `keys` (438),
`crypto` (116), `db` (307). All of it exists to protect a shared host. One user, one device, one key
in the Keychain — no accounts, no sessions, no invites, no AES key store, no rate limiting.

---

## 2. Target architecture

One shared core, several thin shells. The landing page is separate and calls nothing.

```
        packages/core   — seatsaero · query · grid · qr · i18n · notices
        zero server dependencies, 255+ tests, never rewritten
                              │
      ┌───────────────┬───────┴────────┬────────────────┐
      ▼               ▼                ▼                ▼
   iOS app        desktop app     browser extension   run it yourself
   (Capacitor)    (Tauri v2)      (MV3 worker)        (today, minus the host)
      └───────────────┴────────────────┴────────────────┘
              every one uses privileged HTTP, so no CORS

   sites/landing — static, on Cloudflare Pages, makes no API calls at all
```

**iOS is the only v1 target.** The others are shells over the same core and can follow.

**Capacitor over React Native, and the reason is 9,619 lines.** RN discards every `.tsx` — Tailwind
v4, `@base-ui/react` (12 files), `@tanstack/react-virtual` have no RN equivalent, and Anthropic's
TypeScript SDK states it does not support React Native. Capacitor keeps the UI and costs roughly 18
import swaps across 16 files (`next/link`, `next/navigation` → react-router) plus one rewrite of
`src/components/grid/api.ts` (142 lines), whose `ApiResult`/`ApiFailureCode` shape should be kept
exactly so no caller changes.

**The single most dangerous line in the build** is the native-HTTP wiring. `CapacitorHttp`'s patched
`fetch` does not honour `AbortSignal` on native, and silently falls back to WebView `fetch` in some
call shapes — a fallback that surfaces as a CORS error in production, on a device. Therefore:

- Write an explicit adapter with `typeof fetch`'s signature over the native plugin. Inject it as
  `opts.fetch` into `SeatsAeroClient`, which already takes one (`client.ts:227`). Do not rely on the
  global patch.
- The adapter must carry `connectTimeout`/`readTimeout` natively, because `client.ts:312` builds its
  20-second timeout from `AbortController` and `:327` classifies the failure by reading
  `signal.aborted`. Without native timeouts, an abandoned search still spends a quota call.
- Add a startup assertion that the adapter is live. A silent fallback must fail loudly at launch, not
  at first search.

**Quota.** seats.aero returns `X-RateLimit-Remaining`. Read it and trust it over the local counter —
on-device counters reset when the app is reinstalled while seats.aero's does not, so a user could hit
the real 1,000 limit believing they had headroom.

---

## 3. What is kept, rebuilt, and lost

**Kept as-is:** the whole core, `data/places.json` (6 KB), both i18n dictionaries (601 keys × en/zh),
`docs/COPY.md`'s voice rules, `scripts/mock-seatsaero.ts` (the demo mock — now also the App Review
demo mode), and the 9,619 lines of UI.

**Rebuilt: the Ask lane.** `src/lib/ask/session.ts:103` dynamically imports the Claude Agent SDK,
which spawns a `claude` subprocess. iOS cannot provide one. The replacement is a Messages API tool
loop with the seats.aero client exposed as typed tools — strictly better than the curl pipeline the
928-line gate existed to police. None of its 1,742 lines of tests carry over. **Defer to v1.1**: the
grid lane needs no Anthropic key at all.

**Lost: the guaranteed schedule.** `BGAppRefreshTask` is opportunistic, capped near 30 seconds,
user-toggleable, and degrades if a run overruns. There is no iOS mechanism that replaces a cron.
Rename the feature from a *schedule* to a *watch*: check on open, plus best-effort background refresh,
plus an optional Shortcuts intent for users who want a real cadence. `src/lib/scheduler/diff.ts` ports
with one change — it imports `createHash` from `node:crypto`.

**Never print a next-run time.** Print "last checked 2 h ago" and "checks in the background when iOS
allows". Promising a cadence the OS will not honour is the one lie this product must not tell.

**Lost: cross-device continuity.** Saved queries, diff baselines and the quota counter become local.
CloudKit's private database is the honest answer for the first two and still counts as no host of
ours; the quota counter cannot be shared and should not pretend to be.

---

## 4. Design

**The conflict is real and recorded.** `FINAL_REPORT.md:179` lists "no cream + serif + terracotta" as
a generic-template tell this product deliberately passed — which is precisely Restful's signature
(Fraunces serif eyebrows in cream `#ffdb76` on an ink-teal gradient). Adopting it wholesale would
make awardgrid look like Restful rather than like Restful's sibling.

**Restful contains its own answer.** Its two data components — `.fact-table` and `.compare-table` —
switch the glass off: no blur, no shadow, 1px hairlines, horizontal scroll. That is exactly what
awardgrid's grid needs. Copy the instinct, not the hexes.

**One token file, two surface modes.** Colour, type, motion and spacing shared; **radius, blur and
elevation fork**.

- `[data-surface="rich"]` — landing page, onboarding, key setup, settings headers, empty states.
- `[data-surface="flat"]` — the grid and anything inside `.ag-scroll`. Default for the app shell.

**Do not copy Restful's values.** Its `--text-muted` measures 3.80:1 against the bottom of its page
gradient — below AA — and it ships no `prefers-reduced-motion` guards. Both would fail this repo's CI,
which enforces zero serious/critical axe violations on three projects and asserts that nothing
animates under `reduce`. Every new colour pair must be run through
`docs/ui-plan-assets/contrast.mjs` before it lands.

**Keep every existing token name.** 9,619 lines of `.tsx` consume `--bg`, `--fg`, `--line`, `--accent`
through the `@theme inline` bridge. Change values, add tokens, rename nothing.

Three faces, one job each: a display face ≥ 20 px for marketing, **Inter unchanged as the data face**
(tabular figures and the CJK-after-Latin `unicode-range` stack are load-bearing), and a serif for
eyebrow labels only — with an explicit CJK serif fallback, or Chinese eyebrows silently lose the
serif voice in half the product. Pull display tracking back from Restful's `-0.08em`: awardgrid sets
three-letter IATA codes, and `SEA`/`NRT` collide at that tracking.

Self-host the fonts. `docs/UI_PLAN.md:514` rejected a network font dependency on purpose.

**The voice does not change.** Restful's landing page has a "what it does not do" table — *"No smart
alarm"*, *"No ratings yet — Restful is new and from a small team"*. awardgrid's front door already
has exactly that block. The redesign is a new visual language for a voice that is already right.

---

## 5. Distribution risks

**Apple Guideline 3.1.1.** Apple has rejected a bring-your-own-key app with the reviewer wording
"the app uses API keys to unlock or enable functionality". App Review staff replied in that thread
but no public resolution exists. A paid BYO-key app is the highest-risk shape; free is safer.

**Guideline 2.1 — App Review needs a working demo.** The app is inert without a paid seats.aero key.
`scripts/mock-seatsaero.ts` and the e2e fixtures already exist; a fixture-backed demo mode is a real
deliverable, not a nice-to-have, and it also answers Guideline 4.2 (minimum functionality).

**Guideline 4.2.2 — repackaged website.** A WebView shell of an existing web app, shipped beside a
marketing site with the same content, is a recognisable rejection shape. The defence is visible
native surface: Keychain onboarding, local notifications, share-sheet CSV export, offline cache.

**Privacy labels get simpler, not harder** — with no server, the app collects nothing. Queries go to
seats.aero and Anthropic under the user's own keys. Declare that honestly.

**Boundary 6.** The kickoff forbids "no money — no paywall, cost-sharing or subscription logic
anywhere". That boundary existed because a shared host raised the question of who pays for it. With
no host it arguably dissolves — but it is recorded in three places and only the owner can retire it.
Note that a paid app also worsens the seats.aero question in §0.

---

## 6. Phases, ordered by risk retired per unit of work

**Phase 0 — one day, before anything else.** A throwaway Capacitor app, one screen, one hard-coded
query, a real Pro key, on a real device: does a native-HTTP call to seats.aero return rows and render
a grid? This retires the entire technical premise. Acceptance must state explicitly that the call went
over native HTTP — a debugger-hosted run can execute `fetch` in a browser context and fail with CORS,
looking like the premise is wrong when it is the harness that is wrong.

**Phase 1 — the package split.** `pnpm-workspace.yaml` today has no `packages:` key, so this repo is
not actually a workspace; authoring one is new work regardless of repo strategy, which removes the
main argument for a second repo. Extract `packages/core` (six modules), fix `places.ts:16`, and
require that the 255+ core tests pass untouched.

**Phase 2 — the shell.** Vite SPA, react-router, the native-HTTP adapter with its startup assertion,
Keychain key storage, in-memory cache with a JSON snapshot. Device SQLite can wait for watches.

**Phase 3 — the design system.** Tokens with two surface modes, contrast-verified, then the landing
site, then the app screens.

**Phase 4 — watches**, honestly labelled. **Phase 5 — Ask**, rebuilt on the Messages API.

---

## 7. Open questions

| # | Question | Blocks |
|---|---|---|
| 1 | **Does seats.aero permit distributing an app on their Partner API?** Email `support@seats.aero`. | Everything |
| 2 | Free or paid? Paid worsens both Q1 and Guideline 3.1.1. | §0, §5 |
| 3 | Does boundary 6 ("no money") retire with the host, or stand? | Q2 |
| 4 | Must watches survive? If yes, the honest answer may be keeping one small always-on machine. | §3, phase 4 |
| 5 | Is iOS-only acceptable for v1, or is the browser extension wanted at the same time? | §2 |
| 6 | Web version: unhosted desktop app, browser extension, or run-it-yourself? All three work; a hosted static SPA does not. | §2 |

## What this document does not claim

It has not been implemented, and no line of the pivot has been written. The CORS measurements, the
line counts and the 255 passing tests were executed. The App Store precedents, the WKWebView CORS
behaviour, Capacitor's `AbortSignal` gap and seats.aero's OAuth constraints come from documentation
and review, not from a build on a device — Phase 0 exists to convert the load-bearing ones into
measurements.
