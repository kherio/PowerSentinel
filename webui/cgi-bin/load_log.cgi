#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
logf=$(grep '^log_file=' "$PowerSentinel_DATA/PowerSentinel.conf" 2>/dev/null | cut -d= -f2)
logf="${logf:-$PowerSentinel_DATA/PowerSentinel.log}"
cat "$logf" 2>/dev/null || echo ""
