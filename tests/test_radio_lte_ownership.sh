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
  # Real device format: get PRINTS NAMES (as on a OnePlus 11), set takes a
  # BINARY digit string. The fake keeps one decimal mask per slot.
  local NAMES=("GPRS" "EDGE" "UMTS" "CDMA" "CDMA - EvDo rev. 0" "CDMA - EvDo rev. A" "CDMA - 1xRTT" "HSDPA" "HSUPA" "HSPA" "iDEN" "CDMA - EvDo rev. B" "LTE" "CDMA - eHRPD" "HSPA+" "GSM" "TD_SCDMA" "IWLAN" "LTE_CA" "NR")
  names_of() { local m="$1" i out=""; for i in "${!NAMES[@]}"; do [ $(( m & (1 << i) )) -ne 0 ] && out+="${out:+|}${NAMES[$i]}"; done; echo "$out"; }
  cmd() {
    [ "$1" = phone ] || return 1
    case "$2" in
      get-allowed-network-types-for-users) names_of "${MASK[$4]}" ;;
      set-allowed-network-types-for-users)
        case "$5" in ''|*[!01]*) return 1 ;; esac      # decimal or names are rejected, like AOSP
        CMD_LOG+=("set $4 $5")
        [ "$REFUSE" = 1 ] || MASK[$4]=$(( 2#$5 ))
        ;;
    esac
  }
  NR=524288; LTE=4096
  # The exact list the OnePlus 11 printed: every type except iDEN and IWLAN.
  ALL=$(( (1 << 20) - 1 - 1024 - 131072 ))
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

  section "lectura: la salida literal de un OnePlus 11 se interpreta bien"
  cmd() { echo "GPRS|EDGE|UMTS|CDMA|CDMA - EvDo rev. 0|CDMA - EvDo rev. A|CDMA - 1xRTT|HSDPA|HSUPA|HSPA|CDMA - EvDo rev. B|LTE|CDMA - eHRPD|HSPA+|GSM|TD_SCDMA|LTE_CA|NR"; }
  assert_eq "$ALL" "$(_radio_get 0)" "los nombres de la salida real dan la mascara esperada"
  cmd() { echo ""; }
  _radio_get 0 >/dev/null; assert_true $([ $? -ne 0 ] && echo 0 || echo 1) "salida vacia: la lectura falla"
  cmd() { echo "Allowed network types: 4194303"; }
  _radio_get 0 >/dev/null; assert_true $([ $? -ne 0 ] && echo 0 || echo 1) "salida numerica/desconocida: la lectura falla, no se adivina"
  # restaurar el fake
  cmd() {
    [ "$1" = phone ] || return 1
    case "$2" in
      get-allowed-network-types-for-users) names_of "${MASK[$4]}" ;;
      set-allowed-network-types-for-users)
        case "$5" in ''|*[!01]*) return 1 ;; esac
        CMD_LOG+=("set $4 $5")
        [ "$REFUSE" = 1 ] || MASK[$4]=$(( 2#$5 ))
        ;;
    esac
  }

  section "formato real: el set recibe binario, nunca decimal ni nombres"
  reset; action_radio_apply
  case "${CMD_LOG[0]}" in "set 0 "*[!01]*) assert_eq "binario" "no" "el set recibio algo que no es binario" ;; *) assert_eq 0 0 "el set recibio una cadena binaria" ;; esac

  section "un nombre de red desconocido: no se toca nada (no se adivina)"
  reset; NAMES+=("FUTURE_RAT"); MASK[0]=$(( ALL | (1 << 20) )); MASK[1]=$(( ALL | (1 << 20) ))
  CMD_LOG=(); action_radio_apply
  assert_eq "0" "${#CMD_LOG[@]}" "con un nombre fuera de la tabla no se llama a set"
  capability_has() { return 0; }

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
