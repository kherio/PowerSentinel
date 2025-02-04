#!/system/bin/bash
conf="/data/local/tmp/XtremeBS/XtremeBS.conf"
getconf() {
  # change made here to set default
  # if not set
  opt=$(grep "^$1=" "$conf" | cut -d= -f2)
  [ "$opt" != "" ] && echo "$opt" || echo "$2"
}

# Set the Content-Type header for plain text
echo "Content-type: text/plain"
echo ""

# Path to the configuration file
LOG_FILE=$(getconf log_file "/data/local/tmp/XtremeBS/XtremeBS.log")

# Read and output the file content
if [ -f "$LOG_FILE" ]; then
    cat "$LOG_FILE"
else
    echo "Error: Log file not found"
    exit 1
fi
