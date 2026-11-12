#!/bin/bash
# tests/test_ctl_start_stop.sh
#
# Regression guard for PowerSentinelctl's command mapping. Found on a real
# device: `PowerSentinelctl stop` (no event name) wrote "start manual" to
# the control file - the branch matched start OR stop but always wrote
# "start" - so the manual event could never be stopped from the CLI and
# stayed active forever, ignoring any config change made after it started.
#
# Runs the real script (PS_JSON_CONF and JQ point it at a temp tree) and
# reads back what it wrote to the control file.

run_tests() {
  local tmp ctl
  tmp="$(mktemp -d)"
  ctl="$tmp/ctl"
  echo "{\"global\":{\"ctl_file\":\"$ctl\"}}" > "$tmp/PowerSentinel.json"
  runctl() { PS_JSON_CONF="$tmp/PowerSentinel.json" JQ="$JQ" bash "$REPO_ROOT/system/bin/PowerSentinelctl" "$@" 2>&1; }
  last() { tr -d '\n' < "$ctl"; }

  section "start / stop sin nombre de evento apuntan a manual"
  runctl start >/dev/null
  assert_eq "start manual" "$(last)" "start -> 'start manual'"
  runctl stop >/dev/null
  assert_eq "stop manual" "$(last)" "stop -> 'stop manual' (el bug: escribia 'start manual')"

  section "con nombre de evento se pasa tal cual"
  runctl start night >/dev/null
  assert_eq "start night" "$(last)" "start night"
  runctl stop night >/dev/null
  assert_eq "stop night" "$(last)" "stop night"
  runctl stop manual >/dev/null
  assert_eq "stop manual" "$(last)" "stop manual"

  section "otros comandos no se alteran"
  runctl pause >/dev/null
  assert_eq "pause" "$(last)" "pause"
  runctl resume >/dev/null
  assert_eq "resume" "$(last)" "resume"

  section "argumentos invalidos se rechazan y no llegan al fichero de control"
  echo "intacto" > "$ctl"
  runctl 'start;reboot' >/dev/null
  assert_eq "intacto" "$(last)" "metacaracteres de shell rechazados"
  runctl start a b >/dev/null
  assert_eq "intacto" "$(last)" "demasiados argumentos rechazados"

  rm -rf "$tmp"
}
