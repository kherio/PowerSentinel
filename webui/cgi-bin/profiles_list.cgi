#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
mkdir -p "$PowerSentinel_DATA/profiles"
ls -1 "$PowerSentinel_DATA/profiles" 2>/dev/null | sed 's/\.conf$//'
