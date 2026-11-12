#!/bin/bash
# tests/test_notify_language.sh
#
# The daemon's notifications follow the `language` global (auto|es|en);
# "auto" follows Android's locale and, with no locale readable, stays
# Spanish (the behaviour before this existed). Runs the real
# _build_active_mode_text / alert text helpers from alertbridge.sh.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-alertbridge.sh"

  active_mechanisms_snapshot() { echo "$FAKE_SNAPSHOT"; }
  FAKE_SNAPSHOT='[{"event":"night","handle_apps":"bucket","handle_cores":"auto","doze":"true","handle_gms":"false","kill_wifi":"false","low_ram":"false","restrict_data":"false","tune_system":"true","max_cpu_freq":"50","max_refresh_rate":"60"}]'

  LANG_CFG=auto; PROP=""
  getconf() { [ "$1" = language ] && echo "$LANG_CFG" || echo "${2-}"; }
  getprop() { echo "$PROP"; }

  section "auto sin locale legible -> castellano (comportamiento de siempre)"
  assert_eq "Noche|CPU en ahorro · apps en 2º plano restringidas · Doze forzado · ajustes de kernel en reposo · CPU al 50% · pantalla a 60Hz" "$(_build_active_mode_text)" "sin locale: castellano"

  section "auto con locale del sistema"
  PROP="es-ES"; assert_eq "es" "$(_ps_lang)" "es-ES -> es"
  PROP="en-US"; assert_eq "en" "$(_ps_lang)" "en-US -> en"
  PROP="fr-FR"; assert_eq "en" "$(_ps_lang)" "otro idioma -> ingles"

  section "language explicito gana al locale"
  PROP="es-ES"; LANG_CFG=en
  assert_eq "Night|CPU in power-save · background apps restricted · Doze forced · kernel idle tuning · CPU at 50% · screen at 60Hz" "$(_build_active_mode_text)" "language=en"
  assert_eq "Light saving" "$(_event_display_name adaptive_tier1)" "nombre de evento en ingles"
  assert_eq "mi_evento" "$(_event_display_name mi_evento)" "evento custom tal cual"
  PROP="en-US"; LANG_CFG=es
  assert_eq "Ahorro suave" "$(_event_display_name adaptive_tier1)" "language=es gana a locale en"

  section "language invalido en config.sh cae al valor por defecto"
  # shellcheck disable=SC1090
  ( source "$REPO_ROOT/system/bin/PowerSentinel-config.sh"
    config_get_raw() { echo "klingon"; }
    [ "$(config_get language auto)" = "auto" ] ) && assert_eq 0 0 "valor invalido -> auto" || assert_eq 0 1 "valor invalido -> auto"
}
