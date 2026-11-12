#!/bin/bash
# tests/test_apps_bucket_ownership.sh
#
# Regression guard for the "bucket" level of handle_apps (App Standby
# Bucket "restricted", v4.17.0). Built to the same ownership contract as
# nice/suspend in action_apps_apply/undo, so this mirrors the bug
# classes those already had to be fixed for: (1) only restore what
# PowerSentinel itself changed, (2) never undo while another active
# event still wants the app handled, (3) the capability gate must stop
# the attempt, plus the two bucket-specific ones: (4) buckets that must
# never be touched (exempted / never-used / already restricted), and
# (5) never overwrite a newer bucket the system chose by itself.
#
# `am`, `pm` and `pgrep` are real Android binaries this daemon shells out
# to - stubbed as shell functions (bash resolves a function before PATH),
# recording every call and simulating the bucket state per package.

run_tests() {
  local tmp REAL_JQ="$JQ"
  tmp="$(mktemp -d)"
  apps_ownership_file="$tmp/appstate"
  app_policy_file="$tmp/apppolicy"
  allowlist="$tmp/allow"; : > "$allowlist"
  denylist="$tmp/nodeny"
  json_conf="$tmp/PowerSentinel.json"
  echo '{"global":{},"events":{}}' > "$json_conf"

  log_msg() { :; }
  emit() { :; }
  is_critical_app() { return 1; }
  pgrep() { return 0; }

  declare -A BUCKET=()
  AM_SETS=()
  PKGS="com.a.frequent com.b.rare com.c.exempt com.d.never com.e.restricted com.f.active"
  pm() { [ "$1" = "list" ] && for p in $PKGS; do echo "package:$p"; done; }
  am() {
    case "$1" in
      get-standby-bucket) echo "${BUCKET[$2]:-}" ;;
      set-standby-bucket)
        AM_SETS+=("$2 $3")
        case "$3" in
          restricted) BUCKET[$2]=45 ;; active) BUCKET[$2]=10 ;;
          working_set) BUCKET[$2]=20 ;; frequent) BUCKET[$2]=30 ;;
          rare) BUCKET[$2]=40 ;;
        esac
        ;;
    esac
  }
  reset_buckets() {
    BUCKET=([com.a.frequent]=30 [com.b.rare]=40 [com.c.exempt]=5 [com.d.never]=50 [com.e.restricted]=45 [com.f.active]=10)
    AM_SETS=()
    rm -f "$apps_ownership_file"
  }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-apppolicy.sh"
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"

  event="night"; active_events=(night)
  handle_apps="bucket"
  config_get_event_raw() { echo "false"; }

  section "capability gate"
  reset_buckets
  capability_has() { return 1; }
  action_apps_apply
  assert_eq "0" "${#AM_SETS[@]}" "sin la capacidad standby_bucket no se llama a set-standby-bucket"
  [ -f "$apps_ownership_file" ]
  assert_true $([ $? -eq 1 ] && echo 0 || echo 1) "sin la capacidad tampoco se crea el fichero de ownership"

  section "apply: solo toca los buckets 20/30/40"
  reset_buckets
  capability_has() { return 0; }
  action_apps_apply
  assert_eq "2" "${#AM_SETS[@]}" "solo 2 apps (frecuente y rara) pasan a restricted"
  assert_eq "45" "${BUCKET[com.a.frequent]}" "la app frecuente queda en restricted"
  assert_eq "45" "${BUCKET[com.b.rare]}" "la app rara queda en restricted"
  assert_eq "5" "${BUCKET[com.c.exempt]}" "una app exenta (5) no se toca"
  assert_eq "50" "${BUCKET[com.d.never]}" "una app nunca usada (50) no se toca"
  assert_eq "10" "${BUCKET[com.f.active]}" "una app en active (10, el usuario la esta usando) no se toca"
  assert_eq "frequent" "$("$JQ" -r '.["com.a.frequent"].bucket_orig as $b | if $b == "30" then "frequent" else $b end' "$apps_ownership_file")" "se registra el bucket ORIGINAL real (30)"
  assert_eq "bucket" "$("$JQ" -r '.["com.a.frequent"].action' "$apps_ownership_file")" "la accion registrada es bucket"
  assert_eq "null" "$("$JQ" -r '.["com.e.restricted"]' "$apps_ownership_file")" "una app que ya estaba restricted no se registra como nuestra"

  section "reentrada: un segundo apply no re-graba el original"
  AM_SETS=()
  action_apps_apply
  assert_eq "0" "${#AM_SETS[@]}" "un segundo apply no vuelve a llamar a set-standby-bucket"
  assert_eq "30" "$("$JQ" -r '.["com.a.frequent"].bucket_orig' "$apps_ownership_file")" "el original (30) no se sobreescribe con 45"

  section "composicion: otro evento activo quiere gestionar apps - undo no restaura"
  config_get_event_raw() { echo "bucket"; }
  active_events=(night screen_off)
  AM_SETS=()
  action_apps_undo
  assert_eq "0" "${#AM_SETS[@]}" "con otro evento activo que aun lo quiere, no se restaura nada"
  assert_eq "45" "${BUCKET[com.a.frequent]}" "la app sigue restricted"

  section "undo: sin otro evento, se restaura el bucket original"
  config_get_event_raw() { echo "false"; }
  active_events=(night)
  AM_SETS=()
  action_apps_undo
  assert_eq "30" "${BUCKET[com.a.frequent]}" "la app frecuente vuelve a 30"
  assert_eq "40" "${BUCKET[com.b.rare]}" "la app rara vuelve a 40"
  assert_eq "45" "${BUCKET[com.e.restricted]}" "la que ya estaba restricted antes sigue igual"
  assert_eq "{}" "$("$JQ" -c . "$apps_ownership_file")" "el fichero de ownership queda vacio tras el undo"

  section "undo no pisa un bucket que el sistema ya cambio solo"
  reset_buckets
  action_apps_apply
  BUCKET[com.a.frequent]=10   # el usuario abrio la app: Android la subio a active
  AM_SETS=()
  action_apps_undo
  assert_eq "10" "${BUCKET[com.a.frequent]}" "el bucket nuevo elegido por el sistema no se sobreescribe"
  assert_eq "40" "${BUCKET[com.b.rare]}" "las demas apps si se restauran"

  section "politica por app"
  reset_buckets
  apppolicy_set com.a.frequent 1
  assert_eq "bucket" "$(apppolicy_effective_action com.a.frequent bucket)" "nivel 1 deja pasar bucket (no mata ni congela nada)"
  assert_eq "nice" "$(apppolicy_effective_action com.a.frequent kill)" "nivel 1 sigue limitando kill a nice"
  apppolicy_set com.a.frequent 0
  assert_eq "false" "$(apppolicy_effective_action com.a.frequent bucket)" "nivel 0 nunca toca la app"
  apppolicy_set com.a.frequent 3
  assert_eq "suspend" "$(apppolicy_effective_action com.a.frequent bucket)" "nivel 3 fuerza suspend como siempre"

  section "validacion de config"
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-config.sh"
  JQ="$REAL_JQ"
  PS_CONFIG=([handle_apps]=bucket [handle_gms]=bucket)
  assert_eq "bucket" "$(config_get handle_apps false)" "handle_apps acepta bucket"
  assert_eq "false" "$(config_get handle_gms false)" "handle_gms NO acepta bucket"

  rm -rf "$tmp"
}
