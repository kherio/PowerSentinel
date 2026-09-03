#!/system/bin/bash

# PowerSentinel-state.sh - State Manager: persists which events are
# currently active/applied, across daemon restarts and reboots.
# Front 5 of the architecture pass.
#
# The concrete problem this fixes: $active_events (events.sh) is a
# plain in-memory bash array. If the daemon crashes (or the device
# reboots uncleanly), the watchdog in service.sh relaunches it with a
# completely empty $active_events - no memory of what was previously
# applied. But the SYSTEM itself doesn't forget: cores that were taken
# offline stay offline, apps that were suspended stay suspended, WiFi
# that was blocked stays blocked - the daemon just loses all awareness
# that it did any of that, and has no way to undo it. A device could
# get stuck in a degraded state indefinitely with the daemon believing
# everything is at a clean baseline.
#
# The fix: persist $active_events to disk every time it changes
# (state_save(), called from events.sh), and on startup, before
# evaluating any current condition, forcibly undo everything the
# persisted state says was active (state_reconcile()) - bringing the
# system back to a known-clean baseline regardless of whether those
# events "should" still be active. The normal startup flow immediately
# after re-evaluates real conditions and reapplies whatever's actually
# warranted. This is safe even if some of those events were never
# fully applied (e.g. a crash mid-apply): every actions.sh undo
# function is already idempotent - unsuspending an app that isn't
# suspended, enabling WiFi that's already enabled, resetting a
# governor to itself, are all harmless no-ops.

: "${state_file:=/data/local/tmp/PowerSentinel/PowerSentinel.state}"

# Persists the current $active_events array as a JSON array of event
# names. Called by the Event Manager every time an event locks or
# unlocks - cheap (jq on a handful of short strings), and correctness
# here matters more than shaving one process spawn.
state_save() {
  local dir tmp
  dir="$(dirname "$state_file")"
  mkdir -p "$dir" 2>/dev/null
  tmp="$(mktemp "$dir/.PowerSentinel.state.XXXXXX")" || return 1
  if [ "${#active_events[@]}" -eq 0 ]; then
    echo '[]' > "$tmp"
  else
    "$JQ" -cn --args '$ARGS.positional' "${active_events[@]}" > "$tmp" 2>/dev/null
  fi
  chmod 600 "$tmp" 2>/dev/null
  mv "$tmp" "$state_file"
}

# Reads the persisted list of events that were active before this
# daemon start - one per line, empty output if there's no state file or
# it's unreadable/corrupt (fails safe: nothing to reconcile, rather than
# erroring the whole startup).
state_load() {
  [ -r "$state_file" ] || return 0
  "$JQ" -r '.[]?' "$state_file" 2>/dev/null
}

# Startup-only: force-undoes every event the persisted state says was
# active, then clears the persisted state - the caller's normal startup
# flow reconstructs it fresh as it evaluates current conditions.
state_reconcile() {
  local event stale
  stale="$(state_load)"
  [ -n "$stale" ] || return 0
  while IFS= read -r event; do
    [ -n "$event" ] || continue
    log_msg 1 "Reconciling stale state from a previous run: undoing $event"
    handle_event "$event" 0
  done <<< "$stale"
  state_save
}
