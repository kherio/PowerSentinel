#!/bin/bash
# tests/test_chargehealth.sh
#
# Verifies PowerSentinel-chargehealth.sh's edge-triggering: reaching
# 100% while charging should be counted ONCE per charging session, not
# once per cycle for however long the phone happens to sit at 100%
# (which would wildly overcount and make the "X of the last 30 days"
# nudge meaningless), and a session that never reaches 100% at all
# must never be counted.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-chargehealth.sh"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  chargehealth_file="$tmp_dir/chargehealth.json"

  DETECT_BATTERY_LEVEL=98; DETECT_BATTERY_CHARGING=true; chargehealth_check
  DETECT_BATTERY_LEVEL=100; DETECT_BATTERY_CHARGING=true; chargehealth_check
  DETECT_BATTERY_LEVEL=100; DETECT_BATTERY_CHARGING=true; chargehealth_check
  DETECT_BATTERY_LEVEL=100; DETECT_BATTERY_CHARGING=true; chargehealth_check
  assert_json_field "$(chargehealth_summary)" '.count_30d' "1" "3 ciclos seguidos al 100% en la MISMA sesion cuentan como 1, no como 3"

  # New charging session (false -> true) gets a fresh chance.
  DETECT_BATTERY_LEVEL=95; DETECT_BATTERY_CHARGING=false; chargehealth_check
  DETECT_BATTERY_LEVEL=50; DETECT_BATTERY_CHARGING=false; chargehealth_check
  DETECT_BATTERY_LEVEL=80; DETECT_BATTERY_CHARGING=true; chargehealth_check
  DETECT_BATTERY_LEVEL=100; DETECT_BATTERY_CHARGING=true; chargehealth_check
  assert_json_field "$(chargehealth_summary)" '.count_30d' "2" "una segunda sesion que SI llega al 100% suma una mas (total 2)"

  # A session that never reaches 100% must not be counted at all.
  DETECT_BATTERY_LEVEL=95; DETECT_BATTERY_CHARGING=false; chargehealth_check
  DETECT_BATTERY_LEVEL=60; DETECT_BATTERY_CHARGING=true; chargehealth_check
  DETECT_BATTERY_LEVEL=85; DETECT_BATTERY_CHARGING=true; chargehealth_check
  DETECT_BATTERY_LEVEL=99; DETECT_BATTERY_CHARGING=true; chargehealth_check
  assert_json_field "$(chargehealth_summary)" '.count_30d' "2" "una sesion que se queda en 99% (nunca llega a 100%) no suma nada (sigue en 2)"

  rm -rf "$tmp_dir"
}
