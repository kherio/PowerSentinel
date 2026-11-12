#!/bin/bash
# tests/test_screen_poll_interval.sh
#
# Screen polling cadence: fast (SCREEN_POLL_INTERVAL_S, 2s) while the
# screen is ON or its state is unknown, slower (global screen_poll_off,
# default 5s, valid 2-60) while it is OFF - fewer dumpsys calls while the
# phone sits idle. Garbage / out-of-range config falls back to the
# default; it can never go BELOW the fast cadence.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-screenwake.sh"
  SCREEN_POLL_INTERVAL_S=2
  CONF_VAL=""
  getconf() { [ -n "$CONF_VAL" ] && echo "$CONF_VAL" || echo "$2"; }

  section "pantalla encendida o desconocida: cadencia rapida"
  _screenwake_prev_screen="true";  screenwake_choose_interval; assert_eq "2" "$SW_POLL_INTERVAL" "encendida: 2s"
  _screenwake_prev_screen="";      screenwake_choose_interval; assert_eq "2" "$SW_POLL_INTERVAL" "sin lectura aun: 2s"
  _screenwake_prev_screen="unknown"; screenwake_choose_interval; assert_eq "2" "$SW_POLL_INTERVAL" "lectura rara: 2s"

  section "pantalla apagada: cadencia lenta"
  _screenwake_prev_screen="false"
  screenwake_choose_interval; assert_eq "5" "$SW_POLL_INTERVAL" "por defecto 5s"
  CONF_VAL=12; screenwake_choose_interval; assert_eq "12" "$SW_POLL_INTERVAL" "valor configurado"
  CONF_VAL=2;  screenwake_choose_interval; assert_eq "2" "$SW_POLL_INTERVAL" "2 = comportamiento anterior"
  CONF_VAL=1;  screenwake_choose_interval; assert_eq "2" "$SW_POLL_INTERVAL" "nunca por debajo de la cadencia rapida"
  CONF_VAL=abc; screenwake_choose_interval; assert_eq "5" "$SW_POLL_INTERVAL" "valor no numerico: 5s"

  section "vuelve a rapida al encenderse la pantalla"
  CONF_VAL=30; _screenwake_prev_screen="false"; screenwake_choose_interval; assert_eq "30" "$SW_POLL_INTERVAL" "apagada: 30s"
  _screenwake_prev_screen="true"; screenwake_choose_interval; assert_eq "2" "$SW_POLL_INTERVAL" "encendida otra vez: 2s"

  section "validacion de la clave en la config (2-60, por defecto 5)"
  local root; root="$(mktemp -d)"
  unset -f getconf
  # config.sh finds its jq next to itself: run a copy beside the host's jq
  cp "$REPO_ROOT/system/bin/PowerSentinel-config.sh" "$root/" && cp "$JQ" "$root/jq" && chmod +x "$root/jq"
  # shellcheck disable=SC1090
  source "$root/PowerSentinel-config.sh"
  json_conf="$root/c.json"
  for pair in '7:7' '2:2' '60:60' '1:5' '61:5' 'abc:5' '-3:5' '3.5:5' '"":5'; do
    printf '{"global":{"screen_poll_off":"%s"},"events":{}}' "${pair%%:*}" > "$json_conf"
    config_load_global 2>/dev/null
    assert_eq "${pair#*:}" "$(config_get screen_poll_off 5)" "screen_poll_off=${pair%%:*} -> ${pair#*:}"
  done
  printf '{"global":{},"events":{}}' > "$json_conf"; config_load_global 2>/dev/null
  assert_eq "5" "$(config_get screen_poll_off 5)" "sin la clave: 5"
  rm -rf "$root"
}
