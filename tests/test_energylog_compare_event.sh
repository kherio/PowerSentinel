#!/bin/bash
# tests/test_energylog_compare_event.sh
#
# Verifies PowerSentinel-energylog.sh's energylog_compare_event()
# (feature request: "que el usuario sepa que realmente está
# funcionando bien" - a real, measured drain-rate comparison, never an
# invented percentage). Checks the actual computed %/h rates against a
# simulated log with two clearly different, known drain rates, that
# charging intervals are excluded from the calculation entirely (a
# rising level would corrupt it), and that the function honestly
# reports "not enough data" ({}) rather than a number built from too
# little history.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-energylog.sh"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  energylog_file="$tmp_dir/energylog.json"

  python3 - "$energylog_file" << 'PYEOF'
import json, sys

lines = []
ts = 1700000000
level = 100.0

# Sin "night" activo: 10%/h, muestras cada 360s (0.1h) -> 1%/muestra.
# 50 muestras = 50% de caida (100 -> 50), sin tocar 0%.
for _ in range(50):
    lines.append({"ts": ts, "battery": round(level), "temp_c": 30, "charging": "false", "active": "screen_off"})
    ts += 360
    level -= 1.0

# Un ciclo de carga de por medio - debe excluirse por completo del
# calculo (una subida de nivel corromperia una tasa de descarga).
lines.append({"ts": ts, "battery": round(level), "temp_c": 25, "charging": "true", "active": ""})
ts += 3600
level = 100.0

# Con "night" activo: 2.5%/h, muestras cada 1440s (0.4h) -> 1%/muestra.
# 30 muestras = 30% de caida (100 -> 70).
for _ in range(30):
    lines.append({"ts": ts, "battery": round(level), "temp_c": 28, "charging": "false", "active": "night screen_off"})
    ts += 1440
    level -= 1.0

with open(sys.argv[1], "w") as f:
    for l in lines:
        f.write(json.dumps(l) + "\n")
PYEOF

  local result with_rate without_rate
  result="$(energylog_compare_event night)"
  assert_valid_json "$result" "energylog_compare_event() devuelve JSON valido"

  with_rate="$(printf '%s' "$result" | "$JQ" -r '(.with_drop_pct / (.with_seconds/3600))')"
  without_rate="$(printf '%s' "$result" | "$JQ" -r '(.without_drop_pct / (.without_seconds/3600))')"
  assert_eq "2.5" "$with_rate" "tasa CON night activo calculada correctamente (2.5%/h simulado)"
  assert_eq "10" "$without_rate" "tasa SIN night activo calculada correctamente (10%/h simulado) - confirma que el intervalo de carga de por medio no contamino el calculo"

  # Sin suficiente historial (una sola muestra, ningun intervalo
  # posible) - nunca debe inventar una comparacion.
  echo '{"ts":1,"battery":100,"temp_c":25,"charging":"false","active":"screen_off"}' > "$tmp_dir/pocos.json"
  energylog_file="$tmp_dir/pocos.json"
  assert_eq "{}" "$(energylog_compare_event night)" "con historial insuficiente, devuelve {} en vez de una comparacion poco fiable"

  # Fichero inexistente.
  energylog_file="$tmp_dir/no_existe.json"
  assert_eq "{}" "$(energylog_compare_event night)" "sin fichero de historial, devuelve {}"

  rm -rf "$tmp_dir"
}
