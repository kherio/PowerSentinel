#!/system/bin/bash

# PowerSentinel-log.sh - log_msg() and the writer behind it.
#
# The default log file lives on /sdcard, which on a device with
# file-based encryption does NOT exist between boot and the user's first
# unlock. The daemon used to wait for it (service.sh looped until
# /sdcard/Android appeared), so a rebooted phone ran completely
# unmanaged - no profiles, no battery rules - until the person unlocked
# it, which can be hours overnight or after an unattended reboot.
#
# The daemon now starts as soon as Android has booted, and this writer
# copes with the missing storage:
#   - while the log directory does not exist, lines go to a small
#     early-log file in the daemon's own directory (/data is available
#     before unlock), capped so a phone that is never unlocked cannot
#     fill it;
#   - on the first write after the directory appears, the previous log is
#     rotated (it used to be rotated once at daemon start, which would
#     have been skipped), the early lines are appended in order, and the
#     early file is removed.
# A log file on /data (a user-configured path) behaves as before: the
# directory exists from the start, so the first write rotates and writes.

: "${LOG_EARLY_FILE:=/data/local/tmp/PowerSentinel/PowerSentinel.early.log}"
: "${LOG_EARLY_MAX_LINES:=2000}"
declare -g _log_ready=0
declare -g _log_early_n=0

# Forget the "already rotated / merged" state - called when log_file is
# (re)resolved at daemon start.
log_reset() {
  _log_ready=0
  _log_early_n=0
}

log_write() {
  local line="$1" dir="${log_file%/*}"
  if [ "$_log_ready" != 1 ]; then
    if [ -d "$dir" ]; then
      [ -f "$log_file" ] && mv "$log_file" "$log_file.old"
      if [ -s "$LOG_EARLY_FILE" ]; then
        cat "$LOG_EARLY_FILE" >> "$log_file" 2>/dev/null
        rm -f "$LOG_EARLY_FILE"
      fi
      _log_ready=1
    else
      if [ "$_log_early_n" -lt "$LOG_EARLY_MAX_LINES" ]; then
        _log_early_n=$(( _log_early_n + 1 ))
        echo "$line" >> "$LOG_EARLY_FILE" 2>/dev/null
      fi
      return 0
    fi
  fi
  echo "$line" >> "$log_file" 2>/dev/null
}

log_msg() {
  case $1 in
    1)
      log_lvl="[INFO]" ;;
    2)
      log_lvl="[VERBOSE]" ;;
    3)
      log_lvl="[DEBUG]" ;;
  esac
  if [ "$log_level" -ge "$1" ]; then
    local ts
    printf -v ts '%(%m-%d-%Y %H:%M:%S)T' -1
    log_write "$ts $log_lvl $2"
  fi
}
