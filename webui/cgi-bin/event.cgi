#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
action=$(get_param "$QUERY_STRING" action)
name=$(get_param "$QUERY_STRING" name)
# Defense in depth: the frontend already restricts event names to this
# same character set before ever sending a request, but this endpoint
# is reachable by anything that has the session token, so it
# re-validates independently rather than trusting the client.
clean_name="$(sanitize_name "$name")"
[ -n "$clean_name" ] || fail "invalid event name"
case "$action" in
  start) PowerSentinelctl start "$clean_name" && echo "OK" || fail "could not start event" ;;
  stop) PowerSentinelctl stop "$clean_name" && echo "OK" || fail "could not stop event" ;;
  *) fail "invalid action" ;;
esac
