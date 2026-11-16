#!/bin/bash
# tests/test_screen_sysfs_fastpath.sh
#
# is_device screen: backlight 0 => "false" without calling dumpsys;
# anything else (>0 could be AOD, missing/garbage file) => dumpsys decides.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-detect.sh"
  local d; d="$(mktemp -d)"
  local calls="$d/calls"; : > "$calls"
  dumpsys() { echo x >> "$calls"; echo "$DUMPSYS_OUT"; }
  DUMPSYS_OUT=true
  export PS_BACKLIGHT_GLOB="$d/bl/*/brightness"
  mkdir -p "$d/bl/panel0"

  section "backlight 0: apagada sin dumpsys"
  echo 0 > "$d/bl/panel0/brightness"
  assert_eq "false" "$(is_device screen)" "brillo 0 -> false"
  assert_eq "0" "$(wc -l < "$calls" | tr -d ' ')" "no se llamo a dumpsys"

  section "backlight >0: manda dumpsys"
  echo 452 > "$d/bl/panel0/brightness"
  DUMPSYS_OUT=true;  assert_eq "true" "$(is_device screen)" "brillo 452 + dumpsys true"
  DUMPSYS_OUT=false; assert_eq "false" "$(is_device screen)" "brillo >0 pero dumpsys false (AOD) -> false"
  assert_eq "2" "$(wc -l < "$calls" | tr -d ' ')" "dumpsys consultado"

  section "sin nodo o basura: comportamiento de siempre"
  echo abc > "$d/bl/panel0/brightness"
  DUMPSYS_OUT=true; assert_eq "true" "$(is_device screen)" "basura -> dumpsys"
  rm -f "$d/bl/panel0/brightness"
  DUMPSYS_OUT=false; assert_eq "false" "$(is_device screen)" "sin fichero -> dumpsys"
  DUMPSYS_OUT=zzz; assert_eq "unknown" "$(is_device screen)" "dumpsys raro -> unknown"

  section "otros estados no usan el fast path"
  echo 0 > "$d/bl/panel0/brightness"; : > "$calls"
  DUMPSYS_OUT=true; assert_eq "true" "$(is_device charging)" "charging sigue por dumpsys"

  unset PS_BACKLIGHT_GLOB
  unset -f dumpsys
  rm -rf "$d"
}
