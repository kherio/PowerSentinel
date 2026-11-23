#!/bin/bash
# tests/test_log_before_unlock.sh
#
# The daemon now starts before the first unlock, when /sdcard (the default
# log location) does not exist yet. Lines must be kept in the early log and
# land, in order, in the real log once the directory appears; the previous
# log must still be rotated exactly once; the early log is capped; a log
# on a path that exists behaves like before.

run_tests() {
  local tmp; tmp="$(mktemp -d)"
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-log.sh"
  LOG_EARLY_FILE="$tmp/early.log"
  log_level=3

  section "antes del desbloqueo: el directorio del log no existe"
  log_file="$tmp/sdcard/PowerSentinel.log"
  log_reset
  log_msg 1 "primera linea"
  log_msg 3 "segunda linea"
  assert_eq "2" "$(wc -l < "$LOG_EARLY_FILE" | tr -d ' ')" "dos lineas en el log temporal"
  assert_eq "false" "$([ -e "$log_file" ] && echo true || echo false)" "no se crea el log definitivo"

  section "tras el desbloqueo: se rota el log anterior y se vuelcan las lineas en orden"
  mkdir -p "$tmp/sdcard"
  echo "linea vieja" > "$log_file"
  log_msg 1 "tercera linea"
  assert_eq "linea vieja" "$(head -n1 "$log_file.old")" "el log anterior se rota"
  assert_eq "3" "$(wc -l < "$log_file" | tr -d ' ')" "tres lineas en el log nuevo"
  assert_contains "$(sed -n 1p "$log_file")" "primera linea" "orden: primera"
  assert_contains "$(sed -n 2p "$log_file")" "segunda linea" "orden: segunda"
  assert_contains "$(sed -n 3p "$log_file")" "tercera linea" "orden: tercera"
  assert_eq "false" "$([ -e "$LOG_EARLY_FILE" ] && echo true || echo false)" "el log temporal se borra"
  log_msg 1 "cuarta"
  assert_eq "4" "$(wc -l < "$log_file" | tr -d ' ')" "siguientes lineas se anaden sin rotar de nuevo"
  assert_eq "linea vieja" "$(head -n1 "$log_file.old")" "el .old sigue siendo el de antes"

  section "directorio ya existente (ruta en /data): igual que siempre"
  log_file="$tmp/data/PowerSentinel.log"; mkdir -p "$tmp/data"
  echo "anterior" > "$log_file"
  log_reset
  log_msg 1 "arranque"
  assert_eq "anterior" "$(head -n1 "$log_file.old")" "rota en la primera escritura"
  assert_eq "1" "$(wc -l < "$log_file" | tr -d ' ')" "solo la linea nueva"
  assert_eq "false" "$([ -e "$LOG_EARLY_FILE" ] && echo true || echo false)" "no se usa el log temporal"

  section "nivel de log: se respeta"
  log_level=1
  log_msg 3 "debug no debe salir"
  assert_eq "1" "$(wc -l < "$log_file" | tr -d ' ')" "debug filtrado con nivel 1"
  log_level=3

  section "log temporal acotado"
  log_file="$tmp/never/PowerSentinel.log"
  LOG_EARLY_MAX_LINES=5
  log_reset
  local i
  for i in 1 2 3 4 5 6 7 8 9; do log_msg 1 "l$i"; done
  assert_eq "5" "$(wc -l < "$LOG_EARLY_FILE" | tr -d ' ')" "tope de lineas respetado"

  section "service.sh ya no espera a /sdcard"
  assert_eq "0" "$(grep -v '^ *#' "$REPO_ROOT/service.sh" | grep -c '/sdcard')" "service.sh no depende de /sdcard"
  assert_contains "$(grep -v '^ *#' "$REPO_ROOT/service.sh" | head -n12)" 'sys.boot_completed' "sigue esperando al fin del arranque"

  rm -rf "$tmp"
}
