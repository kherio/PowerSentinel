#!/bin/bash
# tests/test_screenwake_suggest_night_window.sh
#
# Regression guard for a bug found while building v3.65.0's
# screenwake_suggest_night_window(): the first version collected EVERY
# gap between wakes over the threshold, with no limit per day - a day
# with several separate multi-hour lulls (sparse daytime phone use)
# could contribute more than one "candidate night", diluting or even
# outnumbering the real nightly sleep gap. Fixed by grouping gaps by
# which calendar day their MIDPOINT falls in and keeping only the
# longest one per day before applying the duration threshold.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-screenwake.sh"

  local tmp_dir wake_file
  tmp_dir="$(mktemp -d)"
  wake_file="$tmp_dir/wake.json"
  screenwake_file="$wake_file"

  python3 - "$wake_file" << 'PYEOF'
import json, random, sys
random.seed(7)
wakes = []
base_day = 1700000000  # epoch base, un lunes cualquiera
for night in range(10):
    day_start = base_day + night * 86400
    # Several DAYTIME wakes with real gaps between them (up to a few
    # hours) - deliberately shaped so some of those daytime gaps ALSO
    # exceed a naive flat threshold, to reproduce the exact bug: without
    # per-day grouping, these would count as extra "nights".
    for h in (10, 14, 18):
        ts = day_start + h * 3600 + random.randint(0, 1800)
        wakes.append({"ts": ts, "time": f"{h:02d}:00", "reason": ""})
    quiet_start_min = 23 * 60 + 20 + random.randint(-10, 10)
    wake_min = 7 * 60 + 5 + random.randint(-10, 10)
    wakes.append({
        "ts": day_start + quiet_start_min * 60,
        "time": f"{quiet_start_min // 60:02d}:{quiet_start_min % 60:02d}",
        "reason": "",
    })
    wakes.append({
        "ts": day_start + 86400 + wake_min * 60,
        "time": f"{wake_min // 60:02d}:{wake_min % 60:02d}",
        "reason": "",
    })
wakes.sort(key=lambda w: w["ts"])
json.dump({"wakes": wakes}, open(sys.argv[1], "w"))
PYEOF

  local result nights_analyzed suggested_start suggested_end
  result="$(screenwake_suggest_night_window)"
  assert_valid_json "$result" "screenwake_suggest_night_window() devuelve JSON valido"

  nights_analyzed="$(printf '%s' "$result" | "$JQ" -r '.nights_analyzed')"
  # 10 real sleep gaps were simulated (one per day) - the bug used to
  # ALSO count several daytime gaps as extra candidates, inflating this
  # well past 10. A small amount of slack (boundary effects at the
  # very first/last day) is fine; a number close to 3x that (what the
  # unfixed version produced) is not.
  [ "$nights_analyzed" -ge 8 ] && [ "$nights_analyzed" -le 12 ]
  assert_true $? "nights_analyzed (${nights_analyzed}) esta en el rango esperado (8-12) - el bug real contaba tambien huecos diurnos como noches, disparando esto muy por encima"

  suggested_start="$(printf '%s' "$result" | "$JQ" -r '.suggested_start')"
  suggested_end="$(printf '%s' "$result" | "$JQ" -r '.suggested_end')"
  # La franja real simulada es ~23:20 +-10min a ~07:05 +-10min - un
  # margen de 20 minutos alrededor del centro simulado es generoso pero
  # detectaria si el algoritmo se desvia hacia una hora de dia real
  # (lo que pasaria si un hueco diurno contaminase la mediana).
  local start_min end_min
  start_min=$(( 10#${suggested_start%%:*} * 60 + 10#${suggested_start##*:} ))
  end_min=$(( 10#${suggested_end%%:*} * 60 + 10#${suggested_end##*:} ))
  [ "$start_min" -ge $((23*60)) ] || [ "$start_min" -le 20 ]
  assert_true $? "suggested_start ($suggested_start) cae dentro de la franja nocturna real simulada"
  [ "$end_min" -ge $((6*60+45)) ] && [ "$end_min" -le $((7*60+25)) ]
  assert_true $? "suggested_end ($suggested_end) cae dentro de la franja de despertar real simulada"

  # Not enough data yet - must not fabricate a suggestion.
  echo '{"wakes":[]}' > "$wake_file"
  result="$(screenwake_suggest_night_window)"
  assert_json_field "$result" '. == {} or (.suggested_start // empty) == ""' "true" "sin datos suficientes, no inventa una sugerencia"

  rm -rf "$tmp_dir"
}
