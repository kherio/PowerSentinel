#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
cat "$PowerSentinel_DATA/PowerSentinel.conf" 2>/dev/null || echo ""
