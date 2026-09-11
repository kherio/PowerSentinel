// tests/frontend/test_switch_log_subtab.mjs
//
// CRITICAL regression guard for v4.7.0's fix: "Registro técnico"'s
// content stopped partway down the screen (the same symptom already
// fixed once for Actividad in v3.70.0, but still broken here). Real
// root cause: switchLogSubTab() set style.display = 'block' directly
// (an inline style) whenever a person switched tabs - and an inline
// style always wins over any stylesheet rule regardless of specificity,
// including the "display: flex" the stylesheet gives these views so
// their content can stretch to fill the screen. Fixed by clearing the
// property ('') for whichever view should be visible instead of forcing
// 'block', letting the stylesheet's own rule take over; 'none' for
// hiding is unaffected. This test exercises real navigation sequences
// (switch away and back), which is exactly what the original CSS-only
// fix's own verification missed.

import { assertEq, setupDom, loadModule } from './lib/harness.mjs';

export async function runTests() {
  setupDom(`<!DOCTYPE html><html><body>
    <button id="l-tab-log"></button>
    <button id="l-tab-journal" class="active"></button>
    <button id="l-tab-energy"></button>
    <div id="l-view-log" style="display:none;"></div>
    <div id="l-view-journal"></div>
    <div id="l-view-energy" style="display:none;"></div>
  </body></html>`);

  const mod = await loadModule('views/log.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const readLog=async()=>'',readJournal=async()=>'',readEnergyLog=async()=>'',exportLog=async()=>'';"],
      [/import \{ toast, escapeHtml \} from '\.\.\/helpers\.js';/, "const toast=()=>{}; const escapeHtml=(s)=>String(s);"],
      [/import \{ t \} from '\.\.\/i18n\.js';/, "const t = (k) => k;"],
      [/import \{ eventDisplayName, eventIcon \} from '\.\/estado\.js';/, "const eventDisplayName=(n)=>n, eventIcon=()=>'';"],
      // loadEnergyLog() reaches into readEnergyLog/network - not needed
      // for this test, which only exercises tab-switch display logic.
      [/if \(view === 'energy'\) loadEnergyLog\(\);/, '']
    ],
    exportNames: ['switchLogSubTab']
  });
  const { switchLogSubTab } = mod;

  switchLogSubTab('log');
  assertEq('', document.getElementById('l-view-log').style.display, 'primer cambio a Registro tecnico: NUNCA "block" en linea, sino "" para que la hoja de estilos controle el display');
  assertEq('none', document.getElementById('l-view-journal').style.display, 'Actividad se oculta correctamente con "none"');

  switchLogSubTab('journal');
  assertEq('', document.getElementById('l-view-journal').style.display, 'volver a Actividad tras haber visitado otra pestaña: tampoco "block" en linea (este era el caso que se rompia sin darnos cuenta)');
  assertEq('none', document.getElementById('l-view-log').style.display, 'Registro tecnico se oculta correctamente al volver a Actividad');

  switchLogSubTab('energy');
  assertEq('', document.getElementById('l-view-energy').style.display, 'cambiar a Energia tampoco fuerza "block" en linea');
  assertEq('none', document.getElementById('l-view-journal').style.display, 'Actividad se oculta al entrar en Energia');
}
