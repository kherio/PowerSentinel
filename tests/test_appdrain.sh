#!/bin/bash
# tests/test_appdrain.sh
#
# PowerSentinel-appdrain runs for real against fixture copies of the
# `dumpsys batterystats` UID lines (real OnePlus 11 output) and of
# `pm list packages -U`: package mapping, the "shared uid" flag, system
# uids skipped, the snapshot diff (and a statistics reset in between), the
# threshold, and the "not available" path. Read-only: it must never call
# anything that resets the system statistics.

run_tests() {
  local tmp script
  tmp="$(mktemp -d)"
  script="$REPO_ROOT/system/bin/PowerSentinel-appdrain"
  export APPDRAIN_STATE="$tmp/snap" APPDRAIN_STATS_FILE="$tmp/stats" APPDRAIN_PKG_FILE="$tmp/pkgs"

  cat > "$tmp/stats" <<'EOF'
  UID 0: 303 bg: 303
  UID u0a538: 334 fg: 79.1 (1h 15m 45s 281ms) bg: 109 (52m 51s 800ms) fgs: 0.287 (3s 369ms) cached: 3.58 (6h 18m 52s 962ms)
  UID u0a548: 318 fg: 104 (1h 14m 20s 581ms) bg: 5.08 (11s 639ms) cached: 69.8 (6h 30m 36s 302ms)
  UID 1000: 182 bg: 182
  UID u0a294: 111 bg: 29.6 (1h 23m 4s 513ms) fgs: 81.8 (7h 6m 22s 545ms)
  UID u0a999: 0.01 bg: 0.01
  UID u0a77: 0.0420 bg: 0.0242 (156ms) cached: 0.0178 (1m 25s 71ms)
EOF
  cat > "$tmp/pkgs" <<'EOF'
package:com.instapro.android uid:10538
package:com.twitter.android uid:10548
package:com.google.android.gms uid:10294
package:com.google.android.gsf uid:10294
package:android uid:1000
package:com.tiny.app uid:10077
package:com.zero.app uid:10999
package:bad;name uid:10538
EOF

  section "sin snapshot: desde la ultima carga, mapeado a paquetes"
  local out
  out="$(bash "$script" report)"
  assert_eq "charge" "$(echo "$out" | "$JQ" -r .window)" "ventana: charge"
  assert_eq "com.instapro.android" "$(echo "$out" | "$JQ" -r '.apps[0].pkg')" "el mayor primero"
  assert_eq "334" "$(echo "$out" | "$JQ" -r '.apps[0].mah | floor')" "mAh del paquete"
  assert_eq "109" "$(echo "$out" | "$JQ" -r '.apps[0].bg | floor')" "segundo plano"
  assert_eq "2" "$(echo "$out" | "$JQ" -r '.apps[] | select(.pkg=="com.google.android.gms") | .shared')" "uid compartido marcado"
  assert_eq "0" "$(echo "$out" | "$JQ" '[.apps[] | select(.pkg=="android")] | length')" "uids de sistema (0, 1000) no se mapean"
  assert_eq "0" "$(echo "$out" | "$JQ" '[.apps[] | select(.pkg=="com.zero.app")] | length')" "bajo 0.1 mAh se omite"
  assert_eq "0" "$(echo "$out" | "$JQ" '[.apps[] | select(.pkg=="bad;name")] | length')" "nombre de paquete raro descartado"

  section "snapshot + report: solo lo gastado desde entonces"
  bash "$script" snapshot > "$tmp/snapout"
  assert_eq "true" "$(< "$tmp/snapout" "$JQ" -r .available)" "snapshot disponible"
  sed -i 's/UID u0a538: 334 fg: 79.1 (1h 15m 45s 281ms) bg: 109/UID u0a538: 340.5 fg: 79.1 (1h 15m 45s 281ms) bg: 115.4/' "$tmp/stats"
  out="$(bash "$script" report)"
  assert_eq "snapshot" "$(echo "$out" | "$JQ" -r .window)" "ventana: snapshot"
  assert_eq "1" "$(echo "$out" | "$JQ" '.apps | length')" "solo la app que gasto algo desde el snapshot"
  assert_eq "true" "$(echo "$out" | "$JQ" '.apps[0].mah == 6.5')" "diferencia de mAh"
  assert_eq "true" "$(echo "$out" | "$JQ" '.apps[0].bg == 6.4')" "diferencia en segundo plano"

  section "estadisticas reiniciadas por Android: nunca un valor negativo"
  sed -i 's/UID u0a548: 318 fg: 104/UID u0a548: 2.5 fg: 1.0/' "$tmp/stats"
  out="$(bash "$script" report)"
  assert_eq "true" "$(echo "$out" | "$JQ" '.apps[] | select(.pkg=="com.twitter.android") | .mah == 2.5')" "contador menor que el snapshot: se usa el valor actual"
  assert_eq "0" "$(echo "$out" | "$JQ" '[.apps[] | select(.mah < 0)] | length')" "ningun negativo"

  section "sin datos de Android: lo dice"
  : > "$tmp/stats"
  assert_eq "false" "$(bash "$script" report | "$JQ" -r .available)" "report: no disponible"
  assert_eq "false" "$(bash "$script" snapshot | "$JQ" -r .available)" "snapshot: no disponible"

  section "solo lectura: no reinicia estadisticas del sistema"
  assert_eq "0" "$(grep -c -- '--reset' "$script")" "el script no contiene --reset"

  unset APPDRAIN_STATE APPDRAIN_STATS_FILE APPDRAIN_PKG_FILE
  rm -rf "$tmp"
}
