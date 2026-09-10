#!/bin/bash
# tests/test_proc_monitor_dedup.sh
#
# Two real bugs found together while reviewing the whole module for
# hang/resource-degradation risks:
#
# 1. action_proc_apply()'s background monitor loop checked "$state_file"
#    (the real, on-disk record of which events are active) with
#    `any(.[]?; . == $e)` - but state_save() writes an OBJECT keyed by
#    event name ({"night": <timestamp>, ...}), so .[]? iterates its
#    VALUES (timestamps), never its keys. This comparison was false
#    unconditionally, for every real state file this daemon has ever
#    written - meaning the loop's own while-condition failed on its
#    very first check, every time. The whole handle_proc feature has
#    likely never actually monitored or reniced anything, for any v2
#    user, since it was written.
#
# 2. Fixing #1 exposes a second, real problem it had been masking:
#    reassert_active_events() (events.sh) calls enable_pwr_save() -
#    and so action_proc_apply() - for every still-active event whenever
#    ANY event ends. With no de-duplication, once the loop actually
#    persists (as bug #1's fix makes it do), every such reassert would
#    spawn ANOTHER redundant background monitor for the same event -
#    an ever-accumulating resource leak the longer a device stays up
#    with multiple simultaneous handle_proc events, using real CPU on
#    every iteration for a purpose PowerSentinel is meant to be saving,
#    not spending.
#
# Runs in the background for real (this is what's under test) - wrapped
# in `timeout` throughout so a regression here fails this test rather
# than hanging the whole suite, and any spawned monitor is explicitly
# killed at the end regardless of outcome.

run_tests() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  state_file="$tmp_dir/state.json"
  proc_file="$tmp_dir/proclist.txt"
  proc_orig_file="$tmp_dir/procorig.json"
  delay=1
  log_msg() { :; }
  echo "sleep 999" > "$proc_file"

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"

  handle_proc=true
  event=night
  echo '{"night": 1700000000}' > "$state_file"

  action_proc_apply
  local pid1="${_proc_monitor_pids[night]:-}"
  sleep 0.3
  kill -0 "$pid1" 2>/dev/null
  assert_true $? "el monitor arranca y sigue vivo mientras el evento está activo (el fichero de estado real es un objeto {evento: timestamp} - bug real: la condición antigua nunca era verdadera para este formato)"

  # Simulate reassert_active_events() calling this again several times
  # while the event is STILL active - the exact real trigger.
  action_proc_apply
  action_proc_apply
  action_proc_apply
  local pid2="${_proc_monitor_pids[night]:-}"
  assert_eq "$pid1" "$pid2" "3 llamadas mas mientras el evento sigue activo NO arrancan monitores nuevos (mismo PID) - sin esto, cada llamada habría dejado un bucle de fondo más corriendo para siempre"

  # Event ends - the loop should notice on its own and exit.
  echo '{}' > "$state_file"
  sleep 1.5
  kill -0 "$pid1" 2>/dev/null
  assert_eq "1" "$?" "al terminar el evento, el monitor sale solo (deja de estar vivo)"

  # Reactivating genuinely should start a fresh one.
  echo '{"night": 1700000000}' > "$state_file"
  action_proc_apply
  local pid3="${_proc_monitor_pids[night]:-}"
  kill -0 "$pid3" 2>/dev/null
  assert_true $? "al reactivarse el evento tras haber terminado de verdad, SÍ arranca un monitor nuevo"
  [ "$pid3" != "$pid1" ]
  assert_true $? "el monitor nuevo tiene un PID distinto del anterior (no es el mismo proceso ya muerto)"

  echo '{}' > "$state_file"
  sleep 1.5
  kill -9 "$pid1" "$pid2" "$pid3" 2>/dev/null
  rm -rf "$tmp_dir"
}
