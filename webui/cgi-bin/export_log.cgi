#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
logf=$(grep '^log_file=' "$XBS_DATA/XtremeBS.conf" 2>/dev/null | cut -d= -f2)
logf="${logf:-$XBS_DATA/XtremeBS.log}"
dest="/sdcard/Download/XtremeBS-log-$(date +%s%3N 2>/dev/null || date +%s).txt"
cp "$logf" "$dest" 2>/dev/null && echo "$dest" || fail "could not export log"
