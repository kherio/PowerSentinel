MODDIR="$(find /data/adb -type d -name XtremeBS)"

echo "Please Wait..."
if ! pgrep -f "httpd -p 127.0.0.1:8081" >/dev/null 2>&1; then
  httpd -p 127.0.0.1:8081 -h "$MODDIR/webui/" -c "$MODDIR/webui/httpd.conf" &>/dev/null &
  sleep 1
fi

am start -a android.intent.action.VIEW -d "http://127.0.0.1:8081" &>/dev/null
