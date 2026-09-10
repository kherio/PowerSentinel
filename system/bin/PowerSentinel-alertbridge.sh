#!/system/bin/bash

# PowerSentinel-alertbridge.sh - Alert Bridge: the ONLY place that pushes
# a real Android notification. Takes a severity + message; only
# "critical" ever reaches the user's notification shade. Everything
# else already went to the Event Journal (journal.sh) - the WebUI's
# Estado/Log view is where routine status belongs, not Android's
# notification tray.
#
# This replaces the old notif() function, which every event/status
# change called directly - "Config Loaded", "status: Enabled",
# "Active Events: ...", etc. all used to post a real Android
# notification every single time, which is the actual problem this
# whole redesign exists to fix. Only genuinely critical situations
# (safe mode active, a config safety guard rejecting an unsafe
# allowlist-less suspend setting) still reach the user this way.

alert_dispatch() {
  local severity="$1" message="$2"
  [ "$severity" = "critical" ] || return 0
  [ "$(getconf notify true)" = "true" ] || return 0

  # SECURITY: see the equivalent comment this replaced in the old
  # notif() - base64-encoding neutralizes shell metacharacters before
  # they ever reach su -c's embedded shell. "$message" can originate
  # from data that ultimately comes from the world-writable control
  # file, so this isn't a theoretical concern.
  local b64
  b64="$(printf '%s' "$message" | base64 | tr -d '\n')"
  su -lp 2000 -c "cmd notification post -S bigtext -t 'PowerSentinel' 'ALERT' \"\$(echo $b64 | base64 -d)\"" >/dev/null
}

# Feature request: a persistent status notification saying which mode
# is active and what it actually does - explicitly NOT a return to the
# noisy old notif() behavior this whole file replaced. Posted with a
# FIXED tag ("PowerSentinelStatus") so every update REPLACES the
# previous one in place rather than stacking a new notification -
# `cmd notification post <tag> <text>` already does this natively when
# the same tag is reused. Opt-in (getconf notify_active_mode, default
# false) - someone who never asks for this sees no change at all.
#
# Real constraint worth being upfront about: `cmd notification post`
# (AOSP source, services/tests/uiservicestests/.../NotificationShellCmdTest)
# only supports -t/-i/-I/-S/-c - there is no flag here for importance,
# silent, or ongoing/non-dismissible. The first time this appears it
# will likely make the normal notification sound - the WebUI tells the
# person, the first time they turn this on, to long-press it once and
# set its channel to Silent from Android's own settings; every update
# after that stays quiet. This is a real limitation of the shell
# command itself, not something more code here can work around.
: "${notify_state_file:=/data/local/tmp/PowerSentinel/PowerSentinel.notifystate}"

# Same handful of predefined event display names already used by the
# WebUI (estado.js's EVENT_META/eventDisplayName) - kept in sync by
# hand since one lives in bash and the other in JS, but there are only
# a few entries and they change rarely. A custom/non-predefined event
# name just displays as typed, exactly like eventDisplayName()'s own
# fallback.
_event_display_name() {
  case "$1" in
    boot) echo "Arranque" ;;
    charging) echo "Cargando" ;;
    screen_off) echo "Pantalla apagada" ;;
    low_power) echo "Ahorro del sistema" ;;
    night) echo "Noche" ;;
    thermal) echo "Temperatura alta" ;;
    manual) echo "Manual" ;;
    adaptive_tier1) echo "Ahorro suave" ;;
    adaptive_tier2) echo "Ahorro moderado" ;;
    adaptive_tier3) echo "Ahorro extremo" ;;
    *) echo "$1" ;;
  esac
}

# Builds "title|body" from active_mechanisms_snapshot() (events.sh) -
# the exact same resolved data the WebUI's own "active now" card is
# built from, so the notification can never say something different
# from what the app itself shows. Empty output (no active events)
# means there's nothing to show - the caller cancels any existing
# notification instead of posting an empty one.
_build_active_mode_text() {
  local snapshot count title body phrases=() p first=1
  snapshot="$(active_mechanisms_snapshot)"
  count="$("$JQ" 'length' <<<"$snapshot" 2>/dev/null)"
  case "$count" in ''|0|*[!0-9]*) return ;; esac

  local names
  names="$("$JQ" -r '[.[].event] | unique | .[]' <<<"$snapshot" 2>/dev/null)"
  first=1
  title=""
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    if [ "$first" = 1 ]; then title="$(_event_display_name "$n")"; first=0
    else title="$title, $(_event_display_name "$n")"; fi
  done <<< "$names"

  local cores doze apps gms wifi lowram maxfreq maxrefresh
  cores="$("$JQ" -r 'any(.[]; .handle_cores != "false")' <<<"$snapshot" 2>/dev/null)"
  doze="$("$JQ" -r 'any(.[]; .doze != "false")' <<<"$snapshot" 2>/dev/null)"
  apps="$("$JQ" -r '[.[] | select(.handle_apps != "false") | .handle_apps] | unique | join(",")' <<<"$snapshot" 2>/dev/null)"
  gms="$("$JQ" -r 'any(.[]; .handle_gms != "false")' <<<"$snapshot" 2>/dev/null)"
  wifi="$("$JQ" -r 'any(.[]; .kill_wifi == "true")' <<<"$snapshot" 2>/dev/null)"
  lowram="$("$JQ" -r 'any(.[]; .low_ram == "true")' <<<"$snapshot" 2>/dev/null)"
  maxfreq="$("$JQ" -r '[.[] | select(.max_cpu_freq != "false" and .max_cpu_freq != null) | (.max_cpu_freq | tonumber)] | min' <<<"$snapshot" 2>/dev/null)"
  maxrefresh="$("$JQ" -r '[.[] | select(.max_refresh_rate != "false" and .max_refresh_rate != null) | (.max_refresh_rate | tonumber)] | min' <<<"$snapshot" 2>/dev/null)"

  [ "$cores" = "true" ] && phrases+=("CPU en ahorro")
  case "$apps" in
    "") ;;
    nice) phrases+=("apps en 2º plano ralentizadas") ;;
    kill) phrases+=("apps en 2º plano cerradas") ;;
    suspend) phrases+=("apps en 2º plano suspendidas") ;;
    *) phrases+=("apps en 2º plano gestionadas") ;;
  esac
  [ "$doze" = "true" ] && phrases+=("Doze forzado")
  [ "$gms" = "true" ] && phrases+=("Play Services limitado")
  [ "$wifi" = "true" ] && phrases+=("WiFi apagado")
  [ "$lowram" = "true" ] && phrases+=("modo RAM baja")
  case "$maxfreq" in
    ''|null) ;;
    *) phrases+=("CPU al ${maxfreq}%") ;;
  esac
  case "$maxrefresh" in
    ''|null) ;;
    *) phrases+=("pantalla a ${maxrefresh}Hz") ;;
  esac

  body=""
  first=1
  for p in "${phrases[@]}"; do
    if [ "$first" = 1 ]; then body="$p"; first=0
    else body="$body · $p"; fi
  done
  [ -n "$body" ] || body="sin cambios activos"

  printf '%s|%s' "$title" "$body"
}

# Called after every event transition (events.sh) - never on a timer,
# so this is only ever real work when something actually changed, not
# a recurring cost. Skips the whole thing (not even a snapshot taken)
# when the feature is off, which is the default.
notify_active_mode_update() {
  [ "$(getconf notify_active_mode false)" = "true" ] || return 0

  local combined title body
  combined="$(_build_active_mode_text)"
  if [ -z "$combined" ]; then
    # Nothing active - cancel any status notification left over from
    # the last active mode rather than leaving a stale one showing.
    su -lp 2000 -c "cmd notification cancel com.android.shell PowerSentinelStatus" >/dev/null 2>&1
    rm -f "$notify_state_file"
    return 0
  fi

  # Only actually re-post when the text genuinely changed - an update-
  # in-place is cheap, but there's still no reason to touch the
  # notification manager on every call if nothing about it would look
  # any different.
  if [ -f "$notify_state_file" ] && [ "$(cat "$notify_state_file" 2>/dev/null)" = "$combined" ]; then
    return 0
  fi

  title="${combined%%|*}"
  body="${combined#*|}"

  # SECURITY: same base64 pattern as alert_dispatch() above - $body is
  # built from config-derived values (handle_apps, etc.), so it isn't
  # attacker-free input either.
  local b64
  b64="$(printf '%s' "$body" | base64 | tr -d '\n')"
  su -lp 2000 -c "cmd notification post -S bigtext -t 'PowerSentinel — $title' 'PowerSentinelStatus' \"\$(echo $b64 | base64 -d)\"" >/dev/null 2>&1

  mkdir -p "$(dirname "$notify_state_file")" 2>/dev/null
  printf '%s' "$combined" > "$notify_state_file" 2>/dev/null
  chmod 600 "$notify_state_file" 2>/dev/null
}
