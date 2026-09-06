#!/usr/bin/env bash
# Playwright webServer entry for the app (playwright.config.ts passes the environment):
#   1. build once if .next/BUILD_ID is missing (webServers start before globalSetup),
#   2. recreate + seed the throwaway SQLite file (scripts/seed-e2e.ts --fresh),
#   3. exec `next start` on 127.0.0.1:${E2E_APP_PORT:-3400}.
# Never points at the runtime database; never prints a key.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${E2E_DB_PATH:?set by playwright.config.ts (throwaway SQLite path)}"
export DATABASE_PATH="$E2E_DB_PATH"
export MASTER_KEY="${MASTER_KEY:-$(printf 'e%.0s' $(seq 1 64))}"
export SEATS_AERO_BASE_URL="${SEATS_AERO_BASE_URL:-http://127.0.0.1:3999/partnerapi/}"
export APP_URL="${APP_URL:-http://127.0.0.1:${E2E_APP_PORT:-3400}}"
export COOKIE_SECURE="${COOKIE_SECURE:-false}"
export NODE_ENV=production
# Ask lane shows its "not configured" state; Telegram uses the mock transport.
export ANTHROPIC_API_KEY=""
export TELEGRAM_BOT_TOKEN=""
export TELEGRAM_BOT_USERNAME=""
export TZ="${TZ:-UTC}"

if [ ! -f .next/BUILD_ID ]; then
  echo "start-app: .next/BUILD_ID missing — running next build (run 'pnpm build' beforehand to skip this)"
  pnpm exec next build
fi

pnpm exec tsx scripts/seed-e2e.ts --db "$DATABASE_PATH" --fresh
exec pnpm exec next start -H 127.0.0.1 -p "${E2E_APP_PORT:-3400}"
