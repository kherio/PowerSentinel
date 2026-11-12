#!/bin/bash
# tests/test_wakeups_report.sh
#
# PowerSentinel-wakeups is a standalone, read-only measurement script, so
# this runs it for real against a fake /sys/class/wakeup tree (the script
# reads its root from $WAKEUP_SYSFS for exactly this reason) and checks
# the JSON it prints: the snapshot/report delta, counters that were
# reset, sources that appear after the snapshot, same-name sources being
# summed, sources with no activity being omitted, and the "not available
# on this kernel" path - which must say so rather than invent anything.

run_tests() {
  local tmp sys state script
  tmp="$(mktemp -d)"
  sys="$tmp/wakeup"
  state="$tmp/snap"
  script="$REPO_ROOT/system/bin/PowerSentinel-wakeups"
  mkdir -p "$sys"

  mk() { # idx name wakeup_count active_time_ms
    mkdir -p "$sys/wakeup$1"
    printf '%s\n' "$2" > "$sys/wakeup$1/name"
    printf '%s\n' "$3" > "$sys/wakeup$1/wakeup_count"
    printf '%s\n' "$4" > "$sys/wakeup$1/active_time_ms"
  }
  run() { WAKEUP_SYSFS="$sys" WAKEUP_STATE="$state" JQ="$JQ" bash "$script" "$@"; }

  section "sin /sys/class/wakeup: lo dice, no inventa nada"
  assert_eq "false" "$(WAKEUP_SYSFS="$tmp/nope" WAKEUP_STATE="$state" JQ="$JQ" bash "$script" report | "$JQ" -r .available)" "directorio inexistente -> available=false"

  section "report sin snapshot previo"
  mk 0 alarmtimer 10 100
  assert_eq "no_snapshot" "$(run report | "$JQ" -r .error)" "sin snapshot, report lo indica en vez de inventar un delta"

  section "snapshot + report: solo el delta"
  mk 0 alarmtimer 10 100
  mk 1 "wlan_rx_wake" 50 2000
  mk 2 idle_source 7 30
  mk 3 same_name 5 10
  mk 4 same_name 5 10
  assert_eq "true" "$(run snapshot | "$JQ" -r .saved)" "snapshot se guarda"
  [ "$(stat -c %a "$state" 2>/dev/null || echo 600)" = "600" ]
  assert_true $? "el fichero de snapshot es 0600"

  mk 0 alarmtimer 14 160        # +4 wakeups, +60 ms
  mk 1 "wlan_rx_wake" 90 2500   # +40, +500 ms  (el mas activo)
  # idle_source sin cambios -> debe omitirse
  mk 3 same_name 6 15           # +1, +5
  mk 4 same_name 8 20           # +3, +10   (mismo nombre: se suman)
  mk 5 new_source 2 5           # aparece despues del snapshot -> base 0
  local out
  out="$(run report)"
  assert_eq "true" "$(echo "$out" | "$JQ" -r .available)" "available=true"
  assert_eq "wlan_rx_wake" "$(echo "$out" | "$JQ" -r '.sources[0].name')" "ordenado por wakeups: el mas activo primero"
  assert_eq "40" "$(echo "$out" | "$JQ" -r '.sources[0].wakeups')" "delta de wakeups real (90-50)"
  assert_eq "500" "$(echo "$out" | "$JQ" -r '.sources[0].active_ms')" "delta de tiempo activo real (2500-2000)"
  assert_eq "4" "$(echo "$out" | "$JQ" -r '[.sources[] | select(.name=="same_name")][0].wakeups')" "fuentes con el mismo nombre se suman (1+3)"
  assert_eq "0" "$(echo "$out" | "$JQ" -r '[.sources[] | select(.name=="idle_source")] | length')" "una fuente sin actividad se omite"
  assert_eq "2" "$(echo "$out" | "$JQ" -r '[.sources[] | select(.name=="new_source")][0].wakeups')" "una fuente nueva cuenta desde 0"
  assert_eq "1" "$(echo "$out" | "$JQ" -r '.elapsed_s >= 0 and .elapsed_s < 30 | if . then 1 else 0 end')" "elapsed_s es un numero razonable"

  section "contador reiniciado: nunca un delta negativo"
  mk 0 alarmtimer 3 20          # estaba en 10 al hacer el snapshot
  out="$(run report)"
  assert_eq "0" "$(echo "$out" | "$JQ" -r '[.sources[] | select(.name=="alarmtimer")] | length')" "contador que baja -> sin actividad, no negativo"
  assert_eq "0" "$(echo "$out" | "$JQ" -r '[.sources[] | select(.wakeups < 0 or .active_ms < 0)] | length')" "ningun valor negativo en la salida"

  section "salida de una sola linea y JSON valido"
  assert_single_line "$(run report)" "report imprime una sola linea"
  run report | "$JQ" -e . >/dev/null 2>&1
  assert_true $? "report es JSON valido"

  section "status: dice si hay una medicion en marcha y desde cuando"
  rm -f "$state"
  assert_eq "false" "$(run status | "$JQ" -r .measuring)" "sin snapshot: measuring=false"
  run snapshot >/dev/null
  assert_eq "true" "$(run status | "$JQ" -r .measuring)" "con snapshot: measuring=true"
  assert_true $([ "$(run status | "$JQ" -r .since)" -gt 1600000000 ] && echo 0 || echo 1) "since es la hora real del snapshot"
  assert_single_line "$(run status)" "status imprime una sola linea"

  section "argumento desconocido"
  assert_eq "usage" "$(run bogus | "$JQ" -r .error)" "un argumento desconocido da error de uso, no una espera"

  rm -rf "$tmp"
}
