#!/system/bin/bash

# PowerSentinel configuration access layer.
#
# The daemon keeps global configuration in memory for the lifetime of a run.
# Event-specific values are read on demand from the same parser so callers do
# not need to know the on-disk syntax. This deliberately does not rewrite the
# user's configuration when a value is invalid; callers receive a safe default.

: "${conf:=/data/local/tmp/PowerSentinel/PowerSentinel.conf}"

declare -gA PS_CONFIG=()

config_load_global() {
  PS_CONFIG=()
  [ -r "$conf" ] || return 0

  while IFS=$'\t' read -r key value; do
    [ -n "$key" ] || continue
    PS_CONFIG["$key"]="$value"
  done < <(
    awk '
      function trim(s) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s }
      /^[[:space:]]*#/ { next }
      {
        line=$0
        if (depth == 0 && line ~ /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/) {
          key=line
          sub(/^[[:space:]]*/, "", key)
          sub(/=.*/, "", key)
          value=line
          sub(/^[^=]*=/, "", value)
          print key "\t" trim(value)
        }
        if (line ~ /\{[[:space:]]*$/) depth++
        if (line ~ /^[[:space:]]*\}/) depth--
      }
    ' "$conf" 2>/dev/null
  )
}

config_get_raw() {
  local key="$1"
  local default="${2-}"
  local value="${PS_CONFIG[$key]-}"
  [ -n "$value" ] && printf '%s\n' "$value" || printf '%s\n' "$default"
}

config_get_event_raw() {
  local event="$1"
  local key="$2"
  local default="${3-}"
  [ -r "$conf" ] || { printf '%s\n' "$default"; return; }

  awk -v target="$event" -v wanted="$key" -v fallback="$default" '
    function trim(s) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s }
    /^[[:space:]]*#/ { next }
    {
      line=$0
      if (!inside && line ~ "^[[:space:]]*" target "[[:space:]]*=[[:space:]]*\\{[[:space:]]*$") {
        inside=1
        next
      }
      if (inside && line ~ /^[[:space:]]*\}/) {
        print fallback
        found=1
        exit
      }
      if (inside && line ~ "^[[:space:]]*" wanted "[[:space:]]*=") {
        value=line
        sub("^[[:space:]]*" wanted "[[:space:]]*=[[:space:]]*", "", value)
        print trim(value)
        found=1
        exit
      }
    }
    END { if (!found) print fallback }
  ' "$conf" 2>/dev/null | tail -n 1
}

config_valid_bool() {
  case "$1" in true|false) return 0 ;; *) return 1 ;; esac
}

config_get() {
  local key="$1"
  local default="${2-}"
  local value
  value="$(config_get_raw "$key" "$default")"

  case "$key" in
    version)
      case "$value" in 1|2) ;; *) value="$default" ;; esac
      ;;
    delay)
      case "$value" in ''|*[!0-9]*) value="$default" ;; esac
      ;;
    log_level)
      case "$value" in ''|*[!0-9]*) value="$default" ;; esac
      ;;
    notify|keep_on_charge|handle_proc|low_ram|doze_enabled|kill_wifi|safemode)
      config_valid_bool "$value" || value="$default"
      ;;
    doze)
      case "$value" in false|light|deep) ;; *) value="$default" ;; esac
      ;;
    handle_apps|handle_gms)
      case "$value" in false|kill|nice|suspend) ;; *) value="$default" ;; esac
      ;;
    charge_limit)
      case "$value" in ''|*[!0-9]*) value="$default" ;; esac
      ;;
  esac

  printf '%s\n' "$value"
}
