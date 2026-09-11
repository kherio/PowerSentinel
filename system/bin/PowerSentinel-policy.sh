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
#
# BUG FIX (found during a security/robustness audit): config_get_event_raw()
# has no per-field validation (unlike config_get(), used for global
# settings, which validates every format-constrained key). A malformed
# night_start/night_end - anything not a real "HH:MM" - used to flow
# straight into is_night_now()'s arithmetic below, failing at runtime
# with a stderr error every single cycle and leaving the night profile
# stuck in a broken state, with no obvious cause visible from the
# WebUI. Confirmed this can't be used for command injection despite
# reaching a `$(( ))` context (bash only re-evaluates a literal $(...)
# written directly in the expression text, not one already inside an
# already-expanded variable's value) - a robustness gap, not a code-
# execution one, but worth closing the same way every other config
# value already is. An invalid value now behaves exactly like an
# unconfigured one (night_start/night_end left empty) - is_night_now()
# already treats that as "never night", the same safe fallback it's
# always had.
get_night_times() {
  local raw_start raw_end
  raw_start="$(config_get_event_raw night night_start "")"
  raw_end="$(config_get_event_raw night night_end "")"
  config_valid_time_hhmm "$raw_start" && night_start="$raw_start" || night_start=""
  config_valid_time_hhmm "$raw_end" && night_end="$raw_end" || night_end=""
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
#
# BUG FIX (same audit as get_night_times() above): thermal_threshold
# went straight from config_get_event_raw() (no validation) into
# arithmetic and numeric comparisons in is_thermal_now() below - a
# non-numeric value would fail at runtime on every cycle instead of
# being treated as "not configured". Validated the same way every
# other numeric config value already is elsewhere in this codebase.
get_thermal_threshold() {
  local raw
  raw="$(config_get_event_raw thermal thermal_threshold "")"
  case "$raw" in
    ''|*[!0-9]*) thermal_threshold="" ;;
    *) thermal_threshold="$raw" ;;
  esac
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
#   - Screen off: flat +15, but only once it's been continuously off
#     for at least $ADAPTIVE_SCREEN_OFF_MIN_SECONDS (see BUG FIX below
#     for why)
#   - Night hours (if configured on the night event): flat +10
#   - CPU load (1-min average, whole-number part only - bash has no
#     float comparison): high load holds pressure back (-10 to -20),
#     since a busy device is the one time aggressive action would
#     actually be felt

# BUG FIX (reported: "Ahorro suave" still flickering every 30-100s even
# after adding score hysteresis and a minimum-dwell-time floor to
# pressure_tier_for_score() below - neither fully fixed it): the real
# root cause traces back further than either of those, to this scoring
# function itself. The screen-off term used to read is_device's
# INSTANTANEOUS state and give the full +15 the moment it read "false"
# - completely ordinary phone use (checking it, locking it again every
# minute or two) toggles that flag constantly, jumping the score by 15
# points on every single toggle, comfortably larger than any reasonable
# hysteresis margin. Fixed at the source instead of trying to dampen
# the symptom further downstream: the screen has to have been
# continuously off for a real stretch before this term contributes
# anything at all, so a brief check-and-lock never moves the score in
# the first place.
: "${_pressure_screen_state:=}"
: "${_pressure_screen_state_since:=0}"
: "${_pressure_load_bucket:=0}"
: "${_pressure_load_bucket_since:=0}"
ADAPTIVE_SCREEN_OFF_MIN_SECONDS=45

# BUG FIX (found immediately while testing the fix above): compute_
# pressure_score() is always called as `x="$(compute_pressure_score)"`
# (its caller needs to capture the numeric result) - command
# substitution runs the WHOLE function in a subshell, so any global
# variable it tries to update internally (_pressure_screen_state and
# friends) is silently thrown away the instant the subshell exits,
# never reaching the calling shell at all. No amount of restructuring
# calls INSIDE compute_pressure_score() can fix this - the subshell
# boundary is set by the $(...) wrapping the function call itself, one
# level up. The actual fix: split the state UPDATE into its own
# function and have the caller (PowerSentineld) invoke it as a plain
# statement (no $(...)) immediately before compute_pressure_score() -
# a plain call shares the caller's real shell, so the update genuinely
# persists; compute_pressure_score() itself then only ever READS these
# globals, which needs no escape from anywhere.
_update_screen_off_duration() {
  local screen_on now
  screen_on="$(is_device screen)"
  now="$(date +%s)"
  if [ "$screen_on" != "$_pressure_screen_state" ]; then
    _pressure_screen_state="$screen_on"
    _pressure_screen_state_since="$now"
  fi

  # BUG FIX (reported directly, again, after a week: "Ahorro suave"
  # STILL flickering even after the screen-off debounce above and the
  # tier-level hysteresis/dwell-time). Found by re-reading every term
  # in compute_pressure_score() from scratch rather than assuming the
  # screen fix was the whole story: the CPU load term has the EXACT
  # same shape of bug the screen-off term had - $DETECT_LOAD1 (a 1-
  # minute trailing average, so it drifts continuously rather than
  # jumping) crossing the whole-number boundary at 1.0 or 2.0 changes
  # the score by 10-20 points INSTANTLY, comfortably larger than the
  # 5-point hysteresis margin - and on a phone sitting idle overnight
  # (exactly when "Noche"/tier1 is active), intermittent background
  # activity (sync jobs, notification checks) can easily make the
  # 1-minute average hover right around 1.0, crossing it repeatedly.
  # Same fix as the screen: track how long the load has sat in its
  # CURRENT bucket, debounced the same $ADAPTIVE_SCREEN_OFF_MIN_SECONDS
  # amount, so it takes a real sustained change before it moves the
  # score - not a momentary background blip. Folded into this same
  # function (not a second one) specifically so there's only one call
  # site to remember, rather than risking a future round forgetting to
  # wire up a second debounce function the same careful way the first
  # one needed.
  local load_int bucket
  load_int="${DETECT_LOAD1%%.*}"
  case "$load_int" in ''|*[!0-9]*) load_int=0 ;; esac
  if [ "$load_int" -ge 2 ]; then bucket=2
  elif [ "$load_int" -ge 1 ]; then bucket=1
  else bucket=0
  fi
  if [ "$bucket" != "$_pressure_load_bucket" ]; then
    _pressure_load_bucket="$bucket"
    _pressure_load_bucket_since="$now"
  fi
}

compute_pressure_score() {
  local level temp_c charging_flag score
  local night_now over now screen_off_for load_bucket_for

  level="$DETECT_BATTERY_LEVEL"
  temp_c="$(detect_battery_temp_c)"
  charging_flag="$DETECT_BATTERY_CHARGING"

  now="$(date +%s)"
  screen_off_for=$(( now - _pressure_screen_state_since ))

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
  if [ "$_pressure_screen_state" = "false" ] && [ "$screen_off_for" -ge "$ADAPTIVE_SCREEN_OFF_MIN_SECONDS" ]; then
    score=$(( score + 15 ))
  fi
  [ "$night_now" = "true" ] && score=$(( score + 10 ))

  load_bucket_for=$(( now - _pressure_load_bucket_since ))
  if [ "$load_bucket_for" -ge "$ADAPTIVE_SCREEN_OFF_MIN_SECONDS" ]; then
    if [ "$_pressure_load_bucket" = "2" ]; then
      score=$(( score - 20 ))
    elif [ "$_pressure_load_bucket" = "1" ]; then
      score=$(( score - 10 ))
    fi
  fi

  [ "$score" -lt 0 ] && score=0
  [ "$score" -gt 100 ] && score=100
  echo "$score"
}

# Maps a 0-100 score to a tier (0 = no intervention), using
# user-configurable thresholds so advanced users can tune sensitivity
# without touching the scoring formula itself.
#
# BUG FIX (reported: "Ahorro suave" entrando y saliendo continuamente
# en Actividad): this had no hysteresis at all - a straight threshold
# comparison, recomputed from scratch every cycle. compute_pressure_
# score() above is sensitive to genuinely noisy inputs moment to
# moment - $DETECT_LOAD1 alone swings the score by 10-20 points
# crossing its own 1.0/2.0 breakpoints, and a screen on/off toggle
# swings it by 15 - so a score sitting near a threshold (tier1's
# default of 20 is the easiest one to sit near, hence it being the
# tier actually reported flapping) could cross back and forth every
# single cycle from completely ordinary fluctuation, with each
# crossing firing a real handle_event transition.
#
# Fixed with a standard sticky-threshold/hysteresis margin: escalating
# to a HIGHER tier still happens immediately (reacting fast to
# genuinely worsening conditions is the safe direction to be quick
# about) - only de-escalating requires the score to drop meaningfully
# below the tier's own entry threshold (by $ADAPTIVE_HYSTERESIS_MARGIN
# points), not merely dip a fraction under it. $previous_tier is
# optional - omitted (as at daemon boot, the very first evaluation
# ever) simply skips hysteresis, since there's nothing yet to be
# sticky relative to.
ADAPTIVE_HYSTERESIS_MARGIN=5

# Second, independent layer against flapping - see the main loop's own
# comment (PowerSentineld) for why score-based hysteresis alone isn't
# enough against a single input (screen off: +15) that can jump by
# more than the margin above in one step. A tier must have been held
# for at least this long before a downgrade is allowed, regardless of
# what the score does in between - tuned against a real reported case
# of re-entries as little as 30-100s apart.
ADAPTIVE_MIN_DWELL_SECONDS=120

pressure_tier_for_score() {
  local score="$1" previous_tier="${2:-}" t1 t2 t3 raw_tier prev_threshold
  read -r t1 t2 t3 <<< "$(_adaptive_tier_thresholds)"

  if [ "$score" -ge "$t3" ]; then raw_tier=3
  elif [ "$score" -ge "$t2" ]; then raw_tier=2
  elif [ "$score" -ge "$t1" ]; then raw_tier=1
  else raw_tier=0
  fi

  case "$previous_tier" in
    ''|*[!0-9]*) echo "$raw_tier"; return ;;
  esac
  if [ "$raw_tier" -ge "$previous_tier" ]; then
    echo "$raw_tier"
    return
  fi

  case "$previous_tier" in
    3) prev_threshold="$t3" ;;
    2) prev_threshold="$t2" ;;
    1) prev_threshold="$t1" ;;
    *) echo "$raw_tier"; return ;;  # previous_tier=0 - nothing below it to be sticky about
  esac
  if [ "$score" -lt "$((prev_threshold - ADAPTIVE_HYSTERESIS_MARGIN))" ]; then
    echo "$raw_tier"
  else
    echo "$previous_tier"
  fi
}

# Single source of truth for the three adaptive-tier thresholds -
# used both for the real tier decision (pressure_tier_for_score above)
# AND for whatever gets reported to the WebUI (PressureThresholds in
# PowerSentineld's update_status()), so the two can never disagree
# about what's actually driving intervention.
#
# BUG FIX (security/robustness audit): config_get() already validates
# each of these three is individually a plain non-negative integer,
# but nothing checked they're in ASCENDING order (t1 <= t2 <= t3) - a
# swapped or jumbled set (e.g. t1=90, t2=20, t3=70) would silently
# activate the MOST aggressive tier (checked first, above) at a much
# LOWER score than the values would suggest to whoever set them -
# exactly backwards from the intent. Falls back to the documented
# defaults on any ordering inconsistency - "fail toward doing less,
# not more", the same principle already applied to every other
# unrecognized/inconsistent config value in this project - rather than
# silently reordering the values or guessing which one was "really"
# meant.
_adaptive_tier_thresholds() {
  local t1 t2 t3
  t1=$(getconf adaptive_tier1_threshold 20)
  t2=$(getconf adaptive_tier2_threshold 45)
  t3=$(getconf adaptive_tier3_threshold 70)
  if ! { [ "$t1" -le "$t2" ] && [ "$t2" -le "$t3" ]; } 2>/dev/null; then
    t1=20; t2=45; t3=70
  fi
  echo "$t1 $t2 $t3"
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
  local night_now over screen_off_for load_bucket_for
  local batt_term=0 temp_term=0 charge_term=0 screen_term=0 night_term=0 load_term=0

  level="$DETECT_BATTERY_LEVEL"
  temp_c="$(detect_battery_temp_c)"
  charging_flag="$DETECT_BATTERY_CHARGING"
  get_night_times
  night_now="$(is_night_now)"

  batt_term=$(( (100 - level) * 40 / 100 ))
  if [ "$temp_c" -gt 30 ]; then
    over=$(( temp_c - 30 ))
    [ "$over" -gt 10 ] && over=10
    temp_term=$(( over * 3 ))
  fi
  [ "$charging_flag" = "true" ] && charge_term=-40

  # BUG FIX (consistency found while re-reviewing the whole adaptive
  # engine after a real, still-unresolved flapping report): this used
  # to recompute screen/load state directly and instantly, completely
  # bypassing the debounce compute_pressure_score() itself now applies
  # (_update_screen_off_duration - screen and CPU load both fixed) -
  # meaning the breakdown a person expands to understand their score
  # could show "+15 pantalla" during the exact 45s grace window the
  # REAL score isn't counting it in yet, disagreeing with the number
  # shown right next to it. Reads the same already-debounced globals
  # instead, so this can never show a different story than the score
  # it's meant to explain.
  screen_off_for=$(( $(date +%s) - _pressure_screen_state_since ))
  if [ "$_pressure_screen_state" = "false" ] && [ "$screen_off_for" -ge "$ADAPTIVE_SCREEN_OFF_MIN_SECONDS" ]; then
    screen_term=15
  fi
  [ "$night_now" = "true" ] && night_term=10

  load_bucket_for=$(( $(date +%s) - _pressure_load_bucket_since ))
  if [ "$load_bucket_for" -ge "$ADAPTIVE_SCREEN_OFF_MIN_SECONDS" ]; then
    if [ "$_pressure_load_bucket" = "2" ]; then
      load_term=-20
    elif [ "$_pressure_load_bucket" = "1" ]; then
      load_term=-10
    fi
  fi

  "$JQ" -cn --argjson batt "$batt_term" --argjson temp "$temp_term" --argjson charge "$charge_term" \
    --argjson screen "$screen_term" --argjson night "$night_term" --argjson load "$load_term" \
    '{battery: $batt, temperature: $temp, charging: $charge, screen_off: $screen, night: $night, cpu_load: $load}' \
    2>/dev/null
}
