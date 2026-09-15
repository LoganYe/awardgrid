# Kickoff prompt — awardgrid client-app pivot

Paste the block below into a fresh session opened in this repository. It is written to be
self-contained: it names what to read, what is already settled, what is forbidden, and what
"done" means for the first unit of work.

---

You are picking up awardgrid, a private award-flight grid app. We are pivoting it from a hosted
multi-user web app into a client app that runs entirely on each user's own API keys, with a static
marketing landing page. **Read `docs/PIVOT.md` first — it is the specification and it was written
from measurements, not guesses.** Then `README.md`, `ARCHITECTURE.md`, `DECISIONS.md`,
`docs/UI_PLAN.md`, `docs/COPY.md`, `HANDOFF.md`.

## Before you write any code

**There is a blocking question that is not technical.** seats.aero's Partner API is licensed for
non-commercial personal use, and commercial use requires their written permission
(`docs/reference/seatsaero/getting-started-p.md:13` and `:25`). `LEGAL.md:3` grounds this whole
product on being "a personal, non-commercial tool for its author and fewer than ten friends". An
App Store listing contradicts that in public. seats.aero also ships their own iOS app and directs
third parties to an OAuth flow that structurally needs a server.

Ask the owner whether they have written to `support@seats.aero` and what the answer was. If they
have not, say so plainly and ask whether to proceed at risk. Do not quietly build past it.

## What is already settled — do not re-litigate

- **seats.aero sends no CORS headers from any origin.** Measured from three. No browser page can
  call it.
- **WKWebView enforces CORS.** "Native app" is not the escape; native *networking* is. Every
  seats.aero and Anthropic call must go over a native-HTTP adapter, never the WebView's `fetch`.
- **Capacitor, not React Native.** RN discards all 9,619 lines of `.tsx` and does not support
  Anthropic's TypeScript SDK. Capacitor keeps the UI for ~18 import swaps across 16 files.
- **The core is portable.** `src/lib/{seatsaero,query,grid,qr}` have zero server-only production
  imports; add `i18n` and `notices`, which they depend on, and that is the package.
- **255 tests across 22 files** in those four directories pass today and are runtime-independent.

## The rule that matters most

**A PR that edits any `*.test.ts` under `packages/core` is rejected on sight.** Those tests encode
behaviour that took months to get right — the pagination and dedupe loop, the cached-vs-bulk planner
and its quota estimator, the bilingual date parser, the cache scope algebra. If a core test needs to
change, that is a product change and needs its own decision record, not a port commit.

## Your first task, and only this

**Phase 0.** A throwaway Capacitor app: one screen, one hard-coded query, the owner's real
seats.aero Pro key, running on a real device or simulator. Prove that a native-HTTP call reaches
seats.aero and renders rows.

Acceptance:
- The response arrives and rows render.
- **You state explicitly how you proved the call went over native HTTP and not the WebView.** A
  debugger-hosted run can execute `fetch` in a browser context and fail with CORS, which looks like
  the premise is wrong when it is the harness that is wrong. Show the evidence.
- You report whether `X-RateLimit-Remaining` came back, and its value.
- You report whether `AbortSignal` actually cancelled the native request, or only the promise.

Do not start the package split, the design system, or any UI work until Phase 0 has an answer.
If Phase 0 fails, stop and report — the pivot's premise is wrong and the plan needs rewriting.

## House rules that carry over

- Decisions are recorded in `DECISIONS.md` and never rewritten; superseded entries are amended in
  place.
- Deferred findings become GitHub issues with `file:line` evidence, not prose.
- The test follows the UI, never the reverse.
- Never invent an API parameter; where the docs are silent, record an explicit assumption.
- Tests must not depend on what time they run.
- New root-level `.md` files break the build — `next.config.ts` traces them into `.next/standalone`
  and the CI secret grep reads them. Put documents under `docs/`.
- The arm64 node is required: `export PATH="$HOME/.local/node-arm64/bin:$PATH"`.

## What not to do

- Do not rewrite the core's tests.
- Do not copy Restful's colour values. Its muted text measures 3.80:1 (below AA) and it ships no
  `prefers-reduced-motion` guards; both fail this repo's CI. Copy its *instincts* — the honesty of
  its "what it does not do" table, and its choice to switch the glass off for data tables.
- Do not promise a background schedule. iOS cannot honour one. The feature is a *watch*, not a
  *schedule*, and the UI must never print a next-run time.
- Do not delete the deployed web app. It is live at `awardgrid.dowhiz.com` behind a Cloudflare
  Tunnel (`docs/DEPLOYMENT.md`) and stays until the app replaces it.
