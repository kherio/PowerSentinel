#!/bin/bash
# tests/test_detect_refresh_no_forks.sh
#
# detect_refresh runs every 3 s. It must parse `dumpsys battery` and
# /proc/loadavg with bash builtins only (one dumpsys, nothing else) and
# give the same values as the old grep/cut chains, including defaults when
# keys are missing and "first matching line wins".

run_tests() {
  local tmp stubs
  tmp="$(mktemp -d)"; stubs="$tmp/bin"; mkdir -p "$stubs"
  # Any external tool the function would fork leaves a trace.
  local t
  for t in grep cut cat awk sed head tr; do
    printf '#!/bin/sh\necho %s >> "%s/forks"\nexit 1\n' "$t" "$tmp" > "$stubs/$t"; chmod +x "$stubs/$t"
  done

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-detect.sh"
  DUMP=""
  dumpsys() { printf '%s\n' "$DUMP"; }

  section "valores reales (salida tipica de dumpsys battery)"
  DUMP='Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  Max charging current: 500000
  Max charging voltage: 5000000
  status: 2
  level: 73
  voltage: 4123
  temperature: 312
  technology: Li-poly'
  local oldpath="$PATH"; PATH="$stubs:$oldpath"
  detect_refresh
  PATH="$oldpath"
  assert_eq "73" "$DETECT_BATTERY_LEVEL" "nivel"
  assert_eq "312" "$DETECT_BATTERY_TEMP_RAW" "temperatura"
  assert_eq "4123" "$DETECT_BATTERY_VOLTAGE" "voltaje (no se confunde con 'Max charging voltage')"
  assert_eq "true" "$DETECT_BATTERY_CHARGING" "USB powered -> cargando"
  assert_eq "false" "$([ -e "$tmp/forks" ] && echo true || echo false)" "ningun proceso externo lanzado ($(cat "$tmp/forks" 2>/dev/null | tr '\n' ' '))"

  section "sin cargador"
  DUMP='  AC powered: false
  USB powered: false
  Wireless powered: false
  level: 50'
  detect_refresh
  assert_eq "false" "$DETECT_BATTERY_CHARGING" "no cargando"
  assert_eq "50" "$DETECT_BATTERY_LEVEL" "nivel"
  assert_eq "250" "$DETECT_BATTERY_TEMP_RAW" "temperatura por defecto"
  assert_eq "0" "$DETECT_BATTERY_VOLTAGE" "voltaje por defecto"

  section "dumpsys vacio: valores por defecto, sin romper"
  DUMP=""
  detect_refresh
  assert_eq "100" "$DETECT_BATTERY_LEVEL" "nivel por defecto"
  assert_eq "false" "$DETECT_BATTERY_CHARGING" "no cargando"

  section "gana la primera linea; inalambrico cuenta"
  DUMP='  level: 11
  level: 99
  Wireless powered: true'
  detect_refresh
  assert_eq "11" "$DETECT_BATTERY_LEVEL" "primera linea gana"
  assert_eq "true" "$DETECT_BATTERY_CHARGING" "Wireless powered: true -> cargando"

  section "loadavg"
  case "$DETECT_LOAD1$DETECT_LOAD5$DETECT_LOAD15" in *[!0-9.]*|'') assert_true 1 "loadavg numerico";; *) assert_true 0 "loadavg numerico";; esac
}
