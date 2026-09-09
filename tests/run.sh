#!/bin/bash
# tests/run.sh - PowerSentinel test suite runner.
#
# Usage: bash tests/run.sh (from anywhere - resolves paths relative to
# this script's own location, not the caller's working directory).
#
# Runs entirely on a dev machine / CI, never on the Android device -
# these tests source the real system/bin/PowerSentinel-*.sh files
# directly (the exact same code that ships), stub only the handful of
# Android-specific primitives a given test needs (dumpsys, is_device,
# DETECT_BATTERY_*), and exercise everything else - the actual jq
# filters, the actual bash logic - for real. Requires bash and jq on
# the machine running this; nothing else.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT

# JQ: tests call the real jq on the dev machine (PATH), NOT the
# bundled Android binary at system/bin/jq (a foreign-architecture ELF
# that won't run here) - every sourced PowerSentinel-*.sh file reads
# $JQ rather than hardcoding the binary name for exactly this reason.
if ! command -v jq >/dev/null 2>&1; then
  echo "jq no esta instalado - necesario para correr los tests." >&2
  exit 1
fi
export JQ="$(command -v jq)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/assert.sh"

echo "PowerSentinel test suite"
echo "jq: $JQ ($($JQ --version 2>&1))"

for test_file in "$SCRIPT_DIR"/test_*.sh; do
  [ -e "$test_file" ] || continue
  run_test_file "$test_file"
done

echo
echo "============================================"
if [ "$TESTS_FAILED" -eq 0 ]; then
  printf '\033[32m%s/%s pruebas correctas\033[0m\n' "$TESTS_RUN" "$TESTS_RUN"
  exit 0
else
  printf '\033[31m%s/%s pruebas fallidas\033[0m\n' "$TESTS_FAILED" "$TESTS_RUN"
  exit 1
fi
