#!/system/bin/bash

# PowerSentinel-screenwake.sh - counts how many times the screen turns
# on within a configurable time window (default 23:00-07:00, a "night
# wake" counter) - dashboard redesign item "contador de encendidos de
# pantalla en un horario predefinido".
#
# Deliberately its OWN config (nightwake_start/nightwake_end, global,
# default 23:00/07:00) rather than reusing the "night" EVENT's own
# night_start/night_end fields (PowerSentinel-policy.sh): those are
# only meaningful if the user has actually configured a "night" event
# block, which plenty of installs never touch (adaptive-mode users in
# particular have no reason to). A dashboard stat that silently shows
# nothing - or worse, a permanent 0 - until someone happens to set up
# an unrelated event would be a confusing, easy-to-miss dependency.
# This gives the counter a sane out-of-the-box default independent of
# whether "night" (the event) is configured at all.
#
# Screen-on detection reuses is_device screen (PowerSentinel-detect.sh)
# - the SAME call already made every single cycle by
# compute_pressure_score/pressure_breakdown (adaptive mode) or the
# classic screen_off check (classic mode), so this works identically
# regardless of which mode the user is in. screenwake_check() itself
# still calls is_device directly rather than reading a shared cache,
# since no such cache exists yet (see the comment on DETECT_* in
# PowerSentinel-detect.sh) - unifying that is a separate refactor.

: "${screenwake_file:=/data/local/tmp/PowerSentinel/PowerSentinel.screenwake}"
declare -g _screenwake_prev_screen=""

# Best-effort hardware wake reason (feature request: "qué procesos
# despiertan la pantalla"). What Android/the kernel actually expose to
# root is a HARDWARE-level wake source ("qpnp_rtc_alarm", "Power Key",
# a WiFi/modem chip IRQ...), never an app/process name - there is no
# reliable, general API for "app X turned the screen on", with or
# without root. This reads whichever of the two known kernel paths for
# that exists on THIS device (they vary by vendor/kernel version - see
# comment below), and is deliberately tolerant of neither existing at
# all: callers get an empty string, and the WebUI already treats that
# as "reason unknown" for that specific wake rather than guessing.
_screenwake_hw_wake_reason() {
  local f
  for f in /sys/kernel/wakeup_reasons/last_resume_reason /sys/power/wakeup_reason; do
    if [ -r "$f" ]; then
      local reason
      reason="$(head -c 200 "$f" 2>/dev/null | tr -d '\n\r' | sed 's/[[:space:]]\+$//')"
      [ -n "$reason" ] && { printf '%s' "$reason"; return; }
    fi
  done
}

# Called once per main loop cycle. Records a wake ONLY on a genuine
# false->true transition (edge-triggered) - never on every cycle the
# screen happens to be on, which would count one wake as dozens of
# "wakes" over however long the screen stays lit.
screenwake_check() {
  local now_on
  now_on="$(is_device screen)"
  if [ "$_screenwake_prev_screen" = "false" ] && [ "$now_on" = "true" ]; then
    _screenwake_record_wake "$(date +%s)" "$(date +%H:%M)" "$(_screenwake_hw_wake_reason)"
  fi
  _screenwake_prev_screen="$now_on"
}

# Records both the epoch (for window filtering/arithmetic) and the
# already-formatted local HH:MM (for display) at the moment of the
# transition - deliberately avoiding any later epoch->local-time
# reformatting (e.g. jq's strftime, or `date -d @epoch`), which would
# depend on jq/toybox timezone support this project has never relied
# on anywhere else (grep confirms: every existing `date` call in this
# codebase reads the CURRENT time via `date +FORMAT`, never converts
# an arbitrary past epoch - this keeps that same, tested-safe pattern).
# $3 (reason) is the RAW hardware string as-is, or empty - categorizing
# it into something human-readable ("Actividad de WiFi", etc.) happens
# entirely in the WebUI (estado.js), not here: the daemon's job is
# reporting the fact, not interpreting it.
_screenwake_record_wake() {
  local ts="$1" hhmm="$2" reason="${3:-}" dir tmp
  dir="$(dirname "$screenwake_file")"
  mkdir -p "$dir" 2>/dev/null
  [ -s "$screenwake_file" ] || echo '{"wakes":[]}' > "$screenwake_file"
  tmp="$(mktemp "$dir/.screenwake.XXXXXX")" || return
  # Prune anything older than 30 days on every write, so the file
  # never grows without bound - same "keep it small forever" approach
  # already used by the energy log and journal.
  if "$JQ" --argjson ts "$ts" --arg hhmm "$hhmm" --arg reason "$reason" --argjson cutoff "$(( ts - 30*86400 ))" \
      '.wakes = ((.wakes // []) + [{ts:$ts, time:$hhmm, reason:$reason}] | map(select(.ts >= $cutoff)))' \
      "$screenwake_file" > "$tmp" 2>/dev/null \
      && [ -s "$tmp" ] && "$JQ" -e . "$tmp" >/dev/null 2>&1; then
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$screenwake_file"
  else
    rm -f "$tmp"
  fi
}

# Returns the [start_epoch, end_epoch) of the window that's either
# CURRENTLY in progress or was the most recently completed one, given
# $1/$2 = start/end as "HH:MM". Only the wrap-past-midnight case (start
# > end, e.g. 23:00-07:00 - the expected shape for a "night" window) is
# exercised by the dashboard feature this exists for; a same-day window
# (start < end) is handled with the same general logic but hasn't been
# exercised against a real config, so it's a reasonable-effort fallback
# rather than a verified path.
_screenwake_window_bounds() {
  local start="$1" end="$2"
  local now_epoch now_h now_m now_min start_h start_m start_min end_h end_m end_min midnight
  now_epoch=$(date +%s)
  now_h=$(date +%H); now_m=$(date +%M)
  start_h=${start%%:*}; start_m=${start##*:}
  end_h=${end%%:*}; end_m=${end##*:}
  now_min=$(( 10#$now_h * 60 + 10#$now_m ))
  start_min=$(( 10#$start_h * 60 + 10#$start_m ))
  end_min=$(( 10#$end_h * 60 + 10#$end_m ))
  midnight=$(( now_epoch - now_min * 60 ))

  if [ "$start_min" -gt "$end_min" ]; then
    if [ "$now_min" -ge "$start_min" ]; then
      echo "$(( midnight + start_min * 60 )) $(( midnight + 86400 + end_min * 60 ))"
    else
      echo "$(( midnight - 86400 + start_min * 60 )) $(( midnight + end_min * 60 ))"
    fi
  else
    if [ "$now_min" -ge "$start_min" ] && [ "$now_min" -lt "$end_min" ]; then
      echo "$(( midnight + start_min * 60 )) $(( midnight + end_min * 60 ))"
    elif [ "$now_min" -lt "$start_min" ]; then
      echo "$(( midnight - 86400 + start_min * 60 )) $(( midnight - 86400 + end_min * 60 ))"
    else
      echo "$(( midnight + start_min * 60 )) $(( midnight + end_min * 60 ))"
    fi
  fi
}

# For the WebUI's "Encendidos nocturnos" card: current (or most
# recently completed) window's count + the exact wake times, and the
# average count over the 7 completed windows immediately before it -
# never including the current one, so a partial, still-in-progress
# night can't drag its own comparison average down.
screenwake_summary() {
  [ -s "$screenwake_file" ] || { echo '{}'; return; }
  local start end bounds cur_start cur_end i s e hist_bounds="[]"
  start="$(getconf nightwake_start "23:00")"
  end="$(getconf nightwake_end "07:00")"
  bounds="$(_screenwake_window_bounds "$start" "$end")"
  cur_start="${bounds%% *}"; cur_end="${bounds##* }"

  for i in 1 2 3 4 5 6 7; do
    s=$(( cur_start - i * 86400 ))
    e=$(( cur_end - i * 86400 ))
    hist_bounds="$("$JQ" -c --argjson s "$s" --argjson e "$e" '. + [{s:$s,e:$e}]' <<<"$hist_bounds" 2>/dev/null)"
    [ -n "$hist_bounds" ] || hist_bounds="[]"
  done

  "$JQ" -c --argjson cs "$cur_start" --argjson ce "$cur_end" --argjson hist "$hist_bounds" \
    --arg win "${start} - ${end}" --arg start "$start" --arg end "$end" '
    (.wakes // []) as $w |
    ($w | map(select(.ts >= $cs and .ts < $ce))) as $cur |
    ($hist | map(. as $b | ($w | map(select(.ts >= $b.s and .ts < $b.e)) | length))) as $counts |
    ($counts | length) as $n |
    {
      count: ($cur | length),
      window: $win,
      start: $start,
      end: $end,
      times: ($cur | sort_by(.ts) | map(.time)),
      entries: ($cur | sort_by(.ts) | map({time: .time, reason: (.reason // "")})),
      avg: (if $n > 0 then ((($counts | add) / $n) + 0.5 | floor) else null end)
    }
  ' "$screenwake_file" 2>/dev/null
}
