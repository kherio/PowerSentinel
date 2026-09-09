#!/bin/bash
# tests/test_is_device_validation.sh
#
# Regression guard for v3.56.0's CRITICAL FIX: is_device() used to call
# `dumpsys deviceidle get $1` with no stderr redirection and no
# validation of the output. If that call ever returned anything other
# than exactly "true"/"false", the classic detector's was_screen_on
# got stuck on that invalid value forever - and since was_screen_on
# being non-empty is also what gates whether change-detection runs AT
# ALL, a single bad read at boot could silently disable screen_off/
# night/thermal detection for the rest of the daemon's life. Reported
# in the wild as "night didn't activate at 23:00 as configured".
#
# This stubs `dumpsys` (a fake PATH binary, not a bash function -
# is_device() execs it as an external command, so a shell function
# override wouldn't be seen) to return controllable output, and
# exercises the REAL is_device()/is_valid_bool_reading() from
# PowerSentinel-detect.sh - nothing reimplemented here.

run_tests() {
  local fake_bin
  fake_bin="$(mktemp -d)"

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-detect.sh"

  cat > "$fake_bin/dumpsys" << 'EOF'
#!/bin/bash
case "$3" in
  screen) echo "$FAKE_SCREEN_VALUE" ;;
  charging) echo "$FAKE_CHARGING_VALUE" ;;
esac
EOF
  chmod +x "$fake_bin/dumpsys"
  local old_path="$PATH"
  PATH="$fake_bin:$PATH"

  export FAKE_SCREEN_VALUE="true"
  assert_eq "true" "$(is_device screen)" "is_device screen devuelve 'true' tal cual cuando dumpsys responde bien"

  export FAKE_SCREEN_VALUE="false"
  assert_eq "false" "$(is_device screen)" "is_device screen devuelve 'false' tal cual"

  export FAKE_SCREEN_VALUE=""
  assert_eq "unknown" "$(is_device screen)" "dumpsys sin salida -> 'unknown', nunca una cadena vacia que se confunda con 'nunca inicializado'"

  export FAKE_SCREEN_VALUE="Error: could not access the DeviceIdleController"
  assert_eq "unknown" "$(is_device screen)" "salida de error de dumpsys -> 'unknown', nunca se cuela como si fuera un booleano real"

  export FAKE_CHARGING_VALUE="garbage_output"
  assert_eq "unknown" "$(is_device charging)" "charging con salida irreconocible -> 'unknown'"

  is_valid_bool_reading "true"; assert_true $? "is_valid_bool_reading acepta 'true'"
  is_valid_bool_reading "false"; assert_true $? "is_valid_bool_reading acepta 'false'"
  is_valid_bool_reading "unknown"
  assert_eq "1" "$?" "is_valid_bool_reading RECHAZA 'unknown' - este es el guard que evita que se persista y bloquee la deteccion para siempre"

  PATH="$old_path"
  rm -rf "$fake_bin"
}
