#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
mkdir -p "$XBS_DATA/profiles"
ls -1 "$XBS_DATA/profiles" 2>/dev/null | sed 's/\.conf$//'
