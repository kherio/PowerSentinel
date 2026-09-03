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

# ---------- Apps ----------

action_apps_apply() {
  [ "$handle_apps" = "false" ] && return
  if [ "$handle_apps" = "suspend" ] && ! capability_has pm_suspend; then
    log_msg 1 "pm suspend not supported on this device - apps will only be force-stopped, not suspended"
  fi
  # SECURITY: see docs/security-audit.md - hardened while-read (not an
  # unquoted for-loop) and grep -Fxq (fixed string, whole line, not -E)
  # against the allowlist, exactly as already audited.
  while IFS= read -r app; do
    [ -n "$app" ] || continue
    if grep -Fxq -- "$app" "$allowlist"; then
      continue
    fi
    if [ "$handle_apps" = "nice" ]; then
      for i in $(pgrep "$app"); do
        log_msg 3 "Renicing $i"
        renice -n 19 "$i" &>/dev/null &
      done
    elif [ "$handle_apps" = "kill" ]; then
      log_msg 3 "Stopping $app"
      am force-stop "$app" &>/dev/null &
    else
      log_msg 3 "Suspending $app"
      am force-stop "$app" &>/dev/null &
      if capability_has pm_suspend; then
        pm suspend "$app" &>/dev/null &
      fi
    fi
  done < <(pm list packages -3 | cut -d: -f2-; [ -s "$denylist" ] && cat "$denylist")
}

action_apps_undo() {
  [ "$handle_apps" = "false" ] && return
  while IFS= read -r app; do
    [ -n "$app" ] || continue
    if grep -Fxq -- "$app" "$allowlist"; then
      continue
    fi
    if [ "$handle_apps" = "nice" ]; then
      for i in $(pgrep "$app"); do
        log_msg 3 "Resetting the nice level for $app"
        renice -n 0 "$i" &>/dev/null &
      done
    else
      log_msg 3 "Unsuspending $app"
      pm unsuspend "$app" &>/dev/null &
    fi
  done < <(pm list packages -3 | cut -d: -f2-; [ -s "$denylist" ] && cat "$denylist")
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
  log_msg 3 "Setting the low_ram flag"
  resetprop -n ro.config.low_ram true
}

action_low_ram_undo() {
  [ "$low_ram" = "true" ] || return
  log_msg 3 "Setting low_ram to false"
  resetprop -n ro.config.low_ram false
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
  if [ -d "/data/adb/modules" ]; then
    magic_remount_rw &>/dev/null
  fi
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
  if [ -d "/data/adb/modules" ]; then
    magic_remount_ro &>/dev/null
  fi
}

action_cores_undo() {
  { [ "$handle_cores" != "false" ] || [ "$disable_cores" != "false" ]; } || return
  if [ -d "/data/adb/modules" ]; then
    magic_remount_rw &>/dev/null
  fi
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
  if [ -d "/data/adb/modules" ]; then
    magic_remount_ro &>/dev/null
  fi
}
