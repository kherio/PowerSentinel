MODDIR="$(find /data/adb -type d -name PowerSentinel)"
PowerSentinel_DATA="/data/local/tmp/PowerSentinel"
SERVE_DIR="$PowerSentinel_DATA/.serve"
TOKEN_FILE="$PowerSentinel_DATA/.token"

echo "Please Wait..."

mkdir -p "$PowerSentinel_DATA"

# Only expose exactly two things via httpd - the built frontend and the
# CGI scripts - never the whole module directory (which also holds the
# daemon binary, module.prop, etc.). Rebuilt every run since webroot/ is
# regenerated (and its old inode invalidated) on every `npm run build`.
rm -rf "$SERVE_DIR"
mkdir -p "$SERVE_DIR"
ln -s "$MODDIR/webroot" "$SERVE_DIR/webroot"
ln -s "$MODDIR/webui/cgi-bin" "$SERVE_DIR/cgi-bin"

# SECURITY: a fresh, random per-session token, regenerated every time
# this action runs. httpd is bound to 127.0.0.1, but on Android that
# still lets *any* app on the device connect to it (no root/special
# permission needed for a loopback socket) - unlike KernelSU's exec()
# bridge, which only the manager app itself can invoke. Every CGI
# endpoint requires this token (see webui/cgi-bin/cgi-common.sh), so
# only the browser tab this script itself opens - which is the only
# place the token is ever exposed, via the URL - can actually use them.
TOKEN="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N)"
echo "$TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

chmod +x "$MODDIR"/webui/cgi-bin/*.cgi 2>/dev/null

if ! pgrep -f "httpd -p 127.0.0.1:8081" >/dev/null 2>&1; then
  httpd -p 127.0.0.1:8081 -h "$SERVE_DIR" -c "$MODDIR/webui/httpd.conf" &>/dev/null &
  sleep 1
fi

am start -a android.intent.action.VIEW -d "http://127.0.0.1:8081/webroot/index.html?token=$TOKEN" &>/dev/null
