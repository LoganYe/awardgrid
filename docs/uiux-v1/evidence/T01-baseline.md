# T01 · Preflight and baseline evidence

Recorded 2026-09-23 (UTC 2026-09-24T02:xx). Raw logs are local only under `evidence/raw/` (git-ignored); this file is the redacted summary.

## Environment

| Item | Value |
|---|---|
| Machine | Apple M3, macOS 26.3 (25D125) |
| Repo | `/Users/yegaoyang/Desktop/workspace/awardgrid`, branch `uiux/quiet-precision-v1` from `main` `9c69c6c6f1a391576a95f8e1b5e69082f3ababc4` |
| Design baseline | `2a1f353534e5a606a3ee0346d5c928ced73b7154`, ancestor of HEAD (4 later commits: seats.aero decoding fixes, Ask token count fix, docs) |
| Working tree at start | clean |
| Node / pnpm | arm64 Node 22.23.2 at `~/.local/node-arm64/bin` + pnpm 12.3.4 (corepack). The non-interactive default `node` is x64 v22.16.0 under Rosetta — see STATUS.md |
| Playwright | `@playwright/test` 1.63.0, Chromium 1243 (arm64) |
| Xcode | 26.6 (17F113); iOS 26.5 runtime; booted iPhone 17 Pro holds the owner's real keys (not used) |
| Handoff pack | `python3 tools/verify_handoff.py` not required for product checks; fixture JSON copied into `packages/core/test/fixtures/uiux/` match the pack manifest SHA-256 values exactly |

## Baseline gates (before any product change)

The first attempt ran under the x64 node and failed on native bindings (environment, not code). Re-run under arm64:

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | app + core + ios |
| `pnpm lint` | 0 | 0 errors, 1 pre-existing warning (`react-hooks/incompatible-library`, `src/components/grid/grid-table.tsx:345`) |
| `pnpm test` | 0 | root 83 files / 818 passed, 2 skipped · core 44 / 669 · ios 26 / 577 |
| `pnpm --filter @awardgrid/ios build` | 0 | Vite bundle (746 KB main chunk warning, pre-existing #92) |
| `pnpm build` (Next) | 0 on arm64 re-run | **Should not have been run in this checkout** — see below |
| `pnpm build:landing` | 0 | |
| `pnpm e2e` (web, 4 projects) | 0 | 583 passed, 145 skipped, 0 failed, 702 s. It rewrote 206 tracked `docs/screenshots/v0.2/**` files; those were restored with `git restore -- docs/screenshots/v0.2` (verified: nothing else modified) |

## Incident during preflight

`pnpm build` rewrote the checkout's `.next`, which the production LaunchAgent (`com.awardgrid.app`, `next start` on 127.0.0.1:3000, PID 959 since 2026-09-19) serves. Checked afterwards with read-only GETs: `/login` → 200 but its stylesheet `/_next/static/chunks/30jnsnx-7tr59.css` → 404; `/` stylesheet → 500. Recorded in `DECISIONS.md` U-003; the owner was notified. No restart was performed.

## Unverified at this point

iOS Simulator, device, and live-key runs were not part of the baseline.
