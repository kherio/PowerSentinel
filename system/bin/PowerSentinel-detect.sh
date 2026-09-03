#!/system/bin/bash

# PowerSentinel-detect.sh - pure, side-effect-free reads of device state.
#
# Nothing in this file writes to the system, changes a setting, or
# persists anything - every function here only answers a question about
# the device's *current* real-world state (battery, temperature,
# charging, CPU load, screen, low-power mode), for policy.sh to combine
# with the user's configured rules and for the daemon's status
# reporting. This is front 2 of the architecture pass (detect -> policy
# -> action), building on the JSON config layer from front 1.
#
# Consolidates what used to be four independent `dumpsys battery` calls
# scattered across the daemon (compute_pressure_score, check_charge_limit,
# is_thermal_now, update_status), each with its own copy of the same
# anchored-regex parsing, into a single read per poll cycle via
# detect_refresh() - callers read the DETECT_* globals it populates
# instead of re-invoking dumpsys themselves. This also means every
# consumer sees the exact same snapshot within one cycle, rather than a
# (rare, but real) chance of the battery level ticking over between two
# independent dumpsys calls a few lines apart.
#
# NOT touched by this consolidation, deliberately: the "charging" EVENT
# trigger (is_device charging, below) reads a *different* underlying
# signal - Android's deviceidle subsystem's own charging flag - than
# DETECT_BATTERY_CHARGING (AC/USB/Wireless powered from `dumpsys
# battery`), which is what the newer battery-card/thermal/pressure/
# charge-limit features have always used. These two signals usually
# agree, but unifying them is a real behavior decision (which one
# should win when they briefly disagree?), not something to fold
# silently into a code-deduplication pass - so both remain, each
# exactly where they already were.

declare -g DETECT_BATTERY_LEVEL=100
declare -g DETECT_BATTERY_TEMP_RAW=250   # tenths of a degree C, as dumpsys reports it
declare -g DETECT_BATTERY_VOLTAGE=0      # millivolts
declare -g DETECT_BATTERY_CHARGING=false
declare -g DETECT_LOAD1=0
declare -g DETECT_LOAD5=0
declare -g DETECT_LOAD15=0

# is device charging|screen|low_power - unchanged from its previous home
# in PowerSentineld itself, just relocated here since it's exactly the
# kind of pure device-state read this file exists to hold.
is_device() {
  if [ "$1" != "low_power" ]; then
    dumpsys deviceidle get $1
  else
    if [ $(settings get global low_power) = 1 ]; then
      echo true
    else
      echo false
    fi
  fi
}

# Call once per poll cycle before reading any DETECT_* global - not
# automatically refreshed on read, matching the same "cache for the
# cycle, refresh explicitly" pattern PowerSentinel-config.sh's
# config_load_global() already uses for global config values, for the
# same reason: several callers need the same values within one cycle,
# and dumpsys/reading /proc are not free.
detect_refresh() {
  local batt_dump load

  batt_dump="$(dumpsys battery 2>/dev/null)"

  DETECT_BATTERY_LEVEL="$(echo "$batt_dump" | grep -m1 -oE '^[[:space:]]*level:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')"
  DETECT_BATTERY_LEVEL="${DETECT_BATTERY_LEVEL:-100}"

  DETECT_BATTERY_TEMP_RAW="$(echo "$batt_dump" | grep -m1 -oE '^[[:space:]]*temperature:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')"
  DETECT_BATTERY_TEMP_RAW="${DETECT_BATTERY_TEMP_RAW:-250}"

  DETECT_BATTERY_VOLTAGE="$(echo "$batt_dump" | grep -m1 -oE '^[[:space:]]*voltage:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')"
  DETECT_BATTERY_VOLTAGE="${DETECT_BATTERY_VOLTAGE:-0}"

  DETECT_BATTERY_CHARGING="false"
  echo "$batt_dump" | grep -qE '^[[:space:]]*(AC|USB|Wireless) powered:[[:space:]]*true' && DETECT_BATTERY_CHARGING="true"

  load="$(cat /proc/loadavg 2>/dev/null)"
  DETECT_LOAD1="$(echo "$load" | cut -d' ' -f1)"; DETECT_LOAD1="${DETECT_LOAD1:-0}"
  DETECT_LOAD5="$(echo "$load" | cut -d' ' -f2)"; DETECT_LOAD5="${DETECT_LOAD5:-0}"
  DETECT_LOAD15="$(echo "$load" | cut -d' ' -f3)"; DETECT_LOAD15="${DETECT_LOAD15:-0}"
}

detect_battery_temp_c() {
  echo $(( DETECT_BATTERY_TEMP_RAW / 10 ))
}

# One-time CPU topology detection at startup: classifies cores into
# "high power" (hp_cpus) vs "low power" (lp_cpus), and records each low-
# power core's own original cpufreq governor (lp_default_govs) so
# actions.sh can restore it later, and each low-power core's governor at
# detection time (lp_govs, used for the "auto" cores mode's restore
# path). No writes - purely reads /sys/devices/system/cpu.
#
# BUG FIX: lp_default_govs[$core] used to read
# "$cpu_base_path/$cpu/cpufreq/scaling_governor" - "$cpu" instead of
# "$core" - a stale loop variable left over from the earlier loop in
# this same function (which builds cpus[]/cpu_freqs[] using "cpu" as its
# own loop variable). Since $cpu doesn't change across this second
# loop's iterations, EVERY entry in lp_default_govs ended up with the
# same wrong value (whichever core "$cpu" was left pointing at), instead
# of each core's own actual governor - so disabling an event with a
# manually-specified handle_cores (not "auto") could reset every one of
# those cores to the same incorrect governor instead of each one's own
# original setting. Verified against a controlled scenario (two cores
# with genuinely different governors) that the fix makes each core keep
# its own value; the original code collapsed them to one shared
# (wrong) value.
auto_map_cores() {
  log_msg 2 "Auto-mapping CPU cores"
  # high power cores
  for cpu in $(ls "$cpu_base_path/" | grep cpu[00-99]); do
    cpus+=( "$cpu" )
    cpu_freqs+=( "$(cat $cpu_base_path/$cpu/cpufreq/cpuinfo_max_freq)" )
  done
  for high_freq in $(echo "${cpu_freqs[@]}" | tr ' ' '\n' | uniq -u); do
    for index in "${!cpu_freqs[@]}"; do
      if [ "${cpu_freqs[$index]}" = "$high_freq" ]; then
        hp_cpus+=( "${cpus[$index]}" )
      fi
    done
  done
  for i in ${!hp_cpus[@]}; do
    tmp_var+="${hp_cpus[$i]} "
  done
  log_msg 3 "High power cores: $tmp_var"
  unset tmp_var
  # Low Power Cores
  for core in $(ls "$cpu_base_path/" | grep cpu[00-99]); do
    match="false"
    for hp_core in ${hp_cpus[@]}; do
      [ "$core" = "$hp_core" ] && match="true"
    done
    if [ "$match" = "false" ] && grep -q " powersave " "$cpu_base_path/$core/cpufreq/scaling_available_governors"; then
      lp_govs+=( "$(cat $cpu_base_path/$core/cpufreq/scaling_governor)" )
      lp_default_govs[$core]="$(cat $cpu_base_path/$core/cpufreq/scaling_governor )"
      lp_cpus+=( "$core" )
    fi
  done
    for i in ${!lp_cpus[@]}; do
    tmp_var+="${lp_cpus[$i]} "
  done
  log_msg 3 "Low power cores: $tmp_var"
  unset tmp_var
}

# One-time detection of which rfkill invocation (if any) actually works
# on this device - actions.sh's WiFi action falls back to `svc wifi` if
# this never finds one. No writes.
find_rfkill_command() {
  log_msg 2 "Searching for a valid rfkill command..."
  if command -v rfkill >/dev/null 2>&1; then
    RFKILL_CMD="rfkill"
  elif command -v toybox >/dev/null 2>&1 && toybox --help | grep -q rfkill; then
    RFKILL_CMD="toybox rfkill"
  else
    local busybox_path="$(find /data/adb/ -type f -name busybox)"
    if [ -f "$busybox_path" ] && "$busybox_path" --help | grep -q rfkill; then
      RFKILL_CMD="$busybox_path rfkill"
    fi
  fi

  if [ -n "$RFKILL_CMD" ]; then
    log_msg 2 "Found rfkill command: $RFKILL_CMD"
  else
    log_msg 2 "No rfkill command found. Will rely on svc for WiFi control."
  fi
}

# One-time detection of apps that should never be touched by
# handle_apps' kill/nice/suspend, regardless of allowlist/denylist
# configuration - "protección de apps críticas" from the proposed
# architecture. Two sources, both queried via official, documented
# Android commands rather than anything fragile/undocumented:
#
#   1. The device's own default dialer/SMS/emergency apps (via
#      `cmd role get-role-holders`, the same official mechanism
#      Android Settings itself uses to show "default apps"). Losing
#      the ability to make a call or receive a text is a genuinely
#      different category of harm than "an app the user likes lags a
#      bit" - these three roles are documented as exclusive (at most
#      one holder), so normally 0 or 1 line each.
#   2. Every app already exempted from Android's own battery
#      optimization (`dumpsys deviceidle`'s "Whitelist system apps"/
#      "Whitelist user apps" sections - system apps Android itself
#      always exempts, plus whatever the user personally chose to
#      exempt via Settings or another app). This respects an existing,
#      already-curated signal rather than PowerSentinel silently
#      overriding it.
#
# Deliberately defensive: this cannot be verified against a real
# device from this environment, and dumpsys/cmd output can vary across
# Android versions/OEMs. Every candidate line is validated against a
# plain-package-name shape before being trusted; anything else
# (a status message, a different section's content, an unexpected
# format) is silently skipped rather than risked. Failing to detect a
# critical app only means missing out on this extra protection layer,
# never a regression - handle_apps' existing allowlist/denylist
# behavior is completely unaffected either way.
declare -ga DETECT_CRITICAL_APPS=()

detect_critical_apps() {
  DETECT_CRITICAL_APPS=()
  local pkg role

  for role in DIALER SMS EMERGENCY; do
    while IFS= read -r pkg; do
      case "$pkg" in
        ''|*[!a-zA-Z0-9._]*) continue ;;
      esac
      DETECT_CRITICAL_APPS+=("$pkg")
    done < <(cmd role get-role-holders "android.app.role.$role" 2>/dev/null | tr -d '\r')
  done

  while IFS= read -r pkg; do
    case "$pkg" in
      ''|*[!a-zA-Z0-9._]*) continue ;;
    esac
    DETECT_CRITICAL_APPS+=("$pkg")
  done < <(dumpsys deviceidle 2>/dev/null | tr -d '\r' | awk '
    /^Whitelist (system|user) apps:/ { collecting=1; next }
    /^Whitelist / { collecting=0 }
    collecting {
      line=$0
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line != "") print line
    }
  ')

  log_msg 2 "Critical/protected apps: ${DETECT_CRITICAL_APPS[*]:-(none detected)}"
}

# Whether $1 (a package name) is in the protected list above - the
# single check action_apps_apply/undo need, alongside the existing
# allowlist check.
is_critical_app() {
  local app="$1" c
  for c in "${DETECT_CRITICAL_APPS[@]}"; do
    [ "$c" = "$app" ] && return 0
  done
  return 1
}
