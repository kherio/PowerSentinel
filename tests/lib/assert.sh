#!/bin/bash
# tests/lib/assert.sh - minimal, dependency-free assertion helpers for
# PowerSentinel's test suite. Sourced by every tests/test_*.sh file,
# never run directly.
#
# Why this exists at all: every bug found and fixed across this
# project's development (is_device's "unknown" handling, the missing
# `jq -c` that made the "Hoy" card vanish, night/thermal's stale
# config snapshot, the wake-window suggester counting more than one
# "night" per day...) was verified with a hand-written, throwaway
# simulation script that never outlived the conversation turn it was
# written in. Nothing stopped any of those regressions from coming
# back silently in a later round. These tests are exactly those same
# verifications, kept for good, so `bash tests/run.sh` can catch a
# reintroduced regression in seconds instead of a multi-round
# reverse-engineering session from a vague symptom report.

TESTS_RUN=0
TESTS_FAILED=0
CURRENT_FILE=""

# assert_eq EXPECTED ACTUAL "description"
assert_eq() {
  local expected="$1" actual="$2" desc="${3:-assert_eq}"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [ "$expected" = "$actual" ]; then
    return 0
  fi
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  \033[31mFAIL\033[0m %s\n' "$desc"
  printf '       esperado: %s\n' "$expected"
  printf '       obtenido: %s\n' "$actual"
  return 1
}

# assert_true CONDITION_EXIT_CODE "description" - pass a command
# substitution's own $? or a `[ ... ]` test result directly, e.g.:
#   [ -n "$x" ]; assert_true $? "x no debe estar vacio"
assert_true() {
  local code="$1" desc="${2:-assert_true}"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [ "$code" -eq 0 ]; then
    return 0
  fi
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  \033[31mFAIL\033[0m %s (esperaba exito, codigo=%s)\n' "$desc" "$code"
  return 1
}

# assert_single_line TEXT "description" - the exact regression guard
# for the v3.67.0 bug class: a jq summary function missing `-c` prints
# across multiple lines, which the WebUI's line-by-line status-file
# parser can never match. Any function whose output is meant to be
# embedded in one `echo "Label: $(...)" >> status_file` line must pass
# this.
assert_single_line() {
  local text="$1" desc="${2:-assert_single_line}"
  local lines
  lines=$(printf '%s' "$text" | wc -l)
  TESTS_RUN=$((TESTS_RUN + 1))
  # wc -l counts newlines, not lines - a single line with no trailing
  # newline correctly reports 0 here, which is what printf without
  # -n's own extra newline behavior gives for genuine one-line output.
  if [ "$lines" -eq 0 ]; then
    return 0
  fi
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  \033[31mFAIL\033[0m %s (salida en %s lineas, se esperaba 1)\n' "$desc" "$((lines + 1))"
  printf '       %s\n' "$text"
  return 1
}

# assert_valid_json TEXT "description"
assert_valid_json() {
  local text="$1" desc="${2:-assert_valid_json}"
  TESTS_RUN=$((TESTS_RUN + 1))
  if printf '%s' "$text" | "$JQ" -e . >/dev/null 2>&1; then
    return 0
  fi
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  \033[31mFAIL\033[0m %s (JSON invalido)\n' "$desc"
  printf '       %s\n' "$text"
  return 1
}

# assert_json_field JSON_TEXT JQ_FILTER EXPECTED "description"
assert_json_field() {
  local json="$1" filter="$2" expected="$3" desc="${4:-assert_json_field}"
  local actual
  actual="$(printf '%s' "$json" | "$JQ" -r "$filter" 2>/dev/null)"
  assert_eq "$expected" "$actual" "$desc"
}

section() {
  echo
  echo "== $1 =="
}

# GOTCHA worth knowing before writing a new test file: bash traps are
# PROCESS-scoped, not function-scoped. A `trap ... RETURN` set inside
# run_tests() fires when ANY sourced script (source/. of a
# PowerSentinel-*.sh file, which every test does) finishes too - not
# only when run_tests() itself returns, deleting a temp dir far too
# early. `trap ... EXIT` avoids that, but then fires again later when
# the whole subshell exits, by which point a `local` variable from
# inside run_tests() is out of scope, producing a spurious "unbound
# variable" (harmless under `set -u`, but noisy). Simplest and safest:
# skip trap entirely for a temp dir/file created inside run_tests() -
# just `rm -rf` it explicit at the end of the function, after your
# assertions. None of these tests need cleanup-on-early-exit (a failed
# assert_* returns 1 rather than exiting), so there's no case a plain
# end-of-function cleanup misses.

# run_test_file PATH - sources and runs a single test file in an
# isolated subshell (so one file's stray global/env change - or crash
# - can never leak into or abort the rest of the suite), then folds
# its counts into the running total. Every test file must define a
# function named exactly `run_tests`.
run_test_file() {
  local file="$1" name
  name="$(basename "$file" .sh)"
  echo
  echo "--- $name ---"
  local result
  # Deliberately NO `set -e` here: assert_* functions return 1 on a
  # failed assertion by design (so a test file COULD branch on it if
  # it ever needed to), and a whole test file failing several
  # assertions is the NORMAL, expected shape of "this test caught a
  # regression" - not a crash. `exit 0` at the end keeps the subshell's
  # own exit status from reflecting whatever the LAST assertion
  # happened to return, so a genuine crash (unbound variable, a
  # sourced file with a syntax error) is the only thing that reaches
  # the `|| { ... }` below.
  result="$(
    TESTS_RUN=0
    TESTS_FAILED=0
    # shellcheck disable=SC1090
    source "$file"
    run_tests
    echo "__COUNTS__ $TESTS_RUN $TESTS_FAILED"
    exit 0
  )" || { printf '  \033[31mERROR\033[0m: %s aborto (fallo real del script, no una aserción)\n' "$name"; TESTS_FAILED=$((TESTS_FAILED + 1)); TESTS_RUN=$((TESTS_RUN + 1)); return; }
  echo "$result" | grep -v '^__COUNTS__'
  local counts file_run file_failed
  counts="$(echo "$result" | grep '^__COUNTS__')"
  file_run="$(echo "$counts" | awk '{print $2}')"
  file_failed="$(echo "$counts" | awk '{print $3}')"
  TESTS_RUN=$((TESTS_RUN + file_run))
  TESTS_FAILED=$((TESTS_FAILED + file_failed))
}
