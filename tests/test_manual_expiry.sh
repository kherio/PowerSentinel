#!/bin/bash
# tests/test_manual_expiry.sh
#
# Regression guard for a bug found and fixed BEFORE it ever shipped
# (v3.65.0, temporary performance mode): if manual mode gets stopped by
# any means OTHER than its own timer expiring (the normal stop button,
# a crash-recovery reconcile) before the timer runs out, the expiry
# file used to just sit there - and could later incorrectly auto-stop
# a completely different, UNTIMED manual session that happens to start
# again before the old timestamp passes. check_manual_expiry() must
# clean the file up the moment "manual" isn't active, not only when
# its own timestamp says so.
#
# PowerSentineld itself can't be `source`d directly in a test (it's a
# script meant to be executed, with real top-level side effects
# including an infinite main loop) - this extracts just the
# check_manual_expiry() function definition via sed and evals only
# that, so the test still exercises the REAL, shipped function body,
# not a reimplementation of it.

run_tests() {
  local fn_src
  fn_src="$(sed -n '/^check_manual_expiry() {/,/^}/p' "$REPO_ROOT/system/bin/PowerSentineld")"
  assert_true $([ -n "$fn_src" ] && echo 0 || echo 1) "check_manual_expiry() se pudo extraer del fichero real (si esto falla, la funcion pudo haberse renombrado o movido)"
  eval "$fn_src"

  local expiry_file
  expiry_file="$(mktemp)"
  manual_expiry_file="$expiry_file"
  log_msg() { :; }  # el logging real no es lo que se prueba aqui

  # Caso 1: manual sigue activo, y su plazo YA paso -> debe pararse y
  # limpiar el fichero.
  active_events=(manual)
  handle_event_calls=()
  handle_event() { handle_event_calls+=("$1 $2"); active_events=(); }
  echo "$(( $(date +%s) - 10 ))" > "$expiry_file"
  check_manual_expiry
  assert_eq "manual 0" "${handle_event_calls[0]:-}" "plazo cumplido y manual activo -> se llama a handle_event manual 0"
  [ -f "$expiry_file" ]
  assert_eq "1" "$?" "el fichero de expiracion se borra tras cumplirse el plazo"

  # Caso 2: manual sigue activo, plazo NO cumplido todavia -> no debe
  # tocar nada.
  echo "manual" > /dev/null
  active_events=(manual)
  handle_event_calls=()
  echo "$(( $(date +%s) + 3600 ))" > "$expiry_file"
  check_manual_expiry
  assert_eq "0" "${#handle_event_calls[@]}" "plazo NO cumplido -> no se llama a handle_event"
  [ -f "$expiry_file" ]
  assert_true $? "el fichero de expiracion sigue existiendo (todavia no toca)"

  # Caso 3 (el bug real): manual YA NO esta activo (se paro por
  # cualquier otra via) pero el fichero de expiracion, con un plazo
  # FUTURO, sigue ahi de una sesion anterior. Debe limpiarse de
  # inmediato, sin esperar a que ese plazo se cumpla - de lo contrario,
  # una sesion manual NUEVA y sin temporizador que empezase antes de
  # esa hora se pararia sola de forma inesperada.
  active_events=()
  handle_event_calls=()
  echo "$(( $(date +%s) + 3600 ))" > "$expiry_file"
  check_manual_expiry
  assert_eq "0" "${#handle_event_calls[@]}" "manual inactivo -> no se llama a handle_event (no hay nada que parar)"
  [ -f "$expiry_file" ]
  assert_eq "1" "$?" "manual inactivo -> el fichero obsoleto se limpia YA, sin esperar al plazo (el bug real que esto evita)"

  rm -f "$expiry_file"
}
