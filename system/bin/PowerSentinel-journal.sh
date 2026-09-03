#!/system/bin/bash

# PowerSentinel-journal.sh - Event Journal: a structured, machine-readable
# record of what happened and why, distinct from the free-text $log_file.
# Every entry is one line of JSON (JSON Lines format) - easy to append
# without rewriting the whole file each time, easy for the WebUI to
# parse. This is what both the WebUI (full history) and the Alert
# Bridge (deciding what's worth surfacing to Android) read from -
# callers should record events here via emit() (see events.sh), not
# talk to Android's notification system directly.

: "${journal_file:=/data/local/tmp/PowerSentinel/PowerSentinel.journal}"

journal_write() {
  local event="$1" severity="$2" message="$3" ts line dir
  ts="$(date +%s)"
  dir="$(dirname "$journal_file")"
  mkdir -p "$dir" 2>/dev/null

  line="$("$JQ" -cn --arg ts "$ts" --arg event "$event" --arg severity "$severity" --arg message "$message" \
    '{ts: ($ts | tonumber), event: $event, severity: $severity, message: $message}' 2>/dev/null)"
  [ -n "$line" ] || return 1

  echo "$line" >> "$journal_file"

  # Simple size-based rotation - same "an unbounded file grows forever"
  # concern $log_file already has, scoped simply here rather than
  # building a full rotation scheme neither file currently has: once it
  # passes ~2000 entries, keep only the most recent 1000.
  local count
  count="$(wc -l < "$journal_file" 2>/dev/null)"
  if [ "${count:-0}" -gt 2000 ]; then
    tail -n 1000 "$journal_file" > "$journal_file.tmp" 2>/dev/null && mv "$journal_file.tmp" "$journal_file"
  fi
}

# Single call site the rest of the daemon should use instead of talking
# to the journal or Android's notification system directly: always
# records to the Event Journal, then lets the Alert Bridge (see
# PowerSentinel-alertbridge.sh) decide whether "$severity" warrants an
# actual Android notification. severity is "info" or "critical".
emit() {
  local event="$1" severity="$2" message="$3"
  journal_write "$event" "$severity" "$message"
  alert_dispatch "$severity" "$message"
}
