#!/bin/bash
# tests/test_mechanism_checks.sh
#
# run_mechanism_checks() (PowerSentinel-selftest.sh, shown in Diagnóstico):
# for tune_system / radio_lte / scan_off / bucket it must report support,
# warn when a mechanism is configured but unsupported, and warn when a
# state file (recorded originals) was LEFT behind with no active event
# wanting it - but not for a fresh state file (event just starting) nor
# while an active event still wants it. Read-only; paths are variables.

run_tests() {
  local root
  root="$(mktemp -d)"
  cp "$REPO_ROOT/system/bin/PowerSentinel-"*.sh "$root/"
  cp "$JQ" "$root/jq" && chmod +x "$root/jq"
  mkdir -p "$root/data"

  # $1 = capabilities line, $2 = ActiveMechanisms json, $3 = conf json
  run() {
    printf 'Capabilities: %s\nActiveMechanisms: %s\n' "$1" "$2" > "$root/data/status"
    echo "$3" > "$root/data/conf.json"
    (cd "$root" && bash -c '
      getconf() { echo ""; }
      mech_status_file="$1/data/status"; mech_conf_file="$1/data/conf.json"; mech_state_dir="$1/data"
      source ./PowerSentinel-selftest.sh
      run_mechanism_checks
    ' _ "$root" 2>/dev/null)
  }
  st() { printf '%s' "$1" | "$JQ" -r --arg id "$2" '.[] | select(.id==$id) | .status'; }
  ALLCAPS="standby_bucket=true kernel_tunables=true radio_lte=true scan_off=true"
  NOCONF='{"global":{},"events":{"night":{}}}'

  section "sistema sano: todo soportado, nada configurado, nada pendiente"
  out="$(run "$ALLCAPS" '[]' "$NOCONF")"
  assert_valid_json "$out" "devuelve JSON valido"
  assert_eq "4" "$(printf '%s' "$out" | "$JQ" 'length')" "una fila por mecanismo"
  assert_eq "0" "$(printf '%s' "$out" | "$JQ" '[.[]|select(.status!="pass")]|length')" "todas en pass"

  section "configurado pero no soportado: aviso"
  out="$(run "kernel_tunables=true standby_bucket=true" '[]' '{"events":{"night":{"radio_lte":"true"}}}')"
  assert_eq "warn" "$(st "$out" mech_radio_lte)" "radio_lte configurado sin capacidad -> warn"
  assert_eq "pass" "$(st "$out" mech_scan_off)" "scan_off sin capacidad pero sin configurar -> pass"

  section "un valor false no cuenta como configurado"
  out="$(run "kernel_tunables=true standby_bucket=true" '[]' '{"events":{"night":{"radio_lte":"false"}}}')"
  assert_eq "pass" "$(st "$out" mech_radio_lte)" "radio_lte=false sin capacidad -> pass, no warn"

  section "bucket se detecta por handle_apps=bucket"
  out="$(run "kernel_tunables=true" '[]' '{"events":{"night":{"handle_apps":"bucket"}}}')"
  assert_eq "warn" "$(st "$out" mech_handle_apps)" "bucket configurado sin standby_bucket -> warn"
  out="$(run "$ALLCAPS" '[]' '{"events":{"night":{"handle_apps":"kill"}}}')"
  assert_eq "pass" "$(st "$out" mech_handle_apps)" "otro modo de apps no cuenta como bucket"

  section "limite olvidado: registro viejo y ningun evento activo lo quiere"
  echo "wifi_scan_always_enabled 1" > "$root/data/PowerSentinel.scanstate"
  touch -d '10 minutes ago' "$root/data/PowerSentinel.scanstate"
  out="$(run "$ALLCAPS" '[]' "$NOCONF")"
  assert_eq "warn" "$(st "$out" mech_scan_off)" "registro antiguo sin evento activo -> warn"
  assert_eq "pass" "$(st "$out" mech_radio_lte)" "los demas mecanismos no se contagian"

  section "registro antiguo pero un evento activo todavia lo quiere: pass"
  out="$(run "$ALLCAPS" '[{"event":"night","scan_off":"true"}]' "$NOCONF")"
  assert_eq "pass" "$(st "$out" mech_scan_off)" "con un evento activo que lo usa, no hay nada olvidado"

  section "registro recien creado (evento arrancando): pass"
  touch "$root/data/PowerSentinel.scanstate"
  out="$(run "$ALLCAPS" '[]' "$NOCONF")"
  assert_eq "pass" "$(st "$out" mech_scan_off)" "dentro del margen de gracia no se avisa"

  section "cada mecanismo mira su propio fichero"
  rm -f "$root/data/PowerSentinel.scanstate"
  for pair in tune_system:PowerSentinel.tunestate radio_lte:PowerSentinel.radiostate; do
    echo "x 1" > "$root/data/${pair#*:}"; touch -d '10 minutes ago' "$root/data/${pair#*:}"
    out="$(run "$ALLCAPS" '[]' "$NOCONF")"
    assert_eq "warn" "$(st "$out" "mech_${pair%%:*}")" "${pair%%:*}: su registro olvidado -> warn"
    rm -f "$root/data/${pair#*:}"
  done

  rm -rf "$root"
}
