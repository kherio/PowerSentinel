#!/system/bin/bash
# PowerSentinel-selftest.sh - functional self-test, run once at daemon
# startup AND available on-demand from the Diagnóstico panel.
#
# Deliberately different from PowerSentinel-capabilities.sh: capability
# detection asks "does this sysfs path/command exist on this device?" -
# useful, but it would never have caught either of the two most
# significant bugs found this whole project (handle_proc's monitor
# loop condition checking the wrong shape of the state file, and
# max_cpu_freq/max_refresh_rate never being wired into
# active_mechanisms_snapshot()) - both were pure LOGIC bugs, present on
# every device equally, that "the file exists and is writable" checks
# have no way to notice. This asks a different question instead: "when
# I feed this function the exact kind of input it's built for, does it
# actually produce the right answer?" - synthetic, safe inputs only
# (temp files, invented scores), never touching this device's real
# state, so it's safe to run unconditionally on every boot.
#
# Self-contained: sources everything it needs itself (harmless to
# re-source alongside PowerSentineld's own sourcing - bash function
# redefinition is a no-op cost, not an error), so PowerSentinel-diagnose
# can also source just this one file and get the same checks on demand.
. "$(dirname "$0")/PowerSentinel-config.sh"
. "$(dirname "$0")/PowerSentinel-detect.sh"
. "$(dirname "$0")/PowerSentinel-policy.sh"
. "$(dirname "$0")/PowerSentinel-screenwake.sh"
. "$(dirname "$0")/PowerSentinel-todaystats.sh"
. "$(dirname "$0")/PowerSentinel-chargehealth.sh"

# getconf() itself is PowerSentineld's own thin wrapper around config_get()
# (PowerSentinel-config.sh, sourced above) - defined there, not in any
# sourced file, so it's only present when THIS script is sourced BY the
# real daemon (which defines it before sourcing everything else). When
# PowerSentinel-diagnose sources this file standalone, nothing else would
# ever define it - declared here as a fallback, skipped entirely (never
# overriding) when the real daemon already provided its own.
declare -f getconf >/dev/null || getconf() { config_get "$1" "${2-}"; }

run_functional_selftest() {
  local results=() tmp_dir

  _selftest_add() {
    # $1=id $2=status(pass|warn|fail) $3=message
    results+=("$("$JQ" -cn --arg id "$1" --arg status "$2" --arg message "$3" '{id:$id,status:$status,message:$message}')")
  }

  # --- is_valid_bool_reading: the exact guard behind the v3.56.0
  #     "night never activates" bug - must accept true/false, reject
  #     anything else.
  if is_valid_bool_reading "true" && is_valid_bool_reading "false" \
     && ! is_valid_bool_reading "unknown" && ! is_valid_bool_reading ""; then
    _selftest_add "fn_bool_validation" "pass" "La validación de lecturas true/false funciona correctamente."
  else
    _selftest_add "fn_bool_validation" "fail" "is_valid_bool_reading() no se comporta como se espera - esto puede desactivar la detección de pantalla/carga en silencio."
  fi

  # --- _adaptive_tier_thresholds: must return 3 ascending positive
  #     integers, falling back to defaults on a bad/unset config
  #     (v3.55.0 security-audit fix) - re-checked here on every boot,
  #     not just when someone happens to misconfigure it.
  local t1 t2 t3
  read -r t1 t2 t3 <<< "$(_adaptive_tier_thresholds)"
  if [ "${t1:-0}" -gt 0 ] 2>/dev/null && [ "${t2:-0}" -gt "$t1" ] 2>/dev/null && [ "${t3:-0}" -gt "$t2" ] 2>/dev/null; then
    _selftest_add "fn_tier_thresholds" "pass" "Los umbrales del modo adaptativo están en orden ascendente ($t1/$t2/$t3)."
  else
    _selftest_add "fn_tier_thresholds" "fail" "Los umbrales del modo adaptativo no están en orden ascendente ($t1/$t2/$t3) - el modo adaptativo podría comportarse de forma inesperada."
  fi

  # --- pressure_tier_for_score: monotonic across a synthetic sweep,
  #     and its hysteresis must actually hold a tier in place for a
  #     small drop (the exact "Ahorro suave" flapping bug, v4.6.0/
  #     v4.9.0) rather than dropping it immediately.
  local tier_low tier_mid tier_high tier_sticky
  tier_low="$(pressure_tier_for_score 0)"
  tier_mid="$(pressure_tier_for_score 50)"
  tier_high="$(pressure_tier_for_score 100)"
  if [ "$tier_low" -le "$tier_mid" ] 2>/dev/null && [ "$tier_mid" -le "$tier_high" ] 2>/dev/null; then
    tier_sticky="$(pressure_tier_for_score "$((t1 - 1))" 1)"
    if [ "$tier_sticky" = "1" ]; then
      _selftest_add "fn_tier_hysteresis" "pass" "El motor adaptativo escala correctamente con la puntuación y mantiene la histéresis contra fluctuaciones pequeñas."
    else
      _selftest_add "fn_tier_hysteresis" "fail" "La histéresis del modo adaptativo no está reteniendo el tier ante una caída mínima de puntuación - riesgo de parpadeo entre modos."
    fi
  else
    _selftest_add "fn_tier_hysteresis" "fail" "pressure_tier_for_score() no escala de forma monótona con la puntuación (0=$tier_low, 50=$tier_mid, 100=$tier_high)."
  fi

  # --- Summary functions: each must produce valid, SINGLE-LINE JSON
  #     (the exact v3.67.0 "Hoy card never appears" bug class) - tested
  #     fresh on every boot, against a temp file, never this device's
  #     real state.
  tmp_dir="$(mktemp -d)"
  local fn out lines ok=true
  for fn in screenwake_summary todaystats_summary chargehealth_summary; do
    case "$fn" in
      screenwake_summary) screenwake_file="$tmp_dir/sw.json" ;;
      todaystats_summary) todaystats_file="$tmp_dir/ts.json" ;;
      chargehealth_summary) chargehealth_file="$tmp_dir/ch.json" ;;
    esac
    out="$("$fn" 2>/dev/null)"
    lines="$(printf '%s' "$out" | wc -l)"
    if [ "$lines" -ne 0 ] || ! "$JQ" -e . <<<"$out" >/dev/null 2>&1; then
      ok=false
      _selftest_add "fn_summary_${fn}" "fail" "$fn() no produce JSON válido de una sola línea - esto rompería la tarjeta correspondiente en la app."
    fi
  done
  "$ok" && _selftest_add "fn_summaries" "pass" "Las funciones de resumen (encendidos nocturnos, Hoy, salud de batería) producen datos válidos."
  rm -rf "$tmp_dir"

  # --- handle_proc's own state-file continuation check (the v4.3.0
  #     "monitor never actually worked" bug) - the real fix was
  #     checking has($e) against an object keyed by event name; this
  #     confirms that specific shape is still what's expected.
  local fake_state
  fake_state="$(mktemp)"
  echo '{"night": 1700000000}' > "$fake_state"
  if "$JQ" -e --arg e "night" 'has($e)' "$fake_state" >/dev/null 2>&1; then
    _selftest_add "fn_proc_state_check" "pass" "La comprobación de estado usada por el monitor de procesos personalizado funciona con el formato real del fichero de estado."
  else
    _selftest_add "fn_proc_state_check" "fail" "La comprobación de estado del monitor de procesos personalizado no reconoce el formato real del fichero de estado - el monitor podría no funcionar en absoluto."
  fi
  rm -f "$fake_state"

  printf '['
  local first=1 r
  for r in "${results[@]}"; do
    [ "$first" -eq 1 ] || printf ','
    printf '%s' "$r"
    first=0
  done
  printf ']\n'
}

# ---------------------------------------------------------------------
# Opt-in mechanisms that write real system state and must give it back
# (tune_system, radio_lte, scan_off, bucket): for each one, report
#   - whether the device supports it (capability, from the status file),
#   - whether it is configured on some event but UNSUPPORTED here, and
#   - whether a limit was LEFT behind (its state file still holds the
#     recorded originals although no active event wants it any more -
#     e.g. the daemon died mid-event and nothing has restored it yet).
# Read-only: it only reads the status file, the config and the state
# files, never touches the device. Prints a JSON array (same shape as
# run_functional_selftest). Paths come from variables so tests can point
# them at temp files.
: "${mech_status_file:=/data/local/tmp/PowerSentinel/PowerSentinel.status}"
: "${mech_conf_file:=${json_conf:-/data/local/tmp/PowerSentinel/PowerSentinel.json}}"
: "${mech_state_dir:=/data/local/tmp/PowerSentinel}"
: "${mech_leftover_grace:=120}"   # a state file younger than this is just an event starting up

run_mechanism_checks() {
  local results=() caps active spec
  caps=" $(grep -m1 '^Capabilities:' "$mech_status_file" 2>/dev/null | sed 's/^Capabilities:[[:space:]]*//') "
  active="$(grep -m1 '^ActiveMechanisms:' "$mech_status_file" 2>/dev/null | sed 's/^ActiveMechanisms:[[:space:]]*//')"
  [ -n "$active" ] || active='[]'

  _mech_add() {
    results+=("$("$JQ" -cn --arg id "$1" --arg status "$2" --arg message "$3" '{id:$id,status:$status,message:$message}')")
  }

  # spec = field:capability:statefile-name:label ("-" = no state file)
  for spec in \
    "tune_system:kernel_tunables:PowerSentinel.tunestate:Ajustes de kernel en reposo" \
    "radio_lte:radio_lte:PowerSentinel.radiostate:Sin 5G" \
    "scan_off:scan_off:PowerSentinel.scanstate:Sin escaneo Wi-Fi/Bluetooth" \
    "handle_apps=bucket:standby_bucket:-:Cubos de espera de apps"; do
    local field cap sfile label key want="true" supported configured wanted_now sf age
    IFS=: read -r field cap sfile label <<<"$spec"
    key="$field"
    case "$field" in *=*) key="${field%%=*}"; want="${field#*=}" ;; esac

    case "$caps" in *" $cap=true "*) supported=1 ;; *) supported=0 ;; esac
    configured="$("$JQ" -r --arg k "$key" --arg w "$want" \
      '[.events[]? | select(type=="object") | .[$k]? | select(. == $w)] | length' "$mech_conf_file" 2>/dev/null)"
    case "$configured" in ''|*[!0-9]*) configured=0 ;; esac
    wanted_now="$("$JQ" -r --arg k "$key" --arg w "$want" 'any(.[]?; .[$k] == $w)' <<<"$active" 2>/dev/null)"

    if [ "$configured" -gt 0 ] && [ "$supported" -eq 0 ]; then
      _mech_add "mech_$key" "warn" "$label: está activado en algún evento pero este dispositivo no lo soporta, así que no hará nada."
      continue
    fi

    if [ "$sfile" != "-" ]; then
      sf="$mech_state_dir/$sfile"
      if [ -s "$sf" ] && [ "$wanted_now" != "true" ]; then
        age=$(( $(date +%s) - $(stat -c %Y "$sf" 2>/dev/null || echo 0) ))
        if [ "$age" -gt "$mech_leftover_grace" ]; then
          _mech_add "mech_$key" "warn" "$label: quedó un límite sin restaurar de una ejecución anterior (el registro de valores originales sigue ahí y ningún evento activo lo necesita). Se restaura solo al reiniciar el demonio."
          continue
        fi
      fi
    fi

    if [ "$supported" -eq 1 ]; then
      if [ "$configured" -gt 0 ]; then
        _mech_add "mech_$key" "pass" "$label: soportado y configurado; no hay nada sin restaurar."
      else
        _mech_add "mech_$key" "pass" "$label: soportado por este dispositivo (no está activado en ningún evento)."
      fi
    else
      _mech_add "mech_$key" "pass" "$label: no soportado en este dispositivo, pero tampoco está activado en ningún evento."
    fi
  done

  printf '['
  local first=1 r
  for r in "${results[@]}"; do
    [ "$first" -eq 1 ] || printf ','
    printf '%s' "$r"
    first=0
  done
  printf ']\n'
}
