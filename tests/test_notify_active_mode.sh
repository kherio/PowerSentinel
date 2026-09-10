#!/bin/bash
# tests/test_notify_active_mode.sh
#
# Verifies PowerSentinel-alertbridge.sh's _build_active_mode_text() -
# the text builder behind the new opt-in "show current mode in
# notifications" feature. Built entirely from active_mechanisms_
# snapshot()'s own JSON shape (events.sh) - the same data the WebUI's
# "active now" card already uses - stubbed here rather than exercising
# the real function, since this test is specifically about the text-
# building logic, not event resolution (already covered elsewhere).

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-alertbridge.sh"

  active_mechanisms_snapshot() { echo "$FAKE_SNAPSHOT"; }

  FAKE_SNAPSHOT='[]'
  local result
  result="$(_build_active_mode_text)"
  assert_eq "" "$result" "sin eventos activos, no genera texto (nada que mostrar)"

  FAKE_SNAPSHOT='[{"event":"night","handle_apps":"nice","handle_cores":"auto","doze":"false","handle_gms":"false","kill_wifi":"false","low_ram":"false","max_cpu_freq":"50","max_refresh_rate":"60"}]'
  result="$(_build_active_mode_text)"
  assert_eq "Noche|CPU en ahorro · apps en 2º plano ralentizadas · CPU al 50% · pantalla a 60Hz" "$result" "un evento con varios mecanismos genera titulo y cuerpo correctos"

  FAKE_SNAPSHOT='[{"event":"night","handle_apps":"nice","handle_cores":"false","doze":"false","handle_gms":"false","kill_wifi":"false","low_ram":"false","max_cpu_freq":"false","max_refresh_rate":"false"},{"event":"screen_off","handle_apps":"kill","handle_cores":"false","doze":"light","handle_gms":"false","kill_wifi":"true","low_ram":"false","max_cpu_freq":"false","max_refresh_rate":"false"}]'
  result="$(_build_active_mode_text)"
  assert_eq "Noche, Pantalla apagada|apps en 2º plano gestionadas · Doze forzado · WiFi apagado" "$result" "dos eventos simultaneos se combinan en un solo titulo y cuerpo, sin duplicar frases"

  assert_eq "Noche" "$(_event_display_name night)" "nombre legible de evento predefinido"
  assert_eq "mi_evento_custom" "$(_event_display_name mi_evento_custom)" "evento no predefinido se muestra tal cual"
}
