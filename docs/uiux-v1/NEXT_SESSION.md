# Next session — how to resume UI/UX v1

Read first: the handoff pack's `CLAUDE_CODE_PROMPT.md` and `RESUME_PROMPT.md`, then this folder's `STATUS.md`, `DECISIONS.md`, `REPO_MAP.md`, `ACCEPTANCE.md`. Confirm state from git, not from these notes.

## Environment (every shell)

```sh
cd /Users/yegaoyang/Desktop/workspace/awardgrid-uiux   # the WORKTREE; never work in ../awardgrid (production runs from it)
export PATH="$HOME/.local/node-arm64/bin:$PATH"   # arm64 node + pnpm 12.3.4; the default node is x64/Rosetta
git status --short && git log --oneline -5
```

Never in this checkout: `pnpm build`, `next build`, `scripts/check-no-secrets-in-bundle.sh --build`, or `pnpm e2e` when `.next/BUILD_ID` is missing — the production LaunchAgent on :3000 serves this `.next` (DECISIONS U-003). Web builds/e2e for M4 go in a separate git worktree. A full `pnpm e2e` also rewrites tracked `docs/screenshots/v0.2/**`; restore them after.

## Where things stand

- Branch `uiux/quiet-precision-v1` in the worktree above, one local commit per finished task (see `git log`). Nothing pushed.
- T01–T03 verified. T04 is next.
- If the worktree's `node_modules` is missing: `for d in node_modules apps/ios/node_modules packages/core/node_modules sites/landing/node_modules; do cp -Rc ../awardgrid/$d $d; done`; vendor: `rsync -a --exclude=.git ../awardgrid/vendor/travel-hacking-toolkit/ vendor/travel-hacking-toolkit/`; then `pnpm build:plugin`.
- Open owner decision: restart `com.awardgrid.app` to fix the live stylesheet 404 (STATUS.md).

## Next commands

```sh
# T04 red test (create e2e/uiux/foundations.spec.ts first)
pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/foundations.spec.ts
# UI/UX browser suite (fixture host on 127.0.0.1:4310)
pnpm exec playwright test --config=playwright.uiux.config.ts
# Gates
pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @awardgrid/ios build
```
