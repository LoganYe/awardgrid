# shellcheck shell=bash
#
# Phase 5, step 7 part B: the e2e phases, sourced by run-probes.sh --e2e (which defines UDID, BUNDLE, IOS, SCRATCH,
# LOG, say, plog, mark, web_build, build_and_install, install_on, launch_armed and EXTRA_UDIDS). Results: docs/PHASE5.md §2.
#
# The app side is apps/ios/src/probes/e2e-driver.ts. Each launch is armed with one phase; the app runs it through its
# own services and posts every result to the probe server. This file does what the app cannot do to itself, each at a
# moment read from the server's log: take screenshots (through e2e-host.mjs, which runs beside it), open Settings and
# come back (E7), terminate the app and launch it again (E3, E8), and create and use the iPhone SE (A4).
#
#   a3            17 Pro   A5 with no keys; A3: no Anthropic key; a grid search against the mock
#   e1            17 Pro   E1, E2, and E3 up to Stop
#   e3_relaunch   17 Pro   E3 after a relaunch, E4, E5, E6; A5 after a 413
#   e7            17 Pro   E7: Settings 3 s into a 40 s request, back at 30 s
#   e8            17 Pro   E8: terminated during a slow request
#   e8_relaunch   17 Pro   E8 after the relaunch
#   layout:17pro  17 Pro   A4 and A5's states
#   layout:se     SE       the same, on an iPhone SE (3rd generation)
#
# A phase that fails or times out is recorded (screenshot, log line) and the next phase still runs: every launch after
# it starts from a fresh process. Nothing here waits with a bare sleep; every wait polls the log with a timeout.

SE_NAME="${SE_NAME:-awardgrid iPhone SE (3rd generation)}"
SE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation"
HOST_PID=""
E2E_FAILED=""

host_loop_start() {
  local udid="$1" label="$2" after
  after="$(server_post "/mark?label=e2e-host:$label:start")"
  node "$IOS/probes/e2e-host.mjs" --log "$LOG" --udid "$udid" --shots "$SCRATCH/shots" --mock "$SCRATCH/mock-seats.out" --after "$after" \
    >"$SCRATCH/e2e-host-$label.out" 2>&1 &
  HOST_PID=$!
  say "e2e-host for $label ($udid) pid $HOST_PID"
}

host_loop_stop() {
  [ -n "$HOST_PID" ] || return 0
  stop_tree "$HOST_PID"
  HOST_PID=""
}

# e2e_wait_phase PHASE TIMEOUT: wait for the app's phase-done post; record a failure and go on.
e2e_wait_phase() {
  local phase="$1" timeout="$2" udid="${3:-$UDID}" hit
  if ! hit="$(plog wait "$LOG" --after "$ARM" --app "phase-done:$phase" --timeout "$timeout")"; then
    say "phase $phase: no phase-done within $timeout s (recorded as a failure)"
    mark "phase-timeout:$phase"
    xcrun simctl io "$udid" screenshot "$SCRATCH/shots/timeout-${phase/:/-}.png" >/dev/null 2>&1 || true
    E2E_FAILED="$E2E_FAILED $phase"
    return 1
  fi
  say "phase $phase done: $hit"
}

# e2e_wait NAME ARGS…: plog wait, recording a failure instead of exiting.
e2e_wait() {
  local name="$1"
  shift
  if ! plog wait "$LOG" --after "$ARM" "$@" >/dev/null; then
    say "$name: wait failed ($*)"
    mark "wait-failed:$name"
    E2E_FAILED="$E2E_FAILED $name"
    return 1
  fi
}

se_udid() {
  local found
  found="$(xcrun simctl list devices -j | node -e '
    const name = process.argv[1];
    const all = Object.values(JSON.parse(require("fs").readFileSync(0, "utf8")).devices).flat();
    const hit = all.find((d) => d.name === name && d.isAvailable !== false);
    process.stdout.write(hit ? hit.udid : "");
  ' "$SE_NAME")"
  if [ -z "$found" ]; then
    local runtime
    runtime="$(xcrun simctl list runtimes -j | node -e '
      const rts = JSON.parse(require("fs").readFileSync(0, "utf8")).runtimes.filter((r) => r.isAvailable && r.platform === "iOS");
      const fits = rts.filter((r) => (r.supportedDeviceTypes ?? []).some((t) => t.identifier === process.argv[1]));
      fits.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
      process.stdout.write(fits[0] ? fits[0].identifier : "");
    ' "$SE_TYPE")"
    [ -n "$runtime" ] || { echo "run-probes: no installed iOS runtime supports $SE_TYPE" >&2; return 1; }
    found="$(xcrun simctl create "$SE_NAME" "$SE_TYPE" "$runtime")"
    say "created $SE_NAME ($found) on $runtime" >&2
  fi
  printf '%s' "$found"
}

run_e2e() {
  # shellcheck disable=SC2034 # read by run-probes.sh's on_exit, which restores the normal app
  PROBE_BUILT=1
  mkdir -p "$SCRATCH/shots"
  say "building the e2e app: VITE_AG_PROBES=e2e npm run build && npx cap sync ios"
  web_build e2e env VITE_AG_PROBES=e2e
  if ! grep -q "127.0.0.1:4599" "$IOS"/dist/assets/*.js; then
    echo "run-probes: the e2e build carries no probe server URL; VITE_AG_PROBES did not take effect" >&2
    exit 1
  fi
  say "building and installing the Debug app on $UDID"
  build_and_install e2e

  host_loop_start "$UDID" 17pro

  # ---- A3 ----
  launch_armed a3 a3
  e2e_wait_phase a3 300 || true

  # ---- E1, E2, E3 up to Stop; then the relaunch, E4, E5, E6 ----
  launch_armed e1 e1
  if e2e_wait e3-ready --app e3_ready_for_relaunch --timeout 900; then
    # Stop does not end the replay the app stopped listening to; its end is in the log before the app is terminated.
    e2e_wait e3-verdict --verdict E3-q2-r2 --timeout 120 || true
    mark "E3:host-terminates"
    xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
    mark "E3:terminated"
  else
    plog wait "$LOG" --after "$ARM" --app "phase-done:e1" --timeout 5 >/dev/null || true
  fi
  launch_armed e3-relaunch e3_relaunch
  e2e_wait_phase e3_relaunch 900 || true

  # ---- E7: leave 3 s into a 40 s request, return at 30 s ----
  launch_armed e7 e7
  if e2e_wait e7-request --request /sse/v1/messages --label E7-r1 --timeout 120 &&
    e2e_wait e7-3s --request /sse/v1/messages --label E7-r1 --elapsed 3000 --timeout 30; then
    mark "E7:host-opens-Settings"
    xcrun simctl launch "$UDID" com.apple.Preferences >"$SCRATCH/launch-e7-preferences.log" 2>&1
    mark "E7:Settings-launch-returned"
    xcrun simctl io "$UDID" screenshot "$SCRATCH/shots/e7-away.png" >/dev/null 2>&1 || true
    e2e_wait e7-30s --request /sse/v1/messages --label E7-r1 --elapsed 30000 --timeout 60 || true
    mark "E7:host-returns-to-awardgrid"
    xcrun simctl launch "$UDID" "$BUNDLE" >"$SCRATCH/launch-e7-return.log" 2>&1
    mark "E7:awardgrid-launch-returned"
  fi
  e2e_wait_phase e7 300 || true

  # ---- E8: terminated during a slow request ----
  launch_armed e8 e8
  if e2e_wait e8-out --app e8_request_out --timeout 120 &&
    e2e_wait e8-3s --request /sse/v1/messages --label E8 --elapsed 3000 --timeout 30; then
    mark "E8:host-terminates"
    xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
    mark "E8:terminated"
  fi
  launch_armed e8-relaunch e8_relaunch
  e2e_wait_phase e8_relaunch 300 || true

  # ---- A4 on the iPhone 17 Pro ----
  launch_armed layout-17pro layout:17pro
  e2e_wait_phase layout:17pro 600 || true
  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
  host_loop_stop

  # ---- A4 on an iPhone SE (3rd generation) ----
  local se
  se="$(se_udid)"
  printf 'se %s\n' "$se" >>"$SCRATCH/pids.txt"
  EXTRA_UDIDS="$EXTRA_UDIDS $se"
  install_on "$se" e2e
  host_loop_start "$se" se
  launch_armed layout-se layout:se "$se"
  e2e_wait_phase layout:se 600 "$se" || true
  xcrun simctl terminate "$se" "$BUNDLE" >/dev/null 2>&1 || true
  host_loop_stop

  # A scenario FAIL is a result, not an error: summary-e2e exits non-zero only if it could not read the log.
  if ! plog summary-e2e "$LOG" --mock "$SCRATCH/mock-seats.out" --shots "$SCRATCH/shots" --json "$SCRATCH/summary-e2e.json" | tee "$SCRATCH/summary-e2e.txt"; then
    say "summary-e2e did not finish (recorded as a failure)"
    E2E_FAILED="$E2E_FAILED summary-e2e"
  fi
  # run-probes.sh exits 9 on a non-empty E2E_FAILED, after the restore and R1.
  if [ -n "$E2E_FAILED" ]; then say "phases or waits that failed:$E2E_FAILED"; else say "every phase reported done"; fi
}
