#!/system/bin/bash

# PowerSentinel-apppolicy.sh - per-app policy in 4 levels, replacing the
# previous binary allowlist/denylist-only model. "Políticas por app en
# 4 niveles" from the apps-block roadmap, deliberately built AFTER
# appwatch.sh (real, measured CPU detection) rather than before it -
# so a level assigned to an app can be an informed decision based on
# what's actually been observed, not an arbitrary guess.
#
# Levels (an integer 0-3, global - an app's real-world behavior doesn't
# change per event, so its policy shouldn't need re-specifying in
# every event block the way allowlist/denylist currently do):
#   0 - Never touch this app, regardless of what the event's own
#       handle_apps says. Same effect as being on an event's allowlist,
#       but set once, globally, rather than per event.
#   1 - Gentle only: whatever the event's handle_apps asks for (kill or
#       suspend), this app only ever gets "nice" - never fully stopped.
#       For an app the user wants left running but doesn't mind being
#       deprioritized.
#   2 - Default: follow the event's own handle_apps exactly as
#       configured. The starting point for every app that has never
#       been explicitly assigned a level.
#   3 - Always aggressive: forces "suspend" regardless of what the
#       event's own handle_apps says (kill or nice) - for an app
#       already confirmed heavy (e.g. flagged by appwatch.sh) that
#       should be dealt with firmly whenever any app-handling event
#       fires, not just the specific ones the user remembered to
#       configure for suspend.
#
# Storage: a small, standalone JSON object (package name -> level),
# read/written the same atomic-temp-file-then-rename way every other
# JSON file in this project already is. An app with no entry is level
# 2 (today's exact existing behavior) - this file starts empty and
# stays that way until the user (or a future automated suggestion)
# assigns something, so installs that never touch this feature see no
# change at all.

: "${app_policy_file:=/data/local/tmp/PowerSentinel/PowerSentinel.apppolicy}"

apppolicy_get() {
  local app="$1" level
  [ -s "$app_policy_file" ] || { echo 2; return; }
  level="$("$JQ" -r --arg a "$app" '.[$a]? // empty' "$app_policy_file" 2>/dev/null)"
  case "$level" in
    0|1|2|3) echo "$level" ;;
    *) echo 2 ;;
  esac
}

apppolicy_set() {
  local app="$1" level="$2" dir tmp
  case "$level" in
    0|1|2|3) ;;
    *) echo "Nivel inválido (debe ser 0, 1, 2 o 3): $level" >&2; return 1 ;;
  esac
  dir="$(dirname "$app_policy_file")"
  mkdir -p "$dir" 2>/dev/null
  [ -s "$app_policy_file" ] || echo '{}' > "$app_policy_file"
  tmp="$(mktemp "$dir/.PowerSentinel.apppolicy.XXXXXX")" || return 1
  if "$JQ" --arg a "$app" --argjson l "$level" '.[$a] = $l' "$app_policy_file" > "$tmp" 2>/dev/null \
      && [ -s "$tmp" ] && "$JQ" -e . "$tmp" >/dev/null 2>&1; then
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$app_policy_file"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

apppolicy_remove() {
  local app="$1" dir tmp
  [ -s "$app_policy_file" ] || return 0
  dir="$(dirname "$app_policy_file")"
  tmp="$(mktemp "$dir/.PowerSentinel.apppolicy.XXXXXX")" || return 1
  if "$JQ" --arg a "$app" 'del(.[$a])' "$app_policy_file" > "$tmp" 2>/dev/null \
      && [ -s "$tmp" ] && "$JQ" -e . "$tmp" >/dev/null 2>&1; then
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$app_policy_file"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

apppolicy_list() {
  [ -s "$app_policy_file" ] || return 0
  "$JQ" -r 'to_entries[] | "\(.key)\t\(.value)"' "$app_policy_file" 2>/dev/null
}

# The one function actions.sh needs: given the event's own configured
# action for apps (false/nice/kill/suspend) and a specific package,
# returns what should ACTUALLY happen to that one app once its policy
# level is folded in. Level 2 (the default for anything unassigned)
# is a pure passthrough - existing behavior for every app nobody has
# ever explicitly classified.
apppolicy_effective_action() {
  local app="$1" event_action="$2" level
  level="$(apppolicy_get "$app")"
  case "$level" in
    0) echo "false" ;;
    1) [ "$event_action" = "false" ] && echo "false" || echo "nice" ;;
    3) echo "suspend" ;;
    *) echo "$event_action" ;;
  esac
}
