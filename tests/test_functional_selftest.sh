#!/bin/bash
# tests/test_functional_selftest.sh
#
# Feature request: not just "does this file/path exist" capability
# detection, but "does this function actually behave correctly right
# now" - PowerSentinel-selftest.sh's run_functional_selftest(), run
# once at daemon boot and on demand from Diagnóstico. This test exercises
# the real function (stubbing config/detection exactly like the rest of
# this suite already does for policy.sh - see test_adaptive_tier_hysteresis.sh)
# and confirms it reports "pass" for a healthy system.

run_tests() {
  getconf() {
    case "$1" in
      adaptive_tier1_threshold) echo 20 ;;
      adaptive_tier2_threshold) echo 45 ;;
      adaptive_tier3_threshold) echo 70 ;;
      *) echo "" ;;
    esac
  }
  is_night_now() { echo false; }
  get_night_times() { :; }
  detect_battery_temp_c() { echo 25; }
  DETECT_BATTERY_LEVEL=50
  DETECT_BATTERY_CHARGING=false
  DETECT_LOAD1="0.5"

  local tmp_dir
  tmp_dir="$(mktemp -d)"

  # PowerSentinel-selftest.sh sources config.sh for its own getconf()
  # fallback - unlike this test's OTHER dependencies (policy.sh,
  # screenwake.sh, todaystats.sh, chargehealth.sh, already stubbed
  # around throughout this suite), config.sh hardcodes $JQ to the
  # bundled Android binary next to it (correct on a real device, not
  # executable on a dev machine) - so selftest.sh is sourced from a
  # copy alongside a real, working jq instead of directly from the repo.
  cp "$REPO_ROOT/system/bin/PowerSentinel-"*.sh "$tmp_dir/"
  cp "$JQ" "$tmp_dir/jq" && chmod +x "$tmp_dir/jq"

  local result
  result="$(cd "$tmp_dir" && bash -c '
    getconf() {
      case "$1" in
        adaptive_tier1_threshold) echo 20 ;;
        adaptive_tier2_threshold) echo 45 ;;
        adaptive_tier3_threshold) echo 70 ;;
        *) echo "" ;;
      esac
    }
    is_night_now() { echo false; }
    get_night_times() { :; }
    detect_battery_temp_c() { echo 25; }
    DETECT_BATTERY_LEVEL=50
    DETECT_BATTERY_CHARGING=false
    DETECT_LOAD1="0.5"
    source ./PowerSentinel-selftest.sh
    run_functional_selftest
  ' 2>/dev/null)"

  assert_valid_json "$result" "run_functional_selftest() devuelve JSON valido"

  local fail_count
  fail_count="$(printf '%s' "$result" | "$JQ" '[.[] | select(.status=="fail")] | length' 2>/dev/null)"
  assert_eq "0" "$fail_count" "en un sistema sano (config/detección simuladas correctamente) todas las comprobaciones pasan"

  local ids
  ids="$(printf '%s' "$result" | "$JQ" -r '[.[].id] | sort | join(",")' 2>/dev/null)"
  assert_eq "fn_bool_validation,fn_proc_state_check,fn_summaries,fn_tier_hysteresis,fn_tier_thresholds" "$ids" "las 5 comprobaciones funcionales esperadas estan presentes"

  rm -rf "$tmp_dir"
}
