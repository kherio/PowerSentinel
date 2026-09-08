#!/system/bin/bash

# PowerSentinel-todaystats.sh - two "Hoy" dashboard metrics that
# neither PowerSentinel-screenwake.sh nor the energy log already cover:
# cumulative screen-on time for the current calendar day (with an
# hourly breakdown, for the card's small activity chart), and how long
# it's been since the last charging session ended. The other two "Hoy"
# numbers (night wakes, interventions today) come from
# PowerSentinel-screenwake.sh and the Event Journal respectively -
# nothing new needed for those.
#
# Reuses the SAME edge-triggered, once-per-cycle pattern as
# screenwake_check() (called from the same place in the main loop) -
# screen state and charging state are each read once per cycle
# already elsewhere in the daemon; this file adds its own is_device
# screen call rather than plumbing a shared cache through, matching
# the existing (documented, deliberate) tech debt of
# compute_pressure_score/pressure_breakdown each calling is_device
# screen independently too.

: "${todaystats_file:=/data/local/tmp/PowerSentinel/PowerSentinel.todaystats}"
declare -g _todaystats_prev_screen=""
declare -g _todaystats_prev_charging=""
declare -g _todaystats_prev_check_ts=""

_todaystats_today() { date +%Y-%m-%d; }

# Loads the file if it matches today's date, otherwise starts a fresh
# in-memory record for today - screen_on_seconds and the 24 hourly
# buckets reset at the day boundary (this IS "time today"), but
# last_charge_end_ts is deliberately carried over unchanged: "time
# since your last charge" can legitimately span into yesterday (e.g.
# it's 01:00 and you last unplugged at 23:00), so it must never reset
# just because the calendar day rolled over.
_todaystats_load() {
  local today day
  today="$(_todaystats_today)"
  if [ -s "$todaystats_file" ]; then
    day="$("$JQ" -r '.day // empty' "$todaystats_file" 2>/dev/null)"
    if [ "$day" = "$today" ]; then
      cat "$todaystats_file"
      return
    fi
    # Day rolled over: keep last_charge_end_ts, reset everything else.
    local prev_charge
    prev_charge="$("$JQ" -r '.last_charge_end_ts // empty' "$todaystats_file" 2>/dev/null)"
    "$JQ" -cn --arg day "$today" --argjson lc "${prev_charge:-null}" \
      '{day: $day, screen_on_seconds: 0, hourly: ([range(24)] | map(0)), last_charge_end_ts: $lc}'
    return
  fi
  "$JQ" -cn --arg day "$today" '{day: $day, screen_on_seconds: 0, hourly: ([range(24)] | map(0)), last_charge_end_ts: null}'
}

_todaystats_save() {
  local content="$1" dir tmp
  dir="$(dirname "$todaystats_file")"
  mkdir -p "$dir" 2>/dev/null
  tmp="$(mktemp "$dir/.todaystats.XXXXXX")" || return
  if "$JQ" -e . <<<"$content" >/dev/null 2>&1; then
    echo "$content" > "$tmp"
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$todaystats_file"
  else
    rm -f "$tmp"
  fi
}

# Called once per main loop cycle.
todaystats_check() {
  local now_epoch now_hour now_on now_charging state elapsed
  now_epoch="$(date +%s)"
  now_hour="$(date +%H)"
  now_on="$(is_device screen)"
  now_charging="$DETECT_BATTERY_CHARGING"

  state="$(_todaystats_load)"

  # Screen-on accumulation: add the time elapsed since the PREVIOUS
  # check to today's total (and this hour's bucket) only when the
  # screen was ALREADY on for that whole span - i.e. gated on the
  # state as it was at the start of the interval, not the end, so a
  # screen-off cycle never gets credited to the interval that just
  # turned it on. First-ever call (no previous timestamp) contributes
  # nothing, since there's no real interval to measure yet.
  if [ -n "$_todaystats_prev_check_ts" ] && [ "$_todaystats_prev_screen" = "true" ]; then
    elapsed=$(( now_epoch - _todaystats_prev_check_ts ))
    # Guard against a nonsensical negative/huge jump (clock change,
    # daemon paused for a long time then resumed) - cap a single
    # interval at 10 minutes so one weird gap can't silently inflate
    # today's total by hours.
    [ "$elapsed" -gt 0 ] || elapsed=0
    [ "$elapsed" -gt 600 ] && elapsed=600
    if [ "$elapsed" -gt 0 ]; then
      state="$("$JQ" --argjson add "$elapsed" --argjson h "$((10#$now_hour))" \
        '.screen_on_seconds += $add | .hourly[$h] += $add' <<<"$state" 2>/dev/null)"
    fi
  fi

  # Charging session end: true->false edge, same pattern as the night-
  # wake counter's screen edge detection.
  if [ "$_todaystats_prev_charging" = "true" ] && [ "$now_charging" = "false" ]; then
    state="$("$JQ" --argjson ts "$now_epoch" '.last_charge_end_ts = $ts' <<<"$state" 2>/dev/null)"
  fi

  _todaystats_save "$state"

  _todaystats_prev_screen="$now_on"
  _todaystats_prev_charging="$now_charging"
  _todaystats_prev_check_ts="$now_epoch"
}

# For the WebUI's "Hoy" card.
todaystats_summary() {
  [ -s "$todaystats_file" ] || { echo '{}'; return; }
  local state now_epoch since
  state="$(_todaystats_load)"
  now_epoch="$(date +%s)"
  since="$("$JQ" -r '.last_charge_end_ts // empty' <<<"$state" 2>/dev/null)"
  local since_s=null
  if [ -n "$since" ]; then
    since_s=$(( now_epoch - since ))
    [ "$since_s" -ge 0 ] || since_s=0
  fi
  "$JQ" --argjson sincharg "$since_s" '{
    screen_on_seconds: .screen_on_seconds,
    hourly: .hourly,
    seconds_since_charge: $sincharg
  }' <<<"$state" 2>/dev/null
}
