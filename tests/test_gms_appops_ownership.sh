#!/bin/bash
# tests/test_gms_appops_ownership.sh
#
# gms_scan_off (WIFI_SCAN, BLUETOOTH_SCAN) and gms_wakelock_off (WAKE_LOCK):
# deny an app-op to Google Play Services while an event wants it. Only
# changes ops that are allow/default, records the originals once, restores
# them only while still "ignore" and when the LAST event wanting THAT
# switch ends (each switch independently), never acts without the
# capability/option, and recovers after a crash.

run_tests() {
  local root; root="$(mktemp -d)"
  gmsops_state_file="$root/gmsops"
  log_msg() { :; }; emit() { :; }
  declare -A M=(); SETS=()
  cmd() {
    [ "$1" = appops ] || return 1
    case "$2" in
      get) [ -n "${M[$4]:-}" ] && echo "$4: ${M[$4]}" || echo "No operations." ;;
      set) SETS+=("$4=$5"); M[$4]="$5" ;;
    esac
  }
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"
  event="night"; active_events=(night)
  gms_scan_off=true; gms_wakelock_off=false
  config_get_event_raw() { echo false; }
  capability_has() { return 0; }
  reset() { M=([WIFI_SCAN]=allow [BLUETOOTH_SCAN]=allow [WAKE_LOCK]=allow); SETS=(); rm -f "$gmsops_state_file"; }

  section "lectura del modo"
  M=([WIFI_SCAN]="default; rejectTime=+3s"); assert_eq "default" "$(_appop_get WIFI_SCAN)" "se queda con la primera palabra"
  M=(); _appop_get WIFI_SCAN >/dev/null; assert_true $([ $? -ne 0 ] && echo 0 || echo 1) "sin dato: falla"

  section "gms_scan_off: deniega solo sus ops y graba originales"
  reset; action_gmsops_apply
  assert_eq "ignore" "${M[WIFI_SCAN]}" "WIFI_SCAN ignore"
  assert_eq "ignore" "${M[BLUETOOTH_SCAN]}" "BLUETOOTH_SCAN ignore"
  assert_eq "allow" "${M[WAKE_LOCK]}" "WAKE_LOCK intacto (su interruptor esta apagado)"
  assert_eq "WIFI_SCAN allow" "$(grep '^WIFI_SCAN ' "$gmsops_state_file")" "original grabado"
  SETS=(); action_gmsops_apply
  assert_eq "0" "${#SETS[@]}" "reentrada: no vuelve a escribir"

  section "op ya denegado por el usuario: ni se toca ni se registra"
  reset; M[BLUETOOTH_SCAN]=deny; action_gmsops_apply; action_gmsops_undo
  assert_eq "deny" "${M[BLUETOOTH_SCAN]}" "sigue como lo dejo el usuario"
  assert_eq "allow" "${M[WIFI_SCAN]}" "el nuestro se restaura"

  section "interruptores independientes al restaurar"
  reset; gms_wakelock_off=true; action_gmsops_apply
  assert_eq "ignore" "${M[WAKE_LOCK]}" "WAKE_LOCK denegado"
  # otro evento quiere solo gms_wakelock_off
  config_get_event_raw() { [ "$2" = gms_wakelock_off ] && echo true || echo false; }
  active_events=(night other)
  action_gmsops_undo
  assert_eq "allow" "${M[WIFI_SCAN]}" "scan: nadie mas lo quiere, se restaura"
  assert_eq "ignore" "${M[WAKE_LOCK]}" "wakelock: otro evento lo quiere, sigue denegado"
  config_get_event_raw() { echo false; }; active_events=(night)
  action_gmsops_undo
  assert_eq "allow" "${M[WAKE_LOCK]}" "wakelock restaurado al terminar el ultimo"
  [ -f "$gmsops_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "registro borrado"

  section "si el usuario cambio el modo mientras tanto, se respeta"
  reset; gms_wakelock_off=false; action_gmsops_apply; M[WIFI_SCAN]=allow; SETS=()
  action_gmsops_undo
  assert_eq "BLUETOOTH_SCAN=allow" "${SETS[*]}" "solo se restaura el que seguia en ignore"

  section "sin opcion / sin capacidad"
  reset; gms_scan_off=false; action_gmsops_apply
  assert_eq "0" "${#SETS[@]}" "sin opcion: nada"
  gms_scan_off=true; capability_has() { return 1; }; action_gmsops_apply
  assert_eq "0" "${#SETS[@]}" "sin capacidad: nada"
  capability_has() { return 0; }

  section "recuperacion al arrancar"
  reset; action_gmsops_apply; active_events=()
  action_gmsops_recover
  assert_eq "allow" "${M[WIFI_SCAN]}" "WIFI_SCAN devuelto"
  assert_eq "allow" "${M[BLUETOOTH_SCAN]}" "BLUETOOTH_SCAN devuelto"
  SETS=(); action_gmsops_recover
  assert_eq "0" "${#SETS[@]}" "sin registro: nada"
}
