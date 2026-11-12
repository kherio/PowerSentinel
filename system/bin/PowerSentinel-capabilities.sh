#!/system/bin/bash

# PowerSentinel-capabilities.sh - Capability Manager: probes what THIS
# specific device/ROM can actually do, once at startup, so actions.sh
# can skip (and clearly log why) instead of blindly attempting
# something that silently fails on hardware/ROMs that don't support it.
# Front 3 of the architecture pass.
#
# Several of these were already checked ad-hoc, right before the one
# place that used them (charge_limit_node's [ -w ... ], the per-core
# " powersave " grep) - those stay exactly where they are, since they're
# already correctly scoped and testing them again here would just be a
# second copy to keep in sync. What this file adds is everything that
# was NOT checked at all before acting: GMS handling and doze both ran
# unconditionally regardless of whether Google services or the
# deviceidle service actually exist on this device, and WiFi's rfkill
# vs. svc choice is scattered across three call sites instead of
# decided once.

declare -gA CAPS=()

# IMPORTANT, HONEST LIMITATION: this daemon runs as root (via Magisk/
# KernelSU), and root bypasses standard Unix permission checks on
# regular files - so `[ -w somefile ]` here mostly tells us whether the
# control exists AT ALL (some kernels genuinely don't expose a given
# sysfs node), not whether the kernel will actually accept and honor a
# write to it. A locked/pinned core, for instance, might still have a
# perfectly "writable" online file that silently ignores an offline
# attempt. This is still strictly better than the previous behavior
# (attempting every action unconditionally, with no capability check at
# all), but it's a best-effort signal, not a hard guarantee - actions.sh
# still needs to tolerate a capability-reported-as-available write
# having no real effect on a specific device.
capabilities_detect() {
  CAPS=()

  # CPU: can we take a core online/offline at all? Checked once, across
  # any core - if the sysfs "online" toggle isn't writable anywhere,
  # nothing device-specific is going to make it writable on another
  # core either.
  local any_online="false"
  for d in "$cpu_base_path"/cpu[0-9]*; do
    [ -w "$d/online" ] 2>/dev/null && any_online="true" && break
  done
  CAPS[cores_online]="$any_online"

  # CPU: can we set a "powersave" cpufreq governor on at least one core?
  local any_governor="false"
  for d in "$cpu_base_path"/cpu[0-9]*; do
    if [ -w "$d/cpufreq/scaling_governor" ] 2>/dev/null && \
       grep -q " powersave " "$d/cpufreq/scaling_available_governors" 2>/dev/null; then
      any_governor="true"
      break
    fi
  done
  CAPS[cores_governor]="$any_governor"

  # WiFi: prefer rfkill (find_rfkill_command, in detect.sh, already
  # found a working invocation if one exists); svc is the fallback
  # every stock Android build has, checked once here instead of at
  # every call site.
  CAPS[rfkill_wifi]="false"
  [ -n "$RFKILL_CMD" ] && CAPS[rfkill_wifi]="true"
  CAPS[svc_wifi]="false"
  command -v svc >/dev/null 2>&1 && CAPS[svc_wifi]="true"

  # Doze: the deviceidle service itself might not exist (heavily
  # modified ROMs, very old Android). A harmless read-only query
  # ("get screen") is enough to tell if the service responds at all.
  CAPS[doze_force]="false"
  dumpsys deviceidle get screen >/dev/null 2>&1 && CAPS[doze_force]="true"

  # GMS: never checked before acting - "pm disable com.google.android.gms"
  # on an AOSP-based ROM with no Google services at all just silently
  # does nothing useful every single cycle.
  CAPS[gms_installed]="false"
  pm path com.google.android.gms >/dev/null 2>&1 && CAPS[gms_installed]="true"

  # pm suspend: present on Android 7+ in practice, but not guaranteed on
  # every fork/ROM - `pm help` lists it if supported.
  CAPS[pm_suspend]="false"
  pm help 2>&1 | grep -qi "suspend" && CAPS[pm_suspend]="true"

  # Data Saver (feature request: "que haya un ahorro de bateria real y
  # creible" - see the long comment on action_restrictdata_apply in
  # actions.sh for why this was missing entirely until now). The
  # netpolicy service backs Settings' own "Ahorro de datos" toggle and
  # has shipped on every mainline Android release since 7.0, but a
  # heavily stripped AOSP fork could still lack it - a harmless,
  # read-only `dumpsys netpolicy` is enough to tell if the service
  # responds at all, same reasoning already used for doze_force above.
  CAPS[netpolicy_restrict]="false"
  dumpsys netpolicy >/dev/null 2>&1 && CAPS[netpolicy_restrict]="true"

  # App Standby Buckets (the "bucket" level of handle_apps). `am
  # get-standby-bucket` / `set-standby-bucket` have existed since Android
  # 9 (API 28), but a stripped fork could lack them - `am help` lists
  # the subcommand when supported, same read-only reasoning as pm_suspend.
  CAPS[standby_bucket]="false"
  am help 2>&1 | grep -qi "set-standby-bucket" && CAPS[standby_bucket]="true"

  # Kernel idle tunables (tune_system): at least one of the two sysctl
  # files it writes must exist and be writable.
  CAPS[kernel_tunables]="false"
  if [ -w /proc/sys/vm/stat_interval ] || [ -w /proc/sys/vm/dirty_writeback_centisecs ]; then
    CAPS[kernel_tunables]="true"
  fi

  # Radio (radio_lte): the telephony shell command must exist AND
  # actually print the current allowed-network-types bitmask for slot 0
  # (so we know the output format is what the action parses). Read-only.
  CAPS[radio_lte]="false"
  if cmd phone help 2>&1 | grep -q "allowed-network-types-for-users" && declare -F _radio_get >/dev/null && _radio_get 0 >/dev/null; then
    CAPS[radio_lte]="true"
  fi

  # Background scanning (scan_off): the settings must read back as a
  # plain 0/1 (on ROMs without them `settings get` prints "null").
  CAPS[scan_off]="false"
  if declare -F _scan_get >/dev/null && _scan_get wifi_scan_always_enabled >/dev/null; then
    CAPS[scan_off]="true"
  fi

  log_msg 2 "Capabilities: $(capabilities_summary)"
}

capability_has() {
  [ "${CAPS[$1]}" = "true" ]
}

capabilities_summary() {
  local out="" k
  for k in cores_online cores_governor rfkill_wifi svc_wifi doze_force gms_installed pm_suspend netpolicy_restrict standby_bucket kernel_tunables radio_lte scan_off; do
    out+="$k=${CAPS[$k]:-false} "
  done
  echo "$out"
}
