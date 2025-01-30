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
httpd -p 127.0.0.1:8081 -h "$MODDIR/webui/" -c "$MODDIR/webui/httpd.conf"

/system/bin/bash /system/bin/XtremeBSd &
