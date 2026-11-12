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

# Language of everything the daemon itself shows the user (the
# notifications below). `language` in the global config: auto|es|en.
# "auto" follows Android's locale; with no locale readable at all it
# stays Spanish, which is what the daemon always used before this
# existed. The WebUI's language selector writes the same field, so the
# app and the notifications always agree.
_ps_lang() {
  local l sys
  l="$(getconf language auto 2>/dev/null)"
  case "$l" in es|en) echo "$l"; return ;; esac
  sys="$(getprop persist.sys.locale 2>/dev/null)"
  [ -n "$sys" ] || sys="$(getprop ro.product.locale 2>/dev/null)"
  case "$sys" in ''|es*) echo es ;; *) echo en ;; esac
}

# _tr <key>: the phrase for $key in the current language. Unknown key
# returns the key itself so a missing entry can never produce empty text.
_tr() {
  local lang
  lang="$(_ps_lang)"
  if [ "$lang" = "en" ]; then
    case "$1" in
      ev_boot) echo "Boot" ;; ev_charging) echo "Charging" ;; ev_screen_off) echo "Screen off" ;;
      ev_low_power) echo "System saving" ;; ev_night) echo "Night" ;; ev_thermal) echo "High temperature" ;;
      ev_manual) echo "Manual" ;; ev_adaptive_tier1) echo "Light saving" ;;
      ev_adaptive_tier2) echo "Moderate saving" ;; ev_adaptive_tier3) echo "Extreme saving" ;;
      cpu_save) echo "CPU in power-save" ;;
      apps_nice) echo "background apps slowed down" ;; apps_kill) echo "background apps closed" ;;
      apps_suspend) echo "background apps suspended" ;; apps_bucket) echo "background apps restricted" ;;
      apps_other) echo "background apps managed" ;;
      doze) echo "Doze forced" ;; gms) echo "Play Services limited" ;; wifi) echo "WiFi off" ;;
      data) echo "Data saver on" ;; tune) echo "kernel idle tuning" ;; radio) echo "5G off" ;; lowram) echo "low-RAM mode" ;;
      cpu_pct) echo "CPU at $2%" ;; refresh) echo "screen at ${2}Hz" ;;
      none) echo "no active changes" ;;
      selftest) echo "PowerSentinel: the startup self-test found a real problem - check the Diagnostics panel" ;;
      safemode) echo "Safe Mode is Active" ;;
      *) echo "$1" ;;
    esac
  else
    case "$1" in
      ev_boot) echo "Arranque" ;; ev_charging) echo "Cargando" ;; ev_screen_off) echo "Pantalla apagada" ;;
      ev_low_power) echo "Ahorro del sistema" ;; ev_night) echo "Noche" ;; ev_thermal) echo "Temperatura alta" ;;
      ev_manual) echo "Manual" ;; ev_adaptive_tier1) echo "Ahorro suave" ;;
      ev_adaptive_tier2) echo "Ahorro moderado" ;; ev_adaptive_tier3) echo "Ahorro extremo" ;;
      cpu_save) echo "CPU en ahorro" ;;
      apps_nice) echo "apps en 2º plano ralentizadas" ;; apps_kill) echo "apps en 2º plano cerradas" ;;
      apps_suspend) echo "apps en 2º plano suspendidas" ;; apps_bucket) echo "apps en 2º plano restringidas" ;;
      apps_other) echo "apps en 2º plano gestionadas" ;;
      doze) echo "Doze forzado" ;; gms) echo "Play Services limitado" ;; wifi) echo "WiFi apagado" ;;
      data) echo "Ahorro de datos activo" ;; tune) echo "ajustes de kernel en reposo" ;; radio) echo "sin 5G" ;; lowram) echo "modo RAM baja" ;;
      cpu_pct) echo "CPU al $2%" ;; refresh) echo "pantalla a ${2}Hz" ;;
      none) echo "sin cambios activos" ;;
      selftest) echo "PowerSentinel: autodiagnóstico encontró un problema real al arrancar - revisa el panel de Diagnóstico" ;;
      safemode) echo "Modo seguro activo" ;;
      *) echo "$1" ;;
    esac
  fi
}

alert_dispatch() {
  local severity="$1" message="$2"
  [ "$severity" = "critical" ] || return 0
  [ "$(getconf notify true)" = "true" ] || return 0

  # The two fixed critical messages are emitted (and journaled) in one
  # language; show them in the user's.
  case "$message" in
    "PowerSentinel: autodiagnóstico encontró"*) message="$(_tr selftest)" ;;
    "Safe Mode is Active") message="$(_tr safemode)" ;;
  esac

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
    boot|charging|screen_off|low_power|night|thermal|manual|adaptive_tier1|adaptive_tier2|adaptive_tier3)
      _tr "ev_$1" ;;
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

  local cores doze apps gms wifi restrictdata tune radio lowram maxfreq maxrefresh
  cores="$("$JQ" -r 'any(.[]; .handle_cores != "false")' <<<"$snapshot" 2>/dev/null)"
  doze="$("$JQ" -r 'any(.[]; .doze != "false")' <<<"$snapshot" 2>/dev/null)"
  apps="$("$JQ" -r '[.[] | select(.handle_apps != "false") | .handle_apps] | unique | join(",")' <<<"$snapshot" 2>/dev/null)"
  gms="$("$JQ" -r 'any(.[]; .handle_gms != "false")' <<<"$snapshot" 2>/dev/null)"
  wifi="$("$JQ" -r 'any(.[]; .kill_wifi == "true")' <<<"$snapshot" 2>/dev/null)"
  restrictdata="$("$JQ" -r 'any(.[]; .restrict_data == "true")' <<<"$snapshot" 2>/dev/null)"
  tune="$("$JQ" -r 'any(.[]; .tune_system == "true")' <<<"$snapshot" 2>/dev/null)"
  radio="$("$JQ" -r 'any(.[]; .radio_lte == "true")' <<<"$snapshot" 2>/dev/null)"
  lowram="$("$JQ" -r 'any(.[]; .low_ram == "true")' <<<"$snapshot" 2>/dev/null)"
  maxfreq="$("$JQ" -r '[.[] | select(.max_cpu_freq != "false" and .max_cpu_freq != null) | (.max_cpu_freq | tonumber)] | min' <<<"$snapshot" 2>/dev/null)"
  maxrefresh="$("$JQ" -r '[.[] | select(.max_refresh_rate != "false" and .max_refresh_rate != null) | (.max_refresh_rate | tonumber)] | min' <<<"$snapshot" 2>/dev/null)"

  [ "$cores" = "true" ] && phrases+=("$(_tr cpu_save)")
  case "$apps" in
    "") ;;
    nice) phrases+=("$(_tr apps_nice)") ;;
    kill) phrases+=("$(_tr apps_kill)") ;;
    suspend) phrases+=("$(_tr apps_suspend)") ;;
    bucket) phrases+=("$(_tr apps_bucket)") ;;
    *) phrases+=("$(_tr apps_other)") ;;
  esac
  [ "$doze" = "true" ] && phrases+=("$(_tr doze)")
  [ "$gms" = "true" ] && phrases+=("$(_tr gms)")
  [ "$wifi" = "true" ] && phrases+=("$(_tr wifi)")
  [ "$restrictdata" = "true" ] && phrases+=("$(_tr data)")
  [ "$tune" = "true" ] && phrases+=("$(_tr tune)")
  [ "$radio" = "true" ] && phrases+=("$(_tr radio)")
  [ "$lowram" = "true" ] && phrases+=("$(_tr lowram)")
  case "$maxfreq" in
    ''|null) ;;
    *) phrases+=("$(_tr cpu_pct "$maxfreq")") ;;
  esac
  case "$maxrefresh" in
    ''|null) ;;
    *) phrases+=("$(_tr refresh "$maxrefresh")") ;;
  esac

  body=""
  first=1
  for p in "${phrases[@]}"; do
    if [ "$first" = 1 ]; then body="$p"; first=0
    else body="$body · $p"; fi
  done
  [ -n "$body" ] || body="$(_tr none)"

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
