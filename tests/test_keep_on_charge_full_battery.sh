#!/bin/bash
# tests/test_keep_on_charge_full_battery.sh
#
# Regression guard for a real device report: "aunque la bateria este al
# 100% cargada a veces parece que esta el dispositivo al 50%". Root
# cause: keep_on_charge's gate in handle_event() only checked $charging
# (a power-source-connected flag - AC/USB/Wireless powered - that Android
# keeps "true" indefinitely while the cable stays in, WELL past the
# point the battery actually finishes charging). Before the fix,
# keep_on_charge genuinely meant "until unplugged", never "until
# charged" - a phone left on the charger overnight, then picked up
# already full, stayed throttled for no real reason.
#
# events.sh is a pure function-definition library (no top-level side
# effects, meant to be sourced from PowerSentineld) so it's sourced
# directly here, exercising the real, shipped handle_event() body.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-events.sh"

  log_msg() { :; }
  state_save() { :; }
  reassert_active_events() { :; }
  emit() { :; }
  _restore_event_snapshot() { :; }
  DISABLE_CALLS=0
  disable_pwr_save() { DISABLE_CALLS=$((DISABLE_CALLS + 1)); }

  # keep_on_charge=true for every event asked; every other field
  # resolves to false/off so handle_event's own body has nothing else
  # to act on - only the keep_on_charge gate itself is under test.
  config_get_event_raw() {
    [ "$2" = "keep_on_charge" ] && { echo "true"; return; }
    echo "false"
  }

  section "cargando, bateria a medias -> keep_on_charge retiene (el comportamiento de siempre)"
  charging="true"
  DETECT_BATTERY_LEVEL="50"
  active_events=(night)
  DISABLE_CALLS=0
  handle_event night 0
  assert_eq "0" "$DISABLE_CALLS" "con el cable puesto y la bateria a la mitad, las restricciones se mantienen"

  section "cargando pero YA al 100% -> debe levantar las restricciones (el bug real)"
  charging="true"
  DETECT_BATTERY_LEVEL="100"
  active_events=(night)
  DISABLE_CALLS=0
  handle_event night 0
  assert_eq "1" "$DISABLE_CALLS" "al 100% aunque siga enchufado, keep_on_charge YA NO debe retener - se levantan las restricciones"

  section "desenchufado -> keep_on_charge nunca debia aplicar aqui, sigue sin hacerlo"
  charging="false"
  DETECT_BATTERY_LEVEL="50"
  active_events=(night)
  DISABLE_CALLS=0
  handle_event night 0
  assert_eq "1" "$DISABLE_CALLS" "sin cable conectado, las restricciones se levantan con normalidad"

  section "DETECT_BATTERY_LEVEL sin refrescar todavia (variable vacia) -> no debe bloquear indefinidamente"
  charging="true"
  unset DETECT_BATTERY_LEVEL
  active_events=(night)
  DISABLE_CALLS=0
  handle_event night 0
  assert_eq "1" "$DISABLE_CALLS" "sin lectura real aun, el valor por defecto (100) no debe dejar el evento atascado reteniendo para siempre"
}
