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

if ! is_daemon_running; then
  /system/bin/bash /system/bin/PowerSentineld &
fi

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
      /system/bin/bash /system/bin/PowerSentineld &
    fi
  done
) &
