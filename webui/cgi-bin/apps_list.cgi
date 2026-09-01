#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
system_flag=$(get_param "$QUERY_STRING" system)
if [ "$system_flag" = "1" ]; then
  pm list packages | cut -d: -f2- | sort
else
  pm list packages -3 | cut -d: -f2- | sort
fi
