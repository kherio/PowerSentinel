#!/bin/bash
# tests/test_summary_functions_single_line.sh
#
# Regression guard for v3.67.0's CRITICAL FIX: todaystats_summary() was
# missing jq's `-c` (compact) flag. Every function whose output gets
# embedded in a single `echo "Label: $(...)" >> status_file` line MUST
# produce single-line JSON - the WebUI parses that file one line at a
# time with a regex expecting the whole `{...}` object on ONE line
# (e.g. /^todaystats:\s*(\{.*\})/i), which pretty-printed, multi-line
# jq output (jq's default without -c) can never match. The bug's
# actual symptom was "the Hoy card never appears at all", precisely
# because sys.todayStats stayed undefined forever.
#
# This is written as a loop over every summary function embedded this
# way, rather than one test per function, specifically so a FUTURE
# summary function follows the same pattern automatically - add its
# name to the list below and it's covered.

run_tests() {
  # screenwake_summary() needs getconf() (PowerSentinel-config.sh) for
  # the current night-window bounds - stubbed to always return
  # whatever default is passed, since this test is about JSON
  # formatting, not the night-window logic itself (that's covered by
  # test_screenwake_suggest_night_window.sh).
  getconf() { echo "$2"; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-screenwake.sh"
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-todaystats.sh"
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-chargehealth.sh"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  screenwake_file="$tmp_dir/screenwake.json"
  todaystats_file="$tmp_dir/todaystats.json"
  chargehealth_file="$tmp_dir/chargehealth.json"

  # Each summary function's own "no file yet" fallback path - the most
  # common real case (a fresh install, or right after a day/session
  # boundary) and the one most likely to accidentally regress since
  # it's the simplest code path in each function.
  local out
  out="$(screenwake_summary)"
  assert_single_line "$out" "screenwake_summary() (sin fichero) es una sola linea"
  assert_valid_json "$out" "screenwake_summary() (sin fichero) es JSON valido"

  out="$(todaystats_summary)"
  assert_single_line "$out" "todaystats_summary() (sin fichero) es una sola linea"
  assert_valid_json "$out" "todaystats_summary() (sin fichero) es JSON valido"

  out="$(chargehealth_summary)"
  assert_single_line "$out" "chargehealth_summary() (sin fichero) es una sola linea"
  assert_valid_json "$out" "chargehealth_summary() (sin fichero) es JSON valido"

  # Now with real data in each file - the case that actually exposed
  # the bug (an empty {} object's summary is short enough that even
  # unindented multi-line jq output could coincidentally still look
  # okay in some naive check; real data with several fields is what
  # actually spans multiple lines under jq's default pretty-printer).
  echo '{"wakes":[{"ts":1000,"time":"23:00","reason":"test"},{"ts":30000,"time":"23:08","reason":""}]}' > "$screenwake_file"
  out="$(screenwake_summary)"
  assert_single_line "$out" "screenwake_summary() con datos reales es una sola linea"
  assert_valid_json "$out" "screenwake_summary() con datos reales es JSON valido"

  echo "{\"day\":\"$(date +%Y-%m-%d)\",\"screen_on_seconds\":1234,\"hourly\":[0,0,0,1234,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],\"last_charge_end_ts\":1000}" > "$todaystats_file"
  out="$(todaystats_summary)"
  assert_single_line "$out" "todaystats_summary() con datos reales es una sola linea (el bug real: esto se rompia con datos, no en el caso vacio)"
  assert_valid_json "$out" "todaystats_summary() con datos reales es JSON valido"
  assert_json_field "$out" '.screen_on_seconds' "1234" "todaystats_summary() conserva los valores reales tras el fix"

  echo '{"full_charges":[1000,2000,3000]}' > "$chargehealth_file"
  out="$(chargehealth_summary)"
  assert_single_line "$out" "chargehealth_summary() con datos reales es una sola linea"
  assert_valid_json "$out" "chargehealth_summary() con datos reales es JSON valido"

  rm -rf "$tmp_dir"
}
