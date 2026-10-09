#!/usr/bin/env bash
# Kickoff §9 Phase-2 self-acceptance: "no key material in logs or client bundles (CI grep of
# .next output for fixture key strings)".
#
# Usage:  bash scripts/check-no-secrets-in-bundle.sh [--build]
#   - Uses the existing .next/ output; builds it first when missing or when --build is given.
#   - Exit 1 if any fixture/seed key literal (or the dev master key) appears ANYWHERE under
#     .next/ (server or client), or if "Partner-Authorization" appears in a client chunk
#     (.next/static/**, including the standalone copy). Server chunks may name the header;
#     the browser must never build a seats.aero request itself.
#   - Exit 0 when clean.
#
# Keep the FIXTURE_STRINGS list in sync with the literals used by tests and scripts/seed-dev.ts.
# The greps are fixed-string (-F) so nothing here is a regex.
set -euo pipefail

cd "$(dirname "$0")/.."

NEXT_DIR=".next"
if [[ "${1:-}" == "--build" || ! -f "$NEXT_DIR/BUILD_ID" ]]; then
  echo "check-no-secrets-in-bundle: building (pnpm exec next build)"
  pnpm exec next build >/dev/null
fi

# Literal fake keys used by tests (src/**/*.test.ts, test/**) and by scripts/seed-dev.ts, plus
# generic markers those fixtures embed so a renamed fixture is still caught.
FIXTURE_STRINGS=(
  # scripts/seed-dev.ts
  "seeded-dev-alice-FAKE-SEATS-TOKEN-a1c3"
  "seeded-dev-bob-FAKE-SEATS-TOKEN-b0b7"
  "seeded-dev-alice-FAKE-a1c3"
  "seeded-dev-bob-FAKE-b0b7"
  "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"
  "password123"
  # test fixtures / colocated tests
  "alice_pro_key_SECRET_a1b2c3"
  "bob_pro_key_SECRET_z9y8x7"
  "pro_key_topsecret_1234"
  "pro_key_topsecret_1235"
  "pro_test_key_ABC123xyz_DO_NOT_LEAK"
  "pro_secret_key_1234"
  "pro_live_SUPERSECRETKEYVALUE_zx9q"
  "pro_live_SECRET_do_not_leak_9876"
  "pro_key_for_find_tests_SECRET"
  # generic markers
  "FAKE_SEATS"
  "FAKE-SEATS-TOKEN"
  "_SECRET_"
  "SUPERSECRET"
  "DO_NOT_LEAK"
)

status=0

echo "check-no-secrets-in-bundle: scanning $NEXT_DIR/ for fixture key strings"
grep_args=()
for s in "${FIXTURE_STRINGS[@]}"; do grep_args+=(-e "$s"); done
# -r recursive, -I skip binaries, -l list files, -F fixed strings. grep exits 1 when nothing matches.
# Third-party code copied into .next/standalone/node_modules is excluded: it cannot contain our
# fixtures, and the generic markers would otherwise false-positive on unrelated constants.
if hits=$(grep -rIlF --exclude-dir=node_modules "${grep_args[@]}" "$NEXT_DIR" 2>/dev/null) && [[ -n "$hits" ]]; then
  echo "FAIL: fixture key material found in build output:"
  echo "$hits" | sed 's/^/  /'
  status=1
else
  echo "  ok: none of ${#FIXTURE_STRINGS[@]} fixture strings present (third-party node_modules excluded)"
fi

echo "check-no-secrets-in-bundle: scanning client chunks for Partner-Authorization"
client_dirs=()
[[ -d "$NEXT_DIR/static" ]] && client_dirs+=("$NEXT_DIR/static")
[[ -d "$NEXT_DIR/standalone/.next/static" ]] && client_dirs+=("$NEXT_DIR/standalone/.next/static")
if [[ ${#client_dirs[@]} -eq 0 ]]; then
  echo "FAIL: no client chunk directory found under $NEXT_DIR (is the build complete?)"
  status=1
elif hits=$(grep -rIliF -e "Partner-Authorization" "${client_dirs[@]}" 2>/dev/null) && [[ -n "$hits" ]]; then
  echo "FAIL: Partner-Authorization referenced in client chunks:"
  echo "$hits" | sed 's/^/  /'
  status=1
else
  echo "  ok: no client chunk references the seats.aero auth header (${client_dirs[*]})"
fi

if [[ $status -eq 0 ]]; then
  echo "check-no-secrets-in-bundle: PASS"
else
  echo "check-no-secrets-in-bundle: FAIL"
fi
exit $status
