#!/bin/bash
# tests/test_scan_off_ownership.sh
#
# scan_off: sets wifi_scan_always_enabled / ble_scan_always_enabled to 0
# while an event that wants it is active. Only ever LOWERS them, records
# the real original once, restores it when the last event that wants
# scan_off ends, and never: acts without the capability, touches/records a
# setting that is already 0, restores over a value the user changed
# meanwhile, or leaves the scans off after a crash (startup recovery).
# `settings` is a fake key/value store.

run_tests() {
  local root
  root="$(mktemp -d)"
  scan_state_file="$root/scanstate"
  json_conf="$root/PowerSentinel.json"
  echo '{"global":{},"events":{}}' > "$json_conf"
  log_msg() { :; }
  emit() { :; }

  declare -A S=()
  PUT_LOG=()
  settings() {
    case "$1" in
      get) echo "${S[$3]:-null}" ;;
      put) PUT_LOG+=("$3=$4"); S[$3]="$4" ;;
    esac
  }
  W=wifi_scan_always_enabled; B=ble_scan_always_enabled
  reset() { S=([$W]=1 [$B]=1); PUT_LOG=(); rm -f "$scan_state_file"; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"
  event="night"; active_events=(night)
  scan_off="true"
  config_get_event_raw() { echo "false"; }

  section "capability gate"
  reset; capability_has() { return 1; }
  action_scan_apply
  assert_eq "0" "${#PUT_LOG[@]}" "sin la capacidad no se escribe nada"
  [ -f "$scan_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "ni se crea el fichero de estado"

  section "lectura: solo 0/1 son validos"
  S=([$W]=null); _scan_get $W >/dev/null; assert_true $([ $? -ne 0 ] && echo 0 || echo 1) "null (ROM sin el ajuste): falla"
  S=([$W]=abc); _scan_get $W >/dev/null; assert_true $([ $? -ne 0 ] && echo 0 || echo 1) "valor raro: falla, no se adivina"
  S=([$W]=1); assert_eq "1" "$(_scan_get $W)" "1 se lee bien"

  section "apply: apaga ambos y graba los originales reales"
  reset; capability_has() { return 0; }
  action_scan_apply
  assert_eq "0" "${S[$W]}" "wifi scan apagado"
  assert_eq "0" "${S[$B]}" "ble scan apagado"
  assert_eq "$W 1" "$(grep "^$W " "$scan_state_file")" "se graba el original del wifi scan"
  assert_eq "$B 1" "$(grep "^$B " "$scan_state_file")" "se graba el original del ble scan"

  section "reentrada: segundo apply no vuelve a escribir ni re-graba"
  PUT_LOG=(); action_scan_apply
  assert_eq "0" "${#PUT_LOG[@]}" "ya apagado: nada que hacer"
  assert_eq "1" "$(grep -c "^$W " "$scan_state_file")" "una sola linea por ajuste"

  section "un ajuste que ya estaba a 0 no se toca ni se registra"
  reset; S[$B]=0
  action_scan_apply
  assert_eq "" "$(grep "^$B " "$scan_state_file")" "el ble scan (ya a 0) no se registra como nuestro"
  assert_eq "0" "${S[$B]}" "y sigue a 0"
  # y al terminar no se 'restaura' a 1 algo que el usuario ya tenia apagado
  action_scan_undo
  assert_eq "0" "${S[$B]}" "tras undo sigue a 0 (el usuario lo tenia apagado)"
  assert_eq "1" "${S[$W]}" "el que SI era nuestro vuelve a 1"

  section "composicion: otro evento activo lo quiere - undo no restaura"
  reset; action_scan_apply
  config_get_event_raw() { echo "true"; }; active_events=(night screen_off)
  action_scan_undo
  assert_eq "0" "${S[$W]}" "con otro evento que aun lo quiere, sigue apagado"
  [ -s "$scan_state_file" ]; assert_true $? "y el registro sigue"

  section "undo: sin otro evento se restaura y se borra el registro"
  config_get_event_raw() { echo "false"; }; active_events=(night)
  action_scan_undo
  assert_eq "1" "${S[$W]}" "wifi scan vuelve a 1"
  assert_eq "1" "${S[$B]}" "ble scan vuelve a 1"
  [ -f "$scan_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "el registro se borra"

  section "undo: si el usuario lo reactivo mientras tanto, queda como el lo dejo"
  # (el original siempre es 1, asi que reactivarlo equivale a restaurarlo;
  # lo que importa es que un valor ya a 1 no se rompe y el otro si se restaura)
  reset; action_scan_apply
  S[$W]=1                          # el usuario lo volvio a encender
  action_scan_undo
  assert_eq "1" "${S[$W]}" "valor del usuario intacto"
  assert_eq "1" "${S[$B]}" "el otro se restaura"

  section "scan_off=false: ni apply ni undo hacen nada"
  reset; scan_off="false"; action_scan_apply; action_scan_undo
  assert_eq "0" "${#PUT_LOG[@]}" "sin la opcion no se escribe nada"
  scan_off="true"

  section "recuperacion al arrancar"
  reset; action_scan_apply; active_events=()
  action_scan_recover
  assert_eq "1" "${S[$W]}" "escaneo devuelto al arrancar el demonio"
  [ -f "$scan_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "y el registro se limpia"
  PUT_LOG=(); action_scan_recover
  assert_eq "0" "${#PUT_LOG[@]}" "recover sin registro no hace nada"

  section "recover sin la capacidad no escribe nada"
  reset; action_scan_apply; capability_has() { return 1; }; PUT_LOG=()
  action_scan_recover
  assert_eq "0" "${#PUT_LOG[@]}" "sin capacidad el recover no toca ajustes"
  capability_has() { return 0; }
}
