SKIPMOUNT=false
PROPFILE=false
POSTFSDATA=false
LATESTARTSERVICE=true

ui_print "  Settings permissions"
set_perm_recursive $MODPATH 0 0 0755 0755
set_perm $MODPATH/system/bin/bash 0 0 0755
set_perm $MODPATH/system/bin/bc 0 0 0755
set_perm $MODPATH/system/bin/XBS-writefile 0 0 0755

# webroot/ permissions and SELinux context are set automatically by
# KernelSU on install - do not chmod/chown it manually here (see
# https://kernelsu.org/guide/module-webui.html).
