#!/bin/bash
# tests/test_adaptive_parked_at_night.sh
#
# Feature request: "un móvil parado por la noche debería tener activado
# el modo Ahorro Extremo". Checked directly against the actual score
# weights and confirmed this was architecturally impossible before this
# fix: the maximum score achievable from battery+screen+night alone was
# 40+15+10=65, always short of tier3's default 70 threshold no matter
# how low the battery got - tier3 could only ever be reached through
# the temperature term (i.e. only when the phone was also genuinely
# hot). Added a large, mostly battery-independent bonus (+45) once the
# screen has been off a genuinely long stretch (not the short debounce
# that only distinguishes "locked a moment ago" from "actually locked")
# while it's night - guarantees crossing 70 even at a full battery,
# with charging as the one deliberate exception (no reason to restrict
# apps on a phone charging peacefully overnight).

run_tests() {
  getconf() { echo ""; }
  detect_battery_temp_c() { echo 22; }
  DETECT_LOAD1="0.3"
  DETECT_BATTERY_CHARGING=false

  local FAKE_NOW=1000
  date() { echo "$FAKE_NOW"; }
  is_device() { echo "false"; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-policy.sh"

  # Stubbed AFTER sourcing - get_night_times()/is_night_now() are real
  # functions policy.sh itself defines, so a stub set before source
  # would just get overwritten the moment the file loads.
  is_night_now() { echo true; }
  get_night_times() { :; }

  _update_screen_off_duration
  FAKE_NOW=$((1000 + 1800))
  _update_screen_off_duration

  local bat tier
  for bat in 100 90 70 50 30 10; do
    DETECT_BATTERY_LEVEL="$bat"
    tier="$(pressure_tier_for_score "$(compute_pressure_score)")"
    assert_eq "3" "$tier" "movil parado de noche (pantalla apagada 30 min) con bateria al ${bat}% alcanza el tier extremo"
  done

  DETECT_BATTERY_CHARGING=true
  DETECT_BATTERY_LEVEL=50
  tier="$(pressure_tier_for_score "$(compute_pressure_score)")"
  [ "$tier" != "3" ]
  assert_true $? "cargando durante la noche NO fuerza el tier extremo (excepcion deliberada - cargando ya relaja la presion)"

  DETECT_BATTERY_CHARGING=false
  is_night_now() { echo false; }
  DETECT_BATTERY_LEVEL=50
  tier="$(pressure_tier_for_score "$(compute_pressure_score)")"
  [ "$tier" != "3" ]
  assert_true $? "de dia (no de noche), aunque la pantalla lleve mucho apagada, NO se activa el bono de +45"
}
