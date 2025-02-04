#!/bin/bash

# Set the Content-Type header
echo "Content-type: text/plain"
echo ""

# Read the POST data from stdin
POST_DATA=$(cat)

# Write the POST data to the file
echo "$POST_DATA" > /sdcard/XtremeBS.log
# Check if writing was successful
if [ $? -eq 0 ]; then
    echo "File saved successfully."
else
    echo "Failed to save the file."
fi
