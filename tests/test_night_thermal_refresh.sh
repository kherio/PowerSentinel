#!/bin/bash
# tests/test_night_thermal_refresh.sh
#
# Regression guard for v3.60.0's CRITICAL FIX: get_night_times()/
# get_thermal_threshold() used to be called only once, at daemon boot -
# is_night_now()/is_thermal_now() were already being called fresh
# every cycle as intended, but against whatever night_start/night_end/
# thermal_threshold had been snapshotted at the last boot, never
# refreshed again. Reported in the wild as "night didn't activate at
# 23:00 as configured". This test simulates a config file changing
# WITHOUT a full daemon restart in between (a raw file edit, or any
# future code path that reloads config without re-exec'ing) and checks
# get_night_times() picks up the new value on the next call.

run_tests() {
  local conf_file
  conf_file="$(mktemp)"

  # Minimal getconf/config_get_event_raw stand-in reading directly from
  # our fixture file - not the real PowerSentinel-config.sh (which
  # expects the full global-config-loading machinery this test doesn't
  # need), just enough to exercise get_night_times()'s own logic for
  # real.
  config_get_event_raw() {
    "$JQ" -r --arg ev "$1" --arg k "$2" '.events[$ev][$k] // empty' "$conf_file" 2>/dev/null
  }
  config_valid_time_hhmm() {
    case "$1" in
      [0-2][0-9]:[0-5][0-9])
        local h="${1%%:*}"
        [ "$((10#$h))" -le 23 ]
        ;;
      *) return 1 ;;
    esac
  }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-policy.sh"

  echo '{"events":{"night":{"night_start":"08:00","night_end":"09:00"}}}' > "$conf_file"
  get_night_times
  assert_eq "08:00" "$night_start" "primera lectura: night_start es el valor inicial del fichero"
  assert_eq "09:00" "$night_end" "primera lectura: night_end es el valor inicial del fichero"

  # The file changes "underneath" the daemon - no re-exec, no restart,
  # exactly the scenario a stale boot-time-only snapshot would miss.
  echo '{"events":{"night":{"night_start":"23:00","night_end":"07:00"}}}' > "$conf_file"
  get_night_times
  assert_eq "23:00" "$night_start" "tras cambiar el fichero SIN reiniciar el demonio, night_start se refresca (el bug real: esto se quedaba en 08:00 para siempre)"
  assert_eq "07:00" "$night_end" "night_end tambien se refresca"

  rm -f "$conf_file"
}
