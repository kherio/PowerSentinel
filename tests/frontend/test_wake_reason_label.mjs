// tests/frontend/test_wake_reason_label.mjs
//
// "Encendidos nocturnos": the daemon now reports the real Android wake
// reason ("pm:WAKE_REASON_X|who|details"); the card must turn it into a
// readable label (with the app/package when there is one) and keep
// handling the old kernel strings exactly as before.

import { assertEq, setupDom, loadModule } from './lib/harness.mjs';

export async function runTests() {
  setupDom('<!DOCTYPE html><html><body></body></html>');
  const mod = await loadModule('views/estado.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const readDrainComparison = async () => '{}';"],
      [/import \{ toast, escapeHtml \} from '\.\.\/helpers\.js';/, "const toast=()=>{}; const escapeHtml=(s)=>String(s);"],
      [/import \{ t \} from '\.\.\/i18n\.js';/, "const t = (k) => k;"],
      [/import \{[^}]*\} from '\.\/log\.js';/, "const parseJournalLines=()=>[],filterBootRestartNoise=(x)=>x,renderTimelineEntry=()=>'',parseEnergyLines=()=>[],computeRecentRate=()=>null;"],
      [/import \{ parseConfig, serializeConfig \} from '\.\.\/config-form\.js';/, "const parseConfig=(t)=>({blocks:[]}), serializeConfig=(m)=>JSON.stringify(m);"]
    ]
  });
  const { wakeReasonLabel } = mod;

  assertEq('dashboard.wakePmPower', wakeReasonLabel('pm:WAKE_REASON_POWER_BUTTON||android.policy:POWER'), 'boton de encendido');
  assertEq('dashboard.wakePmKey', wakeReasonLabel('pm:WAKE_REASON_WAKE_KEY||android.policy:KEY'), 'tecla');
  assertEq('dashboard.wakePmPlugged', wakeReasonLabel('pm:WAKE_REASON_PLUGGED_IN||android.server.power:PLUGGED:true'), 'cargador conectado');
  assertEq('dashboard.wakePmUnplugged', wakeReasonLabel('pm:WAKE_REASON_PLUGGED_IN||android.server.power:PLUGGED:false'), 'cargador desconectado (no se confunde con conectado)');
  assertEq('dashboard.wakePmApp · com.chat.app', wakeReasonLabel('pm:WAKE_REASON_APPLICATION|com.chat.app|com.chat.app:wake'), 'una app se muestra con su paquete');
  assertEq('dashboard.wakePmGesture', wakeReasonLabel('pm:WAKE_REASON_GESTURE||android.policy:GESTURE'), 'gesto');
  assertEq('lid', wakeReasonLabel('pm:WAKE_REASON_LID||x'), 'un motivo desconocido se muestra legible, no se inventa');

  assertEq('dashboard.wakeReasonButton · pmic_pwrkey', wakeReasonLabel('pmic_pwrkey'), 'cadena antigua del kernel: igual que antes');
  assertEq('dashboard.wakeReasonUnknown', wakeReasonLabel(''), 'sin motivo: "no disponible"');
}
