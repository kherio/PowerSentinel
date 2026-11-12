#!/bin/bash
# tests/test_tune_system_ownership.sh
#
# Regression guard for action_tune_apply/undo (tune_system, v4.18.0):
# two sysctl knobs (vm.stat_interval, vm.dirty_writeback_centisecs) that
# are only ever RAISED while an event is active. Built to the same
# ownership/composition contract as kill_wifi / restrict_data / low_ram,
# so this mirrors the bug classes those had to be fixed for, plus the
# knob-specific ones: (1) the capability gate must stop everything,
# (2) the real original is recorded once and never overwritten with the
# value PowerSentinel itself wrote, (3) a knob already at or above the
# target is never lowered and never recorded, (4) undo restores the real
# originals, but not while another active event still wants tune_system.
#
# The knobs live under $tune_sysctl_root, pointed here at a fake tree so
# the real script runs against plain files, no root and no device.

run_tests() {
  local root
  root="$(mktemp -d)"
  tune_sysctl_root="$root"
  tune_state_file="$root/tunestate"
  json_conf="$root/PowerSentinel.json"
  echo '{"global":{},"events":{}}' > "$json_conf"
  mkdir -p "$root/vm"

  log_msg() { :; }
  emit() { :; }

  local stat="$root/vm/stat_interval" wb="$root/vm/dirty_writeback_centisecs"
  reset_knobs() { echo 1 > "$stat"; echo 500 > "$wb"; rm -f "$tune_state_file"; }
  val() { tr -d '[:space:]' < "$1"; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"

  event="night"; active_events=(night)
  tune_system="true"
  config_get_event_raw() { echo "false"; }

  section "capability gate"
  reset_knobs
  capability_has() { return 1; }
  action_tune_apply
  assert_eq "1" "$(val "$stat")" "sin la capacidad kernel_tunables no se toca stat_interval"
  assert_eq "500" "$(val "$wb")" "sin la capacidad no se toca el writeback"
  [ -f "$tune_state_file" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "sin la capacidad no se crea el fichero de estado"

  section "apply: sube los dos intervalos y graba los originales reales"
  reset_knobs
  capability_has() { return 0; }
  action_tune_apply
  assert_eq "10" "$(val "$stat")" "stat_interval pasa de 1 a 10"
  assert_eq "3000" "$(val "$wb")" "dirty_writeback_centisecs pasa de 500 a 3000"
  assert_eq "$root/vm/stat_interval 1" "$(grep stat_interval "$tune_state_file")" "se graba el original REAL de stat_interval (1)"
  assert_eq "$root/vm/dirty_writeback_centisecs 500" "$(grep dirty_writeback "$tune_state_file")" "se graba el original REAL del writeback (500)"

  section "reentrada: un segundo apply no re-graba el original"
  action_tune_apply
  assert_eq "2" "$(wc -l < "$tune_state_file" | tr -d ' ')" "siguen siendo 2 lineas, sin duplicados"
  assert_eq "$root/vm/stat_interval 1" "$(grep stat_interval "$tune_state_file")" "el original (1) no se sobreescribe con el 10 que puso PowerSentinel"

  section "composicion: otro evento activo tambien lo quiere - undo no restaura"
  config_get_event_raw() { echo "true"; }
  active_events=(night screen_off)
  action_tune_undo
  assert_eq "10" "$(val "$stat")" "con otro evento que aun lo quiere, stat_interval sigue en 10"
  [ -s "$tune_state_file" ]
  assert_true $? "y el registro de originales sigue ahi"

  section "undo: sin otro evento, se restauran los originales y se borra el registro"
  config_get_event_raw() { echo "false"; }
  active_events=(night)
  action_tune_undo
  assert_eq "1" "$(val "$stat")" "stat_interval vuelve a 1"
  assert_eq "500" "$(val "$wb")" "el writeback vuelve a 500"
  [ -f "$tune_state_file" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "el fichero de estado se borra tras el undo real"

  section "nunca se baja un valor que ya estaba mas alto"
  echo 30 > "$stat"; echo 6000 > "$wb"; rm -f "$tune_state_file"
  action_tune_apply
  assert_eq "30" "$(val "$stat")" "stat_interval=30 (>= objetivo 10) no se toca"
  assert_eq "6000" "$(val "$wb")" "writeback=6000 (>= objetivo 3000) no se toca"
  [ -f "$tune_state_file" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "y no se registra nada, asi que el undo tampoco toca nada"
  action_tune_undo
  assert_eq "30" "$(val "$stat")" "el undo no cambia un valor que nunca fue nuestro"

  section "solo un knob presente (otro kernel): el otro se ignora sin romper nada"
  reset_knobs; rm -f "$wb"
  action_tune_apply
  assert_eq "10" "$(val "$stat")" "el knob que existe si se ajusta"
  action_tune_undo
  assert_eq "1" "$(val "$stat")" "y se restaura"

  section "tune_system=false: ni apply ni undo hacen nada"
  reset_knobs
  tune_system="false"
  action_tune_apply
  assert_eq "1" "$(val "$stat")" "con tune_system=false no se toca nada"

  rm -rf "$root"
}
