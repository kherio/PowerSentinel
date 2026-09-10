#!/bin/bash
# tests/test_adaptive_tier_hysteresis.sh
#
# Regression guard for a real bug reported directly: "Ahorro suave"
# (adaptive_tier1) flickering in and out of Actividad continuously.
# pressure_tier_for_score() had no hysteresis at all - a straight
# threshold comparison recomputed every daemon cycle from inputs
# (load average, screen on/off) that fluctuate on their own by more
# than enough to cross a nearby threshold every single cycle. Fixed
# with a sticky-threshold margin: escalating to a higher tier is still
# immediate, but de-escalating requires the score to drop meaningfully
# below the current tier's own entry threshold, not just dip under it.

run_tests() {
  getconf() {
    case "$1" in
      adaptive_tier1_threshold) echo 20 ;;
      adaptive_tier2_threshold) echo 45 ;;
      adaptive_tier3_threshold) echo 70 ;;
    esac
  }

  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-policy.sh"

  assert_eq "1" "$(pressure_tier_for_score 22)" "sin tier previo, usa el umbral crudo (22 -> tier1)"
  assert_eq "0" "$(pressure_tier_for_score 18)" "sin tier previo, usa el umbral crudo (18 -> tier0)"

  # El caso real reportado: la puntuacion oscila justo alrededor de 20.
  assert_eq "1" "$(pressure_tier_for_score 19 1)" "en tier1, una caida minima a 19 (justo por debajo del umbral) NO baja de tier - el bug real era exactamente esto"
  assert_eq "1" "$(pressure_tier_for_score 17 1)" "en tier1, 17 sigue dentro del margen de histeresis (5 puntos) - se queda"
  assert_eq "0" "$(pressure_tier_for_score 14 1)" "en tier1, una caida real a 14 (mas alla del margen) SI baja de tier"

  # Escalar SIEMPRE es inmediato, sin histeresis - reaccionar rapido a
  # que empeoren las cosas es la direccion segura de no retrasar.
  assert_eq "1" "$(pressure_tier_for_score 22 0)" "desde tier0, subir a 22 entra en tier1 de inmediato"
  assert_eq "3" "$(pressure_tier_for_score 75 1)" "un salto grande hacia arriba (tier1 -> tier3) tambien es inmediato"

  # Una caida grande de una vez (p.ej. empieza a cargar, -40 puntos)
  # debe aterrizar donde le corresponda, no quedarse pegado subiendo
  # de uno en uno.
  assert_eq "0" "$(pressure_tier_for_score 5 3)" "una caida grande desde tier3 aterriza directamente en tier0, no se queda a medias"
}
