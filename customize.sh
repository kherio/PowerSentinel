SKIPMOUNT=false
PROPFILE=false
POSTFSDATA=false
LATESTARTSERVICE=true

ui_print "  Settings permissions"
set_perm_recursive $MODPATH 0 0 0755 0755
set_perm $MODPATH/system/bin/bash 0 0 0755
set_perm $MODPATH/system/bin/bc 0 0 0755
set_perm $MODPATH/system/bin/XBS-writefile 0 0 0755

# action.sh + the CGI scripts are the Magisk path (no native WebUI-X
# support there): action.sh starts a local httpd for the same webroot/
# KernelSU-family managers open natively. Both paths ship in every
# install - the frontend detects at runtime which one actually works
# (see frontend/src/api.js) rather than this script trying to guess.
set_perm $MODPATH/action.sh 0 0 0755
set_perm_recursive $MODPATH/webui/cgi-bin 0 0 0755 0755

# webroot/ permissions and SELinux context are set automatically by
# KernelSU on install - do not chmod/chown it manually here (see
# https://kernelsu.org/guide/module-webui.html). Magisk doesn't apply
# that automatic handling, but 0755 from the set_perm_recursive above
# (applied to the whole $MODPATH already) is sufficient for httpd -
# running as root either way - to read and serve it.
