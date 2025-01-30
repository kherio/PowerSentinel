#!/system/bin/bash

# Set the Content-Type header for plain text
echo "Content-type: text/plain"
echo ""

# Path to the configuration file
CONFIG_FILE="/data/local/tmp/XtremeBS/XtremeBS.conf"

# Read and output the file content
if [ -f "$CONFIG_FILE" ]; then
    cat "$CONFIG_FILE"
else
    echo "Error: Configuration file not found"
    exit 1
fi
