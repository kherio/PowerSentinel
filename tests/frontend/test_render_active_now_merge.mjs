// tests/frontend/test_render_active_now_merge.mjs
//
// Feature request: merge the hero gauge card and the separate "activo
// ahora" card into one, removing the repetition (mode name + "why"
// text said, in slightly different words, exactly what the separate
// card's own title + "why" line said right underneath it). This tests
// renderActiveNow()'s aggregation logic once its content moved into
// the hero card's own elements: mechanism categories from more than
// one simultaneously active event must never show twice (the first
// active event's value wins, matching buildWhyText()'s own "first
// active event is primary" convention), and the "since" time anchors
// to whichever event started EARLIEST, not an arbitrary one.

import { assertEq, setupDom, loadModule } from './lib/harness.mjs';

export async function runTests() {
  setupDom(`<!DOCTYPE html><html><body>
    <div id="e-dashboard-mechanisms"></div>
    <div id="e-dashboard-since"></div>
    <div id="e-dashboard-drain" style="display:none;"></div>
  </body></html>`);

  const mod = await loadModule('views/estado.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const readDrainComparison = async () => '{}';"],
      [/import \{ toast, escapeHtml \} from '\.\.\/helpers\.js';/, "const toast=()=>{}; const escapeHtml=(s)=>String(s);"],
      [/import \{ t \} from '\.\.\/i18n\.js';/, "const t = (k) => k;"],
      [/import \{[^}]*\} from '\.\/log\.js';/, "const parseJournalLines=()=>[],filterBootRestartNoise=(x)=>x,renderTimelineEntry=()=>'',parseEnergyLines=()=>[],computeRecentRate=()=>null;"],
      [/import \{ parseConfig, serializeConfig \} from '\.\.\/config-form\.js';/, "const parseConfig=(t)=>JSON.parse(t), serializeConfig=(m)=>JSON.stringify(m);"]
    ],
    exportNames: ['renderActiveNow']
  });
  const { renderActiveNow } = mod;

  const mechEl = () => document.getElementById('e-dashboard-mechanisms').textContent;
  const sinceEl = () => document.getElementById('e-dashboard-since').textContent;

  renderActiveNow({ activeMechanisms: [] });
  assertEq('', mechEl(), 'sin eventos activos, el bloque de mecanismos queda vacio');
  assertEq('', sinceEl(), 'sin eventos activos, "desde" queda vacio');
  assertEq('none', document.getElementById('e-dashboard-drain').style.display, 'sin eventos activos, la comparacion de consumo se oculta');

  const now = Math.floor(Date.now() / 1000);
  renderActiveNow({
    activeMechanisms: [
      { event: 'night', handle_apps: 'nice', handle_cores: 'false', doze: 'false', handle_gms: 'false', kill_wifi: 'false', low_ram: 'false', max_cpu_freq: 'false', max_refresh_rate: 'false' },
      { event: 'screen_off', handle_apps: 'kill', handle_cores: 'false', doze: 'light', handle_gms: 'false', kill_wifi: 'true', low_ram: 'false', max_cpu_freq: 'false', max_refresh_rate: 'false' }
    ],
    activeEventStartTimes: { night: now - 3600, screen_off: now - 600 }
  });
  const mechText = mechEl();
  assertEq(1, (mechText.match(/mechApps/g) || []).length, 'con dos eventos que ambos reclaman "Apps", la categoria aparece UNA sola vez, no duplicada');
  assertEq(true, mechText.includes('mechDoze') && mechText.includes('mechWifi'), 'los mecanismos exclusivos del segundo evento (doze, wifi) SI se agregan');

  renderActiveNow({
    activeMechanisms: [{ event: 'night', handle_apps: 'nice', handle_cores: 'false', doze: 'false', handle_gms: 'false', kill_wifi: 'false', low_ram: 'false', max_cpu_freq: 'false', max_refresh_rate: '60' }],
    activeEventStartTimes: { night: now - 7200 }
  });
  assertEq(true, mechEl().includes('mechRefresh'), 'un solo evento activo muestra sus propios mecanismos correctamente');
}
