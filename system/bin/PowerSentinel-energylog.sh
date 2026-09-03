#!/system/bin/bash

# PowerSentinel-energylog.sh - lightweight, change-triggered record of
# battery level/temperature over time, correlated with what was active
# at the moment. This is the data needed to actually check whether a
# given aggressiveness level, or the "thermal" event, genuinely saves
# energy or reduces temperature - instead of assuming it does because
# the logic sounds reasonable. PowerSentinel should be evaluated as a
# real battery-management system with measurable outcomes, not as a
# collection of tweaks that are never actually verified.
#
# A companion to PowerSentinel-journal.sh (which records discrete event
# transitions as they happen), but sampled on real state change rather
# than event-driven, and meant for after-the-fact analysis rather than
# the Alert Bridge or a live status view.
#
# Deliberately NOT sampled every daemon cycle (every $delay seconds,
# typically 3s) - that would mean roughly 28,800 writes/day, which is
# exactly the kind of unnecessary I/O this project shouldn't be causing
# in the name of measuring it. A line is only written when the battery
# level or (whole-degree) temperature actually changed since the last
# recorded sample - both change far less often than the poll interval
# under normal conditions.
#
# This is intentionally raw data collection only - no analysis, no
# WebUI view, no built-in conclusions. Sophisticated visualization is a
# reasonable follow-up once there's real data to look at; building it
# before that would mean guessing what the data will even look like.

: "${energylog_file:=/data/local/tmp/PowerSentinel/PowerSentinel.energylog}"

_energylog_last_level=""
_energylog_last_temp=""

energylog_sample() {
  local level="$DETECT_BATTERY_LEVEL" temp
  temp="$(detect_battery_temp_c)"

  [ "$level" = "$_energylog_last_level" ] && [ "$temp" = "$_energylog_last_temp" ] && return 0
  _energylog_last_level="$level"
  _energylog_last_temp="$temp"

  local ts line dir active
  ts="$(date +%s)"
  dir="$(dirname "$energylog_file")"
  mkdir -p "$dir" 2>/dev/null
  [ -e "$energylog_file" ] || { : > "$energylog_file"; chmod 600 "$energylog_file" 2>/dev/null; }

  # Whatever is active right now (e.g. "screen_off adaptive_tier2") is
  # the real-world "regime" this sample's battery/temp reading should
  # be attributed to.
  active="${active_events[*]}"

  line="$("$JQ" -cn --arg ts "$ts" --arg level "$level" --arg temp "$temp" \
    --arg charging "$DETECT_BATTERY_CHARGING" --arg active "$active" \
    '{ts: ($ts | tonumber), battery: ($level | tonumber), temp_c: ($temp | tonumber), charging: $charging, active: $active}' 2>/dev/null)"
  [ -n "$line" ] || return 1

  echo "$line" >> "$energylog_file"

  # Sparser than the journal (writes only on real change, not per
  # event), so a much larger cap still corresponds to a similar span of
  # real time - roughly a month's worth of level/temp transitions
  # before the oldest half gets dropped.
  local count
  count="$(wc -l < "$energylog_file" 2>/dev/null)"
  if [ "${count:-0}" -gt 5000 ]; then
    tail -n 2500 "$energylog_file" > "$energylog_file.tmp" 2>/dev/null && chmod 600 "$energylog_file.tmp" 2>/dev/null && mv "$energylog_file.tmp" "$energylog_file"
  fi
}
