#!/usr/bin/env bash
#
# Phase 5, step 3: the Simulator probes, as one procedure a person can rerun. Results: docs/PHASE5.md §1.
# Phase 5, step 7 part B: the same harness with --e2e runs the end-to-end scenarios instead. Results: §2.
#
#   apps/ios/probes/run-probes.sh <scratch-dir>
#   apps/ios/probes/run-probes.sh --e2e <scratch-dir>
#
# Step 3's probes include A1b, which sends one request to api.anthropic.com with a key Anthropic rejects. --e2e sends
# nothing to Anthropic: its build rewrites api.anthropic.com to the probe server (src/probes/probe-transport.ts). The
# e2e phases are in e2e-phases.sh, which this script sources; everything else below is shared.
#
# In order (step 3):
#   1. Refuses to start if port 4599 or 4597 is already held. Starts the probe server (probe-server.mjs) on
#      127.0.0.1:4599 and the seats.aero mock on 127.0.0.1:4597, and records both PIDs. Nothing here starts, stops
#      or probes 3000 (live production), 3400 or 3999 (e2e).
#   2. Builds the probe app (VITE_AG_PROBES=1), syncs it, builds it for the Simulator (Debug) and installs it.
#   3. Arms one run on the probe server and launches the app. The app runs every probe on launch and posts each
#      result to the server; nothing is tapped. Waits in the log for the app's "done".
#      A0: if the app reports an App Transport Security failure, or never reaches the server, the Debug build gets
#      App/Info-Debug.plist with NSAllowsLocalNetworking (Release keeps App/Info.plist), a test pinning both, and
#      the run repeats once.
#   4. T5: waits in the log for the app's 60 s drip request, opens Settings about 3 s after the server logged it and
#      returns to awardgrid about 48 s after, each moment taken from the server's log, then waits for the result.
#   5. Stops both servers by the PIDs it started (never by port), rebuilds, syncs and reinstalls the normal app, and
#      runs R1 over the normal bundle.
#
# With --e2e, steps 2-4 are e2e-phases.sh's run_e2e instead: the e2e build (VITE_AG_PROBES=e2e) runs one phase per
# launch on the iPhone 17 Pro, then A4's layout phase on an iPhone SE (3rd generation) that it creates if none named
# $SE_NAME exists, and step 5 restores the normal app on both. If any phase timed out, a wait failed or the summary did
# not finish, it exits 9 after the restore and R1 (scenario FAILs in the summary are results and leave the exit at 0).
#
# Everything it writes (the probe log, build logs, screenshots, the summary) goes under <scratch-dir>, which may not
# be inside the repository. The Simulator is addressed by UDID ($SIM_UDID), so another booted device is never used.
set -euo pipefail

MODE=probes
if [ "${1:-}" = "--e2e" ]; then
  MODE=e2e
  shift
fi
SCRATCH_ARG="${1:?usage: apps/ios/probes/run-probes.sh [--e2e] <scratch-dir outside the repository>}"
UDID="${SIM_UDID:-A480530B-3036-4B12-80D4-F37A6130D898}"
BUNDLE="com.dowhiz.awardgrid"
PROBE_PORT=4599
MOCK_PORT=4597

export PATH="$HOME/.local/node-arm64/bin:$PATH"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
IOS="$REPO/apps/ios"
mkdir -p "$SCRATCH_ARG"
SCRATCH="$(cd "$SCRATCH_ARG" && pwd -P)"
case "$SCRATCH/" in
  "$REPO"/*)
    echo "run-probes: refusing: $SCRATCH is inside the repository" >&2
    exit 2
    ;;
esac

LOG="$SCRATCH/probe-log.jsonl"
APP="$IOS/ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app"
R1_PATTERN='127.0.0.1:45\|localhost:45\|probe-server\|sk-ant-'

say() { printf '[run-probes %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
plog() { node "$IOS/probes/probe-log.mjs" "$@"; }
held() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
server_post() { curl -fsS -X POST "http://127.0.0.1:$PROBE_PORT$1"; }
mark() { server_post "/mark?label=$1" >/dev/null; }
screenshot() { xcrun simctl io "$UDID" screenshot "$SCRATCH/$1.png" >/dev/null 2>&1 || true; }

# ---- Processes this script started, and only those ----

PROBE_PID=""
MOCK_PID=""
PROBE_BUILT=0
RESTORED=0

descendants() {
  local kid
  for kid in $(pgrep -P "$1" 2>/dev/null || true); do
    echo "$kid"
    descendants "$kid"
  done
}

# Stops a PID this script started and every process under it, polling until they are gone (10 s, then SIGKILL).
stop_tree() {
  local root="$1" pids p alive
  [ -n "$root" ] || return 0
  pids="$root $(descendants "$root" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 50); do
    alive=0
    for p in $pids; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && return 0
    sleep 0.2
  done
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
}

stop_servers() {
  stop_tree "$MOCK_PID"
  MOCK_PID=""
  stop_tree "$PROBE_PID"
  PROBE_PID=""
}

# The port's listener must be the process this script started (or one of its children).
owned_by() {
  local listener
  listener="$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [ -n "$listener" ] && { [ "$listener" = "$2" ] || descendants "$2" | grep -qx "$listener"; }
}

until_ready() {
  local seconds="$1" url="$2" pid="$3" deadline=$((SECONDS + $1))
  until curl -fsS -o /dev/null "$url" 2>/dev/null; do
    kill -0 "$pid" 2>/dev/null || { echo "run-probes: the process serving $url exited; see $SCRATCH" >&2; return 1; }
    [ "$SECONDS" -lt "$deadline" ] || { echo "run-probes: $url not ready after $seconds s" >&2; return 1; }
    sleep 0.25
  done
}

# ---- Builds ----

web_build() {
  local label="$1"
  shift
  if ! (cd "$IOS" && "$@" npm run build && npx cap sync ios) >"$SCRATCH/web-$label.log" 2>&1; then
    tail -40 "$SCRATCH/web-$label.log" >&2
    return 1
  fi
}

build_and_install() {
  local label="$1"
  if ! (cd "$IOS" && xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
    -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath ios/DerivedData \
    CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES build) >"$SCRATCH/xcodebuild-$label.log" 2>&1; then
    tail -40 "$SCRATCH/xcodebuild-$label.log" >&2
    return 1
  fi
  install_on "$UDID" "$label"
}

# Boots the Simulator with this UDID if it is not booted, and installs the app last built, replacing any copy.
install_on() {
  local udid="$1" label="$2"
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b >"$SCRATCH/bootstatus-$label-$udid.log" 2>&1
  xcrun simctl terminate "$udid" "$BUNDLE" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$APP"
}

# Other Simulators the e2e run installed the probe build on, which get the normal app back too.
EXTRA_UDIDS=""

restore_normal() {
  [ "$RESTORED" = 1 ] && return 0
  RESTORED=1
  say "restoring the normal app: npm run build && npx cap sync ios, then the Debug build and install"
  web_build normal env -u VITE_AG_PROBES
  build_and_install normal
  local extra
  for extra in $EXTRA_UDIDS; do install_on "$extra" normal; done
}

on_exit() {
  local code=$?
  if [ "$MODE" = e2e ] && declare -F host_loop_stop >/dev/null; then host_loop_stop; fi
  stop_servers
  if [ "$PROBE_BUILT" = 1 ] && [ "$RESTORED" = 0 ]; then
    restore_normal || say "restoring the normal app failed; see $SCRATCH/web-normal.log and xcodebuild-normal.log"
  fi
  exit "$code"
}
trap on_exit EXIT

# ---- A0's fallback (design §10.3): only when the probe server was unreachable because of ATS ----

apply_ats_debug_plist() {
  local app_dir="$IOS/ios/App/App" pbx="$IOS/ios/App/App.xcodeproj/project.pbxproj"
  cp "$app_dir/Info.plist" "$app_dir/Info-Debug.plist"
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$app_dir/Info-Debug.plist"
  # shellcheck disable=SC2016 # the single quotes are deliberate: ${hits} is a JavaScript template, not shell
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    let hits = 0;
    const out = fs.readFileSync(file, "utf8").replace(/\/\* Debug \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;[\s\S]*?\n\t\t\};/g, (block) => {
      if (!block.includes("INFOPLIST_FILE = App/Info.plist;")) return block;
      hits += 1;
      return block.replace("INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info-Debug.plist;");
    });
    if (hits !== 1) { console.error(`expected one Debug INFOPLIST_FILE, found ${hits}`); process.exit(1); }
    fs.writeFileSync(file, out);
  ' "$pbx"
  cat >"$IOS/src/ios-config.test.ts" <<'TS'
/**
 * The Debug build's App Transport Security exception, pinned (docs/PHASE5.md §1, A0).
 *
 * A0 measured that a Debug build without it could not reach the probe server on the Mac. It is Debug only: Release
 * keeps App/Info.plist, which has no NSAppTransportSecurity key.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.join(import.meta.dirname, "..", "ios", "App");
const read = (...parts: string[]) => readFileSync(path.join(APP, ...parts), "utf8");

describe("the App target's Info.plist per configuration", () => {
  it("Debug reads App/Info-Debug.plist and Release reads App/Info.plist", () => {
    const blocks = [...read("App.xcodeproj", "project.pbxproj").matchAll(/\/\* (Debug|Release) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;[\s\S]*?\n\t\t\};/g)];
    const files = blocks.flatMap((m) => {
      const file = /INFOPLIST_FILE = ([^;]+);/.exec(m[0])?.[1];
      return file === undefined ? [] : [[m[1], file]];
    });
    expect(files).toEqual([
      ["Debug", "App/Info-Debug.plist"],
      ["Release", "App/Info.plist"],
    ]);
  });

  it("Info-Debug.plist adds exactly one NSAppTransportSecurity dict, holding NSAllowsLocalNetworking = true", () => {
    const debug = read("App", "Info-Debug.plist");
    expect(debug.match(/<key>NSAppTransportSecurity<\/key>/g)).toHaveLength(1);
    expect(debug).toMatch(/<key>NSAppTransportSecurity<\/key>\s*<dict>\s*<key>NSAllowsLocalNetworking<\/key>\s*<true\/>\s*<\/dict>/);
    expect(read("App", "Info.plist")).not.toContain("NSAppTransportSecurity");
  });
});
TS
}

a0_blocked_by_ats() {
  node -e '
    const [file, after] = process.argv.slice(1);
    const entries = require("fs").readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const a0 = entries.filter((e) => e.seq > Number(after) && e.event === "app" && e.probe === "A0").at(-1);
    const v = (a0 && a0.values) || {};
    process.exit((v.ip && v.ip.ats) || (v.localhost && v.localhost.ats) ? 0 : 1);
  ' "$LOG" "$1"
}

ARM=""
# launch_armed LABEL [PHASE] [UDID]: terminate the app, arm one run (naming the e2e phase, if any), and launch it.
launch_armed() {
  local label="$1" phase="${2:-}" udid="${3:-$UDID}"
  xcrun simctl terminate "$udid" "$BUNDLE" >/dev/null 2>&1 || true
  if [ -n "$phase" ]; then ARM="$(server_post "/arm?phase=$phase")"; else ARM="$(server_post /arm)"; fi
  say "armed one run (log seq $ARM${phase:+, phase $phase}); launching $BUNDLE on $udid"
  xcrun simctl launch "$udid" "$BUNDLE" >"$SCRATCH/launch-$label.log" 2>&1
}

# ---- 1. Servers ----

for port in "$PROBE_PORT" "$MOCK_PORT"; do
  if held "$port"; then
    echo "run-probes: refusing to start: port $port is already held" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    exit 3
  fi
done
if [ -e "$LOG" ]; then mv "$LOG" "$SCRATCH/probe-log.$(date +%Y%m%d-%H%M%S).jsonl"; fi

say "starting the probe server on 127.0.0.1:$PROBE_PORT (log $LOG)"
PROBE_LOG="$LOG" node "$IOS/probes/probe-server.mjs" "$SCRATCH" >"$SCRATCH/probe-server.out" 2>&1 &
PROBE_PID=$!
say "starting the seats.aero mock on 127.0.0.1:$MOCK_PORT"
(cd "$REPO" && MOCK_SEATS_PORT="$MOCK_PORT" exec pnpm exec tsx scripts/mock-seatsaero.ts --demo) >"$SCRATCH/mock-seats.out" 2>&1 &
MOCK_PID=$!
printf 'probe-server %s\nmock-seats %s\n' "$PROBE_PID" "$MOCK_PID" >"$SCRATCH/pids.txt"

until_ready 20 "http://127.0.0.1:$PROBE_PORT/healthz" "$PROBE_PID"
until_ready 60 "http://127.0.0.1:$MOCK_PORT/healthz" "$MOCK_PID"
owned_by "$PROBE_PORT" "$PROBE_PID" || { echo "run-probes: port $PROBE_PORT is not held by the probe server this script started" >&2; exit 4; }
owned_by "$MOCK_PORT" "$MOCK_PID" || { echo "run-probes: port $MOCK_PORT is not held by the mock this script started" >&2; exit 4; }
say "servers ready: probe-server pid $PROBE_PID, mock pid $MOCK_PID"

# ---- 2-4, e2e: the phases in e2e-phases.sh ----

if [ "$MODE" = e2e ]; then
  # shellcheck source=apps/ios/probes/e2e-phases.sh
  . "$IOS/probes/e2e-phases.sh"
  run_e2e
fi

run_step3() {

# ---- 2. The probe app ----

PROBE_BUILT=1
say "building the probe app: VITE_AG_PROBES=1 npm run build && npx cap sync ios"
web_build probe env VITE_AG_PROBES=1
if ! grep -q "127.0.0.1:4599" "$IOS"/dist/assets/*.js; then
  echo "run-probes: the probe build carries no probe server URL; VITE_AG_PROBES did not take effect" >&2
  exit 1
fi
say "building and installing the Debug app"
build_and_install probe

# ---- 3. The probes, and A0's fallback ----

launch_armed first
if ! plog wait "$LOG" --after "$ARM" --app A0 --timeout 120 >/dev/null; then
  # No result at all is not evidence of ATS: the app may not have started. Changing project files on that guess would
  # add a Debug plist, and a test saying A0 measured the need for it, that nothing measured. Stop and show what happened.
  screenshot no-contact
  mark "A0:no-result-from-the-app"
  echo "run-probes: no A0 result from the app within 120 s; see the no-contact screenshot. No project file was changed." >&2
  exit 8
elif a0_blocked_by_ats "$ARM"; then
  NEED_ATS=1
else
  NEED_ATS=0
fi
if [ "$NEED_ATS" = 1 ]; then
  if [ -e "$IOS/ios/App/App/Info-Debug.plist" ]; then
    echo "run-probes: A0 fails with App/Info-Debug.plist already in place; stopping" >&2
    exit 5
  fi
  say "A0: the probe server was not reachable; adding App/Info-Debug.plist (Debug only) and running again"
  mark "A0:adding-Info-Debug.plist"
  apply_ats_debug_plist
  build_and_install probe-ats
  launch_armed second
  plog wait "$LOG" --after "$ARM" --app A0 --timeout 120 >/dev/null || { screenshot no-contact-after-ats; echo "run-probes: no A0 result after the ATS change" >&2; exit 5; }
fi

say "waiting for the app's done (A0 to X1)"
if ! plog wait "$LOG" --after "$ARM" --app "done" --timeout 420 >/dev/null; then
  screenshot no-done
  echo "run-probes: the app did not post done" >&2
  exit 6
fi
screenshot probes-done

# ---- 4. T5: leaving the app during a request ----

say "T5: waiting for the app's drip request"
plog wait "$LOG" --after "$ARM" --app t5_ready --timeout 60 >/dev/null
plog wait "$LOG" --after "$ARM" --request "probe=T5" --timeout 60 >/dev/null
plog wait "$LOG" --after "$ARM" --request "probe=T5" --elapsed 3000 --timeout 30 >/dev/null
mark "T5:host-opens-Settings"
xcrun simctl launch "$UDID" com.apple.Preferences >"$SCRATCH/launch-preferences.log" 2>&1
mark "T5:Settings-launch-returned"
screenshot t5-away
plog wait "$LOG" --after "$ARM" --request "probe=T5" --elapsed 48000 --timeout 90 >/dev/null
mark "T5:host-returns-to-awardgrid"
xcrun simctl launch "$UDID" "$BUNDLE" >"$SCRATCH/launch-return.log" 2>&1
mark "T5:awardgrid-launch-returned"
say "T5: waiting for the app's result"
if ! plog wait "$LOG" --after "$ARM" --app T5 --timeout 300 >/dev/null; then
  say "T5: no result from the app within 300 s (recorded as FAIL)"
fi
plog wait "$LOG" --after "$ARM" --app t5_done --timeout 30 >/dev/null || true
screenshot probes-final

plog summary "$LOG" --json "$SCRATCH/summary.json" | tee "$SCRATCH/summary.txt"

}

if [ "$MODE" = probes ]; then run_step3; fi

# ---- 5. Stop, restore, R1 ----

stop_servers
for port in "$PROBE_PORT" "$MOCK_PORT"; do
  if held "$port"; then say "warning: port $port is still held after stopping the servers this script started"; fi
done
say "servers stopped"

restore_normal
for f in "$IOS"/dist/assets/*[Pp]robe* "$IOS"/dist/assets/*e2e*; do
  if [ -e "$f" ]; then
    echo "run-probes: R1 FAILED: the normal bundle has a probe chunk: ${f#"$REPO"/}" >&2
    exit 7
  fi
done
say "R1: grep -c \"$R1_PATTERN\" apps/ios/dist/assets/*.js"
for f in "$IOS"/dist/assets/*.js; do
  printf '%s %s %s\n' "$(grep -c "$R1_PATTERN" "$f" || true)" "$(wc -c <"$f" | tr -d ' ')" "${f#"$REPO"/}"
done | tee "$SCRATCH/r1.txt"
if awk '$1 != "0" { bad = 1 } END { exit bad ? 0 : 1 }' "$SCRATCH/r1.txt"; then
  echo "run-probes: R1 FAILED: a probe host or key is in the normal bundle" >&2
  exit 7
fi
# Optional: R1_BASELINE names a `shasum -a 256` listing of a normal build's .js files made before the probe wiring changed.
if [ -n "${R1_BASELINE:-}" ]; then
  (cd "$IOS/dist/assets" && shasum -a 256 ./*.js | sed 's#  \./#  #') >"$SCRATCH/r1-sha256.txt"
  if diff <(grep '\.js$' "$R1_BASELINE" | sort) <(sort "$SCRATCH/r1-sha256.txt") >"$SCRATCH/r1-sha256.diff"; then
    say "R1: every .js file hashes identically to $R1_BASELINE"
  else
    echo "run-probes: R1 FAILED: the normal bundle differs from $R1_BASELINE (see r1-sha256.diff)" >&2
    exit 7
  fi
fi
if [ "$MODE" = e2e ]; then
  say "R1 passed. Probe log: $LOG; summary: $SCRATCH/summary-e2e.txt"
  # A phase that timed out, a wait that failed or a summary that did not finish leaves verdicts nobody should read as
  # a complete run, so the exit status says so. Scenario FAILs in the summary are results and do not change it.
  if [ -n "$E2E_FAILED" ]; then
    echo "run-probes: the e2e run is incomplete; phases or waits that failed:$E2E_FAILED" >&2
    exit 9
  fi
else
  say "R1 passed. Probe log: $LOG; summary: $SCRATCH/summary.txt"
fi
