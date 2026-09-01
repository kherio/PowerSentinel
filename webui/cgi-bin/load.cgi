#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
cat "$XBS_DATA/XtremeBS.conf" 2>/dev/null || echo ""
