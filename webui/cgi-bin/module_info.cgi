#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
cat "$(find /data/adb -maxdepth 2 -type d -name XtremeBS 2>/dev/null | head -1)/module.prop" 2>/dev/null || echo ""
