SKIPMOUNT=false
PROPFILE=false
POSTFSDATA=false
LATESTARTSERVICE=true

ui_print "  Settings permissions"
set_perm_recursive $MODPATH 0 0 0755 0755
set_perm $MODPATH/system/bin/bash 0 0 0755
set_perm $MODPATH/system/bin/bc 0 0 0755
set_perm $MODPATH/system/bin/jq 0 0 0755
set_perm $MODPATH/system/bin/PowerSentinel-writefile 0 0 0755

# PowerSentinel uses KernelSU's native WebUI exclusively. KernelSU manages
# webroot/ permissions and SELinux context when the module is installed;
# do not chmod/chown that directory manually.
