#!/system/bin/bash
. "$(dirname "$0")/cgi-common.sh"
require_token
echo ""
# The POST body is expected to already be base64 (the frontend base64s
# the config text before sending, exactly like the KernelSU/exec() path
# does before piping into XBS-writefile) - so this CGI never has raw,
# attacker-influenced config text anywhere near a shell command line,
# same hardening as the native path.
read_post_body | XBS-writefile "$XBS_DATA/XtremeBS.conf" || fail "could not save config"
XBSctl reload
echo "OK"
