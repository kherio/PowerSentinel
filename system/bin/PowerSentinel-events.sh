#!/system/bin/bash

# PowerSentinel-events.sh - Event Manager: owns the lifecycle of an
# event from trigger to applied/undone state. Handles event locking
# (is_event_locked, active_events bookkeeping), resolves every field for
# the event via config_get_event_raw() (PowerSentinel-config.sh,
# JSON-backed - centralizing what used to be a hand-rolled parser here),
# and dispatches to enable_pwr_save()/disable_pwr_save() (the thin
# orchestrators in PowerSentineld that call into
# PowerSentinel-actions.sh). Relocated verbatim from PowerSentineld - no
# logic changes except the notification call at the end, migrated from
# the old notif() (which posted every event transition straight to
# Android's notification tray) to emit() (PowerSentinel-journal.sh),
# which always records to the Event Journal but only reaches Android
# through the Alert Bridge for genuinely critical severity - "Active
# Events changed" is routine status, not something that should interrupt
# the user every time an event fires.
#
# This is the first piece of the notification-system redesign, and was
# also always the next planned step in the architecture pass (front 4,
# "sistema de políticas centralizado") - rather than build it twice,
# this IS that piece, pulled forward.

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

  # Centralized read: every field for this event now goes through
  # config_get_event_raw() (PowerSentinel-config.sh, JSON-backed) instead
  # of this function's own hand-rolled `grep -F -A99 "$event={" "$conf"`
  # + while-read parser - removing what used to be a third, independent
  # parser of the config file (config.sh's own functions, and the
  # WebUI's frontend parser, are the other two), each of which could in
  # principle drift out of sync about what a given field means. Same
  # validation semantics as before for every field, just centralized.
  local val

  val="$(config_get_event_raw "$event" keep_on_charge false)"
  if [ "$val" = "true" ] && [ "$flag" = "0" ] && [ "$event" != "charging" ] && [ "$charging" = "true" ]; then
    log_msg 1 "$event has keep_on_charge set. We are keeping the settings until unplugged"
    return 0
  fi

  val="$(config_get_event_raw "$event" quit false)"
  [ "$val" = "true" ] && [ "$event" = "boot" ] && quit=true

  val="$(config_get_event_raw "$event" handle_cores false)"
  [ "$val" != "false" ] && handle_cores="$val"

  val="$(config_get_event_raw "$event" disable_cores false)"
  [ "$val" != "false" ] && disable_cores="$val"

  val="$(config_get_event_raw "$event" handle_apps false)"
  [ "$val" != "false" ] && handle_apps="$val"

  val="$(config_get_event_raw "$event" allowlist "")"
  [ -n "$val" ] && [ -f "$val" ] && allowlist="$val"

  val="$(config_get_event_raw "$event" denylist "")"
  [ -n "$val" ] && [ -f "$val" ] && denylist="$val"

  val="$(config_get_event_raw "$event" handle_proc false)"
  [ "$val" != "false" ] && handle_proc="$val"

  val="$(config_get_event_raw "$event" proc_file "")"
  [ -n "$val" ] && [ -f "$val" ] && proc_file="$val"

  val="$(config_get_event_raw "$event" handle_gms false)"
  [ "$val" != "false" ] && handle_gms="$val"

  val="$(config_get_event_raw "$event" low_ram false)"
  [ "$val" = "true" ] && low_ram="true"

  val="$(config_get_event_raw "$event" doze false)"
  [ "$val" != "false" ] && doze="$val"

  val="$(config_get_event_raw "$event" kill_wifi false)"
  [ "$val" = "true" ] && kill_wifi="true"

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

  emit events info "Active Events: $active_notif"
  unset active_notif
}
