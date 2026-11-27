#!/bin/bash
# tests/test_nightreport.sh
#
# Night report hooks: only the "night" event; snapshot at start (into its
# OWN files), report at end with duration/battery levels and the top apps;
# too-short nights and missing baselines are discarded; observation only.

run_tests() {
  local tmp; tmp="$(mktemp -d)"
  nightreport_dir="$tmp"; nightreport_base="$tmp/base"; nightreport_meta="$tmp/meta"; nightreport_file="$tmp/report.json"
  NIGHTREPORT_BIN="$tmp/bin"; mkdir -p "$NIGHTREPORT_BIN"
  cat > "$NIGHTREPORT_BIN/PowerSentinel-appdrain" <<'EOT'
#!/bin/bash
case "$1" in
  snapshot) echo "1000" > "$APPDRAIN_STATE"; echo '{"available":true}' ;;
  report) echo '{"available":true,"window":"snapshot","since":1000,"elapsed_s":3600,"apps":[{"pkg":"com.a","mah":40,"fg":0,"bg":40,"cached":0,"shared":1},{"pkg":"com.b","mah":10,"fg":1,"bg":9,"cached":0,"shared":1}]}' ;;
esac
EOT
  chmod +x "$NIGHTREPORT_BIN/PowerSentinel-appdrain"
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-nightreport.sh"
  NIGHTREPORT_MIN_S=0
  DETECT_BATTERY_LEVEL=90

  section "otro evento: no hace nada"
  nightreport_start screen_off; wait
  [ -e "$nightreport_meta" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "sin meta para otros eventos"

  section "inicio de la noche: baseline propio y nivel"
  nightreport_start night; wait
  assert_true $([ -s "$nightreport_base" ] && echo 0 || echo 1) "baseline guardado en su fichero"
  assert_eq "90" "$(awk '{print $2}' "$nightreport_meta")" "nivel inicial"

  section "fin de la noche: informe"
  DETECT_BATTERY_LEVEL=84
  nightreport_end night; wait
  assert_valid_json "$(cat "$nightreport_file")" "informe JSON valido"
  assert_eq "90" "$("$JQ" .level_start "$nightreport_file")" "nivel inicial en el informe"
  assert_eq "84" "$("$JQ" .level_end "$nightreport_file")" "nivel final"
  assert_eq "com.a" "$("$JQ" -r '.apps[0].pkg' "$nightreport_file")" "apps ordenadas por consumo"
  assert_eq "2" "$("$JQ" '.apps|length' "$nightreport_file")" "apps incluidas"
  assert_eq "false" "$([ -e "$nightreport_base" ] || [ -e "$nightreport_meta" ] && echo true || echo false)" "se limpian baseline y meta"

  section "noche demasiado corta: se descarta"
  rm -f "$nightreport_file"; NIGHTREPORT_MIN_S=99999
  nightreport_start night; wait; nightreport_end night; wait
  [ -e "$nightreport_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "sin informe"
  NIGHTREPORT_MIN_S=0

  section "fin sin inicio / sin baseline: nada"
  nightreport_end night; wait
  [ -e "$nightreport_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "sin meta: nada"
  echo "1 90" > "$nightreport_meta"; rm -f "$nightreport_base"; nightreport_end night; wait
  [ -e "$nightreport_file" ]; assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "sin baseline: nada"
}
