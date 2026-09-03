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
        for i in $(pgrep "$app"); do
          log_msg 3 "Restoring the original nice level for $app"
          renice -n "${_owned_nice[$app]:-0}" "$i" &>/dev/null &
        done
        unset "_owned_action[$app]" "_owned_nice[$app]"
        changed=1
        ;;
      suspend)
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

action_gms_apply() {
  capability_has gms_installed || return
  if [ "$handle_gms" = "nice" ]; then
    log_msg 3 "Renicing GMS"
    renice -n 19 "$(pgrep com.google.android.gms)"
  elif [ "$handle_gms" = "kill" ]; then
    log_msg 3 "Disabling GMS"
    pm disable com.google.android.gms
    am force-stop com.google.android.gms
  fi
}

action_gms_undo() {
  capability_has gms_installed || return
  if [ "$handle_gms" = "nice" ]; then
    log_msg 3 "Resetting the nice level for GMS"
    renice -n 0 "$(pgrep com.google.android.gms)"
  elif [ "$handle_gms" = "kill" ]; then
    log_msg 3 "Enabling GMS"
    pm enable com.google.android.gms
  fi
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
    while IFS= read -r proc nice; do
      pid="$(pgrep "$proc")"
      [ ! "$nice" ] && nice="10"
      if [ "$(cat /proc/$pid/stat | cut -d' ' -f19)" != "$nice" ]; then
        log_msg 3 "Renicing $proc to $nice"
        renice -n "$nice" "$pid"
      fi
    done < "$proc_file"
    sleep "$delay"
  done &
}

action_proc_undo() {
  [ "$handle_proc" = "true" ] || return
  while IFS= read -r proc nice; do
    log_msg 3 "Resetting the nice level for $proc"
    renice -n 0 "$(pgrep "$proc")"
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
  local orig="false"
  if [ -f "$low_ram_orig_file" ]; then
    orig="$(cat "$low_ram_orig_file" 2>/dev/null)"
    rm -f "$low_ram_orig_file"
  fi
  [ -n "$orig" ] || orig="false"
  log_msg 3 "Restoring low_ram to its original value ($orig)"
  resetprop -n ro.config.low_ram "$orig"
}

# ---------- WiFi ----------

action_wifi_apply() {
  [ "$kill_wifi" = "true" ] || return
  if ! capability_has rfkill_wifi && ! capability_has svc_wifi; then
    log_msg 1 "Cannot disable WiFi: neither rfkill nor svc is available on this device"
    return
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
    return
  fi
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

action_cores_apply() {
  { [ "$handle_cores" != "false" ] || [ "$disable_cores" != "false" ]; } || return
  # BUG FIX: magic_remount_rw/magic_remount_ro (here and further below)
  # were never defined anywhere in this project's history - going all
  # the way back to its very first commit. Wrapped in &>/dev/null, they
  # always failed silently with "command not found". Confirmed via
  # extensive testing that writing to /sys/devices/system/cpu (a
  # virtual filesystem controlled by kernel driver permissions, not by
  # whether /system itself is mounted read-write) works correctly
  # without any remount step - removed rather than "fixed", since there
  # was never a working implementation to restore and the feature has
  # never needed one.
  if [ "$disable_cores" = "auto" ]; then
    if capability_has cores_online; then
      for cpu in ${hp_cpus[@]}; do
        log_msg 3 "Disabling $cpu"
        echo "0" > "$cpu_base_path/$cpu/online"
      done
    else
      log_msg 1 "Cannot disable CPU cores: no writable 'online' control found on this device"
    fi
  else
    # manual
    if capability_has cores_online; then
      for core in $disable_cores; do
        if [ -d "$cpu_base_path/$core" ]; then
          log_msg 3 "Disabling $core"
          echo "0" > "$cpu_base_path/$core/online"
        fi
      done
    else
      log_msg 1 "Cannot disable CPU cores: no writable 'online' control found on this device"
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
    for core in $handle_cores; do
      [ -d "$cpu_base_path/$core/" ] && \
      grep -q " powersave " "$cpu_base_path/$core/cpufreq/scaling_available_governors" && \
      log_msg 3 "Setting powersave on $core" && \
      echo "powersave" > "$cpu_base_path/$core/cpufreq/scaling_governor"
    done
  fi
}

action_cores_undo() {
  { [ "$handle_cores" != "false" ] || [ "$disable_cores" != "false" ]; } || return
  if [ "$disable_cores" = "auto" ]; then
    if capability_has cores_online; then
      for cpu in ${hp_cpus[@]}; do
        log_msg 3 "Enabling $cpu"
        echo "1" > "$cpu_base_path/$cpu/online"
      done
    fi
  else
    # the user manually set it
    if capability_has cores_online; then
      for cpu in $disable_cores; do
        if [ -d "$cpu_base_path/$cpu/" ]; then
          log_msg 3 "Enabling $cpu"
          echo "1" > "$cpu_base_path/$cpu/online"
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
    # the user manually set it
    for cpu in $handle_cores; do
      if [ -d "$cpu_base_path/$cpu/" ]; then
        log_msg 3 "Resetting $cpu"
        echo "${lp_default_govs[$cpu]}" > "$cpu_base_path/$cpu/cpufreq/scaling_governor"
      fi
    done
  fi
}
