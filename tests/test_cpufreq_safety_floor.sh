#!/bin/bash
# tests/test_cpufreq_safety_floor.sh
#
# Regression guard for feedback received directly: the CPU speed limit
# feature had no floor at all against an extreme value (a hand-edited
# raw config, or any future preset this project might add) - action_
# cpufreq_apply() must never cap any core below 30% of its real max,
# since below that even ordinary UI interaction starts to feel broken
# rather than just slower. Also covers the "already-selected value is
# a valid preset" cases so the floor logic can't accidentally alter
# them.

run_tests() {
  local fake_bin cpu_path
  fake_bin="$(mktemp -d)"
  cpu_path="$fake_bin/sys/devices/system/cpu/cpu0/cpufreq"
  mkdir -p "$cpu_path"
  echo "2400000" > "$cpu_path/cpuinfo_max_freq"

  cpu_base_path="$fake_bin/sys/devices/system/cpu"
  active_events=(night)
  event=night
  config_get_event_raw() { echo "false"; }
  log_msg() { :; }
  emit() { :; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"

  local case_val expected_pct applied applied_pct
  for case_val_expected in "15:30" "29:30" "30:30" "50:50" "100:100"; do
    case_val="${case_val_expected%%:*}"
    expected_pct="${case_val_expected##*:}"
    echo "2400000" > "$cpu_path/scaling_max_freq"
    cpufreq_orig_file="$fake_bin/cpufreqorig_$case_val.json"
    max_cpu_freq="$case_val"
    action_cpufreq_apply
    applied="$(cat "$cpu_path/scaling_max_freq")"
    applied_pct=$(( applied * 100 / 2400000 ))
    assert_eq "$expected_pct" "$applied_pct" "max_cpu_freq=$case_val aplica ~${expected_pct}% del maximo (suelo de seguridad: nunca por debajo de 30%)"
  done

  rm -rf "$fake_bin"
}
