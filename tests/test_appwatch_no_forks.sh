#!/bin/bash
# tests/test_appwatch_no_forks.sh
#
# appwatch_check measures background CPU with shell builtins only (no
# pgrep/cat/awk per app), caches the `pm list packages -3` answer, still
# flags a sustained heavy app after N consecutive checks, and resets the
# count for an app with no process.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-appwatch.sh"
  local d; d="$(mktemp -d)"
  PROC_ROOT="$d/proc"; mkdir -p "$PROC_ROOT"
  local ext="$d/ext_calls" pmc="$d/pm_calls" flagged="$d/flagged" emitted="$d/emitted"
  : > "$ext"; : > "$pmc"; : > "$flagged"; : > "$emitted"

  pgrep() { echo pgrep >> "$ext"; }
  cat()   { echo cat   >> "$ext"; }
  awk()   { echo awk   >> "$ext"; }
  head()  { echo head  >> "$ext"; }
  pm()    { echo pm >> "$pmc"; printf 'package:com.heavy.app\npackage:com.idle.app\npackage:com.gone.app\n'; }
  is_device() { echo false; }
  emit() { echo "$*" >> "$emitted"; }
  appwatch_flag() { echo "$1" >> "$flagged"; }

  mkproc() { # pid cmdline utime stime
    mkdir -p "$PROC_ROOT/$1"
    printf '%s\0--flag\0' "$2" > "$PROC_ROOT/$1/cmdline"
    echo "$1 ($2 x) S 1 1 1 0 -1 4194560 100 0 0 0 $3 $4 0 0 20 0 1 0 1 1 1" > "$PROC_ROOT/$1/stat"
  }
  mkproc 10 com.heavy.app 0 0
  mkproc 11 com.idle.app 0 0
  mkproc 12 other.system.proc 5 5
  mkproc 900 com.heavy.app 7 7   # higher pid, same package: lowest pid wins

  _step() { # n : advance the clock model by one interval and run
    local now; printf -v now '%(%s)T' -1
    _appwatch_last_check_ts=0
    _appwatch_last_ts[com.heavy.app]=$(( now - 60 ))
    _appwatch_last_ts[com.idle.app]=$(( now - 60 ))
    mkproc 10 com.heavy.app $(( $1 * 6000 )) 0
    mkproc 11 com.idle.app 1 0
    appwatch_check
  }

  section "primera lectura: sin procesos externos, pm una vez"
  appwatch_check
  assert_eq "0" "$(wc -l < "$ext" | tr -d ' ')" "ni pgrep, ni cat, ni awk, ni head"
  assert_eq "1" "$(wc -l < "$pmc" | tr -d ' ')" "pm list packages -3 llamado una vez"

  section "lista de paquetes en cache"
  _step 1; _step 2
  assert_eq "1" "$(wc -l < "$pmc" | tr -d ' ')" "pm no se vuelve a llamar"

  section "app pesada sostenida: se marca tras 3 comprobaciones seguidas"
  assert_eq "" "$(cat_file() { while IFS= read -r l; do echo "$l"; done < "$1"; }; cat_file "$flagged")" "aun no marcada tras 2"
  _step 3
  assert_eq "com.heavy.app" "$(while IFS= read -r l; do echo "$l"; done < "$flagged")" "marcada solo la pesada"
  assert_eq "0" "$(wc -l < "$ext" | tr -d ' ')" "sigue sin procesos externos"

  section "app sin proceso: contador a cero"
  assert_eq "0" "${_appwatch_high_count[com.gone.app]}" "app ausente: 0"

  section "refresco al caducar la cache"
  _appwatch_pkgs_ts=0; _step 4
  assert_eq "2" "$(wc -l < "$pmc" | tr -d ' ')" "pm de nuevo al caducar"

  unset -f pgrep cat awk head pm is_device emit appwatch_flag
  rm -rf "$d"
}
