#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
path=$(get_param "$QUERY_STRING" path)
[ -z "$path" ] && { echo ""; exit 0; }
# Defense in depth: reads aren't routed through XBS-writefile (which only
# handles writes), so this endpoint enforces the same allowlist itself -
# otherwise it would be an arbitrary-file-read oracle for anyone who
# somehow obtained a valid session token.
case "$path" in
  "$XBS_DATA"/*) ;;
  *) fail "path not allowed" ;;
esac
case "$path" in *..*) fail "path traversal rejected" ;; esac
[ -L "$path" ] && fail "refusing to read through a symlink"
cat "$path" 2>/dev/null || echo ""
