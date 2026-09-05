#!/system/bin/sh
# Do NOT assume where your module will be located.
# ALWAYS use $MODDIR if you need to know where this script
# and module is placed.
# This will make sure your module will still work
# if Magisk change its mount point in the future
MODDIR=${0%/*}

# This script will be executed in late_start service mode

until [ "$(getprop sys.boot_completed)" = "1" ] && [ -d "/sdcard/Android" ]; do
  sleep 3
done

# BUG FIX (external code review): `pgrep -f PowerSentineld` alone isn't
# an atomic "am I the only instance" check - it's a name match with no
# lock and no verification that a matching PID is genuinely still
# alive versus a reused PID. A daemon that toggles CPU governors, core
# online state, WiFi, and system properties shouldn't risk two
# instances running at once. PowerSentineld now writes its own PID to
# $PIDFILE as early as possible in its startup (see PowerSentineld);
# checked here with both a liveness check (kill -0) and a cmdline
# match (guards against a stale PID number having since been reused by
# some unrelated process) before deciding whether to start another.
PIDFILE="/data/local/tmp/PowerSentinel/PowerSentineld.pid"

is_daemon_running() {
  [ -f "$PIDFILE" ] || return 1
  pid="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  grep -q "PowerSentineld" "/proc/$pid/cmdline" 2>/dev/null
}

# BUG FIX (external code review, then confirmed by reasoning through the
# real timeline rather than just the code): is_daemon_running() + launch
# still wasn't atomic - two checks could both see "not running" and both
# launch, each then overwriting the other's PID file. Boot-time
# duplicate service.sh runs are one way this could happen, but there's
# a more concrete one now that a manual "restart daemon" button exists
# in the WebUI (added the same round as this fix): a person pressing it
# kills the old process, and for the brief window before the new one
# finishes starting, the watchdog loop below - which has been ticking
# independently every 60s since boot, inside this SAME service.sh
# process - could ALSO wake up, see "not running", and launch its own
# replacement at the same moment.
#
# `mkdir` is a single atomic syscall - it either creates the directory
# or fails if it already exists, with no window where two callers could
# both succeed. Used here as a real mutual-exclusion lock: whoever's
# mkdir succeeds is the only one who checks-and-launches; anyone who
# loses the race (mkdir fails) does nothing at all, since a launch is
# already in progress. The launcher re-checks is_daemon_running() AFTER
# acquiring the lock too, in case someone else's launch (from just
# before the lock existed) already finished.
LOCKDIR="/data/local/tmp/PowerSentinel/.daemon_launch.lock"

launch_daemon_if_needed() {
  is_daemon_running && return
  if mkdir "$LOCKDIR" 2>/dev/null; then
    is_daemon_running || /system/bin/bash /system/bin/PowerSentineld &
    sleep 1
    rmdir "$LOCKDIR" 2>/dev/null
  fi
}

launch_daemon_if_needed

# Watchdog: if the daemon dies unexpectedly (crash, OOM kill, etc.), the
# device would otherwise stay unmanaged until the next reboot. Checks
# every 60s and relaunches it if it's not running. Logs via Android's
# own `log` command (visible in logcat) rather than PowerSentinel's own log
# file, since this script doesn't know/parse the user's configured
# log_file path - it's a last-resort safety net, not a regular feature
# users need to see inside the app.
(
  while true; do
    sleep 60
    if ! is_daemon_running; then
      log -t PowerSentinel "Watchdog: PowerSentineld was not running - restarting it"
      launch_daemon_if_needed
    fi
  done
) &
