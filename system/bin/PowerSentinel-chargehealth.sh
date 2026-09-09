#!/system/bin/bash

# PowerSentinel-chargehealth.sh - feature request: gentle guidance on
# battery longevity. Repeatedly charging a Li-ion cell to 100% ages it
# faster than keeping it in a shallower range - this tracks how often
# that actually happens on THIS device/usage pattern (never assumed),
# so the suggestion to consider charge_limit is based on real,
# measured behavior, not a blanket claim that would apply the same way
# to everyone.
#
# Deliberately its OWN small file/tracker rather than folded into
# todaystats.sh's existing charging-transition tracking: that file's
# job is "today's numbers, reset daily" - this is a slower-moving,
# multi-week signal, and mixing the two would mean either resetting
# data that should persist across days, or NOT resetting data that
# should. Same edge-triggered, atomic-write, bounded-retention pattern
# already used throughout this project (screenwake.sh, todaystats.sh).

: "${chargehealth_file:=/data/local/tmp/PowerSentinel/PowerSentinel.chargehealth}"
declare -g _chargehealth_prev_charging=""
declare -g _chargehealth_recorded_this_session=""

# Called once per main loop cycle (same $delay cadence as
# check_charge_limit - this doesn't need the tighter screen-poll
# cadence, since "reached 100% this charging session" isn't a brief
# event that could be missed between samples the way a quick screen
# glance could).
chargehealth_check() {
  local level="$DETECT_BATTERY_LEVEL" charging="$DETECT_BATTERY_CHARGING"

  # A NEW charging session (false->true) always gets a fresh chance to
  # be recorded - otherwise a device that's charged to 100% every
  # single night would only ever get counted once, the very first
  # time, and this would never reflect how often it's actually
  # happening.
  if [ "$_chargehealth_prev_charging" != "true" ] && [ "$charging" = "true" ]; then
    _chargehealth_recorded_this_session=""
  fi
  _chargehealth_prev_charging="$charging"

  [ "$charging" = "true" ] && [ "$level" -eq 100 ] 2>/dev/null || return
  [ -z "$_chargehealth_recorded_this_session" ] || return
  _chargehealth_recorded_this_session="1"

  local dir tmp
  dir="$(dirname "$chargehealth_file")"
  mkdir -p "$dir" 2>/dev/null
  [ -s "$chargehealth_file" ] || echo '{"full_charges":[]}' > "$chargehealth_file"
  tmp="$(mktemp "$dir/.chargehealth.XXXXXX")" || return
  # 90 days of retention - this is a slow, multi-week pattern, not
  # something that needs today's granularity like the wake counter -
  # bounded the same way regardless, so the file can't grow forever on
  # a device that's been running the daemon for years.
  if "$JQ" --argjson ts "$(date +%s)" --argjson cutoff "$(( $(date +%s) - 90*86400 ))" \
      '.full_charges = ((.full_charges // []) + [$ts] | map(select(. >= $cutoff)))' \
      "$chargehealth_file" > "$tmp" 2>/dev/null \
      && [ -s "$tmp" ] && "$JQ" -e . "$tmp" >/dev/null 2>&1; then
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$chargehealth_file"
  else
    rm -f "$tmp"
  fi
}

# For the WebUI's battery card: how many full-charge events happened
# in the last 30 days, plus whether charge_limit is already configured
# (getconf, PowerSentinel-config.sh) - the WebUI only ever shows a
# suggestion when the count is high AND the person hasn't already
# acted on it, never repeating advice they've already followed.
chargehealth_summary() {
  [ -s "$chargehealth_file" ] || { echo '{"count_30d":0}'; return; }
  local cutoff
  cutoff=$(( $(date +%s) - 30*86400 ))
  "$JQ" -c --argjson cutoff "$cutoff" '
    { count_30d: ((.full_charges // []) | map(select(. >= $cutoff)) | length) }
  ' "$chargehealth_file" 2>/dev/null
}
