#!/bin/bash
# tests/test_adaptive_screen_debounce.sh
#
# CRITICAL regression guard for a real bug reported with a screenshot:
# "Ahorro suave" was STILL flickering in/out every 30-100 seconds even
# after v4.6.0's score-based hysteresis and a minimum-dwell-time floor
# (test_adaptive_tier_hysteresis.sh). Root cause traced further back
# than either of those, to compute_pressure_score() itself: the
# screen-off term used to give its full +15 the instant is_device
# read "false" - completely ordinary phone use (check it, lock it
# again every minute or two) toggles that by 15 points on every single
# change, comfortably clearing any reasonable hysteresis margin. Fixed
# by requiring the screen to have been continuously off for a real
# stretch (ADAPTIVE_SCREEN_OFF_MIN_SECONDS) before this term
# contributes anything.
#
# A second, real bug was found WHILE fixing the above and is covered
# here too: compute_pressure_score() is always invoked via command
# substitution ("x=$(compute_pressure_score)") by every caller, which
# runs the entire function in a subshell - any global variable it
# tried to update internally was silently discarded the instant that
# subshell exited, never reaching the caller. Fixed by moving the
# state UPDATE into its own function (_update_screen_off_duration)
# that callers invoke as a plain statement (no $(...)) immediately
# before compute_pressure_score() - this test calls it the same way,
# exactly matching the real daemon's own usage, specifically so a
# regression back to updating state from inside the subshelled
# function would be caught here.

run_tests() {
  getconf() { echo ""; }
  is_night_now() { echo false; }
  get_night_times() { :; }
  detect_battery_temp_c() { echo 25; }
  DETECT_BATTERY_LEVEL=50
  DETECT_BATTERY_CHARGING=false
  DETECT_LOAD1="0.5"

  local FAKE_NOW=1000
  date() { echo "$FAKE_NOW"; }
  local FAKE_SCREEN="false"
  is_device() { echo "$FAKE_SCREEN"; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-policy.sh"

  # Baseline score with battery at 50% and nothing else active: 20.
  _update_screen_off_duration
  assert_eq "20" "$(compute_pressure_score)" "puntuacion base sin credito de pantalla (bateria al 50%)"

  FAKE_NOW=1044
  _update_screen_off_duration
  assert_eq "20" "$(compute_pressure_score)" "pantalla apagada solo 44s continuos - AUN sin credito (bug real: esto se aplicaba al instante)"

  FAKE_NOW=1045
  _update_screen_off_duration
  assert_eq "35" "$(compute_pressure_score)" "pantalla apagada 45s continuos - AHORA si aplica el credito de +15"

  FAKE_NOW=1200
  _update_screen_off_duration
  assert_eq "35" "$(compute_pressure_score)" "pantalla apagada sostenida mucho mas tiempo - sigue aplicando correctamente"

  # El caso real reportado: la pantalla nunca llega a estar apagada
  # 45s SEGUIDOS porque se enciende antes - el credito nunca debe
  # aplicarse, sea cual sea el numero total de ciclos.
  FAKE_NOW=1000
  FAKE_SCREEN="true"
  local i score last_score="20"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    FAKE_NOW=$((FAKE_NOW + 40))
    [ "$FAKE_SCREEN" = "true" ] && FAKE_SCREEN="false" || FAKE_SCREEN="true"
    _update_screen_off_duration
    score="$(compute_pressure_score)"
    last_score="$score"
  done
  assert_eq "20" "$last_score" "pantalla parpadeando cada 40s durante 400s (nunca 45s seguidos) - el credito NUNCA se activa, la puntuacion se queda estable en 20"
}
