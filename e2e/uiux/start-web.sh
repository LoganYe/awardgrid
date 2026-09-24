#!/usr/bin/env bash
# UI/UX Web surface (plan 04 T18), started by playwright.uiux.config.ts. TEST-ONLY.
#   1. build when .next is missing or older than the web or core sources (this worktree's .next, never production's),
#   2. recreate and seed the throwaway SQLite file (scripts/uiux-web/seed.ts),
#   3. `next start` on 127.0.0.1:${UIUX_WEB_PORT:-4330}, on the fixture's clock, against the fixture's seats.aero.
# No Anthropic or Telegram key; never the runtime database; never a real seats.aero key.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Production serves the main checkout's .next (docs/uiux-v1 DECISIONS U-003): never build or start there.
if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
  echo "start-web: refusing to build or start the Next app outside a linked git worktree (U-003). Run with UIUX_WEB=0 here." >&2
  exit 1
fi

PORT="${UIUX_WEB_PORT:-4330}"
MOCK_PORT="${UIUX_WEB_MOCK_PORT:-4331}"
export DATABASE_PATH="${UIUX_WEB_DB:-${TMPDIR:-/tmp}/awardgrid-uiux-web/${PORT}.db}"
mkdir -p "$(dirname "$DATABASE_PATH")"
export MASTER_KEY="$(printf 'e%.0s' $(seq 1 64))"
export SEATS_AERO_BASE_URL="http://127.0.0.1:${MOCK_PORT}/partnerapi/"
export APP_URL="http://127.0.0.1:${PORT}"
export COOKIE_SECURE=false
export NODE_ENV=production
export ANTHROPIC_API_KEY=""
export TELEGRAM_BOT_TOKEN=""
export TELEGRAM_BOT_USERNAME=""
export TZ=UTC
# The fixture's clock, as e2e/uiux/helpers.ts sets the browser's; UIUX_WEB_NOW, when set, moves both (harness checks).
export UIUX_WEB_NOW="${UIUX_WEB_NOW:-$(node -e 'process.stdout.write(require("./packages/core/test/fixtures/uiux/scenarios.json").now)')}"

# Everything compiled into the build: the web and core sources, core's data (places.json) and exports map, the tokens,
# and the root config. Directories count too, so a deleted or renamed file also rebuilds (T18 review FIX-4).
BUILD_INPUTS=(src packages/core packages/tokens package.json pnpm-lock.yaml tsconfig.json next.config.* postcss.config.*)
if [ ! -f .next/BUILD_ID ] || [ -n "$(find "${BUILD_INPUTS[@]}" -name node_modules -prune -o -newer .next/BUILD_ID -print 2>/dev/null | head -1)" ]; then
  echo "start-web: building (.next missing or older than the sources)"
  pnpm exec next build
fi

pnpm exec tsx scripts/uiux-web/seed.ts
NODE_OPTIONS="--import=$(pwd)/e2e/uiux/web-clock.mjs" exec pnpm exec next start -H 127.0.0.1 -p "$PORT"
