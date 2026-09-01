#!/system/bin/bash
# Sourced by every CGI script in this directory - NOT executed directly.
#
# SECURITY MODEL: httpd (started by action.sh, on demand) runs as root and
# is bound to 127.0.0.1, but on Android that still means *any* app on the
# device can connect to it - loopback sockets need no special permission,
# unlike KernelSU's exec() bridge, which only the manager app itself can
# invoke. So every CGI here requires a per-session token, generated fresh
# by action.sh each time it starts httpd and opens the browser, to make
# sure only the browser tab action.sh itself opened can successfully call
# these endpoints - not just any app that happens to guess the port.
#
# The token is never served as a static file from webroot (it lives
# outside DOCUMENT_ROOT, at $PowerSentinel_DATA/.token, mode 600) - it only ever
# appears in the URL action.sh opens and in requests the page's own JS
# makes back to the server with it.
PowerSentinel_DATA="/data/local/tmp/PowerSentinel"
TOKEN_FILE="$PowerSentinel_DATA/.token"

echo "Content-type: text/plain"

# QUERY_STRING is what busybox/toybox httpd sets for CGI requests; POST
# body (if any) is read separately by read_post_body() below, since a
# request can have both (e.g. a token in the query string, content in
# the body).
urldecode() {
  # Turns %XX into the matching byte and '+' into a space, matching
  # standard application/x-www-form-urlencoded encoding. Pure
  # printf/read - no external decoder binary required.
  local data="${1//+/ }"
  printf '%b' "${data//%/\\x}"
}

# Extracts one key's value from a "k1=v1&k2=v2" formatted string
# (QUERY_STRING or a urlencoded POST body), URL-decoded.
get_param() {
  local src="$1" key="$2" pair
  local IFS='&'
  for pair in $src; do
    if [ "${pair%%=*}" = "$key" ]; then
      urldecode "${pair#*=}"
      return 0
    fi
  done
  return 1
}

read_post_body() {
  # Plain `cat` on stdin, matching exactly what the original save.cgi did
  # (before this rewrite) and is known to work with this specific httpd -
  # relying on CONTENT_LENGTH instead couldn't be verified against the
  # real binary from this environment, so it's not worth the risk of a
  # behavior this codebase hasn't already proven.
  cat
}

fail() {
  echo "Error: $1"
  exit 1
}

# Every script calls this first (after sourcing this file). Compares the
# caller-supplied token (query string ?token=... - kept out of the POST
# body so scripts that also read a raw POST body don't need to strip it
# out first) against the one action.sh generated for this session.
require_token() {
  local supplied stored
  [ -f "$TOKEN_FILE" ] || fail "no active session"
  supplied="$(get_param "$QUERY_STRING" token)"
  stored="$(cat "$TOKEN_FILE" 2>/dev/null)"
  [ -n "$supplied" ] && [ -n "$stored" ] && [ "$supplied" = "$stored" ] || fail "invalid or missing session token"
}

# Defense in depth for event/profile names: the frontend already
# restricts these to the same character set before ever sending a
# request, but every endpoint here re-validates independently rather
# than trusting the client, since anything with a valid session token
# can reach these directly.
sanitize_name() {
  printf '%s' "$1" | tr -cd 'a-zA-Z0-9_-'
}
