#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
ps -A -o NAME 2>/dev/null | tail -n +2
