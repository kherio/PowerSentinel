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

/system/bin/bash /system/bin/PowerSentineld &

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
    if ! pgrep -f "/system/bin/PowerSentineld" >/dev/null 2>&1; then
      log -t PowerSentinel "Watchdog: PowerSentineld was not running - restarting it"
      /system/bin/bash /system/bin/PowerSentineld &
    fi
  done
) &
