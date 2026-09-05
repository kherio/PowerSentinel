#!/system/bin/bash

# PowerSentinel-actions.sh - the only place that touches the system.
# Every function here reads the already-resolved field values
# handle_event() sets up (handle_apps, allowlist, handle_cores, ...) and
# either applies or undoes exactly one category of setting - renice, pm
# suspend, cpufreq governors, doze, wifi, GMS, process priorities, low
# RAM. Nothing here decides anything; policy.sh and handle_event()'s own
# field resolution already did that. Front 2, part 3/3 of the
# architecture pass (detect -> policy -> action) - the last piece.
#
# Relocated from enable_pwr_save()/disable_pwr_save() with one real bug
# fixed along the way (see action_cores_apply below) - otherwise no
# logic changes, only where the code lives and how it's split.

: "${low_ram_orig_file:=/data/local/tmp/PowerSentinel/PowerSentinel.lowram_orig}"
: "${proc_orig_file:=/data/local/tmp/PowerSentinel/PowerSentinel.procorig}"

# CRITICAL FIX (found by an external code review, then confirmed with
# a real reproduction before being trusted): the single-slot ownership
# files (gms_state_file, wifi_state_file, low_ram_orig_file) are
# global, not indexed by event. Two active events wanting the exact
# SAME action on the same target self-heal correctly via
# reassert_active_events() re-establishing ownership after an undo -
# verified this explicitly and it holds. But two active events wanting
# DIFFERENT actions on the same target (e.g. one event's
# handle_gms=nice, another's handle_gms=kill, both active at once) do
# NOT self-heal: whichever event's apply happened to run first "owns"
# the single record slot, so when the SECOND event later runs its own
# apply, it correctly recognizes the target is already in a different
# state than before ITS OWN change and skips re-recording (since a
# record already exists) - meaning its own real transition is never
# tracked at all. Confirmed via a real reproduction: GMS ends up
# permanently disabled forever after both events end, since neither
# undo call ever has an accurate record of what to restore.
#
# Fixed with a different approach than per-event-indexed state (which
# would need a real redesign of every one of these files): before
# actually restoring anything, check whether any OTHER currently-
# active event (excluding the one currently ending, which is still in
# $active_events at this point in handle_event()'s own flow) still
# wants to touch this same field at all, REGARDLESS of which specific
# value it wants. If so, don't restore - leave the recorded state
# exactly as it is and return; reassert_active_events() (which runs
# immediately after undo, as part of the same handle_event() flow)
# will correctly re-apply whatever that other event's own
# configuration actually needs, including re-establishing correct
# ownership tracking for its own real transition. Only when confirmed
# that NO other active event needs this field at all does undo
# actually restore the true original.
_another_active_event_wants() {
  local field="$1" ev val
  for ev in "${active_events[@]}"; do
    [ -n "$ev" ] && [ "$ev" != "$event" ] || continue
    val="$(config_get_event_raw "$ev" "$field" false)"
    [ "$val" = "false" ] || return 0
  done
  return 1
}

# Per-app variant of the same check: is there another currently-active
# event whose OWN handle_apps, once filtered through this specific
# app's own 4-level policy, still resolves to a real action for THIS
# app? Only ever called for apps actually being reversed (see
# action_apps_undo below), not every installed app.
_another_active_event_wants_app() {
  local app="$1" ev val eff
  for ev in "${active_events[@]}"; do
    [ -n "$ev" ] && [ "$ev" != "$event" ] || continue
    val="$(config_get_event_raw "$ev" handle_apps false)"
    [ "$val" = "false" ] && continue
    eff="$(apppolicy_effective_action "$app" "$val")"
    [ "$eff" = "false" ] || return 0
  done
  return 1
}
# CRITICAL FIX (external code review, same class as GMS/WiFi/apps/
# low_ram/cores above, confirmed real by reading this exact code):
# proc_orig_file is a single global file keyed by PROCESS NAME, not by
# event - with two active events each targeting the same process
# through their own handle_proc/proc_file (even with different target
# nice values), ending ONE of them would restore the real original and
# delete the shared record while the OTHER event's own background
# monitor is still actively renicing that same process, exactly the
# same composition gap already fixed elsewhere. Same fix shape: check
# whether another currently-active event's own proc_file also targets
# this process name before actually restoring it.
_another_active_event_wants_proc() {
  local proc="$1" ev val other_proc_file
  for ev in "${active_events[@]}"; do
    [ -n "$ev" ] && [ "$ev" != "$event" ] || continue
    val="$(config_get_event_raw "$ev" handle_proc false)"
    [ "$val" = "true" ] || continue
    other_proc_file="$(config_get_event_raw "$ev" proc_file "")"
    [ -n "$other_proc_file" ] && [ -f "$other_proc_file" ] || continue
    awk -v p="$proc" '$1 == p { found=1 } END { exit !found }' "$other_proc_file" 2>/dev/null && return 0
  done
  return 1
}
: "${apps_ownership_file:=/data/local/tmp/PowerSentinel/PowerSentinel.appstate}"

# Current nice value of a live PID, via /proc/[pid]/stat (field 19) -
# same stable kernel interface, and the same "strip through the last
# comm-closing paren before counting fields" handling, already used by
# PowerSentinel-appwatch.sh for utime/stime.
_app_current_nice() {
  local stat_line
  stat_line="$(cat "/proc/$1/stat" 2>/dev/null)"
  stat_line="${stat_line##*) }"
  echo "$stat_line" | awk '{print $17}'
}

# Best-effort check for whether $1 is ALREADY suspended, independent of
# anything PowerSentinel has done. ApplicationInfo.FLAG_SUSPENDED /
# PackageManager.isPackageSuspended() are real, documented framework
# concepts; dumpsys package's per-user-state "suspended=" field is a
# long-standing convention for surfacing that state, but this exact
# text format cannot be verified against a real device from this
# environment. Fails safe either way: if this stops matching on some
# device/version, it simply always reports "not suspended", meaning
# apply/undo behave exactly as they did before this fix for that one
# signal - never a new, worse failure mode than not checking at all.
_app_is_suspended() {
  dumpsys package "$1" 2>/dev/null | grep -q "suspended=true"
}

# ---------- Apps ----------

action_apps_apply() {
  [ "$handle_apps" = "false" ] && return
  if [ "$handle_apps" = "suspend" ] && ! capability_has pm_suspend; then
    log_msg 1 "pm suspend not supported on this device - apps will only be force-stopped, not suspended"
  fi
  # SECURITY: see docs/security-audit.md - hardened while-read (not an
  # unquoted for-loop) and grep -Fxq (fixed string, whole line, not -E)
  # against the allowlist, exactly as already audited. is_critical_app
  # (PowerSentinel-detect.sh) layers on top: the device's own default
  # dialer/SMS/emergency apps, and anything already exempted from
  # Android's own battery optimization, are protected regardless of
  # allowlist/denylist configuration. apppolicy_effective_action
  # (PowerSentinel-apppolicy.sh) layers on top of THAT: a per-app,
  # global 4-level policy (never / gentle-only / follow-event / always-
  # aggressive) that can override what THIS event's own handle_apps
  # asks for, on a per-app basis - level 2 (the default for any app
  # never explicitly classified) is a pure passthrough, so nothing
  # changes for anyone who hasn't set any app policy at all.
  #
  # BUG FIX (found by an external report, then confirmed real): this
  # used to blindly renice-to-19 or pm-suspend every matching app on
  # apply, and blindly renice-to-0 or pm-unsuspend every matching app
  # on undo, with no record of whether PowerSentinel itself was the one
  # who changed that app's state, or what it was before. A suspend on
  # an app ALREADY suspended by something else, or a nice level that
  # wasn't originally 0, would get silently and permanently
  # "corrected" back to PowerSentinel's own defaults once the event
  # ended - modifying app state PowerSentinel never actually created.
  # Now records, per app, exactly what action was taken (and the real
  # original nice value) in $apps_ownership_file, loaded and saved once
  # per call rather than once per app to avoid a jq subprocess per
  # installed package.
  local effective app pkg act nice
  declare -A _owned_action=() _owned_nice=()
  if [ -s "$apps_ownership_file" ]; then
    while IFS=$'\t' read -r pkg act nice; do
      [ -n "$pkg" ] || continue
      _owned_action[$pkg]="$act"
      [ -n "$nice" ] && _owned_nice[$pkg]="$nice"
    done < <("$JQ" -r 'to_entries[] | "\(.key)\t\(.value.action)\t\(.value.nice_orig // "")"' "$apps_ownership_file" 2>/dev/null)
  fi
  local changed=0

  while IFS= read -r app; do
    [ -n "$app" ] || continue
    if grep -Fxq -- "$app" "$allowlist" || is_critical_app "$app"; then
      continue
    fi
    effective="$(apppolicy_effective_action "$app" "$handle_apps")"
    [ "$effective" = "false" ] && continue
    # BUG FIX (external code review, then confirmed by reading this
    # exact code): $effective used to go straight into
    # if.../elif.../else - the else branch (suspend, the single most
    # disruptive per-app action this daemon takes) caught EVERY value
    # that wasn't literally "nice" or "kill", including anything
    # unexpected - a config typo ("ncie"), manual corruption, or any
    # future bug elsewhere producing a value outside the known set.
    # "Fail toward doing less, not more" has been this project's
    # consistent direction everywhere else; this one path did the
    # opposite, silently escalating anything unrecognized into the
    # most aggressive action available. Now an unrecognized value is
    # treated the same as "false" - skip this app entirely - rather
    # than falling through to suspend.
    case "$effective" in
      nice|kill|suspend) ;;
      *) continue ;;
    esac
    if [ "$effective" = "nice" ]; then
      for i in $(pgrep "$app"); do
        if [ -z "${_owned_nice[$app]:-}" ]; then
          _owned_nice[$app]="$(_app_current_nice "$i")"
          _owned_action[$app]="nice"
          changed=1
        fi
        log_msg 3 "Renicing $i"
        renice -n 19 "$i" &>/dev/null &
      done
    elif [ "$effective" = "kill" ]; then
      log_msg 3 "Stopping $app"
      am force-stop "$app" &>/dev/null &
    else
      if _app_is_suspended "$app"; then
        log_msg 3 "$app is already suspended independently of PowerSentinel - leaving it as-is"
      else
        _owned_action[$app]="suspend"
        changed=1
        log_msg 3 "Suspending $app"
        am force-stop "$app" &>/dev/null &
        if capability_has pm_suspend; then
          pm suspend "$app" &>/dev/null &
        fi
      fi
    fi
  done < <(pm list packages -3 | cut -d: -f2-; [ -s "$denylist" ] && cat "$denylist")

  if [ "$changed" = "1" ]; then
    local dir tmp
    dir="$(dirname "$apps_ownership_file")"
    mkdir -p "$dir" 2>/dev/null
    tmp="$(mktemp "$dir/.PowerSentinel.appstate.XXXXXX")" || return
    echo '{}' > "$tmp"
    for pkg in "${!_owned_action[@]}"; do
      "$JQ" --arg p "$pkg" --arg a "${_owned_action[$pkg]}" --arg n "${_owned_nice[$pkg]:-}" \
        '.[$p] = ({action: $a} + (if $n != "" then {nice_orig: $n} else {} end))' \
        "$tmp" > "$tmp.step" 2>/dev/null && mv "$tmp.step" "$tmp"
    done
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$apps_ownership_file"
  fi
}

action_apps_undo() {
  [ "$handle_apps" = "false" ] && return
  local effective app pkg act nice
  declare -A _owned_action=() _owned_nice=()
  if [ -s "$apps_ownership_file" ]; then
    while IFS=$'\t' read -r pkg act nice; do
      [ -n "$pkg" ] || continue
      _owned_action[$pkg]="$act"
      [ -n "$nice" ] && _owned_nice[$pkg]="$nice"
    done < <("$JQ" -r 'to_entries[] | "\(.key)\t\(.value.action)\t\(.value.nice_orig // "")"' "$apps_ownership_file" 2>/dev/null)
  fi
  local changed=0

  while IFS= read -r app; do
    [ -n "$app" ] || continue
    if grep -Fxq -- "$app" "$allowlist" || is_critical_app "$app"; then
      continue
    fi
    effective="$(apppolicy_effective_action "$app" "$handle_apps")"
    [ "$effective" = "false" ] && continue

    # Only reverse whatever PowerSentinel itself actually recorded
    # doing to THIS app - never what the current policy would compute,
    # which is exactly the bug: an app that was never touched (or was
    # already in that state before PowerSentinel acted) is left alone.
    case "${_owned_action[$app]:-}" in
      nice)
        _another_active_event_wants_app "$app" && continue
        for i in $(pgrep "$app"); do
          log_msg 3 "Restoring the original nice level for $app"
          renice -n "${_owned_nice[$app]:-0}" "$i" &>/dev/null &
        done
        unset "_owned_action[$app]" "_owned_nice[$app]"
        changed=1
        ;;
      suspend)
        _another_active_event_wants_app "$app" && continue
        log_msg 3 "Unsuspending $app"
        pm unsuspend "$app" &>/dev/null &
        unset "_owned_action[$app]"
        changed=1
        ;;
      *)
        : # never touched, or was already in that state - nothing to undo
        ;;
    esac
  done < <(pm list packages -3 | cut -d: -f2-; [ -s "$denylist" ] && cat "$denylist")

  if [ "$changed" = "1" ]; then
    local dir tmp
    dir="$(dirname "$apps_ownership_file")"
    mkdir -p "$dir" 2>/dev/null
    tmp="$(mktemp "$dir/.PowerSentinel.appstate.XXXXXX")" || return
    echo '{}' > "$tmp"
    for pkg in "${!_owned_action[@]}"; do
      "$JQ" --arg p "$pkg" --arg a "${_owned_action[$pkg]}" --arg n "${_owned_nice[$pkg]:-}" \
        '.[$p] = ({action: $a} + (if $n != "" then {nice_orig: $n} else {} end))' \
        "$tmp" > "$tmp.step" 2>/dev/null && mv "$tmp.step" "$tmp"
    done
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$apps_ownership_file"
  fi
}

# ---------- Google Mobile Services ----------

: "${gms_state_file:=/data/local/tmp/PowerSentinel/PowerSentinel.gmsstate}"

# Whether GMS is CURRENTLY disabled, independent of anything
# PowerSentinel has done - `pm list packages -d` (list disabled
# packages) is a standard, documented pm subcommand, not a fragile
# dumpsys parse.
_gms_is_disabled() {
  pm list packages -d 2>/dev/null | grep -q "com.google.android.gms$"
}

_gms_ensure_state_dir() {
  mkdir -p "$(dirname "$gms_state_file")" 2>/dev/null
}

action_gms_apply() {
  capability_has gms_installed || return
  # BUG FIX (found by an external code review, then confirmed with a
  # real reproduction before being trusted): the earlier version of
  # this fix recorded ownership only ONCE ("if the state file doesn't
  # exist yet") - correct when every active event wants the SAME
  # action, but incoherent when different active events want DIFFERENT
  # actions on GMS (one event's handle_gms=nice, another's
  # handle_gms=kill, both active at once). Confirmed: the second
  # event's own real transition was never recorded at all (a record
  # already existed, from the first event's own different action), so
  # when both events eventually ended, neither undo call had an
  # accurate record of what to restore - GMS ended up permanently
  # disabled.
  #
  # Fixed by always updating the recorded ACTION on every apply
  # (reflecting whichever event most recently caused GMS's current
  # state), while capturing the TRUE original value (nice level, or
  # disabled state) only the first time this transitions from
  # untracked to tracked - the two are tracked separately so one can
  # change without touching the other.
  if [ "$handle_gms" = "nice" ]; then
    local pid orig_nice
    pid="$(pgrep com.google.android.gms)"
    orig_nice="$("$JQ" -r '.orig_nice // empty' "$gms_state_file" 2>/dev/null)"
    [ -n "$orig_nice" ] || orig_nice="$(_app_current_nice "$pid")"
    _gms_ensure_state_dir
    "$JQ" -cn --arg action "nice" --arg orig "$orig_nice" '{action: $action, orig_nice: $orig}' > "$gms_state_file" 2>/dev/null
    chmod 600 "$gms_state_file" 2>/dev/null
    log_msg 3 "Renicing GMS"
    renice -n 19 "$pid"
  elif [ "$handle_gms" = "kill" ]; then
    local was_disabled
    was_disabled="$("$JQ" -r '.orig_disabled // empty' "$gms_state_file" 2>/dev/null)"
    if [ -z "$was_disabled" ]; then
      if _gms_is_disabled; then was_disabled="true"; else was_disabled="false"; fi
    fi
    _gms_ensure_state_dir
    "$JQ" -cn --arg action "kill" --arg orig "$was_disabled" '{action: $action, orig_disabled: $orig}' > "$gms_state_file" 2>/dev/null
    chmod 600 "$gms_state_file" 2>/dev/null
    log_msg 3 "Disabling GMS"
    pm disable com.google.android.gms
    am force-stop com.google.android.gms
  fi
}

action_gms_undo() {
  capability_has gms_installed || return
  # Idempotent by construction: a second call (or a call with no
  # matching apply ever having run) finds nothing recorded and does
  # nothing further, rather than guessing.
  [ -f "$gms_state_file" ] || return
  _another_active_event_wants handle_gms && return
  local action orig
  action="$("$JQ" -r '.action // empty' "$gms_state_file" 2>/dev/null)"
  case "$action" in
    nice)
      orig="$("$JQ" -r '.orig_nice // empty' "$gms_state_file" 2>/dev/null)"
      rm -f "$gms_state_file"
      [ -n "$orig" ] || orig="0"
      log_msg 3 "Restoring the original nice level for GMS"
      renice -n "$orig" "$(pgrep com.google.android.gms)"
      ;;
    kill)
      orig="$("$JQ" -r '.orig_disabled // empty' "$gms_state_file" 2>/dev/null)"
      rm -f "$gms_state_file"
      if [ "$orig" != "true" ]; then
        log_msg 3 "Enabling GMS"
        pm enable com.google.android.gms
      fi
      ;;
    *)
      rm -f "$gms_state_file"
      ;;
  esac
}

# ---------- Process priorities ----------

action_proc_apply() {
  [ "$handle_proc" = "true" ] || return
  # BUG FIX: this used to loop "while [ "$lock" = "1" ]" - but nothing
  # in the v2 code path ever set $lock to anything (it was only ever
  # set inside enable_pwr_save's now-removed v1-only branches), so this
  # background monitor has silently never actually looped for any v2
  # user - it ran its body once, checked an always-empty $lock, and
  # exited immediately. Also, since this whole block backgrounds itself
  # (the trailing &), it forks a subshell with its own copy of any
  # bash variable - even a correctly-set $active_events in the parent
  # daemon process would never be visible here as it changes. The
  # state file (PowerSentinel-state.sh) is an actual file on disk, so
  # it's the one thing a backgrounded subshell can reliably observe
  # changing in the parent process: keep monitoring while this
  # specific event is still listed as active there.
  local proc_event="$event"
  while "$JQ" -e --arg e "$proc_event" 'any(.[]?; . == $e)' "$state_file" >/dev/null 2>&1; do
    # BUG FIX (found while fixing the ownership issue below, unrelated
    # to it): `IFS= read -r proc nice` - setting IFS to EMPTY disables
    # field splitting entirely, so the WHOLE line ("myprocess 10") went
    # into $proc and $nice was always empty, silently falling through
    # to the hardcoded default of 10 below regardless of what nice
    # value the user actually configured per process in $proc_file.
    # This has likely never worked as documented since it was written.
    while read -r proc nice; do
      [ ! "$nice" ] && nice="10"
      # BUG FIX (external code review): this used to do
      # `pid="$(pgrep "$proc")"` as a single assignment - for a process
      # with more than one running instance, pgrep returns MULTIPLE
      # PIDs (one per line), so $pid became a multi-line string and
      # `/proc/$pid/stat` was never a valid path at all for any process
      # with more than one PID; the whole check silently did nothing.
      # Now loops over every matching PID individually, the same
      # pattern already used for apps.
      for pid in $(pgrep "$proc"); do
        [ -n "$pid" ] || continue
        if [ "$(cat /proc/$pid/stat 2>/dev/null | cut -d' ' -f19)" != "$nice" ]; then
          # BUG FIX (same review): also capture the real original nice
          # for this PROCESS NAME (not this PID specifically - a
          # process that restarts mid-monitoring gets a new PID, but
          # it's still the same logical process, and shouldn't be
          # treated as having a "new" original just because its PID
          # changed) the first time it's ever touched, so undo can
          # restore it instead of hardcoding 0.
          if ! "$JQ" -e --arg p "$proc" 'has($p)' "$proc_orig_file" >/dev/null 2>&1; then
            mkdir -p "$(dirname "$proc_orig_file")" 2>/dev/null
            [ -s "$proc_orig_file" ] || echo '{}' > "$proc_orig_file"
            local cur_nice tmp
            cur_nice="$(cat /proc/$pid/stat 2>/dev/null | cut -d' ' -f19)"
            tmp="$(mktemp "$(dirname "$proc_orig_file")/.procorig.XXXXXX")"
            "$JQ" --arg p "$proc" --arg n "$cur_nice" '.[$p] = $n' "$proc_orig_file" > "$tmp" 2>/dev/null \
              && chmod 600 "$tmp" 2>/dev/null && mv "$tmp" "$proc_orig_file" || rm -f "$tmp"
          fi
          log_msg 3 "Renicing $proc ($pid) to $nice"
          renice -n "$nice" "$pid"
        fi
      done
    done < "$proc_file"
    sleep "$delay"
  done &
}

action_proc_undo() {
  [ "$handle_proc" = "true" ] || return
  while read -r proc nice; do
    _another_active_event_wants_proc "$proc" && continue
    local orig
    orig="$("$JQ" -r --arg p "$proc" '.[$p] // empty' "$proc_orig_file" 2>/dev/null)"
    [ -n "$orig" ] || orig="0"
    for pid in $(pgrep "$proc"); do
      [ -n "$pid" ] || continue
      log_msg 3 "Restoring the original nice level for $proc ($pid)"
      renice -n "$orig" "$pid"
    done
    "$JQ" --arg p "$proc" 'del(.[$p])' "$proc_orig_file" > "$proc_orig_file.tmp" 2>/dev/null \
      && mv "$proc_orig_file.tmp" "$proc_orig_file"
  done < "$proc_file"
}

# ---------- Low RAM flag ----------

action_low_ram_apply() {
  [ "$low_ram" = "true" ] || return
  # BUG FIX (found by an external report, then confirmed by reading
  # this function before the fix): this used to unconditionally set
  # low_ram to true and, on undo, unconditionally set it back to
  # false - with no record of what it actually was before PowerSentinel
  # touched it. A device that genuinely ships with
  # ro.config.low_ram=true by default (a real, intentional system
  # setting on some low-memory devices, affecting a lot of Android's
  # memory management) would have that setting silently and
  # persistently overwritten to false once the event ended. Recorded
  # only the FIRST time this transitions from untracked to tracked -
  # if the file already exists, PowerSentinel itself already changed
  # this earlier (e.g. a different still-active event applied it
  # first) and the current live value is already PowerSentinel's own
  # "true", not the real original.
  if [ ! -f "$low_ram_orig_file" ]; then
    mkdir -p "$(dirname "$low_ram_orig_file")" 2>/dev/null
    getprop ro.config.low_ram > "$low_ram_orig_file" 2>/dev/null
    chmod 600 "$low_ram_orig_file" 2>/dev/null
  fi
  log_msg 3 "Setting the low_ram flag"
  resetprop -n ro.config.low_ram true
}

action_low_ram_undo() {
  [ "$low_ram" = "true" ] || return
  # Idempotency hardening (external code review): calling this twice in
  # a row without an intervening apply used to fall through to a
  # hardcoded "false" on the second call, once the recorded original
  # had already been consumed and deleted by the first - potentially
  # wrong if the real original was "true". Now a second call (or one
  # with no matching apply ever having run) finds nothing recorded and
  # does nothing further, rather than guessing.
  [ -f "$low_ram_orig_file" ] || return
  _another_active_event_wants low_ram && return
  local orig
  orig="$(cat "$low_ram_orig_file" 2>/dev/null)"
  rm -f "$low_ram_orig_file"
  [ -n "$orig" ] || orig="false"
  log_msg 3 "Restoring low_ram to its original value ($orig)"
  resetprop -n ro.config.low_ram "$orig"
}

# ---------- WiFi ----------

# Whether WiFi is CURRENTLY enabled, independent of anything
# PowerSentinel has done and independent of which control mechanism
# (rfkill or svc) actually toggles it - `settings get global wifi_on`
# is backed by the same WifiManager.isWifiEnabled() state either
# control path ultimately changes, not a fragile dumpsys parse.
: "${wifi_state_file:=/data/local/tmp/PowerSentinel/PowerSentinel.wifistate}"

_wifi_is_enabled_now() {
  [ "$(settings get global wifi_on 2>/dev/null)" = "1" ]
}

action_wifi_apply() {
  [ "$kill_wifi" = "true" ] || return
  if ! capability_has rfkill_wifi && ! capability_has svc_wifi; then
    log_msg 1 "Cannot disable WiFi: neither rfkill nor svc is available on this device"
    emit capabilities warning "WiFi could not be disabled: not supported on this device"
    return
  fi
  # BUG FIX (found during an external code review's broader idempotency
  # concern, then confirmed by reading this function): undo
  # unconditionally re-enabled WiFi with no record of whether it was
  # already off before PowerSentinel touched it. This matters more here
  # than almost anywhere else in the daemon: a user manually turning
  # WiFi off themselves (no network around, deliberately saving
  # battery, flight mode) is completely ordinary - undo forcing it back
  # on regardless would be a real, everyday annoyance, not just a
  # theoretical edge case. Recorded only the first time this
  # transitions from untracked to tracked, same reasoning as low_ram's
  # own fix - a second apply while already active must not overwrite
  # the real original with PowerSentinel's own "off".
  if [ ! -f "$wifi_state_file" ]; then
    mkdir -p "$(dirname "$wifi_state_file")" 2>/dev/null
    if _wifi_is_enabled_now; then echo "was_on" > "$wifi_state_file"; else echo "was_off" > "$wifi_state_file"; fi
    chmod 600 "$wifi_state_file" 2>/dev/null
  fi
  log_msg 3 "Disabling WiFi"
  if [ -n "$RFKILL_CMD" ]; then
    log_msg 3 "Attempting to block with: $RFKILL_CMD"
    "$RFKILL_CMD" block wifi
    # Check if rfkill actually worked, if not, use svc as a final fallback
    if [ "$("$RFKILL_CMD" list wifi | grep Soft | cut -d: -f2 | cut -d' ' -f2)" != "yes" ]; then
       log_msg 3 "rfkill failed to block. Falling back to svc."
       svc wifi disable
    fi
  else
    log_msg 3 "No rfkill command available. Using svc."
    svc wifi disable
  fi
}

action_wifi_undo() {
  [ "$kill_wifi" = "true" ] || return
  if ! capability_has rfkill_wifi && ! capability_has svc_wifi; then
    log_msg 1 "Cannot re-enable WiFi: neither rfkill nor svc is available on this device"
    emit capabilities warning "WiFi could not be re-enabled: not supported on this device"
    return
  fi
  # Idempotent (a second call, or a call with no matching apply ever
  # having run, finds nothing recorded and does nothing further), and
  # only re-enables if PowerSentinel itself is the one who actually
  # turned WiFi off - never if it was already off beforehand.
  [ -f "$wifi_state_file" ] || return
  _another_active_event_wants kill_wifi && return
  local recorded
  recorded="$(cat "$wifi_state_file" 2>/dev/null)"
  rm -f "$wifi_state_file"
  [ "$recorded" = "was_on" ] || return
  log_msg 3 "Enabling WiFi"
  if [ -n "$RFKILL_CMD" ]; then
    log_msg 3 "Attempting to unblock with: $RFKILL_CMD"
    "$RFKILL_CMD" unblock wifi
    if [ "$("$RFKILL_CMD" list wifi | grep Soft | cut -d: -f2 | cut -d' ' -f2)" != "no" ]; then
       log_msg 3 "rfkill failed to unblock. Falling back to svc."
       svc wifi enable
    fi
  else
    log_msg 3 "No rfkill command available. Using svc."
    svc wifi enable
  fi
}

# ---------- Doze ----------

action_doze_apply() {
  capability_has doze_force || return
  if [ "$doze" = "light" ]; then
    log_msg 3 "Enabling $doze Doze mode"
    dumpsys deviceidle force-idle light &>/dev/null
  fi
  if [ "$doze" = "deep" ]; then
    log_msg 3 "Enabling $doze Doze mode"
    dumpsys deviceidle force-idle deep &>/dev/null
  fi
}

action_doze_undo() {
  [ "$doze" != "false" ] || return
  capability_has doze_force || return
  log_msg 3 "Disabling Doze mode"
  dumpsys deviceidle unforce &>/dev/null
}

# ---------- CPU cores ----------

: "${cores_online_file:=/data/local/tmp/PowerSentinel/PowerSentinel.coresonline}"
: "${cores_manual_gov_file:=/data/local/tmp/PowerSentinel/PowerSentinel.coresgov}"

# Whether $1 (a core name, e.g. "cpu6") is CURRENTLY online, read
# directly from the same sysfs file action_cores_apply/undo themselves
# read and write - not a cached array from detection time.
_core_is_online() {
  [ "$(cat "$cpu_base_path/$1/online" 2>/dev/null)" = "1" ]
}

# Records that core $1 was online before PowerSentinel is about to take
# it offline - only the first time (an already-tracked core keeps its
# real original, not PowerSentinel's own "0"). $2 is the JSON file to
# record into (cores_online_file is shared between disable_cores'
# "auto" and "manual" modes, since both ultimately toggle the exact
# same sysfs "online" file per core).
_core_capture_online_orig() {
  local core="$1" file="$2" existing
  existing="$("$JQ" -r --arg c "$core" '.[$c] // empty' "$file" 2>/dev/null)"
  [ -n "$existing" ] && return
  mkdir -p "$(dirname "$file")" 2>/dev/null
  [ -s "$file" ] || echo '{}' > "$file"
  local tmp
  tmp="$(mktemp "$(dirname "$file")/.coretrack.XXXXXX")" || return
  if _core_is_online "$core"; then
    "$JQ" --arg c "$core" '.[$c] = "1"' "$file" > "$tmp" 2>/dev/null
  else
    "$JQ" --arg c "$core" '.[$c] = "0"' "$file" > "$tmp" 2>/dev/null
  fi
  [ -s "$tmp" ] && chmod 600 "$tmp" 2>/dev/null && mv "$tmp" "$file" || rm -f "$tmp"
}

# Whether any OTHER currently-active event's own disable_cores (auto or
# manual) would also disable this specific core - same composition-
# safety reasoning as GMS/WiFi/low_ram/apps above, applied per core.
_another_active_event_disables_core() {
  local core="$1" ev val
  for ev in "${active_events[@]}"; do
    [ -n "$ev" ] && [ "$ev" != "$event" ] || continue
    val="$(config_get_event_raw "$ev" disable_cores false)"
    [ "$val" = "false" ] && continue
    if [ "$val" = "auto" ]; then
      # Can't recompute hp_cpus for another event without re-running
      # detection - but disable_cores=auto always means the same real
      # hp_cpus set on this device regardless of which event asked for
      # it, so checking membership in the CURRENT hp_cpus array (auto-
      # detected once at startup, not per event) is accurate here.
      local hp
      for hp in "${hp_cpus[@]}"; do [ "$hp" = "$core" ] && return 0; done
    else
      local c
      for c in $val; do [ "$c" = "$core" ] && return 0; done
    fi
  done
  return 1
}

action_cores_apply() {
  { [ "$handle_cores" != "false" ] || [ "$disable_cores" != "false" ]; } || return
  # BUG FIX (external code review, same class as GMS/WiFi/low_ram/apps
  # above): action_cores_undo() used to unconditionally bring every
  # targeted core back online, with no record of whether it was
  # already offline (for entirely unrelated reasons - thermal
  # throttling, a different tool, manual admin action) before
  # PowerSentinel ever touched it. Now records, per core, whether it
  # was genuinely online before PowerSentinel takes it offline -
  # exactly the same reasoning already applied to apps/GMS/WiFi.
  if [ "$disable_cores" = "auto" ]; then
    if capability_has cores_online; then
      for cpu in ${hp_cpus[@]}; do
        _core_is_online "$cpu" || continue
        _core_capture_online_orig "$cpu" "$cores_online_file"
        log_msg 3 "Disabling $cpu"
        echo "0" > "$cpu_base_path/$cpu/online"
      done
    else
      log_msg 1 "Cannot disable CPU cores: no writable 'online' control found on this device"
      emit capabilities warning "CPU cores could not be disabled: not supported on this device"
    fi
  else
    # manual
    if capability_has cores_online; then
      for core in $disable_cores; do
        if [ -d "$cpu_base_path/$core" ]; then
          _core_is_online "$core" || continue
          _core_capture_online_orig "$core" "$cores_online_file"
          log_msg 3 "Disabling $core"
          echo "0" > "$cpu_base_path/$core/online"
        fi
      done
    else
      log_msg 1 "Cannot disable CPU cores: no writable 'online' control found on this device"
      emit capabilities warning "CPU cores could not be disabled: not supported on this device"
    fi
  fi
  if [ "$handle_cores" = "auto" ]; then
    if capability_has cores_governor; then
      for cpu in ${lp_cpus[@]}; do
        log_msg 3 "Setting powersave on $cpu"
        echo "powersave" > "$cpu_base_path/$cpu/cpufreq/scaling_governor"
      done
    else
      log_msg 1 "Cannot set powersave governor: not supported on this device's cores"
      emit capabilities warning "The CPU power-save mode could not be set: not supported on this device"
    fi
  else
    # BUG FIX: this used to write to
    # "$cpu_base_path/$cpu/cpufreq/scaling_governor" - "$cpu" instead of
    # "$core", a stale variable left over from the disable_cores loop
    # right above (which does use "$cpu" as its own loop variable, in
    # its "auto" branch). Since "$cpu" doesn't change across THIS loop's
    # iterations, every manually-specified core ended up having
    # powersave applied to whichever core "$cpu" was last pointing at
    # (or nowhere at all, if disable_cores was "false" and "$cpu" was
    # never set this cycle) - not the core the log line right above it
    # claimed. Manual (non-"auto") core selection is a comparatively
    # rarely-used mode, which is likely why this went unnoticed.
    #
    # BUG FIX (external code review): undo used to restore from
    # $lp_default_govs, an array populated by auto_map_cores() only for
    # cores classified as low-power AT STARTUP - a manually-specified
    # high-power core (e.g. handle_cores=cpu6 where cpu6 is actually a
    # performance core) has no entry there at all, so undo would write
    # an EMPTY STRING as the governor. Now captures each manually-
    # specified core's real, current governor before overwriting it,
    # regardless of whether that core happens to also be in the auto-
    # detected low-power set.
    for core in $handle_cores; do
      if [ -d "$cpu_base_path/$core/" ] && grep -q " powersave " "$cpu_base_path/$core/cpufreq/scaling_available_governors"; then
        local existing_gov
        existing_gov="$("$JQ" -r --arg c "$core" '.[$c] // empty' "$cores_manual_gov_file" 2>/dev/null)"
        if [ -z "$existing_gov" ]; then
          mkdir -p "$(dirname "$cores_manual_gov_file")" 2>/dev/null
          [ -s "$cores_manual_gov_file" ] || echo '{}' > "$cores_manual_gov_file"
          local tmp real_gov
          real_gov="$(cat "$cpu_base_path/$core/cpufreq/scaling_governor" 2>/dev/null)"
          tmp="$(mktemp "$(dirname "$cores_manual_gov_file")/.coresgov.XXXXXX")"
          "$JQ" --arg c "$core" --arg g "$real_gov" '.[$c] = $g' "$cores_manual_gov_file" > "$tmp" 2>/dev/null \
            && chmod 600 "$tmp" 2>/dev/null && mv "$tmp" "$cores_manual_gov_file" || rm -f "$tmp"
        fi
        log_msg 3 "Setting powersave on $core"
        echo "powersave" > "$cpu_base_path/$core/cpufreq/scaling_governor"
      fi
    done
  fi
}

action_cores_undo() {
  { [ "$handle_cores" != "false" ] || [ "$disable_cores" != "false" ]; } || return
  if [ "$disable_cores" = "auto" ]; then
    if capability_has cores_online; then
      for cpu in ${hp_cpus[@]}; do
        [ "$("$JQ" -r --arg c "$cpu" '.[$c] // empty' "$cores_online_file" 2>/dev/null)" = "1" ] || continue
        _another_active_event_disables_core "$cpu" && continue
        log_msg 3 "Enabling $cpu"
        echo "1" > "$cpu_base_path/$cpu/online"
        "$JQ" --arg c "$cpu" 'del(.[$c])' "$cores_online_file" > "$cores_online_file.tmp" 2>/dev/null \
          && mv "$cores_online_file.tmp" "$cores_online_file"
      done
    fi
  else
    # the user manually set it
    if capability_has cores_online; then
      for cpu in $disable_cores; do
        if [ -d "$cpu_base_path/$cpu/" ]; then
          [ "$("$JQ" -r --arg c "$cpu" '.[$c] // empty' "$cores_online_file" 2>/dev/null)" = "1" ] || continue
          _another_active_event_disables_core "$cpu" && continue
          log_msg 3 "Enabling $cpu"
          echo "1" > "$cpu_base_path/$cpu/online"
          "$JQ" --arg c "$cpu" 'del(.[$c])' "$cores_online_file" > "$cores_online_file.tmp" 2>/dev/null \
            && mv "$cores_online_file.tmp" "$cores_online_file"
        fi
      done
    fi
  fi
  if [ "$handle_cores" = "auto" ]; then
    if capability_has cores_governor; then
      for index in ${!lp_cpus[@]}; do
        # TBH, i have no fucking clue
        # what i did here but its
        # magical and it works
        # so, i will just leave it.
        log_msg 3 "Resetting ${lp_cpus[$index]}"
        echo "${lp_govs[$index]}" > "$cpu_base_path/${lp_cpus[$index]}/cpufreq/scaling_governor"
      done
    fi
  else
    # the user manually set it - restore from the real captured value
    # (cores_manual_gov_file), not $lp_default_govs (see the matching
    # comment in action_cores_apply for why that array doesn't work
    # here).
    for core in $handle_cores; do
      if [ -d "$cpu_base_path/$core/" ]; then
        local recorded_gov
        recorded_gov="$("$JQ" -r --arg c "$core" '.[$c] // empty' "$cores_manual_gov_file" 2>/dev/null)"
        [ -n "$recorded_gov" ] || continue
        log_msg 3 "Resetting $core"
        echo "$recorded_gov" > "$cpu_base_path/$core/cpufreq/scaling_governor"
        "$JQ" --arg c "$core" 'del(.[$c])' "$cores_manual_gov_file" > "$cores_manual_gov_file.tmp" 2>/dev/null \
          && mv "$cores_manual_gov_file.tmp" "$cores_manual_gov_file"
      fi
    done
  fi
}
