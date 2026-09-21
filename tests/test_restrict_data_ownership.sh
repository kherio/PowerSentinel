#!/bin/bash
# tests/test_restrict_data_ownership.sh
#
# Regression guard for action_restrictdata_apply/undo (the new Data
# Saver mechanism, "que haya un ahorro de bateria real y creible" -
# background data restriction was the one real, well-documented lever
# this project had never pulled despite already managing WiFi/GMS/
# cores/CPU/refresh rate). Built to the exact same ownership/
# composition contract already proven for kill_wifi/handle_gms/
# low_ram above it in actions.sh, so this test mirrors the same three
# real bug classes those already had to be fixed for: (1) never turn
# something back off that PowerSentinel didn't itself turn on, (2)
# never turn it off while another still-active event also wants it on,
# (3) the capability gate must actually stop the attempt, not just log
# around it.
#
# `cmd` and `dumpsys` are real Android binaries this daemon shells out
# to - stubbed here as plain shell functions (bash resolves a function
# name before PATH, so this works with no real device or root needed),
# recording every invocation instead of touching anything real.

run_tests() {
  local fake_bin
  fake_bin="$(mktemp -d)"
  restrictdata_state_file="$fake_bin/restrictdatastate"
  json_conf="$fake_bin/PowerSentinel.json"
  echo '{"global":{},"events":{}}' > "$json_conf"

  log_msg() { :; }
  emit() { :; }

  CMD_CALLS=()
  cmd() { CMD_CALLS+=("$*"); }
  DATA_SAVER_NOW="false"
  dumpsys() {
    if [ "$1" = "netpolicy" ]; then
      echo "Restrict background: $DATA_SAVER_NOW"
    fi
  }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"

  section "capability gate"
  capability_has() { return 1; }
  restrict_data="true"
  event="night"
  active_events=(night)
  action_restrictdata_apply
  assert_eq "0" "${#CMD_CALLS[@]}" "sin la capacidad netpolicy_restrict, no se llama a cmd en absoluto"
  [ -f "$restrictdata_state_file" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "sin la capacidad, tampoco se crea el fichero de estado"

  section "apply real: primera activacion, dispositivo con Data Saver apagado"
  capability_has() { return 0; }
  DATA_SAVER_NOW="false"
  CMD_CALLS=()
  action_restrictdata_apply
  assert_eq "1" "${#CMD_CALLS[@]}" "una activacion real llama a cmd exactamente una vez"
  assert_eq "netpolicy set restrict-background true" "${CMD_CALLS[0]}" "el comando real es el documentado por Android"
  assert_eq "was_off" "$(cat "$restrictdata_state_file")" "se registra el estado ORIGINAL real (apagado), no el que PowerSentinel acaba de poner"

  section "reentrada: un segundo apply mientras sigue activo no debe re-grabar el original"
  DATA_SAVER_NOW="true"  # ya lo puso el propio PowerSentinel
  CMD_CALLS=()
  action_restrictdata_apply
  assert_eq "was_off" "$(cat "$restrictdata_state_file")" "el original grabado (was_off) no se sobreescribe con el estado actual (ya activado por PowerSentinel)"

  section "undo: sin ningun otro evento activo que lo quiera, se restaura el original"
  config_get_event_raw() { echo "false"; }  # ningun otro evento pide restrict_data
  active_events=(night)
  event="night"
  CMD_CALLS=()
  action_restrictdata_undo
  assert_eq "1" "${#CMD_CALLS[@]}" "sin nadie mas pidiendolo, undo llama a cmd exactamente una vez"
  assert_eq "netpolicy set restrict-background false" "${CMD_CALLS[0]}" "undo restaura el false original, no un true a medias"
  [ -f "$restrictdata_state_file" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "el fichero de ownership se borra tras un undo real"

  section "composicion: dos eventos activos quieren restrict_data - terminar UNO no debe apagarlo"
  rm -f "$restrictdata_state_file"
  DATA_SAVER_NOW="false"
  active_events=(night screen_off)
  event="night"
  CMD_CALLS=()
  action_restrictdata_apply
  event="screen_off"
  config_get_event_raw() {
    # el otro evento activo (night) tambien pide restrict_data=true
    [ "$1" = "night" ] && [ "$2" = "restrict_data" ] && { echo "true"; return; }
    echo "false"
  }
  CMD_CALLS=()
  action_restrictdata_undo
  assert_eq "0" "${#CMD_CALLS[@]}" "night SIGUE activo y tambien quiere restrict_data - screen_off terminando no debe tocar nada"
  [ -f "$restrictdata_state_file" ]
  assert_true $? "el registro de ownership sigue en pie para que night lo siga usando"

  section "usuario ya tenia Data Saver activado por su cuenta - undo NUNCA debe apagarlo"
  rm -f "$restrictdata_state_file"
  DATA_SAVER_NOW="true"
  active_events=(night)
  event="night"
  config_get_event_raw() { echo "false"; }
  CMD_CALLS=()
  action_restrictdata_apply
  assert_eq "was_on" "$(cat "$restrictdata_state_file")" "se detecta y graba que el usuario ya lo tenia activado el mismo"
  CMD_CALLS=()
  action_restrictdata_undo
  assert_eq "0" "${#CMD_CALLS[@]}" "el original era 'was_on' - undo no debe apagar algo que PowerSentinel no encendio"

  section "idempotencia: un segundo undo sin apply previo no hace nada"
  CMD_CALLS=()
  action_restrictdata_undo
  assert_eq "0" "${#CMD_CALLS[@]}" "sin fichero de ownership, un undo repetido es un no-op seguro"

  rm -rf "$fake_bin"
}
