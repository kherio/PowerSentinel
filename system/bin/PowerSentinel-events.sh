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

# CRITICAL FIX: this function was accidentally deleted in commit
# 44f90a9 ("Front 2 complete + Front 3") - a range-based text removal
# meant to only delete enable_pwr_save()/disable_pwr_save()'s old
# inline bodies also swept up this function, which sat between them
# and handle_event() under its own "# Event stuff for V2" header,
# without that range boundary ever being checked. Restored verbatim
# from before that commit (git show 44f90a9^:system/bin/PowerSentineld).
#
# Impact while this was missing (present in every release from v3.13.0
# through v3.16.0): handle_event()'s enable path (flag=1) calls this
# function and branches on its exit code. A call to an undefined
# function returns 127 (bash's "command not found") - which is "!= 0",
# so the code unconditionally took the "already active, refuse to
# re-enable" branch and returned early, for every single event, every
# time. No event could ever actually apply its settings - the daemon
# has not functionally worked at all for anyone on these versions.
is_event_locked() {
  event="$1"
  for i in ${!active_events[@]}; do
    if [ "${active_events[$i]}" = "$event" ]; then
      return 1
    fi
  done
  return 0
}

# BUG FIX (found and confirmed via a real report, then reproduced with
# a standalone simulation before being trusted): handle_event()'s undo
# path only ever reverses the ONE event that's ending, using ITS OWN
# resolved field values - it has no awareness of what OTHER events are
# still active. Confirmed reproduction: two events both requesting
# kill_wifi=true, one ending while the other stays active - the ending
# event's undo (gated on its own kill_wifi=true) incorrectly
# re-enabled WiFi, even though the still-active event also needed it
# disabled. The same class of bug applies to handle_cores, doze,
# handle_gms, and low_ram - any category two active events might both
# want the same effect on.
#
# Fix: after any event ends and is removed from active_events, re-
# resolve and re-apply whatever the REMAINING active events still
# need - correcting anything the ending event's undo just wrongly
# reversed.
#
# Deliberately a standalone re-resolution rather than refactoring
# handle_event()'s own field-resolution to be shared: handle_event()
# is the single most load-bearing function in this daemon, and
# duplicating ~25 lines of its already-correct, heavily-tested
# resolution logic here (everything except the undo-only
# keep_on_charge/quit handling, which doesn't apply to a re-apply
# pass) is a safer trade than restructuring it to fix this.
#
# Not a full policy-composition engine, and this doesn't pretend to
# be one: if two still-active events want genuinely DIFFERENT things
# for the same category (one wants nice, another wants suspend),
# whichever is processed last here wins - there's no defined
# precedence between them yet. What this DOES guarantee: a real,
# currently-active event's own configuration gets correctly re-applied
# after another event ends, rather than the ending event's undo being
# left as the final word by default regardless of what's still active.
# Resolves ONE event's own field values into the same global variables
# handle_event() itself resolves them into (handle_apps, handle_cores,
# doze, ...) - shared by reassert_active_events() (which then applies
# them) and active_mechanisms_snapshot() (which only reports them),
# so this logic exists in exactly one place rather than three. Still
# deliberately NOT shared with handle_event() itself - see the comment
# on reassert_active_events() below for why that one stays separate.
# CRITICAL FIX: handle_event() re-resolves every field straight from
# the config file on EVERY call, for both starting (flag=1) AND ending
# (flag=0) an event. Confirmed with a real reproduction: if the config
# is saved (or a different profile loaded) WHILE an event is active and
# that save changes what the event's own fields resolve to (or removes
# the event block entirely) - completely ordinary things to do from
# the WebUI - the "undo" that fires as part of the very same reload
# reads the NEW config, not what was ACTUALLY applied under the OLD
# one. If the new resolution says handle_apps=false where the old one
# said "nice", the undo call sees nothing to undo and returns
# immediately - the reniced/suspended app, disabled core, or disabled
# WiFi is left exactly as it was, forever, with the daemon believing
# everything is clean. This isn't a rare edge case: writeConfig() (used
# by both the normal config-save flow and profile loading) always
# writes the new file to disk BEFORE requesting the reload that
# triggers this undo.
#
# Fixed by snapshotting the fields actually resolved at the moment an
# event genuinely starts (or reassert_active_events() genuinely
# re-applies it), and using THAT snapshot - not a fresh re-resolution -
# when the event ends. Falls back to fresh resolution only when no
# snapshot exists for this event (e.g. state_reconcile() undoing a
# stale event from a previous daemon process, where no in-memory
# snapshot could possibly have survived the restart - reconcile's own
# safety net is the idempotent undo functions plus the ownership-
# tracking files, which DO persist across restarts, so falling back
# here doesn't weaken anything reconcile already relies on).
declare -gA _event_applied_fields=()

_snapshot_event_fields() {
  local ev="$1"
  _event_applied_fields[$ev]="$(declare -p handle_cores disable_cores handle_apps allowlist denylist handle_proc proc_file handle_gms low_ram doze kill_wifi 2>/dev/null)"
}

_restore_event_snapshot() {
  local ev="$1" snap
  if [ -n "${_event_applied_fields[$ev]:-}" ]; then
    # `declare -p`'s own output is prefixed with "declare -- " - eval-ing
    # that verbatim from INSIDE this function would create a new LOCAL
    # shadow of each variable (declare always scopes to the current
    # function) instead of updating the actual global handle_event()
    # and disable_pwr_save() read from, silently discarding the
    # restored values the moment this function returns. Stripped down
    # to plain "var=value" assignments, which - with no declare/local
    # keyword - correctly update whichever "var" is already visible,
    # global or not. Confirmed this exact failure mode with a minimal
    # reproduction before trusting the fix.
    snap="${_event_applied_fields[$ev]//declare -- /}"
    eval "$snap"
    unset "_event_applied_fields[$ev]"
    return 0
  fi
  return 1
}

_resolve_event_fields() {
  local ev="$1" val
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

  val="$(config_get_event_raw "$ev" handle_cores false)"
  [ "$val" != "false" ] && handle_cores="$val"
  val="$(config_get_event_raw "$ev" disable_cores false)"
  [ "$val" != "false" ] && disable_cores="$val"
  val="$(config_get_event_raw "$ev" handle_apps false)"
  [ "$val" != "false" ] && handle_apps="$val"
  val="$(config_get_event_raw "$ev" allowlist "")"
  [ -n "$val" ] && [ -f "$val" ] && allowlist="$val"
  val="$(config_get_event_raw "$ev" denylist "")"
  [ -n "$val" ] && [ -f "$val" ] && denylist="$val"
  val="$(config_get_event_raw "$ev" handle_proc false)"
  [ "$val" != "false" ] && handle_proc="$val"
  val="$(config_get_event_raw "$ev" proc_file "")"
  [ -n "$val" ] && [ -f "$val" ] && proc_file="$val"
  val="$(config_get_event_raw "$ev" handle_gms false)"
  [ "$val" != "false" ] && handle_gms="$val"
  val="$(config_get_event_raw "$ev" low_ram false)"
  [ "$val" = "true" ] && low_ram="true"
  val="$(config_get_event_raw "$ev" doze false)"
  [ "$val" != "false" ] && doze="$val"
  val="$(config_get_event_raw "$ev" kill_wifi false)"
  [ "$val" = "true" ] && kill_wifi="true"

  if [ "$handle_apps" != "false" ] && [ "$allowlist" = "null" ] && [ "$denylist" = "null" ]; then
    handle_apps=false
  fi
  if [ "$handle_proc" != "false" ] && [ "$proc_file" = "null" ]; then
    handle_proc="false"
  fi
}

reassert_active_events() {
  local ev
  for ev in "${active_events[@]}"; do
    [ -n "$ev" ] || continue
    _resolve_event_fields "$ev"
    _snapshot_event_fields "$ev"
    enable_pwr_save
  done
}

# "¿Qué está haciendo ahora?" from the roadmap: a JSON snapshot of
# every currently-active event's OWN resolved fields (not the combined
# global state after reassert - each event's own configuration,
# individually), for the WebUI to show plainly what's applied and why,
# per active event, instead of one opaque tier number.
active_mechanisms_snapshot() {
  local ev items=()
  # This can run from inside update_status(), itself called from
  # enable_pwr_save()/disable_pwr_save() mid-flow while the CALLING
  # event's own resolved fields (handle_apps, doze, ...) are still the
  # live global state its own caller may still expect after returning.
  # Save and restore them around this read-only snapshot so calling it
  # here never leaks a DIFFERENT event's resolution into that flow.
  local _save_handle_cores="$handle_cores" _save_disable_cores="$disable_cores"
  local _save_handle_apps="$handle_apps" _save_allowlist="$allowlist" _save_denylist="$denylist"
  local _save_handle_proc="$handle_proc" _save_proc_file="$proc_file"
  local _save_handle_gms="$handle_gms" _save_low_ram="$low_ram"
  local _save_doze="$doze" _save_kill_wifi="$kill_wifi"

  for ev in "${active_events[@]}"; do
    [ -n "$ev" ] || continue
    _resolve_event_fields "$ev"
    items+=("$("$JQ" -cn \
      --arg ev "$ev" --arg apps "$handle_apps" --arg cores "$handle_cores" \
      --arg doze "$doze" --arg gms "$handle_gms" --arg wifi "$kill_wifi" --arg lowram "$low_ram" \
      '{event: $ev, handle_apps: $apps, handle_cores: $cores, doze: $doze, handle_gms: $gms, kill_wifi: $wifi, low_ram: $lowram}' \
      2>/dev/null)")
  done

  handle_cores="$_save_handle_cores"; disable_cores="$_save_disable_cores"
  handle_apps="$_save_handle_apps"; allowlist="$_save_allowlist"; denylist="$_save_denylist"
  handle_proc="$_save_handle_proc"; proc_file="$_save_proc_file"
  handle_gms="$_save_handle_gms"; low_ram="$_save_low_ram"
  doze="$_save_doze"; kill_wifi="$_save_kill_wifi"

  if [ "${#items[@]}" -eq 0 ]; then
    echo '[]'
  else
    printf '%s\n' "${items[@]}" | "$JQ" -cs '.' 2>/dev/null
  fi
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
      active_event_start_ts["$event"]="$(date +%s)"
      state_save
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

  # CRITICAL FIX: capture what's ACTUALLY about to be applied for this
  # start, so that ending this same event later restores based on this
  # snapshot rather than whatever the config happens to say when it
  # ends (which could have changed via a save or profile load in the
  # meantime) - see the full explanation on _snapshot_event_fields
  # above. Only meaningful for a genuine start (flag=1); ending an
  # event doesn't need its own fields re-captured.
  [ "$flag" = 1 ] && _snapshot_event_fields "$event"

  # perform action using the old way
  # instead of a massive refactor which
  # is probably coming in a later update
  if [ "$flag" = 0 ]; then
    # CRITICAL FIX: restore the real applied-at-start snapshot (if one
    # exists for this event) BEFORE undoing, overriding the fresh
    # (and possibly now-wrong) resolution just computed above - see
    # _snapshot_event_fields's full explanation. Falls through to the
    # freshly-resolved values already in place when there's no
    # snapshot (state_reconcile() undoing a stale event from a
    # previous process, where none could exist).
    _restore_event_snapshot "$event"
    log_msg 1 "Undoing actions for $event"
    disable_pwr_save
    # remove from active_events
    for i in ${!active_events[@]}; do
      if [ "${active_events[$i]}" = "$event" ]; then
        unset "active_events[$i]"
      fi
    done
    unset "active_event_start_ts[$event]"
    state_save
    reassert_active_events
    log_msg 1 "Actions for $event undone"
    emit "$event" info "$event ended"
  else
    log_msg 1 "Performing actions for $event event"
    enable_pwr_save
    log_msg 1 "Actions for $event completed"
    # Timeline roadmap item: the resolved mechanisms are embedded
    # directly in THIS journal entry (as $detail) rather than the
    # WebUI trying to reconstruct "what was applied at that past
    # moment" from the CURRENT config later - the config could have
    # changed since, and a historical timeline needs to reflect what
    # actually happened, not what the same event would do today.
    emit "$event" info "$event started" \
      "$("$JQ" -cn --arg apps "$handle_apps" --arg cores "$handle_cores" --arg doze "$doze" \
        --arg gms "$handle_gms" --arg wifi "$kill_wifi" --arg lowram "$low_ram" \
        '{handle_apps: $apps, handle_cores: $cores, doze: $doze, handle_gms: $gms, kill_wifi: $wifi, low_ram: $lowram}' 2>/dev/null)"
    if [ "$event" = "boot" ] && \
    [ "$quit" = "true" ]; then
      log_msg 1 "Boot event has the quit option set. Killing the daemon."
      exit 0
    fi
  fi
}
