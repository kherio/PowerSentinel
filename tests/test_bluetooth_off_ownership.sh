#!/bin/bash
# tests/test_bluetooth_off_ownership.sh
#
# bluetooth_off: turns Bluetooth off only when it is on AND nothing is
# connected (unknown/unrecognised dump counts as connected). Records the
# original once, turns it back on only if still off when the last event
# that wants it ends, never acts without the capability or the option,
# and recovers after a crash.

run_tests() {
  local root; root="$(mktemp -d)"
  bt_state_file="$root/btstate"
  export BT_DUMP_FILE="$root/dump"
  log_msg() { :; }; emit() { :; }
  BT=1; SVC=()
  settings() { [ "$1" = get ] && [ "$3" = bluetooth_on ] && echo "$BT"; }
  svc() { SVC+=("$*"); case "$2" in disable) BT=0;; enable) BT=1;; esac; }
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"
  event="night"; active_events=(night); bluetooth_off="true"
  config_get_event_raw() { echo false; }
  capability_has() { return 0; }
  reset() { BT=1; SVC=(); rm -f "$bt_state_file"; }
  NOCONN=$'Bluetooth Status\n  enabled: true\n  Connected devices: 0\n  state: ON'
  CONN=$'Bluetooth Status\n  enabled: true\n  Profile: A2DP\n    mCurrentDevice: AA:BB:CC:DD:EE:FF'

  section "nada conectado: se apaga y se graba el original"
  reset; echo "$NOCONN" > "$BT_DUMP_FILE"
  action_bt_apply
  assert_eq "bluetooth disable" "${SVC[*]}" "svc bluetooth disable"
  assert_eq "bluetooth_on 1" "$(cat "$bt_state_file")" "original grabado"

  section "dispositivo conectado: no se toca"
  reset; echo "$CONN" > "$BT_DUMP_FILE"; action_bt_apply
  assert_eq "0" "${#SVC[@]}" "conectado: nada"
  [ -f "$bt_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "ni registro"

  section "formato desconocido o vacio: se asume conectado"
  reset; echo "algo raro" > "$BT_DUMP_FILE"; action_bt_apply
  assert_eq "0" "${#SVC[@]}" "formato no reconocido: nada"
  reset; : > "$BT_DUMP_FILE"; action_bt_apply
  assert_eq "0" "${#SVC[@]}" "vacio: nada"

  section "ya apagado por el usuario: ni se toca ni se registra"
  reset; BT=0; echo "$NOCONN" > "$BT_DUMP_FILE"; action_bt_apply; action_bt_undo
  assert_eq "0" "${#SVC[@]}" "no hace nada (tampoco lo enciende)"

  section "undo: lo vuelve a encender"
  reset; echo "$NOCONN" > "$BT_DUMP_FILE"; action_bt_apply; SVC=()
  config_get_event_raw() { echo true; }; active_events=(night x)
  action_bt_undo
  assert_eq "0" "${#SVC[@]}" "otro evento lo quiere: sigue apagado"
  config_get_event_raw() { echo false; }; active_events=(night)
  action_bt_undo
  assert_eq "bluetooth enable" "${SVC[*]}" "restaurado"
  [ -f "$bt_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "registro borrado"

  section "si el usuario lo encendio mientras tanto, se respeta"
  reset; echo "$NOCONN" > "$BT_DUMP_FILE"; action_bt_apply; SVC=(); BT=1
  action_bt_undo
  assert_eq "0" "${#SVC[@]}" "no se vuelve a 'encender'"

  section "sin opcion o sin capacidad"
  reset; echo "$NOCONN" > "$BT_DUMP_FILE"; bluetooth_off=false; action_bt_apply
  assert_eq "0" "${#SVC[@]}" "opcion desactivada: nada"
  bluetooth_off=true; capability_has() { return 1; }; action_bt_apply
  assert_eq "0" "${#SVC[@]}" "sin capacidad: nada"
  capability_has() { return 0; }

  section "recuperacion al arrancar"
  reset; echo "$NOCONN" > "$BT_DUMP_FILE"; action_bt_apply; SVC=(); active_events=()
  action_bt_recover
  assert_eq "bluetooth enable" "${SVC[*]}" "Bluetooth devuelto"
  SVC=(); action_bt_recover
  assert_eq "0" "${#SVC[@]}" "sin registro: nada"
  unset BT_DUMP_FILE
}
