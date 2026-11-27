# PowerSentinel-nightreport.sh - sourced by the daemon (events.sh calls
# these hooks). Purely observational: when the "night" event starts it
# saves a per-app battery baseline (PowerSentinel-appdrain, in its own
# file - system statistics are never reset) plus the time and battery
# level; when it ends it writes a small JSON report with what each app
# used during the night. Nothing here changes any setting and nothing
# feeds back into any decision; restricting an app from the report is a
# button the person presses in the WebUI.
#
# Report (nightreport_file), one JSON object:
#   {"available":true,"start":EPOCH,"end":EPOCH,"duration_s":N,
#    "level_start":N,"level_end":N,"apps":[{"pkg","mah","fg","bg","cached","shared"}...]}
# Nights shorter than NIGHTREPORT_MIN_S (default 1800 s) are discarded.
#
# The heavy part (dumpsys batterystats) runs in a background subshell so
# starting/ending the event is never delayed by it.

: "${nightreport_dir:=/data/local/tmp/PowerSentinel}"
: "${nightreport_base:=$nightreport_dir/PowerSentinel.nightbase}"
: "${nightreport_meta:=$nightreport_dir/PowerSentinel.nightmeta}"
: "${nightreport_file:=$nightreport_dir/PowerSentinel.nightreport.json}"
: "${NIGHTREPORT_MIN_S:=1800}"
: "${NIGHTREPORT_BIN:=$(dirname "$0")}"
: "${NIGHTREPORT_EVENT:=night}"

nightreport_start() {
  [ "$1" = "$NIGHTREPORT_EVENT" ] || return 0
  mkdir -p "$nightreport_dir" 2>/dev/null
  rm -f "$nightreport_base"
  printf '%(%s)T %s\n' -1 "${DETECT_BATTERY_LEVEL:-0}" > "$nightreport_meta" 2>/dev/null
  chmod 600 "$nightreport_meta" 2>/dev/null
  ( APPDRAIN_STATE="$nightreport_base" "$NIGHTREPORT_BIN/PowerSentinel-appdrain" snapshot >/dev/null 2>&1 ) &
}

nightreport_end() {
  [ "$1" = "$NIGHTREPORT_EVENT" ] || return 0
  [ -s "$nightreport_meta" ] || return 0
  local t0 l0 now l1
  read -r t0 l0 < "$nightreport_meta"
  rm -f "$nightreport_meta"
  case "$t0" in ''|*[!0-9]*) return 0 ;; esac
  printf -v now '%(%s)T' -1
  l1="${DETECT_BATTERY_LEVEL:-0}"
  if [ $(( now - t0 )) -lt "$NIGHTREPORT_MIN_S" ] || [ ! -s "$nightreport_base" ]; then
    rm -f "$nightreport_base"; return 0
  fi
  (
    local rpt
    rpt="$(APPDRAIN_STATE="$nightreport_base" "$NIGHTREPORT_BIN/PowerSentinel-appdrain" report 2>/dev/null)"
    rm -f "$nightreport_base"
    [ -n "$rpt" ] || exit 0
    "$JQ" -c --argjson start "$t0" --argjson end "$now" --argjson l0 "${l0:-0}" --argjson l1 "${l1:-0}" '
      select(.available == true) |
      {available: true, start: $start, end: $end, duration_s: ($end - $start),
       level_start: $l0, level_end: $l1, apps: (.apps[:15])}' <<<"$rpt" > "$nightreport_file.tmp" 2>/dev/null \
      && [ -s "$nightreport_file.tmp" ] && chmod 600 "$nightreport_file.tmp" && mv "$nightreport_file.tmp" "$nightreport_file"
    rm -f "$nightreport_file.tmp"
  ) &
}
