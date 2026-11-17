#!/system/bin/bash

# PowerSentinel-appwatch.sh - observational detection of apps consuming
# real, measurable CPU while the screen is off. Directly serves "real
# battery-management outcomes, not a collection of tweaks that sound
# reasonable" - this is a measurement, not another lever, and it's the
# groundwork for making any future per-app policy (a "4 niveles"
# system) target apps that are ACTUALLY measured as heavy, rather than
# an arbitrary manually-curated list.
#
# Uses /proc/[pid]/stat - a stable, POSIX/Linux-documented kernel
# interface (see `man proc`), not any Android-framework dumpsys command.
# This project has repeatedly found dumpsys/framework text output to be
# fragile across Android versions and OEMs (batterystats, dumpsys
# alarm); /proc/[pid]/stat's field layout has been stable for decades
# and doesn't depend on Android at all, only the Linux kernel.
#
# Deliberately OBSERVATIONAL ONLY: flags a candidate after several
# consecutive samples of sustained CPU use and records it to the Event
# Journal - it does not suspend, kill, or nice anything automatically.
# Acting on an unreviewed heuristic threshold risks exactly the kind of
# app instability this project exists to minimize, not cause. A future
# policy layer can use this signal once there's confidence in it; for
# now it's a diagnostic a person can act on themselves (e.g. by adding
# the app to a denylist).
#
# Scoped to while the screen is off, matching the same "screen off
# should mean idle unless something is legitimately working" assumption
# the rest of this project already makes - CPU use while the screen is
# on could easily be the user's own foreground activity, which this has
# no business judging.

# Standard Linux clock ticks per second - a fixed, extremely stable OS
# convention preserved by libc for ABI compatibility even when the
# kernel's internal timer frequency differs, not something that needs
# querying per-device (and not derived from the `getconf` shell
# function already defined elsewhere in this project, which reads
# PowerSentinel's own config, not the system's clock tick rate).
readonly APPWATCH_CLK_TCK=100

# Injectable, same pattern as $cpu_base_path elsewhere in this project -
# defaults to the real kernel /proc, so production behavior is
# identical to hardcoding it, but a test can point this at a fake
# directory tree without needing real running processes.
PROC_ROOT="${PROC_ROOT:-/proc}"

APPWATCH_INTERVAL_S="${APPWATCH_INTERVAL_S:-60}"
APPWATCH_CPU_THRESHOLD_PCT="${APPWATCH_CPU_THRESHOLD_PCT:-5}"
APPWATCH_CONSECUTIVE_NEEDED="${APPWATCH_CONSECUTIVE_NEEDED:-3}"

_appwatch_last_check_ts=0
declare -gA _appwatch_last_ticks=()
declare -gA _appwatch_last_ts=()
declare -gA _appwatch_high_count=()

# Flagged apps persist here so the WebUI/CLI can show and act on them -
# previously this only ever lived in the in-memory
# $_appwatch_high_count array and a one-off Journal line, with no way
# for anything outside the daemon's own process to know which apps are
# currently flagged. One-directional by design: appwatch_flag() only
# ever ADDS an app here (once, the first time it's confirmed) - it
# never removes one on its own, even if that app's CPU use later drops
# back to normal, since the point is for a person to actually review
# it. Removal (resolved or dismissed as a false positive) is a
# deliberate action from the WebUI or PowerSentinelconf, not something
# this file decides by itself.
: "${flagged_apps_file:=/data/local/tmp/PowerSentinel/PowerSentinel.flagged}"

appwatch_flag() {
  local pkg="$1" dir tmp
  dir="$(dirname "$flagged_apps_file")"
  mkdir -p "$dir" 2>/dev/null
  [ -s "$flagged_apps_file" ] || echo '[]' > "$flagged_apps_file"
  if "$JQ" -e --arg p "$pkg" 'any(.[]?; . == $p)' "$flagged_apps_file" >/dev/null 2>&1; then
    return 0
  fi
  tmp="$(mktemp "$dir/.PowerSentinel.flagged.XXXXXX")" || return 1
  if "$JQ" --arg p "$pkg" '. + [$p]' "$flagged_apps_file" > "$tmp" 2>/dev/null \
      && [ -s "$tmp" ] && "$JQ" -e . "$tmp" >/dev/null 2>&1; then
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$flagged_apps_file"
  else
    rm -f "$tmp"
  fi
}

appwatch_unflag() {
  local pkg="$1" dir tmp
  [ -s "$flagged_apps_file" ] || return 0
  dir="$(dirname "$flagged_apps_file")"
  tmp="$(mktemp "$dir/.PowerSentinel.flagged.XXXXXX")" || return 1
  if "$JQ" --arg p "$pkg" 'map(select(. != $p))' "$flagged_apps_file" > "$tmp" 2>/dev/null \
      && [ -s "$tmp" ] && "$JQ" -e . "$tmp" >/dev/null 2>&1; then
    chmod 600 "$tmp" 2>/dev/null
    mv "$tmp" "$flagged_apps_file"
  else
    rm -f "$tmp"
  fi
}

# Third-party package list, cached: `pm list packages -3` starts a JVM
# process and was being run every 60 s while the screen was off.
APPWATCH_PKG_REFRESH_S="${APPWATCH_PKG_REFRESH_S:-3600}"
declare -gA _appwatch_pkgs=()
_appwatch_pkgs_ts=0

_appwatch_refresh_pkgs() {
  local now="$1" line
  local -A fresh=()
  while IFS= read -r line; do
    line="${line#package:}"
    [ -n "$line" ] && fresh[$line]=1
  done < <(pm list packages -3 2>/dev/null)
  # An empty answer (pm hiccup) keeps the previous list.
  [ "${#fresh[@]}" -gt 0 ] || return 0
  _appwatch_pkgs=()
  for line in "${!fresh[@]}"; do _appwatch_pkgs[$line]=1; done
  _appwatch_pkgs_ts="$now"
}

# Called freely every main-loop cycle, same pattern as
# energylog_sample() - internally throttles to $APPWATCH_INTERVAL_S.
#
# PERFORMANCE FIX: the real check used to fork several processes per
# installed third-party app every 60 s (pgrep | head, cat, awk x2, plus
# `pm list packages -3`), i.e. hundreds of forks a minute while the phone
# was idle - measured on a OnePlus 11 as the daemon's child processes
# using ~19% of one core overnight. It now does the same measurement with
# shell builtins only: one pass over /proc (cmdline = package name for an
# app's main process), the package list cached for
# $APPWATCH_PKG_REFRESH_S, and no external command at all in the common
# case.
appwatch_check() {
  local now
  printf -v now '%(%s)T' -1
  [ $(( now - _appwatch_last_check_ts )) -ge "$APPWATCH_INTERVAL_S" ] || return 0
  _appwatch_last_check_ts="$now"

  [ "$(is_device screen)" = "false" ] || return 0

  if [ "${#_appwatch_pkgs[@]}" -eq 0 ] || \
     [ $(( now - _appwatch_pkgs_ts )) -ge "$APPWATCH_PKG_REFRESH_S" ]; then
    _appwatch_refresh_pkgs "$now"
  fi

  local pkg pid stat_line utime stime ticks elapsed_ticks elapsed_s pct d cmd
  local -A pid_of=()

  # One pass over /proc: lowest PID whose argv[0] is a tracked package.
  for d in "$PROC_ROOT"/[0-9]*; do
    pid="${d##*/}"
    cmd=""
    IFS= read -r -d '' cmd < "$d/cmdline" 2>/dev/null
    [ -n "$cmd" ] || continue
    [ -n "${_appwatch_pkgs[$cmd]}" ] || continue
    if [ -z "${pid_of[$cmd]}" ] || [ "$pid" -lt "${pid_of[$cmd]}" ]; then
      pid_of[$cmd]="$pid"
    fi
  done

  for pkg in "${!_appwatch_pkgs[@]}"; do
    pid="${pid_of[$pkg]}"
    [ -n "$pid" ] || { _appwatch_high_count[$pkg]=0; continue; }

    stat_line=""
    read -r stat_line < "$PROC_ROOT/$pid/stat" 2>/dev/null
    [ -n "$stat_line" ] || continue
    # Field 2 (the command name) is parenthesized and can itself
    # contain spaces, which would shift every subsequent
    # positionally-numbered field - `man proc` explicitly warns about
    # this. Strip everything up to and including the last ")" first,
    # then count fields from there: what was field 14/15 (utime/stime)
    # becomes field 12/13 relative to this trimmed remainder.
    stat_line="${stat_line##*) }"
    set -- $stat_line
    utime="${12}"
    stime="${13}"
    case "$utime$stime" in
      *[!0-9]*|'') continue ;;
    esac
    ticks=$(( utime + stime ))

    if [ -n "${_appwatch_last_ticks[$pkg]}" ]; then
      elapsed_ticks=$(( ticks - _appwatch_last_ticks[$pkg] ))
      elapsed_s=$(( now - _appwatch_last_ts[$pkg] ))
      if [ "$elapsed_s" -gt 0 ] && [ "$elapsed_ticks" -ge 0 ]; then
        pct=$(( elapsed_ticks * 100 / APPWATCH_CLK_TCK / elapsed_s ))
        if [ "$pct" -ge "$APPWATCH_CPU_THRESHOLD_PCT" ]; then
          _appwatch_high_count[$pkg]=$(( ${_appwatch_high_count[$pkg]:-0} + 1 ))
          if [ "${_appwatch_high_count[$pkg]}" -eq "$APPWATCH_CONSECUTIVE_NEEDED" ]; then
            emit appwatch info "Sustained background CPU use detected: $pkg (~${pct}% of one core, screen off)"
            appwatch_flag "$pkg"
          fi
        else
          _appwatch_high_count[$pkg]=0
        fi
      fi
    fi

    _appwatch_last_ticks[$pkg]="$ticks"
    _appwatch_last_ts[$pkg]="$now"
  done
}
