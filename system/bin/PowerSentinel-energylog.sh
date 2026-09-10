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

# Feature request: "que el usuario sepa que realmente está funcionando
# bien" - a REAL, measured comparison, using data this file has
# already been collecting since it was first built (see this file's
# own header: it exists specifically "to actually check whether a
# given... event genuinely saves energy... instead of assuming it
# does"). Never an invented percentage (the exact thing this project
# already decided against once before) - this computes the actual
# drain rate (%/h) for every logged interval where $1 was active,
# and separately for every interval where it wasn't, from the SAME
# device's own real history, and reports both so the WebUI can show
# "con X activo: Y%/h, sin X: Z%/h" - a real difference, or an honest
# "not enough data yet" if there isn't.
#
# Deliberately excludes any interval where charging was true at
# either end (a rising level would corrupt a drain-rate calculation
# entirely) and any interval longer than 6h (a gap that large points
# at a daemon restart/long pause between samples, not a genuine single
# stretch of "event X was active the whole time" - energylog only
# samples on real battery/temp change, so even a very slow, perfectly
# legitimate overnight drain can easily produce multi-hour gaps
# between samples on its own; 6h is generous specifically so a real
# slow-drain night isn't thrown out along with genuine anomalies).
energylog_compare_event() {
  local event_name="$1"
  [ -n "$event_name" ] || { echo '{}'; return; }
  [ -s "$energylog_file" ] || { echo '{}'; return; }

  local result
  result="$("$JQ" -cs --arg ev "$event_name" '
    (map(select(.charging != "true")) | sort_by(.ts)) as $entries |
    [range(0; ($entries | length) - 1) |
      ($entries[.+1].ts - $entries[.].ts) as $dt |
      ($entries[.].battery - $entries[.+1].battery) as $dlevel |
      select($dt > 0 and $dt <= 21600 and $dlevel >= 0) |
      {dt: $dt, dlevel: $dlevel, active: ($entries[.].active // "" | split(" "))}
    ] as $intervals |
    ($intervals | map(select(.active | index($ev)))) as $with |
    ($intervals | map(select((.active | index($ev)) | not))) as $without |
    {
      with_seconds: ($with | map(.dt) | add // 0),
      with_drop_pct: ($with | map(.dlevel) | add // 0),
      without_seconds: ($without | map(.dt) | add // 0),
      without_drop_pct: ($without | map(.dlevel) | add // 0)
    }
  ' "$energylog_file" 2>/dev/null)"
  [ -n "$result" ] || { echo '{}'; return; }

  # Needs at least 30 real minutes in EACH bucket before reporting
  # anything - a comparison built from a couple of noisy samples isn't
  # a real measurement, and showing one anyway would be exactly the
  # kind of unverifiable claim this project has consistently avoided
  # elsewhere (the same reasoning behind never inventing a savings
  # percentage, or the night-window suggester's own "needs at least 3
  # nights" floor).
  local with_s without_s
  with_s="$("$JQ" -r '.with_seconds' <<<"$result" 2>/dev/null)"
  without_s="$("$JQ" -r '.without_seconds' <<<"$result" 2>/dev/null)"
  if [ "${with_s:-0}" -lt 1800 ] 2>/dev/null || [ "${without_s:-0}" -lt 1800 ] 2>/dev/null; then
    echo '{}'
    return
  fi
  printf '%s' "$result"
}
