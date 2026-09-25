# T22 · Evidence ledger (A37): every stage's logs, exit codes, counts, commits and screenshots, T01–T21

Built in T22 from the raw logs (`evidence/raw/`, local and gitignored), git, and the evidence docs, by a read-only agent. No log contains a key. T22's own stage is in [T22-regression-handoff.md](T22-regression-handoff.md). Doc quotes below are from the committed versions (before T22's corrections).

**Legend**
- **Paths:** WT is the worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`. MAIN is the main checkout `/Users/yegaoyang/Desktop/workspace/awardgrid`.
- **"—"** means not in the log.
- **Worktree start:** WT was created on 2026-09-23 at 20:02 (the directory's birth time and its `.git` file). Any log older than that cannot have run in WT.
- **Commands:** `$ …` is the script line pnpm printed. The command that started the run is not in these logs, except the gate files t04/t05/t06, which have `== <cmd>` headers and `exit=N :: <cmd>` lines. Playwright and plain vitest logs print no command.
- **Exit codes:** they appear only in the t04/t05/t06 gate files, the baseline `summary.tsv` files, and `ELIFECYCLE … exit code N` lines.
- **Counts:** `f` = test files, `p` = passed, `s` = skipped, `F` = failed.
- **Times:** tables show the file's mtime as HH:MM. The timing lines use HH:MM:SS from `stat`.

---

## T01: `0c94f59`, 2026-09-23 19:56:02, baseline and fixture harness (all logs dated 09-23)

| Log | mtime | Kind | Command in log | Exit | Counts / result | Checkout |
|---|---|---|---|---|---|---|
| baseline-gates/pnpm_typecheck.log | 19:08 | baseline gate, x64 node | `$ tsc --noEmit && …` | 0 (tsv) | no errors | — |
| baseline-gates/pnpm_lint.log | 19:09 | baseline gate | `$ eslint` | 0 (tsv) | 0 errors, 1 warning | MAIN |
| baseline-gates/pnpm_test.log | 19:09 | baseline gate | `$ vitest run --passWithNoTests && …` | 1 (tsv), "Test failed" | Startup Error: rolldown native binding missing; no tests ran | MAIN |
| baseline-gates/pnpm_--filter__awardgrid_ios_build.log | 19:09 | baseline gate | `$ vite build` | exit code 1 | native binding error; `Node.js v22.16.0` | MAIN |
| baseline-gates/pnpm_build.log | 19:09 | baseline gate | `$ next build` | exit code 1 | Rosetta 2 warning, `@next/swc-darwin-x64`, lightningcss x64 missing | MAIN |
| baseline-gates/pnpm_build_landing.log | 19:09 | baseline gate | `$ pnpm --filter @awardgrid/landing build` | exit code 1 | native binding error | MAIN |
| baseline-gates/summary.tsv | 19:09 | exit summary | — | typecheck 0, lint 0, test 1, ios build 1, build 1, build:landing 1 | — | — |
| baseline-gates-arm64/node_-p_process.arch.log | 19:10 | environment | — | 0 (tsv) | `arm64` | — |
| baseline-gates-arm64/pnpm_typecheck.log | 19:10 | baseline gate | `$ tsc --noEmit && …` | 0 (tsv) | no errors | — |
| baseline-gates-arm64/pnpm_lint.log | 19:10 | baseline gate | `$ eslint` | 0 (tsv) | 0 errors, 1 warning | MAIN |
| baseline-gates-arm64/pnpm_test.log | 19:10 | baseline gate (unit) | `$ vitest run --passWithNoTests && …` | 0 (tsv) | root 83f/818p 2s · core 44f/669p · ios 26f/577p | MAIN |
| baseline-gates-arm64/pnpm_--filter__awardgrid_ios_build.log | 19:10 | baseline gate | `$ vite build` | 0 (tsv) | built; 746.58 kB chunk warning | — |
| baseline-gates-arm64/pnpm_build.log | 19:10 | baseline gate | `$ next build` | 1 (tsv), exit code 1 | `Cannot find module '../lightningcss.darwin-x64.node'` (5 errors) | MAIN |
| baseline-gates-arm64/pnpm_build_landing.log | 19:10 | baseline gate | `$ pnpm --filter @awardgrid/landing build` | 0 (tsv) | built | — |
| baseline-gates-arm64/pnpm_build_cleanpath.log | 19:11 | baseline gate | `$ next build` | exit code 1 | same lightningcss x64 error | MAIN |
| baseline-gates-arm64/summary.tsv | 19:10 | exit summary | — | arch 0, typecheck 0, lint 0, test 0, ios build 0, **build 1**, build:landing 0 | — | — |
| baseline-build-rerun/pnpm_build.log + summary.tsv | 19:13 | baseline gate | `$ next build` | 0 (tsv) | Compiled successfully | — |
| baseline-e2e/pnpm_e2e.log + summary.tsv | 19:25 | web e2e | `$ playwright test` | 0 (tsv, 702 s) | 728 run: 583p, 145s, 0F (11.7 m) | — |
| T01/red.log | 19:27 | red | — | — | 4F, 1p | MAIN |
| T01/green-1.log | 19:29 | green attempt | — | — | 1F, 4p (`.miles` locator not found) | MAIN |
| T01/green-2.log | 19:30 | green | — | — | 5p | — |
| T01/ios-build.log | 19:30 | gate | `$ vite build && node scripts/check-fixture-free-bundle.mjs` | — | "18 files in dist, no fixture markers" | — |
| T01/bundle-check-negative.log | 19:30 | guard negative | — | — | reports "fixture-ready" in bundle | — |
| T01/test.log | 19:31 | gate (unit) | `$ vitest run --passWithNoTests && …` | — | 818p 2s · 669p · 577p | MAIN |
| T01/typecheck.log | 19:31 | gate | `$ tsc --noEmit && …` | — | no errors | — |
| T01/uiux-all.log | 19:32 | full UI/UX run | — | — | 5p | — |
| T01/lint.log | 19:32 | gate | `$ eslint` | — | 0 errors, 1 warning | MAIN |
| T01/ios-test.log | 19:32 | unit | `$ vitest run` | — | ios 26f/577p | MAIN |
| T01/uiux-hardened.log | 19:52 | full UI/UX run | — | — | 10p | — |
| T01/bundle-neg-data.log | 19:52 | guard negative | — | — | marker found in dist | — |
| T01/bundle-neg-map.log | 19:52 | guard negative | — | — | factory.ts found in source map | — |
| T01/ios-build-hardened.log | 19:52 | gate | `$ vite build && node scripts/check-fixture-free-bundle.mjs` | — | "18 files, 116 markers, none found in dist" | — |
| T01/eslint-neg.log | 19:52 | guard negative | — | — | 2 errors (no-restricted-imports) | MAIN |
| T01/eslint-test-allowed.log | 19:52 | guard positive | — | — | empty file (0 bytes) | — |
| T01/typecheck-final.log | 19:52 | gate | `$ tsc --noEmit && …` | — | no errors | — |
| T01/test-final.log | 19:53 | gate (unit) | `$ vitest run --passWithNoTests && …` | — | 83f/818p 2s · 44f/669p · 26f/577p | MAIN |
| T01/uiux-repeat-1.log, uiux-repeat-2.log | 19:53 | full UI/UX runs | — | — | 10p, 10p | — |
| T01/lint-final.log | 19:53 | gate | `$ eslint` | — | 0 errors, 1 warning | MAIN |
| T01/uiux-evidence.log | 19:54 | evidence capture (full run) | — | — | 10p | — |

- **Screenshots (2):** `t01-host-complete-search.png`, `t01-host-no-seats-key.png`. The file mtime is 21:51, but git shows them only in `0c94f59` and unchanged since.
- **Timing:** ios-build-hardened 19:52:39 · typecheck-final 19:52:54 · test-final 19:53:14 · lint-final 19:53:58 · uiux-evidence 19:54:22 · commit 19:56:02. No landing or Next build log after the baseline.

## T02: `7c093f5` (wip) 20:02:17 and `a553b5d` 20:20:09

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| T02/red.log | 19:57 | red | — | ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL (no number) | 2f failed, no tests (`./identity`, `./semantics` missing) | MAIN (packages/core) |
| T02/green-1.log | 19:59 | green | — | — | 2f/61p | MAIN |
| T02/green-2.log | 19:59 | green | — | — | 3f/64p | MAIN |
| T02/web-store.log | 20:05 | unit (root) | — | — | 5f/39p | WT |
| T02/ios-build.log | 20:05 | gate | `$ vite build && node scripts/check-fixture-free-bundle.mjs` | — | 116 markers, none found | — |
| T02/uiux.log | 20:06 | full UI/UX run | — | — | 10p | — |
| T02/build-plugin.log | 20:06 | setup | `$ tsx scripts/build-plugin.ts` | — | wrote 45 files to WT/build/plugin | WT |
| T02/typecheck.log | 20:06 | gate | `$ tsc --noEmit && …` | — | no errors | — |
| T02/lint.log | 20:07 | gate | `$ eslint` | — | 0 errors, 1 warning | WT |
| T02/test.log | 20:07 | gate (unit) | `$ vitest run --passWithNoTests && …` | — | root 84f/821p 2s · core 47f/733p · ios 26f/577p | WT |
| T02/typecheck-2.log | 20:18 | final gate | `$ tsc --noEmit && …` | — | no errors | — |
| T02/lint-2.log | 20:18 | final gate | `$ eslint` | — | 0 errors, 1 warning | WT |
| T02/test-2.log | 20:18 | final gate (unit) | `$ vitest run --passWithNoTests && …` | — | 84f/823p 2s · 47f/753p · 26f/577p | WT |
| T02/ios-build-2.log | 20:18 | final gate | `$ vite build && …` | — | 116 markers, none found | — |
| T02/uiux-2.log | 20:19 | full UI/UX run | — | — | 10p | — |

- **Screenshots:** none.
- **Timing:** the first gate set (20:05:51–20:07:21) comes after the wip commit (20:02:17). Final set: typecheck-2 20:18:34 · lint-2 20:18:44 · test-2 20:18:57 · ios-build-2 20:18:58 · uiux-2 20:19:09 · commit `a553b5d` 20:20:09.

## T03: `24e5ab6`, 20:48:04

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| T03/red.log | 20:22 | red | — | ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL | 1f failed, no tests (`./coverage`) | WT |
| T03/web-store.log | 20:27 | unit (root) | — | — | 6f/47p | WT |
| T03/typecheck.log | 20:27 | gate | `$ tsc --noEmit && …` | — | no errors | — |
| T03/lint.log | 20:27 | gate | `$ eslint` | — | 0 errors, 1 warning | WT |
| T03/test.log | 20:28 | gate (unit) | `$ vitest run --passWithNoTests && …` | — | 85f/829p 2s · 48f/785p · 26f/577p | WT |
| T03/ios-build.log | 20:28 | gate | `$ vite build && …` | — | 116 markers, none found | — |
| T03/uiux.log | 20:28 | full UI/UX run | — | — | 10p | — |
| T03/typecheck-2.log | 20:45 | gate | `$ tsc --noEmit && …` | — | no errors | — |
| T03/lint-2.log | 20:45 | gate | `$ eslint` | — | 0 errors, 1 warning | WT |
| T03/test-2.log | 20:45 | gate (unit) | `$ vitest run --passWithNoTests && …` | "Test failed", ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL | root 85f/836p 2s · **core 1f F / 47f p, 6F / 793p** (all six in `src/lib/ask/coverage.test.ts`) · ios not reached | WT |
| T03/ios-build-2.log | 20:45 | gate | `$ vite build && …` | — | none found | — |
| T03/uiux-2.log | 20:46 | full UI/UX run | — | — | 10p | — |
| T03/typecheck-3.log | 20:46 | final gate | `$ tsc --noEmit && …` | — | no errors | — |
| T03/lint-3.log | 20:46 | final gate | `$ eslint` | — | 0 errors, 1 warning | WT |
| T03/test-3.log | 20:47 | final gate (unit) | `$ vitest run --passWithNoTests && …` | — | 85f/836p 2s · 48f/799p · 26f/577p | WT |
| T03/ios-build-3.log | 20:47 | final gate | `$ vite build && …` | — | none found | — |
| T03/uiux-3.log | 20:47 | full UI/UX run | — | — | 10p | — |

- **Screenshots:** none.
- **Timing:** typecheck-3 20:46:50 · lint-3 20:46:59 · test-3 and ios-build-3 20:47:13 · uiux-3 20:47:25 · commit 20:48:04.

## T04: `b000c03` 21:51:49 and `65014e4` (docs) 21:53:30

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| T04/tokens.log | 20:50 | unit (token guard) | — | — | 2f/90p | WT |
| T04/red.log | 20:50 | red | — | — | 10F ("foundations" not seeded) | WT |
| T04/green-1.log | 20:54 | green attempt | — | — | 1F, 9p (reduced-motion) | WT |
| T04/green-2.log | 20:54 | green | — | — | 20p | — |
| T04/evidence-shots.log | 20:55 | evidence capture | — | — | 2p | — |
| T04/green-3.log | 20:56 | green | — | — | 10p | — |
| T04/typecheck.log | 20:56 | gate | `$ tsc --noEmit && …` | **exit code 2**, then exit code 1 | 15 × TS2769 in `src/components/ui/primitives.test.ts` | WT |
| T04/lint.log | 20:56 | gate | `$ eslint` | — | 0 errors, 1 warning | WT |
| T04/test.log | 20:56 | gate (unit) | `$ vitest run --passWithNoTests && …` | — | 86f/919p 2s · 48f/799p · 27f/590p | WT |
| T04/ios-build.log | 20:56 | gate | `$ vite build && …` | — | 116 markers, none found | — |
| T04/landing.log | 20:56 | gate | `$ pnpm --filter @awardgrid/landing build` | — | built | — |
| T04/next-build.log | 20:57 | gate | `$ next build` | — | Compiled successfully | — |
| T04/uiux.log | 20:57 | full UI/UX run | — | — | 20p | — |
| t04-gates.log | 21:25 | gates | `== pnpm typecheck` etc. | exit=0 typecheck · **exit=1 pnpm lint** (react-hooks/refs, `Sheet.tsx:31`) · exit=0 test · exit=0 ios build · exit=0 build:landing · (after "== after Sheet useEffectEvent") exit=0 lint (rerun) · exit=0 ios test (rerun) · exit=0 pnpm build (worktree .next) · exit=0 uiux e2e with evidence | test: 919p 2s · 799p · ios 27f/593p; uiux 28p | WT |
| t04-evidence-run.log | 21:49 | evidence capture | — | — | 25p (foundations) | — |
| t04-gates-final.log | 21:50 | final gates | `== …` headers | exit=0 × 6: typecheck, lint, test, ios build, build:landing, build | 0 errors, 1 warning · 86f/919p 2s · 48f/799p · ios 32f/642p · 118 markers | WT |
| t04-isolation.log | 21:53 | isolation gates on `b000c03` | `== …` headers | exit=0 × 6 | ios 27f/595p · src/styles 2f/90p · 118 markers · UI/UX 35p | throwaway worktree `/private/tmp/claude-501/…/scratchpad/t04check`. The log opens with pnpm install output ("Already up to date", pnpm v12.3.4) |

- **Screenshots (6):** `t04-foundations-{light,dark}`, `t04-app-search-{light,dark}`, `t04-app-settings-{light,dark}`.
- **Timing:** evidence 21:49:42 · gates-final 21:50:34 · commit 21:51:49 · isolation 21:53:27 (after that commit, 3 s before `65014e4`). gates-final contains no full UI/UX run. The last full run before the commit is in t04-gates.log (21:25:08).

## T05: `ce4d206`, 22:26:39

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t05-red.log | 21:32 | red | — | ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL | 1f failed, no tests (`./workspace-store`) | WT |
| t05-gates.log | 22:25 | gates + full UI/UX run | `== …` headers | exit=0 × 7 (typecheck, lint, test, ios build, build:landing, build, playwright uiux) | 0 errors, 1 warning · 919p 2s · 799p · ios 33f/655p · 118 markers · UI/UX 39p | WT |
| t05-evidence-run.log | 22:25 | evidence capture | — | — | 4p | — |

- **Screenshots (2):** `t05-failed-old`, `t05-inflight-old`.
- **Timing:** gates 22:25:12 · evidence 22:25:17 · commit 22:26:39. The red run (21:32) is older than the T04 commit.

## T06: `c8958cf`, 23:11:54

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t06-red.log | 22:28 | red | — | ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL | no tests (`./query-editor`) | WT |
| t06-gates.log | 23:10 | gates + full UI/UX run | `== …` headers | exit=0 × 7 | 919p 2s · core 49f/826p · ios 33f/656p · 118 markers · UI/UX 57p | WT |
| t06-evidence-run.log | 23:10 | evidence capture | — | — | 2p | — |

- **Screenshots (2):** `t06-query-editor-{light,dark}`.
- **Timing:** gates 23:10:25 · evidence 23:10:28 · commit 23:11:54.

## T07: `0ac65d8`, 2026-09-24 00:51:53

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t07-red.log | 09-23 23:15 | red | — | — | 10F, 1p (9 × "missing-values" not seeded, 1 × "partial") | WT |
| t07-evidence-run.log | 00:50 | evidence capture | — | — | 2p | — |

- **Screenshots (2):** `t07-results-{light,dark}`.
- **Timing:** no gate log exists. Evidence 00:50:14 · commit 00:51:53.

## T08: `83f1c30`, 01:49:21

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t08-red.log | 00:56 | red | — | ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL | no tests (`./projection`) | WT |
| t08-evidence-run.log | 01:47 | evidence capture | — | — | 3p | — |

- **Screenshots (3):** `t08-calendar-{light,dark}`, `t08-calendar-list-320`.
- **Timing:** no gate log. Evidence 01:47:21 · commit 01:49:21.

## T09: `21ed5b2`, 02:43:53

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t09-red.log | 01:53 | red | — | — | 10F (`getByRole("grid")` not found) | WT |
| t09-evidence-run.log | 02:39 | evidence capture | — | — | 2p | — |

- **Screenshots (2):** `t09-matrix-{light,dark}`.
- **Timing:** no gate log. Evidence 02:39:37 · commit 02:43:53.

## T10: `a09b139`, 03:45:04

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t10-red.log | 02:49 | red | — | — | 8F (timeouts; `No route matches URL "/detail/…"`) | WT |
| t10-evidence-run.log | 03:41 | evidence capture | — | — | 2p | — |

- **Screenshots (2):** `t10-details-{light,dark}`.
- **Timing:** no gate log. Evidence 03:41:23 · commit 03:45:04.

## T11–T17: red run, full UI/UX run and evidence capture only

In every row below, the red run failed in WT, and the full run and evidence capture show no command, no exit code and no checkout path. The full runs are all in the `[ios]` project, with no failed or skipped lines.

| Task / commit | Red log (mtime, result) | Full run (mtime, result) | Evidence run (mtime, spec line, result) | Screenshots | Timing |
|---|---|---|---|---|---|
| T11 `1a96076` 05:08:04 | t11-red 03:50, 9F (onboarding.spec) | t11-full-run 05:04, 140p (1.8 m) | t11-evidence-run 05:04, onboarding:434, 2p | 12: `t11-{welcome,seats-key,anthropic-key,example,editor,settings}-{light,dark}` | full 05:04:05 · ev 05:04:58 · commit 05:08:04 |
| T12 `cd157c4` 05:59:10 | t12-red-core 05:09, no tests (`./selection`) | t12-full-run 05:56, 151p (1.9 m) | t12-evidence-run 05:57, compare:311, 2p | 8: `t12-{compare,compare-end,compare-one-by-one,tray}-{light,dark}` | full 05:56:44 · ev 05:57:37 · commit 05:59:10 |
| T13 `f416d89` 06:49:06 | t13-red 06:00, no tests (`./favorites-store`) | t13-full-run 06:47, 166p (2.2 m) | t13-evidence-run 06:44, favorites:268, 2p | 6: `t13-{saved,saved-snapshot,saved-undo}-{light,dark}` | ev 06:44:12 · full 06:47:54 · commit 06:49:06 |
| T14 `43082bb` 07:43:27 | t14-red 06:51, no tests (`./watch-migration`) | t14-full-run 07:41, 176p (2.3 m); the same two tests are at `watches.spec.ts:214` | t14-evidence-run 07:35, **watches:192**, 2p | 2: `t14-watches-{light,dark}` | ev 07:35:17 · full 07:41:16 · commit 07:43:27 |
| T15 `0df34c4` 08:48:59 | t15-red 07:44, no tests (`./context`) | t15-full-run 08:44, 190p (2.7 m) | t15-evidence-run 08:46, ask:258, 2p | 2: `t15-ask-{light,dark}` | full 08:44:57 · ev 08:46:30 · commit 08:48:59 |
| T16 `558995a` 09:33:21 | t16-red 08:49, no tests (`./proposals`) | t16-full-run 09:31, 198p (3.0 m) | t16-evidence-run 09:31, proposals:123, 2p | 2: `t16-proposal-{light,dark}` | full 09:31:32 · ev 09:31:45 · commit 09:33:21 |
| T17 `22e3736` 10:11:15 | t17-red 09:33, no tests (`./request-coordinator`) | t17-full-run 10:09, 203p (3.0 m) | t17-evidence-run 09:47, ask-stop:62, 2p | 2: `t17-stopped-{light,dark}` | ev 09:47:32 · full 10:09:33 · commit 10:11:15 |

No typecheck, lint, unit, iOS build, landing build or Next build log exists for T11–T17.

## T18: `c5b41e9`, 11:25:16

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t18-red.log | 10:22 | red | — | — | 1F (web-isolation:10, 60 s click timeout) | WT |
| t18-review-red.log | 11:01 | review red | — | — | 2F (web-isolation:93, :107) | WT |
| t18-review-clock.log | 11:02 | review green (clock) | — | — | 3p | — |
| t18-review-clock-red.log | 11:03 | review red (clock) | — | — | 1F (web-isolation:12, 60 s timeout) | WT |
| t18-review-ios-only-list.log | 11:03 | `--list` with UIUX_WEB=0 | — | — | "Total: 203 tests in 15 files" | — |
| t18-web-e2e.log | 11:19 | web e2e | `$ playwright test` | — | 728 run: 583p, 145s (11.5 m) | — |
| t18-quota-red.log | 11:20 | red (header quota) | — | — | 1F (web-isolation:122) | WT |
| t18-review-green.log | 11:20 | review green | — | — | 8p | — |
| t18-evidence-run.log | 11:20 | evidence capture | — | — | 2p | — |
| t18-full-run.log | 11:24 | full UI/UX run | — | — | 211p (3.2 m) | — |
| t18-unit-final.log | 11:24 | final gate (unit) | `$ vitest run --passWithNoTests && …` | — | 89f/930p 2s · 59f/960p · 48f/795p | WT |

- **Screenshots (4):** `t18-web-saved-{light,dark}`, `t18-web-workspace-{light,dark}`.
- **Timing:** web-e2e 11:19:46 · full 11:24:10 · unit 11:24:43 · commit 11:25:16.

## T19: `2987004`, 13:19:58

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t19-red.log | 11:28 | red | — | — | 1F (`[ios]` web-layout:7, 60 s timeout) | WT |
| t19-review-ios-only-list.log | 12:58 | `--list` runs | — | — | 203 tests in 15 files (UIUX_WEB=0) and 254 tests in 17 files, plus two "0" lines with no label | — |
| t19-unit.log | 12:59 | final gate (unit) | `$ vitest run --passWithNoTests && …` | — | 90f/949p 2s · 59f/960p · 48f/795p | WT |
| t19-web-e2e.log | 13:15 | web e2e | `$ playwright test` | — | 583p, 145s (11.5 m) | — |
| t19-full-run.log | 13:19 | full UI/UX run | — | — | 254p (211 ios + 43 web-desktop, 3.7 m) | — |
| t19-evidence-run.log | 13:19 | evidence capture | — | — | 2p (`[web-desktop]` web-layout:430) | — |

- **Screenshots (8):** `t19-web-{1024-overlay,1440-assistant,1440-matrix,palette}-{light,dark}`.
- **Timing:** unit 12:59:18 · web-e2e 13:15:03 · full 13:19:09 · evidence 13:19:15 · commit 13:19:58.

## T20: `ccfa264`, 14:17:23

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t20-red.log | 13:20 | red | — | ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL | no tests (`./watch-capabilities`) | WT |
| t20-parse-red.log | 13:33 | red (parse consent) | — | — | 2f failed · 2F / 45p | WT |
| t20-cli-worker.log | 13:38 | unit / integration | — | — | 6f/34p | WT |
| t20-cli-fixture.log | 13:39 | CLI output | — | — | a grid table only, no counts | — |
| t20-evidence-run.log | 13:40 | evidence capture | — | — | 2p | — |
| t20-unit.log | 13:56 | final gate (unit) | `$ vitest run --passWithNoTests && …` | — | 92f/960p 2s · 61f/965p · 49f/798p | WT |
| t20-full-run.log | 14:16 | full UI/UX run | — | — | 263p (220 ios + 43 web-desktop, 3.7 m) | — |
| t20-web-e2e.log | 14:16 | web e2e | `$ playwright test` | — | 583p, 145s (11.5 m) | — |

- **Screenshots (2):** `t20-web-queries-{light,dark}`.
- **Timing:** evidence 13:40:20 · unit 13:56:40 · full 14:16:46 (3.7 m in log) · web-e2e 14:16:56 (11.5 m in log) · commit 14:17:23. The committed doc says "Final run after the review fix, in the worktree, with nothing running alongside".

## T21: `07f4aa5`, 17:58:36

| Log | mtime | Kind | Command | Exit | Counts | Checkout |
|---|---|---|---|---|---|---|
| t21-red.log | 14:20 | Step-1 verbatim run | — | — | 7p | — |
| t21-a11y.log | 15:02 | intermediate | — | — | 11p | — |
| t21-rerun.log | 15:51 | intermediate | — | — | 30p | — |
| t21-keyboard-overscroll-red.log | 16:15 | red | — | — | 1F, 3p | WT |
| t21-audit-proof-2.log | 17:04 | review-2 red | — | — | 1F, 1p (expected 0, received 776) | WT |
| t21-reach-red.log | 17:05 | review-2 red | — | — | 3F, 2p | WT |
| t21-audit2-first.log | 17:07 | review-2 red | — | — | **3F**, 24p | WT |
| t21-audit2-ios.log | 17:08 | review-2 red | — | — | **2F**, 1p | WT |
| t21-audit2-run.log | 17:12 | green | — | — | 40p | — |
| t21-landing-build.log | 17:19 | final gate | `$ pnpm --filter @awardgrid/landing build` | — | built | — |
| t21-web-build.log | 17:19 | final gate | `$ next build` | — | Compiled successfully | — |
| t21-web-e2e.log | 17:31 | web e2e | `$ playwright test` | — | 583p, 145s (11.8 m) | — |
| t21-review3-red.log | 17:47 | review-3 red | — | — | 5F | WT |
| t21-audit3-run.log | 17:50 | green | — | — | 43p | — |
| t21-typecheck.log | 17:50 | final gate | `$ tsc --noEmit && …` | — | no errors | — |
| t21-lint.log | 17:50 | final gate | `$ eslint` | — | 0 errors, 1 warning | WT |
| t21-unit.log | 17:51 | final gate (unit) | `$ vitest run --passWithNoTests && …` | — | 92f/960p 2s · 61f/966p · 49f/798p | WT |
| t21-ios-build.log | 17:51 | final gate | `$ vite build && …` | — | 18 files, 118 markers, none found | — |
| t21-full-run.log | 17:56 | full UI/UX run | — | — | 306p (263 ios + 43 web-desktop, 5.6 m) | — |
| t21-evidence-run.log | 17:57 | evidence capture | — | — | 4p | — |

- **Screenshots (8):** `t21-ios-results-{320,390}-200-{light,dark}`, `t21-web-workspace-{390,768}-200-{light,dark}`.
- **Timing:** landing 17:19:15 · web-build 17:19:20 · web-e2e 17:31:12 · review3-red 17:47:08 · typecheck 17:50:46 · lint 17:50:59 · unit 17:51:14 · ios-build 17:51:15 · full 17:56:48 · evidence 17:57:07 · commit 17:58:36.

---

## Tasks with no raw log for their final gates (the evidence doc is the only record)

- **T07, T08, T09, T10:** no log for any final gate: typecheck, lint, unit, iOS build, landing build, Next build, or the full UI/UX run. The docs claim 72, 87, 103 and 122 passed; only the red log and the evidence-capture log exist.
- **T11 to T17:** the full UI/UX run has a log, but typecheck, lint, unit, iOS build, landing build and Next build exist only in the doc.
- **T18, T19, T20:** the unit run, full UI/UX run and web e2e have logs, but typecheck, lint, iOS build, landing build and Next build exist only in the doc.
- **Complete:** T01 (harness gates), T02, T03, T04, T05, T06 and T21 have a log for every final gate their doc lists.

## Logs showing a failure the committed doc does not mention

1. **Baseline arm64 Next build.** `baseline-gates-arm64/pnpm_build.log` (19:10) and `pnpm_build_cleanpath.log` (19:11) both end in `[ELIFECYCLE] Command failed with exit code 1.` after "Cannot find module '../lightningcss.darwin-x64.node'", and `summary.tsv` records `pnpm build 1`. The T01-baseline doc says only "`pnpm build` (Next) | 0 on arm64 re-run", and names only the x64 run as failed.
2. **T04 typecheck.** `T04/typecheck.log` (20:56) shows `[ELIFECYCLE] Command failed with exit code 2.` with 15 × TS2769. The T04 doc says "`pnpm typecheck` | 0 |".
3. **T04 first lint.** `t04-gates.log` (21:25) shows `exit=1 :: pnpm lint` (react-hooks/refs at `Sheet.tsx:31`). The T04 doc says "`pnpm lint` | 0 | 0 errors, the pre-existing `grid-table.tsx` warning", and lists t04-gates.log as a raw log.
4. **T21 review-2 runs.** `t21-audit2-first.log` shows "3 failed" and `t21-audit2-ios.log` shows "2 failed". The T21 doc never names either file. Its Review 2 table describes the same defects (CLOSE-1 "75,000" spilling a 112-wide cell; CLOSE-2 "Every segment in" cut), but its red row cites only `t21-audit-proof-2.log` and `t21-reach-red.log`.

**Mentioned in the doc, but described differently from the log:**
- **T01 Green 1:** the doc says "found `process is not defined`". That string does not appear in `T01/green-1.log`, which shows a `.miles` locator not found (1F, 4p).
- **T03:** the doc says "a pinned Ask test … failed once". `T03/test-2.log` shows 6 failed tests in core.
- **T07 red:** the doc gives every failure as "missing-values" not seeded. The log shows 9 of those plus 1 "partial".
- **T01 guard negative:** `T01/bundle-check-negative.log` (19:30) shows a failure message with no exit code. The doc describes only the two later negatives (19:52).

## Environment differences shown by the logs

- **`baseline-gates/*` (main checkout):** ran on x64 Node v22.16.0 under Rosetta. The logs show the Rosetta 2 warning, the `@next/swc-darwin-x64` download, and `Node.js v22.16.0`.
- **Baseline arm64 Next builds:** the arm64 build logs above load an x64 lightningcss binary.
- **`t04-isolation.log`:** ran in a throwaway worktree under `/private/tmp`, and is the only log that prints the pnpm version (v12.3.4).
- **Main checkout runs:** everything in `raw/T01/`, plus T02 `red.log`, `green-1.log` and `green-2.log`, ran in the main checkout.
- **Versions not recorded:** no log records the arm64 Node version, the Playwright version or the Chromium version.

## Other facts from the logs

- **T14:** the screenshots and evidence run (07:35) used `watches.spec.ts:192`. The final full run (07:41) has those tests at `:214`.
- **T17 and T20:** the evidence captures (09:47 and 13:40) are older than their final full runs (10:09 and 14:16).
- **T07–T13 bundle-check wording:** the docs quote the bundle check as "18 files, no fixture markers". That is close to the wording of `T01/ios-build.log` before hardening. Every iOS build log from 19:52 onward prints "18 files, N markers, none found in dist".
- **Out of scope:** `t22-*` logs (18:00–18:56) are not part of T01–T21, and `t22-fix-run.log` appeared while I was working.
