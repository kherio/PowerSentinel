#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
path=$(get_param "$QUERY_STRING" path)
[ -z "$path" ] && fail "missing path"
read_post_body | XBS-writefile "$path" || fail "could not write app list"
echo "OK"
