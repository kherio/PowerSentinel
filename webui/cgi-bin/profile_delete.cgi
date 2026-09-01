#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
name="$(sanitize_name "$(get_param "$QUERY_STRING" name)")"
[ -n "$name" ] || fail "invalid profile name"
rm -f "$XBS_DATA/profiles/$name.conf"
echo "OK"
