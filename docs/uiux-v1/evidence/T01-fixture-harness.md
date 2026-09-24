# T01 · Fixture harness — evidence

Scope verified: **browser mock** (Playwright Chromium against the test-only fixture host) and **production bundle** checks. Not iOS Simulator, device, or live-key verification — those do not apply to this task. Toolchain: arm64 Node 22.23.2, pnpm 12.3.4, Playwright 1.63.0 (Chromium 1243), macOS 26.3. Baseline for this task: [T01-baseline.md](T01-baseline.md).

## What was built

- `apps/ios/fixture-host/` (test-only Vite root, `apps/ios/vite.fixture.config.ts`): mounts the real `App` through the real `bootstrap()` with explicit fake ports — memory key stores, a namespaced localStorage file store, a synthetic seats.aero transport (search, availability, routes; trips 404 until T10) and a refusing Anthropic transport. The WebView fetch guard is installed as in `src/main.tsx`, and refused direct attempts are counted.
- Scenarios: only **seeded** ids boot (`complete`, `complete-empty`, `unmonitored`, `no-seats-key`, `no-ai-key`, `quota-low`, `multi-program`, `storage-failure`). Every other id in `scenarios.json` is refused with the task that will seed it; unknown or missing ids are refused. No fallback.
- `playwright.uiux.config.ts` (fixture host on 127.0.0.1:4310, never :3000/:3400/:3999/:4597/:4599; never builds Next; `reuseExistingServer: false`; dead-proxy backstop), `e2e/uiux/test.ts` (per-context network lockdown; every test fails if any non-loopback request was attempted), `e2e/uiux/helpers.ts` (`openScenario`, `requestLog`, `externalRequests`, `takeExternalRequests`, `evidenceShot`).
- Production seams (no behaviour change when unused): `App` gained optional `bootstrapOptions`/`onReady` props; `BootstrapOptions` gained optional `assertNative`, passed to Ask. `src/main.tsx` still renders `<App />` with no props.
- A01 guards: `apps/ios/scripts/check-fixture-free-bundle.mjs` runs on every `pnpm --filter @awardgrid/ios build` (116 markers derived from the synthetic JSON plus source-map path checks); an ESLint rule forbids production iOS source (excluding tests and `src/probes/**`) from importing `@awardgrid/core/test-fixtures/*` or `fixture-host`.
- `playwright.config.ts` ignores `e2e/uiux/**`; the web suite still lists 728 tests in 15 files.
- Synthetic JSON copied verbatim to `packages/core/test/fixtures/uiux/` (SHA-256 identical to the pack manifest).

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red (config error, not counted) | `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/fixture-harness.spec.ts` | Node ESM needed a JSON import attribute; fixed the harness |
| Red (valid) | same | exit 1 — 4 failed (host never reported ready/error), 1 passed (helper refusal) |
| Green 1 | same | exit 1 — the search test found `process is not defined` in the dev-served host (core `process.env` defaults; the shipped bundle compiles them to `{}`) |
| Green 2 | same | exit 0 — 5 passed |
| Independent review | 3 reviewers (isolation, test validity, plan conformance) | 6 major + 18 minor findings (several found by more than one reviewer), e.g. network block too narrow, scenarios silently booted as base, Anthropic counter could never be non-zero, storage untested, bundle check missed synthetic data. All fixed |
| After fixes | `pnpm exec playwright test --config=playwright.uiux.config.ts` | exit 0 — **10 passed**, 3 consecutive runs (11.0–12.0 s) |

## Gates after T01

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | app + core + ios (host now in the ios tsconfig) |
| `pnpm lint` | 0 | 0 errors, the same 1 pre-existing warning |
| `pnpm test` | 0 | root 818 passed / 2 skipped · core 669 · ios 577 — unchanged from baseline, no existing test edited |
| `pnpm --filter @awardgrid/ios build` | 0 | `check-fixture-free-bundle: 18 files, 116 markers, none found in dist` |
| Guard negative: synthetic `purpose` string appended to a dist copy | 1 | reported the marker |
| Guard negative: `test/fixtures/uiux/factory.ts` added to a copy's source map | 1 | reported the path |
| ESLint negative (stdin, `apps/ios/src/leak-probe.ts` importing fixtures) | 1 | rule fired; the same import in a `*.test.ts` is allowed (exit 0) |
| R1 (from the reviews) | — | no `*probe*`/`*e2e*` chunk, no `127.0.0.1:45|localhost:45|probe-server|sk-ant-` in dist |

## Screenshots (the real app in the host, synthetic data)

- [`screens/t01-host-no-seats-key.png`](screens/t01-host-no-seats-key.png) — no key: Run disabled, the app's own no-key callout, no rows invented.
- [`screens/t01-host-complete-search.png`](screens/t01-host-complete-search.png) — a search through the synthetic transport. This is the pre-redesign UI; it shows the problems the redesign addresses (seat count 0 renders as nothing, fees are never shown, freshness is colour-only).

## Findings recorded for later tasks

- `storage-failure`: the current app lets file-store failures surface only as unhandled promise rejections (`void services.persist()` in `App.tsx`), with nothing shown to the user. docs/02 D04 requires recoverable, actionable write failures → T05/T13.
- `quota-low`: the refusal is shown as a generic alert; the spec asks for known remaining/limit and reset basis without a countdown → T07/T11 copy.
