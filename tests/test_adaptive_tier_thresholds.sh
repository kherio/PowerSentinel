#!/bin/bash
# tests/test_adaptive_tier_thresholds.sh
#
# Regression guard for a real finding from v3.55.0's security audit:
# each of adaptive_tier1/2/3_threshold was already validated as a
# plain non-negative integer, but nothing checked they were in
# ascending order. A jumbled set (e.g. tier1=90, tier2=20, tier3=50)
# would activate the MOST aggressive tier at a much lower score than
# the values would suggest, since tier3 is checked first in
# pressure_tier_for_score(). Fixed by falling back to the documented
# defaults (20/45/70) on any ordering inconsistency, in a single
# function (_adaptive_tier_thresholds()) used both for the real
# decision and for whatever gets reported to the WebUI, so the two can
# never disagree.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-policy.sh"

  getconf() {
    case "$1" in
      adaptive_tier1_threshold) echo "$T1" ;;
      adaptive_tier2_threshold) echo "$T2" ;;
      adaptive_tier3_threshold) echo "$T3" ;;
    esac
  }

  T1=20; T2=45; T3=70
  assert_eq "20 45 70" "$(_adaptive_tier_thresholds)" "umbrales en orden correcto se devuelven tal cual"
  assert_eq "2" "$(pressure_tier_for_score 60)" "score=60 con umbrales normales -> tier 2"
  assert_eq "3" "$(pressure_tier_for_score 80)" "score=80 con umbrales normales -> tier 3"
  assert_eq "0" "$(pressure_tier_for_score 10)" "score=10 con umbrales normales -> tier 0"

  # El caso real del hallazgo: umbrales desordenados.
  T1=90; T2=20; T3=50
  assert_eq "20 45 70" "$(_adaptive_tier_thresholds)" "umbrales desordenados (90/20/50) caen al valor por defecto, no se usan tal cual"
  assert_eq "2" "$(pressure_tier_for_score 60)" "score=60 con umbrales desordenados -> tier 2 (el del valor por defecto), NUNCA tier 3 (lo que darian los umbrales desordenados sin el fix)"
}
