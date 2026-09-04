#!/system/bin/bash

# PowerSentinel-policy.sh - pure decisions: given detected device state
# (PowerSentinel-detect.sh) and the user's configured rules
# (PowerSentinel-config.sh), decide WHAT should be active next - never
# HOW to apply it. Nothing in this file touches the system: no renice,
# no pm suspend, no CPU frequency changes, no sysfs writes. Front 2,
# part 2/3 of the architecture pass (detect -> policy -> action);
# handle_event()'s own field-resolution and action-dispatch are left
# for part 3/3, since untangling those two concerns properly belongs in
# the same pass as building actions.sh, not split awkwardly across two.
#
# Relocated verbatim from PowerSentineld - no logic changes, only where
# the code lives - so behavior is identical to before this file existed.

# Independent, time-of-day based profile (feature request: "perfil
# nocturno"). Unlike the other events, "night" isn't tied to any device
# state (charging/screen/battery) - it's purely a clock range read from
# its own event block's night_start/night_end fields (HH:MM), and can be
# active at the same time as any other event.
get_night_times() {
  night_start="$(config_get_event_raw night night_start "")"
  night_end="$(config_get_event_raw night night_end "")"
}

is_night_now() {
  if [ -z "$night_start" ] || [ -z "$night_end" ]; then
    echo false
    return
  fi
  # "10#" forces base-10 parsing: bash treats a leading-zero number like
  # 08/09 as invalid octal in arithmetic context otherwise.
  local now_h now_m now_min start_h start_m start_min end_h end_m end_min
  now_h=$(date +%H); now_m=$(date +%M)
  start_h=${night_start%%:*}; start_m=${night_start##*:}
  end_h=${night_end%%:*}; end_m=${night_end##*:}
  now_min=$(( 10#$now_h * 60 + 10#$now_m ))
  start_min=$(( 10#$start_h * 60 + 10#$start_m ))
  end_min=$(( 10#$end_h * 60 + 10#$end_m ))

  if [ "$start_min" -le "$end_min" ]; then
    # same-day range, e.g. 13:00-18:00
    if [ "$now_min" -ge "$start_min" ] && [ "$now_min" -lt "$end_min" ]; then echo true; else echo false; fi
  else
    # wraps past midnight, e.g. 23:00-07:00
    if [ "$now_min" -ge "$start_min" ] || [ "$now_min" -lt "$end_min" ]; then echo true; else echo false; fi
  fi
}

# Independent, temperature-based profile (companion to "night" above,
# same idea: an event that isn't tied to charging/screen state, active
# whenever the battery is at or above a configured temperature). Reads
# its threshold from the "thermal" event block's thermal_threshold field
# (whole degrees Celsius). Hysteresis (3C below the threshold) avoids
# rapidly flapping on/off when the temperature hovers right at the line.
get_thermal_threshold() {
  thermal_threshold="$(config_get_event_raw thermal thermal_threshold "")"
}

is_thermal_now() {
  if [ -z "$thermal_threshold" ]; then
    echo false
    return
  fi
  local temp_c hysteresis_c
  temp_c="$(detect_battery_temp_c)"
  if [ "$was_thermal" = "true" ]; then
    hysteresis_c=$(( thermal_threshold - 3 ))
    [ "$temp_c" -ge "$hysteresis_c" ] && echo true || echo false
  else
    [ "$temp_c" -ge "$thermal_threshold" ] && echo true || echo false
  fi
}

# ---------- Adaptive pressure engine ----------
#
# Opt-in (adaptive_mode=true) alternative to the classic per-device-state
# events (charging/low_power/screen_off/night/thermal): instead of an
# all-or-nothing profile switching on/off around a single state change,
# this computes one 0-100 "pressure" score each poll cycle from several
# real-time signals at once, then maps that score to one of three
# escalating tiers - adaptive_tier1/2/3, plain config blocks with the
# exact same fields any other event has (handle_apps, handle_cores,
# doze, ...), so the existing form UI/handle_event/apps-picker machinery
# needs no changes to support them. When enabled, this fully replaces
# the classic automatic triggers below; "manual", "boot", and safe mode
# are unaffected in either mode.
#
# Score composition (each term is independent, then the total is
# clamped to 0-100 - see docs/adaptive-engine.md for the reasoning
# behind these specific weights):
#   - Battery level: linear, an empty battery contributes up to +40
#   - Temperature: starts contributing above 30C, capped at +30 by 40C+
#   - Charging: flat -40 (charging relieves pressure - no urgency)
#   - Screen off: flat +15 (headroom to act without the user noticing)
#   - Night hours (if configured on the night event): flat +10
#   - CPU load (1-min average, whole-number part only - bash has no
#     float comparison): high load holds pressure back (-10 to -20),
#     since a busy device is the one time aggressive action would
#     actually be felt
compute_pressure_score() {
  local level temp_c charging_flag score
  local screen_on load_int night_now over

  level="$DETECT_BATTERY_LEVEL"
  temp_c="$(detect_battery_temp_c)"
  charging_flag="$DETECT_BATTERY_CHARGING"

  screen_on="$(is_device screen)"
  get_night_times
  night_now="$(is_night_now)"

  score=0
  score=$(( score + (100 - level) * 40 / 100 ))
  if [ "$temp_c" -gt 30 ]; then
    over=$(( temp_c - 30 ))
    [ "$over" -gt 10 ] && over=10
    score=$(( score + over * 3 ))
  fi
  [ "$charging_flag" = "true" ] && score=$(( score - 40 ))
  [ "$screen_on" = "false" ] && score=$(( score + 15 ))
  [ "$night_now" = "true" ] && score=$(( score + 10 ))

  load_int="${DETECT_LOAD1%%.*}"
  case "$load_int" in ''|*[!0-9]*) load_int=0 ;; esac
  if [ "$load_int" -ge 2 ]; then
    score=$(( score - 20 ))
  elif [ "$load_int" -ge 1 ]; then
    score=$(( score - 10 ))
  fi

  [ "$score" -lt 0 ] && score=0
  [ "$score" -gt 100 ] && score=100
  echo "$score"
}

# Maps a 0-100 score to a tier (0 = no intervention), using
# user-configurable thresholds so advanced users can tune sensitivity
# without touching the scoring formula itself.
pressure_tier_for_score() {
  local score="$1" t1 t2 t3
  t1=$(getconf adaptive_tier1_threshold 20)
  t2=$(getconf adaptive_tier2_threshold 45)
  t3=$(getconf adaptive_tier3_threshold 70)
  if [ "$score" -ge "$t3" ]; then echo 3
  elif [ "$score" -ge "$t2" ]; then echo 2
  elif [ "$score" -ge "$t1" ]; then echo 1
  else echo 0
  fi
}

# Same formula as compute_pressure_score() above, but returns each
# term separately instead of only the clamped sum - "presión: 42/100,
# temperatura +10, batería +12, ..." from the roadmap. Deliberately a
# separate function rather than refactoring compute_pressure_score()
# to also return this: that function is the one the real tier decision
# is based on every cycle, and duplicating ~25 lines of already-
# correct, already-tested arithmetic here is a safer trade than
# restructuring it just to expose a breakdown for display. The
# individual terms can sum to something outside 0-100 before clamping
# (e.g. very hot AND very low battery, or fully charged AND idle) -
# that's fine for an explanatory breakdown, and the actual clamped
# score is reported separately, from the real function, alongside it.
pressure_breakdown() {
  local level temp_c charging_flag
  local screen_on load_int night_now over
  local batt_term=0 temp_term=0 charge_term=0 screen_term=0 night_term=0 load_term=0

  level="$DETECT_BATTERY_LEVEL"
  temp_c="$(detect_battery_temp_c)"
  charging_flag="$DETECT_BATTERY_CHARGING"
  screen_on="$(is_device screen)"
  get_night_times
  night_now="$(is_night_now)"

  batt_term=$(( (100 - level) * 40 / 100 ))
  if [ "$temp_c" -gt 30 ]; then
    over=$(( temp_c - 30 ))
    [ "$over" -gt 10 ] && over=10
    temp_term=$(( over * 3 ))
  fi
  [ "$charging_flag" = "true" ] && charge_term=-40
  [ "$screen_on" = "false" ] && screen_term=15
  [ "$night_now" = "true" ] && night_term=10

  load_int="${DETECT_LOAD1%%.*}"
  case "$load_int" in ''|*[!0-9]*) load_int=0 ;; esac
  if [ "$load_int" -ge 2 ]; then
    load_term=-20
  elif [ "$load_int" -ge 1 ]; then
    load_term=-10
  fi

  "$JQ" -cn --argjson batt "$batt_term" --argjson temp "$temp_term" --argjson charge "$charge_term" \
    --argjson screen "$screen_term" --argjson night "$night_term" --argjson load "$load_term" \
    '{battery: $batt, temperature: $temp, charging: $charge, screen_off: $screen, night: $night, cpu_load: $load}' \
    2>/dev/null
}
