#!/bin/bash
# tests/test_screenwake_reason_from_log.sh
#
# The wake cause now comes from PowerManagerService's own log line
# ("Waking up from Dozing (uid=..., reason=WAKE_REASON_..., details=...)")
# instead of the kernel's last_resume_reason, which keeps an old value
# when the screen turns on without a suspend-resume. Must: parse the
# real lines, resolve app uids to packages, never reuse a line already
# accounted for, stay empty (not stale) when there is no new line, and
# fall back to the old path only when the log is unreadable.

run_tests() {
  # shellcheck disable=SC1090
  source "$REPO_ROOT/system/bin/PowerSentinel-screenwake.sh"
  timeout() { shift; "$@"; }
  LOGCAT_OUT=""; LOGCAT_RC=0
  logcat() { printf '%s' "$LOGCAT_OUT"; return $LOGCAT_RC; }
  pm() { printf 'package:com.android.systemui uid:10150\npackage:com.chat.app uid:10234\n'; }

  PWR='11-12 16:30:42.444  2730  3989 I PowerManagerService: Waking up from Dozing (uid=1000, reason=WAKE_REASON_POWER_BUTTON, details=android.policy:POWER)...'
  KEY='11-12 16:54:00.059  2730  2730 I PowerManagerService: Waking up from Dozing (uid=1000, reason=WAKE_REASON_WAKE_KEY, details=android.policy:KEY)...'
  PLUG='11-12 16:59:11.542  2730  3614 I PowerManagerService: Waking up from Dozing (uid=1000, reason=WAKE_REASON_PLUGGED_IN, details=android.server.power:PLUGGED:true)...'
  APP='11-12 17:02:10.100  2730  3614 I PowerManagerService: Waking up from Asleep (uid=10234, reason=WAKE_REASON_APPLICATION, details=com.chat.app:wake)...'

  section "lineas reales: motivo, quien y detalle"
  _screenwake_last_pm_line=""; LOGCAT_OUT="$PWR"
  _screenwake_pm_log_cause; assert_eq "0" "$?" "log legible -> 0"
  assert_eq "pm:WAKE_REASON_POWER_BUTTON||android.policy:POWER" "$_SW_CAUSE" "boton de encendido, sistema (uid 1000) sin 'quien'"
  _screenwake_last_pm_line=""; LOGCAT_OUT="$KEY"; _screenwake_pm_log_cause
  assert_eq "pm:WAKE_REASON_WAKE_KEY||android.policy:KEY" "$_SW_CAUSE" "tecla"
  _screenwake_last_pm_line=""; LOGCAT_OUT="$PLUG"; _screenwake_pm_log_cause
  assert_eq "pm:WAKE_REASON_PLUGGED_IN||android.server.power:PLUGGED:true" "$_SW_CAUSE" "cargador conectado"

  section "uid de app: se resuelve al paquete"
  _screenwake_last_pm_line=""; LOGCAT_OUT="$APP"; _screenwake_pm_log_cause
  assert_eq "pm:WAKE_REASON_APPLICATION|com.chat.app|com.chat.app:wake" "$_SW_CAUSE" "app identificada por su uid"

  section "se usa la ULTIMA linea del log"
  _screenwake_last_pm_line=""; LOGCAT_OUT="$PWR"$'\n'"$KEY"
  _screenwake_pm_log_cause
  assert_eq "pm:WAKE_REASON_WAKE_KEY||android.policy:KEY" "$_SW_CAUSE" "gana la mas reciente"

  section "una linea ya contabilizada no se repite (nada de motivos rancios)"
  _screenwake_pm_log_cause; assert_eq "0" "$?" "sigue siendo 0 (log legible)"
  assert_eq "" "$_SW_CAUSE" "misma linea que la vez anterior -> motivo vacio, no el viejo"
  LOGCAT_OUT="$KEY"$'\n'"$PLUG"; _screenwake_pm_log_cause
  assert_eq "pm:WAKE_REASON_PLUGGED_IN||android.server.power:PLUGGED:true" "$_SW_CAUSE" "una linea nueva si se recoge"

  section "log legible pero sin lineas de despertar: vacio, no fallback"
  _screenwake_last_pm_line=""; LOGCAT_OUT='11-12 16:30:00.000  2730  3989 I PowerManagerService: algo distinto'
  _screenwake_pm_log_cause; assert_eq "0" "$?" "legible -> 0"
  assert_eq "" "$_SW_CAUSE" "sin linea de despertar -> vacio"

  section "log ilegible: devuelve 1 para usar el metodo antiguo"
  LOGCAT_OUT=""; _screenwake_pm_log_cause; assert_eq "1" "$?" "sin salida -> 1"

  section "screenwake_check integra: guarda la causa real y usa fallback solo si hace falta"
  REC=()
  _screenwake_record_wake() { REC+=("$3"); }
  is_valid_bool_reading() { case "$1" in true|false) return 0 ;; *) return 1 ;; esac; }
  _screenwake_wake_cause() { printf 'kernel:pmic_pwrkey'; }
  _screenwake_prev_screen=""; _screenwake_last_pm_line=""; LOGCAT_OUT="$PWR"
  screenwake_check false                       # primera lectura: solo anota la linea ya existente
  screenwake_check true                        # pantalla encendida, pero NO hay linea nueva
  assert_eq "" "${REC[0]}" "encendido sin linea nueva -> motivo vacio (no el 'pmic_pwrkey' rancio)"
  screenwake_check false
  LOGCAT_OUT="$PWR"$'\n'"$KEY"; screenwake_check true
  assert_eq "pm:WAKE_REASON_WAKE_KEY||android.policy:KEY" "${REC[1]}" "con linea nueva se guarda su motivo real"
  screenwake_check false
  LOGCAT_OUT=""; screenwake_check true
  assert_eq "kernel:pmic_pwrkey" "${REC[2]}" "con el log ilegible se cae al metodo antiguo"
}
