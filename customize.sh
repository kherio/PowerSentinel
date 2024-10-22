SKIPMOUNT=false
PROPFILE=false
POSTFSDATA=false
LATESTARTSERVICE=true

ui_print "  Settings permissions"
set_perm_recursive $MODPATH 0 0 0755 0755
set_perm $MODPATH/system/bin/bash 0 0 0755
