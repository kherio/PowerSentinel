#!/system/bin/bash

# Set the Content-Type header for plain text
echo "Content-type: text/plain"
echo ""

# Path to the configuration file
STATUS_FILE="/data/local/tmp/XtremeBS/XtremeBS.status"

# Read and output the file content
if [ -f "$STATUS_FILE" ]; then
    cat "$STATUS_FILE"
else
    echo "Error: Status Unavailable"
    exit 1
fi
