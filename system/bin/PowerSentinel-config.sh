#!/system/bin/bash

# PowerSentinel configuration access layer - JSON-backed (via jq).
#
# The on-disk source of truth is now $json_conf (PowerSentinel.json), not
# the legacy $conf (PowerSentinel.conf) text format. $conf still exists
# for two purposes only, both one-directional:
#   1. Upgrading an existing install: migrate_conf_to_json() converts it
#      to JSON exactly once, the first time the daemon starts after this
#      change ships. It is never written to again afterward.
#   2. A developer-mode raw view in the WebUI, which now edits the JSON
#      text directly rather than the old custom syntax - there is no
#      write-back-to-.conf path at all, so there's only ever one format
#      the daemon actually reads at runtime.
#
# Global values are cached in memory (PS_CONFIG) for the lifetime of a
# poll cycle, matching the old awk-based design's performance
# characteristics - config_get_raw() is a plain bash array lookup, not a
# jq subprocess spawn, since it can be called many times per second from
# inside the daemon's hot loop. Only config_load_global() (called once at
# startup and after an explicit reload) and any write actually invoke jq.
# Event-specific reads (config_get_event_raw) are comparatively rare
# (once per event evaluation) and still shell out to jq directly - not
# worth caching every event's fields when most polls only touch one or
# two.

: "${conf:=/data/local/tmp/PowerSentinel/PowerSentinel.conf}"
: "${json_conf:=/data/local/tmp/PowerSentinel/PowerSentinel.json}"

JQ="$(dirname "${BASH_SOURCE[0]:-$0}")/jq"

declare -gA PS_CONFIG=()

config_load_global() {
  PS_CONFIG=()
  [ -r "$json_conf" ] || return 0

  while IFS=$'\t' read -r key value; do
    [ -n "$key" ] || continue
    PS_CONFIG["$key"]="$value"
  done < <("$JQ" -r '.global // {} | to_entries[] | "\(.key)\t\(.value)"' "$json_conf" 2>/dev/null)
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
  [ -r "$json_conf" ] || { printf '%s\n' "$default"; return; }

  local value
  value="$("$JQ" -r --arg e "$event" --arg k "$key" '.events[$e][$k]? // empty' "$json_conf" 2>/dev/null)"
  [ -n "$value" ] && printf '%s\n' "$value" || printf '%s\n' "$default"
}

# List of every event block name currently defined (used by handle_event's
# active_events bookkeeping and anywhere else that needs to enumerate
# events rather than name one directly).
config_list_events() {
  [ -r "$json_conf" ] || return 0
  "$JQ" -r '.events // {} | keys[]' "$json_conf" 2>/dev/null
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
    notify|keep_on_charge|handle_proc|low_ram|doze_enabled|kill_wifi|safemode|adaptive_mode)
      config_valid_bool "$value" || value="$default"
      ;;
    doze)
      case "$value" in false|light|deep) ;; *) value="$default" ;; esac
      ;;
    handle_apps|handle_gms)
      case "$value" in false|kill|nice|suspend) ;; *) value="$default" ;; esac
      ;;
    charge_limit|adaptive_tier1_threshold|adaptive_tier2_threshold|adaptive_tier3_threshold)
      case "$value" in ''|*[!0-9]*) value="$default" ;; esac
      ;;
  esac

  printf '%s\n' "$value"
}

# Centralized, atomic write path for a single global setting - e.g. safe
# mode toggling used to be scattered `echo "safemode=1" >> "$conf"` /
# `sed -i '/safemode=1/d' "$conf"` calls in the daemon itself. Anything
# that needs to persist a global value should go through this instead of
# touching $json_conf directly, so there's exactly one place that knows
# how to write it safely (temp file + atomic rename, same pattern
# XBS-writefile/PowerSentinel-writefile already uses for the WebUI's own
# writes) and exactly one place callers need to trust.
config_set_global() {
  local key="$1"
  local value="$2"
  local dir tmp
  dir="$(dirname "$json_conf")"
  mkdir -p "$dir" 2>/dev/null
  [ -s "$json_conf" ] || echo '{"global":{},"events":{}}' > "$json_conf"

  tmp="$(mktemp "$dir/.PowerSentinel.json.XXXXXX")" || return 1
  if "$JQ" --arg k "$key" --arg v "$value" '.global[$k] = $v' "$json_conf" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$json_conf"
    config_load_global
    return 0
  fi
  rm -f "$tmp"
  return 1
}

# One-time upgrade path: converts an existing (v2, block-structured)
# PowerSentinel.conf into PowerSentinel.json. Never runs if $json_conf
# already exists - from that point on $conf is inert, kept only as a
# historical artifact of the install. Uses `jq --arg` exclusively (never
# interpolates a config value into a jq *program* string), so arbitrary
# characters in a user's own config values can't affect the filter being
# run.
migrate_conf_to_json() {
  [ -s "$json_conf" ] && return 0
  [ -s "$conf" ] || return 0

  local dir tmp
  dir="$(dirname "$json_conf")"
  mkdir -p "$dir" 2>/dev/null
  tmp="$(mktemp "$dir/.PowerSentinel.json.XXXXXX")" || return 1
  echo '{"global":{},"events":{}}' > "$tmp"

  local kind a b c
  while IFS=$'\t' read -r kind a b c; do
    case "$kind" in
      GLOBAL)
        "$JQ" --arg k "$a" --arg v "$b" '.global[$k] = $v' "$tmp" > "$tmp.step" 2>/dev/null \
          && mv "$tmp.step" "$tmp"
        ;;
      EVENT)
        "$JQ" --arg e "$a" --arg k "$b" --arg v "$c" \
          '.events[$e] = ((.events[$e] // {}) + {($k): $v})' "$tmp" > "$tmp.step" 2>/dev/null \
          && mv "$tmp.step" "$tmp"
        ;;
    esac
  done < <(awk '
    function trim(s) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s }
    /^[[:space:]]*#/ { next }
    {
      line = $0
      if (line ~ /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=[[:space:]]*\{[[:space:]]*$/) {
        name = line
        sub(/^[[:space:]]*/, "", name)
        sub(/[[:space:]]*=.*/, "", name)
        current = name
        next
      }
      if (line ~ /^[[:space:]]*\}/) { current = ""; next }
      if (line ~ /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/) {
        key = line
        sub(/^[[:space:]]*/, "", key)
        sub(/=.*/, "", key)
        value = line
        sub(/^[^=]*=/, "", value)
        value = trim(value)
        if (current == "") { print "GLOBAL\t" key "\t" value }
        else { print "EVENT\t" current "\t" key "\t" value }
      }
    }
  ' "$conf")

  mv "$tmp" "$json_conf"
  rm -f "$tmp.step"
}
