#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
name="$(sanitize_name "$(get_param "$QUERY_STRING" name)")"
[ -n "$name" ] || fail "invalid profile name"
mkdir -p "$XBS_DATA/profiles"
read_post_body | XBS-writefile "$XBS_DATA/profiles/$name.conf" || fail "could not save profile"
echo "OK"
