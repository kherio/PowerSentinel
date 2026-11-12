#!/bin/bash
# tests/test_radio_lte_ownership.sh
#
# radio_lte (v-next): clears ONLY the NR (5G) bit of each SIM slot's
# allowed-network-types bitmask via the telephony shell command, records
# the real original once per slot, restores it when the last event that
# wants radio_lte ends, and never: acts without the capability, touches a
# slot that already has no 5G, builds a mask without LTE, restores over a
# value the user changed meanwhile, or leaves the radio limited when the
# modem refuses the change. `cmd` is a fake with per-slot state.

run_tests() {
  local root
  root="$(mktemp -d)"
  radio_state_file="$root/radiostate"
  json_conf="$root/PowerSentinel.json"
  echo '{"global":{},"events":{}}' > "$json_conf"
  log_msg() { :; }
  emit() { :; }

  declare -A MASK=()
  CMD_LOG=()
  REFUSE=0
  # cmd phone get-allowed-network-types-for-users -s N
  # cmd phone set-allowed-network-types-for-users -s N MASK
  cmd() {
    [ "$1" = phone ] || return 1
    case "$2" in
      get-allowed-network-types-for-users) echo "Allowed network types for reason user: ${MASK[$4]}" ;;
      set-allowed-network-types-for-users)
        CMD_LOG+=("set $4 $5")
        [ "$REFUSE" = 1 ] || MASK[$4]="$5"
        ;;
    esac
  }
  NR=524288; LTE=4096
  ALL=$(( 4194303 ))          # every bit set incl. NR and LTE
  NO5G=$(( ALL & ~NR ))
  reset() { MASK=([0]=$ALL [1]=$ALL); CMD_LOG=(); REFUSE=0; rm -f "$radio_state_file"; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"
  event="night"; active_events=(night)
  radio_lte="true"
  config_get_event_raw() { echo "false"; }

  section "capability gate"
  reset; capability_has() { return 1; }
  action_radio_apply
  assert_eq "0" "${#CMD_LOG[@]}" "sin la capacidad no se llama a cmd phone"
  [ -f "$radio_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "ni se crea el fichero de estado"

  section "apply: quita solo el bit 5G en cada slot y graba el original real"
  reset; capability_has() { return 0; }
  action_radio_apply
  assert_eq "$NO5G" "${MASK[0]}" "slot 0 queda sin el bit NR"
  assert_eq "$NO5G" "${MASK[1]}" "slot 1 queda sin el bit NR"
  assert_eq "$(( ${MASK[0]} & LTE ))" "$LTE" "LTE sigue permitido"
  assert_eq "0 $ALL $NO5G" "$(grep '^0 ' "$radio_state_file")" "se graba el original REAL del slot 0"

  section "reentrada: un segundo apply no re-graba ni vuelve a llamar"
  CMD_LOG=()
  action_radio_apply
  assert_eq "0" "${#CMD_LOG[@]}" "ya sin 5G: no hay nada que hacer"
  assert_eq "0 $ALL $NO5G" "$(grep '^0 ' "$radio_state_file")" "el original no se sobreescribe"

  section "slot que ya no tiene 5G no se toca ni se registra"
  reset; MASK[1]=$NO5G
  action_radio_apply
  assert_eq "" "$(grep '^1 ' "$radio_state_file")" "el slot 1 no se registra como nuestro"
  assert_eq "$NO5G" "${MASK[1]}" "y queda igual"

  section "nunca deja una mascara sin LTE"
  reset; MASK=([0]=$NR [1]=$NR)    # solo 5G permitido
  action_radio_apply
  assert_eq "$NR" "${MASK[0]}" "una mascara que quedaria sin LTE no se modifica"

  section "el modem rechaza el cambio: se restaura y no se queda registro"
  reset; REFUSE=1
  action_radio_apply
  assert_eq "$ALL" "${MASK[0]}" "la mascara sigue siendo la original"
  assert_eq "" "$(grep '^0 ' "$radio_state_file" 2>/dev/null)" "sin registro de algo que no se aplico"

  section "composicion: otro evento activo lo quiere - undo no restaura"
  reset; action_radio_apply
  config_get_event_raw() { echo "true"; }; active_events=(night screen_off)
  action_radio_undo
  assert_eq "$NO5G" "${MASK[0]}" "con otro evento que aun lo quiere, sigue sin 5G"
  [ -s "$radio_state_file" ]; assert_true $? "y el registro sigue ahi"

  section "undo: sin otro evento se restaura el original y se borra el registro"
  config_get_event_raw() { echo "false"; }; active_events=(night)
  action_radio_undo
  assert_eq "$ALL" "${MASK[0]}" "slot 0 recupera su original"
  assert_eq "$ALL" "${MASK[1]}" "slot 1 recupera su original"
  [ -f "$radio_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "el registro se borra"

  section "undo: si el usuario cambio el valor mientras tanto, no se pisa"
  reset; action_radio_apply
  MASK[0]=$(( LTE | 1 ))           # el usuario eligio otra cosa
  action_radio_undo
  assert_eq "$(( LTE | 1 ))" "${MASK[0]}" "no se restaura sobre un valor que cambio el usuario"
  assert_eq "$ALL" "${MASK[1]}" "el slot que no cambio si se restaura"

  section "recuperacion al arrancar: un limite que quedo de una ejecucion anterior se levanta"
  reset; action_radio_apply
  active_events=()
  action_radio_recover
  assert_eq "$ALL" "${MASK[0]}" "5G devuelto al arrancar el demonio"
  [ -f "$radio_state_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "y el registro se limpia"

  section "recover sin registro no hace nada"
  CMD_LOG=(); action_radio_recover
  assert_eq "0" "${#CMD_LOG[@]}" "sin registro no se llama a cmd"
}
