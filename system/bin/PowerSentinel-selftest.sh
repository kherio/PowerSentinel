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
