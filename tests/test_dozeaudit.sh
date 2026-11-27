#!/bin/bash
# tests/test_dozeaudit.sh - PowerSentinel-dozeaudit against a fixture of
# `dumpsys deviceidle whitelist`: parsing, removable flag, refusal to touch
# system exemptions / unknown or malformed package names, unavailable path.

run_tests() {
  local tmp script out
  tmp="$(mktemp -d)"; script="$REPO_ROOT/system/bin/PowerSentinel-dozeaudit"
  export DOZEAUDIT_FILE="$tmp/wl"
  cat > "$DOZEAUDIT_FILE" <<'EOT'
system-excidle,com.android.shell,2000
system,com.google.android.gms,10294
user,com.example.chat,10300
user,org.foo.sync,10301
user,com.example.chat,10300
garbage line
EOT
  section "list"
  out="$(bash "$script" list)"
  assert_valid_json "$out" "JSON valido"
  assert_eq "true" "$(printf '%s' "$out" | "$JQ" -r .available)" "disponible"
  assert_eq "4" "$(printf '%s' "$out" | "$JQ" '.apps|length')" "4 apps (duplicados fusionados, basura ignorada)"
  assert_eq "true" "$(printf '%s' "$out" | "$JQ" -r '.apps[]|select(.pkg=="org.foo.sync")|.removable')" "user -> removible"
  assert_eq "false" "$(printf '%s' "$out" | "$JQ" -r '.apps[]|select(.pkg=="com.google.android.gms")|.removable')" "system -> no removible"
  assert_eq "system-excidle" "$(printf '%s' "$out" | "$JQ" -r '.apps[]|select(.pkg=="com.android.shell")|.kind')" "kind system-excidle"

  section "remove"
  out="$(bash "$script" remove org.foo.sync)"; assert_eq "true" "$(printf '%s' "$out" | "$JQ" -r .ok)" "user: ok"
  out="$(bash "$script" remove com.google.android.gms)"; assert_eq "system_exemption" "$(printf '%s' "$out" | "$JQ" -r .error)" "system: rechazado"
  out="$(bash "$script" remove com.nope)"; assert_eq "not_exempt" "$(printf '%s' "$out" | "$JQ" -r .error)" "no exenta: rechazado"
  out="$(bash "$script" remove 'a;rm -rf /')"; assert_eq "bad_package" "$(printf '%s' "$out" | "$JQ" -r .error)" "nombre malicioso: rechazado"
  out="$(bash "$script" remove '')"; assert_eq "bad_package" "$(printf '%s' "$out" | "$JQ" -r .error)" "vacio: rechazado"

  section "sin datos"
  : > "$DOZEAUDIT_FILE"
  out="$(bash "$script" list)"; assert_eq "false" "$(printf '%s' "$out" | "$JQ" -r .available)" "volcado vacio -> no disponible"
  bash "$script" bogus 2>/dev/null; assert_eq "2" "$?" "argumento desconocido: exit 2"
  unset DOZEAUDIT_FILE
}
