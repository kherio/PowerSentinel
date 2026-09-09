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
#
# BUG FIX: reported as "always says 'motivo no disponible'" - neither
# of these two paths exists on every kernel (this interface has been
# replaced by /sys/class/wakeup/wakeupN/ on newer (5.x-based) kernels,
# and some OEM trees restrict it entirely regardless of root). Rather
# than chase every kernel's own layout indefinitely, _screenwake_wake_cause()
# below now falls back to something that DOES exist on every Android
# version: active wake locks (see _screenwake_wakelock_hint()).
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

# Fallback for when no kernel-level wake reason is available (the
# common case in practice - see the bug-fix note above). Wake lock TAGS
# are set by whichever app/service acquired them, and very often
# already contain a real, recognizable name - a package name, an SDK's
# own tag ("*job*/com.example.app", "NlpWakeLock",
# "GCM_HB_ALARM"...) - a meaningfully "more real" name than a bare
# kernel IRQ line ever gives, which is exactly what was asked for here.
# This is still NOT proof that a specific held wakelock is what turned
# the screen on (most PARTIAL_WAKE_LOCKs keep the CPU running WITHOUT
# ever touching the screen, and this reads whatever's active a moment
# AFTER the wake was already detected, not necessarily the trigger) -
# it's the closest-to-real signal actually available, presented as
# such (the WebUI's categorization/labels don't claim certainty either
# way). Takes the first 2 held locks' tags, whatever they are - no
# attempt to filter "relevant" ones, since guessing which is relevant
# would be exactly the kind of unverifiable claim this project avoids.
#
# Unlike the kernel-file read above (an instant local read),
# `dumpsys power` is a Binder call into system_server - normally fast,
# but on a daemon that must never be the reason something else lags,
# an unbounded call is a real (if rare) risk: this runs synchronously
# in the single main loop, on every wake, so a slow/stuck dumpsys would
# stall event detection for as long as it hangs. `timeout` bounds that
# to 3s and degrades to "no hint" (empty output) rather than a stuck
# daemon - the same safe-empty-string outcome as every other failure
# mode this function already has. Also capped to 200 chars, matching
# the length guard the kernel-file path already has - nothing here
# guarantees a wake lock tag is short.
_screenwake_wakelock_hint() {
  # BUG FIX / IMPROVEMENT (feature request: a "more real" name for what
  # turns the screen on): dumpsys power's wake lock lines usually
  # include the acquiring process's UID ("... ACQ=-1s (uid=10234,
  # ws=null)"), which resolves to an EXACT installed package - a much
  # more reliable, verifiable identification than the tag text alone
  # (a tag like "NetworkStats" or "*job*" names a subsystem, not an
  # app; some tags happen to embed a package name, most don't). System
  # UIDs (<10000, no real "app" to name) are skipped rather than
  # resolved - that lookup would just spend a whole extra `pm` call to
  # confirm there's nothing more specific to say. `pm list packages -U`
  # is only ever called AT MOST ONCE per invocation (cached in
  # $pkglist, reused for a second matching UID) - and not at all if
  # every found lock's UID is a system one. `timeout 2` bounds this
  # second lookup so the worst case (`dumpsys power` already timing
  # out at 3s, THEN this also timing out) stays a bounded ~5s stall,
  # not unbounded - still real, still worth knowing about, but this is
  # the same "bound every external call, degrade to nothing rather
  # than hang" principle already applied to the dumpsys call itself.
  # Falls back to the plain tag, exactly as before, whenever resolution
  # isn't possible for any reason - never a regression from what this
  # already did.
  local lines line tag uid resolved out="" n=0 pkglist=""
  lines="$(timeout 3 dumpsys power 2>/dev/null | grep '_WAKE_LOCK')"
  [ -n "$lines" ] || return
  while IFS= read -r line; do
    [ "$n" -ge 2 ] && break
    tag="$(printf '%s' "$line" | sed -n "s/.*'\([^']*\)'.*/\1/p")"
    [ -n "$tag" ] || continue
    uid="$(printf '%s' "$line" | sed -n 's/.*uid=\([0-9][0-9]*\).*/\1/p')"
    if [ -n "$uid" ] && [ "$uid" -ge 10000 ] 2>/dev/null; then
      [ -n "$pkglist" ] || pkglist="$(timeout 2 pm list packages -U 2>/dev/null)"
      resolved="$(printf '%s\n' "$pkglist" | grep -F "uid:$uid" | head -n1 | sed -n 's/^package:\([^ ]*\).*/\1/p')"
      [ -n "$resolved" ] && tag="$tag ($resolved)"
    fi
    out="${out:+$out, }$tag"
    n=$((n + 1))
  done <<< "$lines"
  printf '%s' "$out" | head -c 200
}

# Tries the hardware-level reason first (when available, it's the more
# precise of the two - a real IRQ source, not an inference from
# whatever else happens to be running); falls back to active wake
# locks only when that gave nothing.
_screenwake_wake_cause() {
  local reason
  reason="$(_screenwake_hw_wake_reason)"
  [ -n "$reason" ] && { printf '%s' "$reason"; return; }
  _screenwake_wakelock_hint
}

# Called every SCREEN_POLL_INTERVAL_S (see _screen_poll_cycle() in
# PowerSentineld). Records a wake ONLY on a genuine false->true
# transition (edge-triggered) - never on every cycle the screen
# happens to be on, which would count one wake as dozens of "wakes"
# over however long the screen stays lit.
#
# BUG FIX (found while re-auditing after the polling-cadence change):
# takes an optional pre-fetched screen-state reading ($1) so
# _screen_poll_cycle() can share ONE is_device call with
# todaystats_check() instead of each function making its own - this
# duplication already existed before the cadence fix (both were
# already called once per main-loop cycle), but tightening the cadence
# to run every 2s instead of every $delay makes the wasted second
# dumpsys call meaningfully more frequent in absolute terms. Falls
# back to calling is_device itself when invoked without an argument,
# so nothing breaks for any other caller.
screenwake_check() {
  local now_on="${1:-}"
  [ -n "$now_on" ] || now_on="$(is_device screen)"
  # BUG FIX: skip entirely on an "unknown" reading (is_device's own
  # fix - PowerSentinel-detect.sh) rather than persisting it into
  # _screenwake_prev_screen - same reasoning as the classic screen_off
  # detector's fix (PowerSentineld): persisting "unknown" would make
  # the FOLLOWING cycle's comparison ("was it false last time?") fail
  # even once the reading recovers, silently missing whatever
  # false->true transition happened to land right after a transient
  # dumpsys hiccup. Less severe here than the classic bug was (this
  # self-heals within one more cycle either way, never gets
  # permanently stuck), but the same fix is just as cheap.
  is_valid_bool_reading "$now_on" || return
  if [ "$_screenwake_prev_screen" = "false" ] && [ "$now_on" = "true" ]; then
    _screenwake_record_wake "$(date +%s)" "$(date +%H:%M)" "$(_screenwake_wake_cause)"
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
      times: ($cur | sort_by(.ts) | .[-20:] | map(.time)),
      entries: ($cur | sort_by(.ts) | .[-20:] | map({time: .time, reason: (.reason // "")})),
      avg: (if $n > 0 then ((($counts | add) / $n) + 0.5 | floor) else null end)
    }
  ' "$screenwake_file" 2>/dev/null
}

# Feature request: suggest a night-window start/end from the person's
# OWN real history, instead of them having to guess it - the exact
# data needed (every recorded wake, with its real timestamp) already
# exists for the wake counter above; this is a different read of the
# same file, nothing new to collect.
#
# Approach: find every gap between two consecutive wakes that's at
# least $SCREENWAKE_QUIET_GAP_MIN_S long (4h by default) - a long
# stretch with no recorded wake is what a real sleep period looks like
# in this data, whatever time of day it happens to fall at. The wake
# right BEFORE such a gap is a real "went quiet at HH:MM" sample; the
# one right AFTER is a real "woke up at HH:MM" sample. Needs at least
# $SCREENWAKE_QUIET_MIN_NIGHTS such gaps before suggesting anything -
# one lucky quiet afternoon isn't a sleep schedule.
#
# The median (not average) of those samples is what gets suggested,
# taken with the calendar day re-anchored at NOON instead of midnight
# first - averaging clock times naively breaks across the midnight
# boundary (23:50 and 00:10 are 20 minutes apart, but naively average
# to noon), and almost nobody's real sleep window straddles noon
# itself, so shifting the reference point there avoids the wrap
# instead of needing circular statistics to handle it properly.
SCREENWAKE_QUIET_GAP_MIN_S=14400
SCREENWAKE_QUIET_MIN_NIGHTS=3

_screenwake_to_noon_min() {
  # $1 = "HH:MM" -> minutes-since-midnight, re-anchored so 0 = noon
  # instead of 0 = midnight (see the function-level comment above).
  local hhmm="$1" h m raw
  h=${hhmm%%:*}; m=${hhmm##*:}
  raw=$(( 10#$h * 60 + 10#$m ))
  echo $(( (raw - 720 + 1440) % 1440 ))
}

_screenwake_from_noon_min() {
  # Inverse of the above: noon-anchored minutes -> real "HH:MM".
  local noon_min="$1" real_min
  real_min=$(( (noon_min + 720) % 1440 ))
  printf '%02d:%02d' "$(( real_min / 60 ))" "$(( real_min % 60 ))"
}

screenwake_suggest_night_window() {
  [ -s "$screenwake_file" ] || { echo '{}'; return; }
  local gaps starts=() ends=() line s e n
  # BUG FIX (found while testing against synthetic multi-gap-per-day
  # data): the first version of this collected EVERY gap over the
  # threshold, with no limit per day - a day with several separate
  # multi-hour lulls (e.g. sparse daytime phone use) could contribute
  # more than one "candidate" gap, diluting or even outnumbering the
  # real nightly sleep gap in the sample the median is taken from.
  # Grouping by which calendar day each gap's MIDPOINT falls in, and
  # keeping only the single longest gap per day BEFORE applying the
  # duration threshold, guarantees at most one candidate per day - and
  # it's naturally the one most likely to actually be sleep, since it's
  # the longest quiet stretch that day had.
  gaps="$("$JQ" -c --argjson gap "$SCREENWAKE_QUIET_GAP_MIN_S" '
    (.wakes // []) | sort_by(.ts) as $w |
    [range(0; ($w | length) - 1) |
      ($w[.+1].ts - $w[.].ts) as $d |
      {start: $w[.].time, end: $w[.+1].time, dur: $d, day: (($w[.].ts + ($d/2)) / 86400 | floor)}
    ] as $allgaps |
    ($allgaps | group_by(.day) | map(max_by(.dur))) as $daily_max |
    [$daily_max[] | select(.dur >= $gap) | {start, end}][]
  ' "$screenwake_file" 2>/dev/null)"
  [ -n "$gaps" ] || { echo '{}'; return; }

  while IFS= read -r line; do
    [ -n "$line" ] || continue
    s="$("$JQ" -r '.start' <<<"$line" 2>/dev/null)"
    e="$("$JQ" -r '.end' <<<"$line" 2>/dev/null)"
    [ -n "$s" ] && [ -n "$e" ] || continue
    starts+=("$(_screenwake_to_noon_min "$s")")
    ends+=("$(_screenwake_to_noon_min "$e")")
  done <<< "$gaps"

  n="${#starts[@]}"
  [ "$n" -ge "$SCREENWAKE_QUIET_MIN_NIGHTS" ] || { echo '{}'; return; }

  local sorted_starts sorted_ends median_start median_end mid
  sorted_starts=($(printf '%s\n' "${starts[@]}" | sort -n))
  sorted_ends=($(printf '%s\n' "${ends[@]}" | sort -n))
  mid=$(( n / 2 ))
  median_start="${sorted_starts[$mid]}"
  median_end="${sorted_ends[$mid]}"

  "$JQ" -cn --arg start "$(_screenwake_from_noon_min "$median_start")" \
    --arg end "$(_screenwake_from_noon_min "$median_end")" \
    --argjson n "$n" \
    '{suggested_start: $start, suggested_end: $end, nights_analyzed: $n}'
}
