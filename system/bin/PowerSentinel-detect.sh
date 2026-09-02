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
