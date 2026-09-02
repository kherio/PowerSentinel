#!/system/bin/bash
# PowerSentinel event/detection manager.
# This layer owns raw event observation, transition detection, and the active
# event set. Policy/action functions are intentionally supplied by the daemon
# (enable_pwr_save/disable_pwr_save) so this extraction does not change
# behavior or policy semantics.

declare -ga active_events

# Previous observations are state owned by the event manager.
was_charging=""
was_low_power=""
was_screen_on=""
was_night=""
was_thermal=""

is_device() {
  # is device charging|screen|low_power
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

# Independent, time-of-day based profile (feature request: "perfil
# nocturno"). Unlike the other events, "night" isn't tied to any device
# state (charging/screen/battery) - it's purely a clock range read from
# its own event block's night_start/night_end fields (HH:MM), and can be
# active at the same time as any other event.
get_night_times() {
  night_start="$(config_get_event_raw night night_start "")"
  night_end="$(config_get_event_raw night night_end "")"
}

is_night_now() {
  if [ -z "$night_start" ] || [ -z "$night_end" ]; then
    echo false
    return
  fi
  # "10#" forces base-10 parsing: bash treats a leading-zero number like
  # 08/09 as invalid octal in arithmetic context otherwise.
  local now_h now_m now_min start_h start_m start_min end_h end_m end_min
  now_h=$(date +%H); now_m=$(date +%M)
  start_h=${night_start%%:*}; start_m=${night_start##*:}
  end_h=${night_end%%:*}; end_m=${night_end##*:}
  now_min=$(( 10#$now_h * 60 + 10#$now_m ))
  start_min=$(( 10#$start_h * 60 + 10#$start_m ))
  end_min=$(( 10#$end_h * 60 + 10#$end_m ))

  if [ "$start_min" -le "$end_min" ]; then
    # same-day range, e.g. 13:00-18:00
    if [ "$now_min" -ge "$start_min" ] && [ "$now_min" -lt "$end_min" ]; then echo true; else echo false; fi
  else
    # wraps past midnight, e.g. 23:00-07:00
    if [ "$now_min" -ge "$start_min" ] || [ "$now_min" -lt "$end_min" ]; then echo true; else echo false; fi
  fi
}

# Independent, temperature-based profile (companion to "night" above,
# same idea: an event that isn't tied to charging/screen state, active
# whenever the battery is at or above a configured temperature). Reads
# its threshold from the "thermal" event block's thermal_threshold field
# (whole degrees Celsius). Hysteresis (3C below the threshold) avoids
# rapidly flapping on/off when the temperature hovers right at the line.
get_thermal_threshold() {
  thermal_threshold="$(config_get_event_raw thermal thermal_threshold "")"
}

is_thermal_now() {
  if [ -z "$thermal_threshold" ]; then
    echo false
    return
  fi
  local temp_raw temp_c hysteresis_c
  temp_raw=$(dumpsys battery 2>/dev/null | grep -m1 -oE '^[[:space:]]*temperature:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')
  [ -z "$temp_raw" ] && { echo false; return; }
  temp_c=$(( temp_raw / 10 ))
  if [ "$was_thermal" = "true" ]; then
    hysteresis_c=$(( thermal_threshold - 3 ))
    [ "$temp_c" -ge "$hysteresis_c" ] && echo true || echo false
  else
    [ "$temp_c" -ge "$thermal_threshold" ] && echo true || echo false
  fi
}

is_event_locked() {
  event="$1"
  for i in ${!active_events[@]}; do
    if [ "${active_events[$i]}" = "$event" ]; then
      return 1
    fi
  done
  return 0
}

handle_event() {
  event="$1"
  flag="$2"

  if [ "$flag" = 1 ]; then # we are trying to enable
    # check to see if its unlocked
    is_event_locked "$event"
    if [ $? != 0 ]; then
      # we tried to enable an already active event
      log_msg 2 "$event was triggered but it is currently enabled"
      # return early
      return 1
    else
      # lock the event
      active_events+=( "$event" )
    fi
  fi

  # set everything to false
  quit=false
  handle_cores=false
  disable_cores=false
  handle_apps=false
  allowlist=null
  denylist=null
  handle_proc=false
  proc_file=null
  handle_gms=false
  low_ram=false
  doze=false
  kill_wifi=false

  log_msg 3 "Parsing the config for $event event"

  # parse config of event
  line=''
  while read line; do
    [ "$line" = "$event={" ] && continue
    [ "$line" = "}" ] && break
    key=$(echo "$line" | cut -d= -f1)
    val=$(echo "$line" | cut -d= -f2-)
    case $key in
      keep_on_charge)
        if [ "$val" = "true" ] && \
        [ "$flag" = "0" ] && \
        [ "$event" != "charging" ] && \
        [ "$charging" = "true" ]; then
          log_msg 1 "$event has keep_on_charge set. We are keeping the settings until unplugged"
          return 0
        fi ;;
      quit)
        if [ "$val" = "true" ] && \
        [ "$event" = "boot" ]; then
          quit=true
        fi ;;
      handle_cores)
        if [ "$val" != "false" ]; then
          handle_cores="$val"
        fi ;;
      disable_cores)
        if [ "$val" != "false" ]; then
          disable_cores="$val"
        fi ;;
      handle_apps)
        if [ "$val" != "false" ]; then
          handle_apps="$val"
        fi ;;
      allowlist)
        if [ -f "$val" ]; then
          allowlist="$val"
        fi ;;
      denylist)
        if [ -f "$val" ]; then
          denylist="$val"
        fi ;;
      handle_proc)
        if [ "$val" != "false" ]; then
          handle_proc="$val"
        fi ;;
      proc_file)
        if [ -f "$val" ]; then
          proc_file="$val"
        fi ;;
      handle_gms)
        if [ "$val" != "false" ]; then
          handle_gms="$val"
        fi ;;
      low_ram)
        if [ "$val" = "true" ]; then
          low_ram="true"
        fi ;;
      doze)
        if [ "$val" != "false" ]; then
          doze="$val"
        fi ;;
      kill_wifi)
        if [ "$val" = "true" ]; then
          kill_wifi="true"
        fi;;
    esac
  done < <(grep -F -A99 "$event={" "$conf")

  # perform sanity checks to prevent the user from killing themself
  if [ "$handle_apps" != "false" ] && [ "$allowlist" = "null" ] && [ "$denylist" = "null" ]; then
    handle_apps=false
  fi
  if [ "$handle_proc" != "false" ] && [ "$proc_file" = "null" ]; then
    handle_proc="false"
  fi

  # perform action using the old way
  # instead of a massive refactor which
  # is probably coming in a later update
  if [ "$flag" = 0 ]; then
    log_msg 1 "Undoing actions for $event"
    disable_pwr_save
    # remove from active_events
    for i in ${!active_events[@]}; do
      if [ "${active_events[$i]}" = "$event" ]; then
        unset "active_events[$i]"
      fi
    done
    log_msg 1 "Actions for $event undone"
  else
    log_msg 1 "Performing actions for $event event"
    enable_pwr_save
    log_msg 1 "Actions for $event completed"
    if [ "$event" = "boot" ] && \
    [ "$quit" = "true" ]; then
      log_msg 1 "Boot event has the quit option set. Killing the daemon."
      exit 0
    fi
  fi

  # build the active events notification
  for i in ${!active_events[@]}; do
    active_notif+="${active_events[$i]} "
  done

  notif "Active Events: $active_notif"
  unset active_notif
}

# Establish the exact same initial event state/order as the former init_v2
# inline implementation.
events_initialize() {
  handle_event boot 1

  charging="$(is_device charging)"
  if [ "$charging" = "true" ]; then
    handle_event charging 1
  fi
  was_charging="$charging"

  low_power="$(is_device low_power)"
  if [ "$low_power" = "true" ]; then
    handle_event low_power 1
  fi
  was_low_power="$low_power"

  screen_on="$(is_device screen)"
  if [ "$screen_on" = "false" ]; then
    handle_event screen_off 1
  fi
  was_screen_on="$screen_on"

  get_night_times
  night_now="$(is_night_now)"
  if [ "$night_now" = "true" ]; then
    handle_event night 1
  fi
  was_night="$night_now"

  was_thermal="false"
  get_thermal_threshold
  thermal_now="$(is_thermal_now)"
  if [ "$thermal_now" = "true" ]; then
    handle_event thermal 1
  fi
  was_thermal="$thermal_now"
}

# Poll device/time observations and emit transitions through handle_event().
# This is deliberately a mechanical extraction of the former init_v2 loop.
events_poll() {
  charging="$(is_device charging)"
  if [ "$was_charging" != "" ]; then
    if [ "$charging" != "$was_charging" ]; then
      log_msg 2 "Charging event was triggered"
      if [ "$charging" = "true" ]; then
        handle_event charging 1
      else
        handle_event charging 0
      fi
    fi
  fi
  was_charging="$charging"

  low_power="$(is_device low_power)"
  if [ "$was_low_power" != "" ]; then
    if [ "$low_power" != "$was_low_power" ]; then
      log_msg 2 "Low Power event was triggered"
      if [ "$low_power" = "true" ]; then
        handle_event low_power 1
      else
        handle_event low_power 0
      fi
    fi
  fi
  was_low_power="$low_power"

  screen_on="$(is_device screen)"
  if [ "$was_screen_on" != "" ]; then
    if [ "$screen_on" != "$was_screen_on" ]; then
      log_msg 2 "Screen change was detected"
      if [ "$screen_on" = "false" ]; then
        handle_event screen_off 1
      else
        handle_event screen_off 0
      fi
    fi
  fi
  was_screen_on="$screen_on"

  night_now="$(is_night_now)"
  if [ "$was_night" != "" ]; then
    if [ "$night_now" != "$was_night" ]; then
      log_msg 2 "Night profile boundary crossed"
      if [ "$night_now" = "true" ]; then
        handle_event night 1
      else
        handle_event night 0
      fi
    fi
  fi
  was_night="$night_now"

  thermal_now="$(is_thermal_now)"
  if [ "$thermal_now" != "$was_thermal" ]; then
    log_msg 2 "Thermal profile boundary crossed"
    if [ "$thermal_now" = "true" ]; then
      handle_event thermal 1
    else
      handle_event thermal 0
    fi
  fi
  was_thermal="$thermal_now"
}
