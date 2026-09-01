#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
logf=$(grep '^log_file=' "$XBS_DATA/XtremeBS.conf" 2>/dev/null | cut -d= -f2)
logf="${logf:-$XBS_DATA/XtremeBS.log}"
cat "$logf" 2>/dev/null || echo ""
