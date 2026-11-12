#!/bin/bash
# tests/test_service_fresh_install_launch.sh
#
# Regression guard for the fresh-install deadlock in service.sh: the
# launch lock is a plain `mkdir` (atomic on purpose, so NOT `mkdir -p`),
# which fails when its parent directory doesn't exist - and that parent
# is created by the very daemon the lock guards. On a device that had
# never run PowerSentinel, the daemon was therefore never launched
# (found on a real device: no status file, config or log at all).
#
# service.sh blocks in a boot-wait loop at top level, so it can't just be
# sourced; this extracts its two real functions with sed, points the
# paths at a temp tree and replaces the one absolute /system/bin/bash
# launch line with a marker write (that path doesn't exist on a dev
# machine). Everything else - the lock logic - is the shipped code.

run_tests() {
  local tmp marker script
  tmp="$(mktemp -d)"
  marker="$tmp/launched"
  script="$tmp/fn.sh"

  {
    sed -n '/^is_daemon_running()/,/^}/p' "$REPO_ROOT/service.sh"
    sed -n '/^launch_daemon_if_needed()/,/^}/p' "$REPO_ROOT/service.sh" \
      | sed "s#/system/bin/bash /system/bin/PowerSentineld &#echo launched >> \"$marker\"#"
  } > "$script"

  section "el codigo extraido contiene de verdad la logica de lock"
  grep -q 'mkdir "\$LOCKDIR"' "$script"
  assert_true $? "la funcion extraida incluye el mkdir del lock"
  grep -q 'echo launched' "$script"
  assert_true $? "y el lanzamiento del demonio fue sustituido por el marcador"

  section "instalacion limpia: el directorio de datos NO existe todavia"
  PIDFILE="$tmp/data/PowerSentineld.pid"
  LOCKDIR="$tmp/data/.daemon_launch.lock"
  # shellcheck disable=SC1090
  source "$script"
  [ -d "$tmp/data" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "precondicion: el directorio padre no existe"
  launch_daemon_if_needed
  [ -s "$marker" ]
  assert_true $? "aun asi el demonio se lanza (este era el bug: nunca arrancaba)"
  [ -d "$LOCKDIR" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "y el lock se libera al terminar"

  section "instalacion existente: sigue funcionando igual"
  rm -f "$marker"
  launch_daemon_if_needed
  [ -s "$marker" ]
  assert_true $? "con el directorio ya creado tambien lanza"

  section "el lock sigue siendo exclusivo: si alguien ya lo tiene, no se lanza nada"
  rm -f "$marker"
  mkdir "$LOCKDIR"
  launch_daemon_if_needed
  [ -f "$marker" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "con el lock tomado por otro, no se lanza una segunda instancia"
  rmdir "$LOCKDIR"

  rm -rf "$tmp"
}
