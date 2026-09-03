#!/system/bin/bash

# PowerSentinel-alertbridge.sh - Alert Bridge: the ONLY place that pushes
# a real Android notification. Takes a severity + message; only
# "critical" ever reaches the user's notification shade. Everything
# else already went to the Event Journal (journal.sh) - the WebUI's
# Estado/Log view is where routine status belongs, not Android's
# notification tray.
#
# This replaces the old notif() function, which every event/status
# change called directly - "Config Loaded", "status: Enabled",
# "Active Events: ...", etc. all used to post a real Android
# notification every single time, which is the actual problem this
# whole redesign exists to fix. Only genuinely critical situations
# (safe mode active, a config safety guard rejecting an unsafe
# allowlist-less suspend setting) still reach the user this way.

alert_dispatch() {
  local severity="$1" message="$2"
  [ "$severity" = "critical" ] || return 0
  [ "$(getconf notify true)" = "true" ] || return 0

  # SECURITY: see the equivalent comment this replaced in the old
  # notif() - base64-encoding neutralizes shell metacharacters before
  # they ever reach su -c's embedded shell. "$message" can originate
  # from data that ultimately comes from the world-writable control
  # file, so this isn't a theoretical concern.
  local b64
  b64="$(printf '%s' "$message" | base64 | tr -d '\n')"
  su -lp 2000 -c "cmd notification post -S bigtext -t 'PowerSentinel' 'ALERT' \"\$(echo $b64 | base64 -d)\"" >/dev/null
}
