#!/bin/bash
# tests/test_adaptive_load_debounce.sh
#
# CRITICAL regression guard for a real bug reported directly, almost a
# week after the screen-off debounce (v4.9.0) was shipped: "Ahorro
# suave" was STILL flickering. Re-reading compute_pressure_score() from
# scratch (rather than assuming the screen fix was the whole story)
# found the CPU load term had the exact same shape of bug: $DETECT_LOAD1
# crossing its whole-number boundaries at 1.0/2.0 changes the score by
# 10-20 points INSTANTLY - comfortably larger than the 5-point
# hysteresis margin - and a phone idle overnight (exactly when "Noche"/
# tier1 is active) can easily have its 1-minute load average hover
# right around 1.0 from intermittent background activity (sync jobs,
# notification checks), crossing it repeatedly. Fixed with the same
# debounce pattern already used for screen-off: the load has to sit in
# its current bucket for a real stretch before it affects the score.
#
# Confirmed directly against a scenario that reproduces 39 tier
# transitions in 40 cycles under the OLD (undebounced) logic - down to
# 1 with the fix.

run_tests() {
  getconf() { echo ""; }
  detect_battery_temp_c() { echo 25; }
  DETECT_BATTERY_LEVEL=85
  DETECT_BATTERY_CHARGING=false

  local FAKE_NOW=1000
  date() { echo "$FAKE_NOW"; }
  is_device() { echo "false"; }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-policy.sh"

  _update_screen_off_duration
  FAKE_NOW=1100
  _update_screen_off_duration

  # Bateria 85% -> (100-85)*40/100=6; pantalla apagada de sobra -> +15;
  # "night" sin configurar (getconf devuelve "" para todo) -> is_night_now
  # cae de forma natural a false, +0. Base = 21 - justo por encima del
  # umbral de tier1 (20), para que la resta de carga (-10/-20) cruce el
  # umbral de verdad, igual que en el escenario real reportado.
  DETECT_LOAD1="0.8"
  assert_eq "21" "$(compute_pressure_score)" "puntuacion base con carga baja (bateria 85%, pantalla apagada de sobra, sin resta de carga)"

  DETECT_LOAD1="2.5"
  FAKE_NOW=1110
  _update_screen_off_duration
  assert_eq "21" "$(compute_pressure_score)" "carga alta durante solo 10s - AUN sin aplicar el descuento (bug real: esto se aplicaba al instante)"

  FAKE_NOW=1156
  _update_screen_off_duration
  assert_eq "1" "$(compute_pressure_score)" "carga alta sostenida 46s (mas del retardo de 45s) - AHORA si aplica el descuento completo"

  # El escenario real reportado: carga oscilando entre 0.8 y 2.5 cada
  # 20s durante 40 ciclos (~13 min) - nunca debe acumular mas de un
  # punado de transiciones de tier real.
  DETECT_LOAD1="0.8"
  local was_tier=0 entered_at=1156 transitions=0 t=1156 i score proposed tier
  for i in $(seq 1 40); do
    t=$((t + 20))
    FAKE_NOW=$t
    if [ "$DETECT_LOAD1" = "0.8" ]; then DETECT_LOAD1="2.5"; else DETECT_LOAD1="0.8"; fi
    _update_screen_off_duration
    score="$(compute_pressure_score)"
    proposed="$(pressure_tier_for_score "$score" "$was_tier")"
    if [ "$proposed" -lt "$was_tier" ] && [ "$((t - entered_at))" -lt 120 ]; then
      tier="$was_tier"
    else
      tier="$proposed"
    fi
    if [ "$tier" != "$was_tier" ]; then
      transitions=$((transitions + 1))
      entered_at="$t"
    fi
    was_tier="$tier"
  done
  [ "$transitions" -le 3 ]
  assert_true $? "carga de CPU oscilando cada 20s durante ~13 min produce muy pocas transiciones reales ($transitions, esperado <=3) - sin el arreglo esto daba 39 de 40 ciclos"
}
