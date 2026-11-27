#!/bin/bash
# tests/test_aod_off_ownership.sh
#
# aod_off: sets secure doze_always_on to 0 while an event that wants it is
# active. Only LOWERS it, records the real original once, restores it when
# the last event that wants aod_off ends, and never: acts without the
# capability, records a value already 0, overwrites a value the user
# changed, or leaves AOD off after a crash (startup recovery).

run_tests() {
  local root
  root="$(mktemp -d)"
  aod_state_file="$root/aodstate"
  json_conf="$root/PowerSentinel.json"
  echo '{"global":{},"events":{}}' > "$json_conf"
  log_msg() { :; }
  emit() { :; }

  declare -A S=()
  PUT_LOG=()
  settings() {
    case "$1" in
      get) [ "$2" = "secure" ] || return 1; echo "${S[$3]:-null}" ;;
      put) [ "$2" = "secure" ] || return 1; PUT_LOG+=("$3=$4"); S[$3]="$4" ;;
    esac
  }
  K=doze_always_on
  reset() { S=([$K]=1); PUT_LOG=(); rm -f "$aod_state_file"; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"
  event="night"; active_events=(night)
  aod_off="true"
  config_get_event_raw() { echo "false"; }

  section "capability gate"
  reset; capability_has() { return 1; }
  action_aod_apply
  assert_eq "0" "${#PUT_LOG[@]}" "sin la capacidad no se escribe nada"

  section "lectura: solo 0/1"
  S=([$K]=null); _aod_get $K >/dev/null; assert_true $([ $? -ne 0 ] && echo 0 || echo 1) "null falla"
  S=([$K]=abc); _aod_get $K >/dev/null; assert_true $([ $? -ne 0 ] && echo 0 || echo 1) "valor raro falla"

  section "apply apaga y graba el original"
  reset; capability_has() { return 0; }
  action_aod_apply
  assert_eq "0" "${S[$K]}" "AOD apagado"
  assert_eq "$K 1" "$(grep "^$K " "$aod_state_file")" "original grabado"
  PUT_LOG=(); action_aod_apply
  assert_eq "0" "${#PUT_LOG[@]}" "reentrada: no escribe"
  assert_eq "1" "$(grep -c "^$K " "$aod_state_file")" "una sola linea"

  section "ya estaba a 0: ni se toca ni se registra"
  reset; S[$K]=0
  action_aod_apply; action_aod_undo
  assert_eq "0" "${S[$K]}" "sigue a 0"
  [ -f "$aod_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "sin registro"

  section "composicion: otro evento lo quiere"
  reset; action_aod_apply
  config_get_event_raw() { echo "true"; }; active_events=(night screen_off)
  action_aod_undo
  assert_eq "0" "${S[$K]}" "sigue apagado"
  config_get_event_raw() { echo "false"; }; active_events=(night)
  action_aod_undo
  assert_eq "1" "${S[$K]}" "restaurado al terminar el ultimo"

  section "aod_off=false: no hace nada"
  reset; aod_off="false"; action_aod_apply; action_aod_undo
  assert_eq "0" "${#PUT_LOG[@]}" "nada escrito"
  aod_off="true"

  section "recuperacion al arrancar"
  reset; action_aod_apply; active_events=()
  action_aod_recover
  assert_eq "1" "${S[$K]}" "AOD devuelto"
  PUT_LOG=(); action_aod_recover
  assert_eq "0" "${#PUT_LOG[@]}" "sin registro no hace nada"
  capability_has() { return 1; }; reset; S[$K]=0; echo "$K 1" > "$aod_state_file"
  action_aod_recover
  assert_eq "0" "${#PUT_LOG[@]}" "sin capacidad no toca"
}
