#!/bin/bash
# tests/test_cores_never_zero_online.sh
#
# CRITICAL regression guard for a real bug found while reviewing CPU
# mechanisms for anything that could leave the device "prácticamente
# inutilizable": action_cores_apply()'s disable_cores=auto path had no
# check for "would this leave zero cores online system-wide". On a
# big.LITTLE SoC this can't happen in practice (hp_cpus/lp_cpus are
# always disjoint), but on a SYMMETRIC CPU - every core sharing the
# same max frequency, nothing to distinguish a "high power" cluster -
# auto_map_cores() classifies EVERY core as high-power, so
# disable_cores=auto would attempt to take every single core offline:
# a fully hung device requiring a hard reboot, not just a slow one.
# This is categorically the most severe failure mode this project has
# ever had to guard against, worse than any battery-vs-performance
# trade-off.

run_tests() {
  local fake_bin i
  fake_bin="$(mktemp -d)"
  cpu_base_path="$fake_bin/sys/devices/system/cpu"
  for i in 0 1 2 3; do
    mkdir -p "$cpu_base_path/cpu$i"
    echo "1" > "$cpu_base_path/cpu$i/online"
  done

  cores_online_file="$fake_bin/coresonline.json"
  active_events=(night)
  event=night
  log_msg() { :; }
  emit() { :; }
  capability_has() { return 0; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-actions.sh"

  # The exact real-world trigger: a symmetric CPU where every core got
  # classified as "high power" (nothing to distinguish them by).
  hp_cpus=(cpu0 cpu1 cpu2 cpu3)
  disable_cores=auto
  handle_cores=false
  action_cores_apply

  local online_count
  online_count="$(_count_online_cores)"
  assert_eq "1" "$online_count" "disable_cores=auto en una CPU simetrica (todos los nucleos clasificados como alto rendimiento) SIEMPRE deja al menos 1 nucleo activo - el fallo real habria dejado 0"

  # Same guarantee for the manual (explicit core list) selection path.
  for i in 0 1 2 3; do echo "1" > "$cpu_base_path/cpu$i/online"; done
  rm -f "$cores_online_file"
  disable_cores="cpu0 cpu1 cpu2 cpu3"
  handle_cores=false
  action_cores_apply
  online_count="$(_count_online_cores)"
  assert_eq "1" "$online_count" "una lista manual que cubre TODOS los nucleos tambien deja al menos 1 activo"

  rm -rf "$fake_bin"
}
