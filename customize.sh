SKIPMOUNT=false
PROPFILE=false
POSTFSDATA=false
LATESTARTSERVICE=true

# The daemon keeps its config, state and lock under this directory; create
# it at install time so a first-ever install doesn't depend on the daemon
# (which is what would normally create it) already running.
mkdir -p /data/local/tmp/PowerSentinel 2>/dev/null

ui_print "  Settings permissions"
set_perm_recursive $MODPATH 0 0 0755 0755
set_perm $MODPATH/system/bin/bash 0 0 0755
set_perm $MODPATH/system/bin/bc 0 0 0755
set_perm $MODPATH/system/bin/jq 0 0 0755
set_perm $MODPATH/system/bin/PowerSentinel-writefile 0 0 0755

# PowerSentinel uses KernelSU's native WebUI exclusively. KernelSU manages
# webroot/ permissions and SELinux context when the module is installed;
# do not chmod/chown that directory manually.
