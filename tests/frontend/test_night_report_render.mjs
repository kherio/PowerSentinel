// tests/frontend/test_night_report_render.mjs
//
// Night report card: summary line (duration, battery, %/h), per-app rows
// with a Restrict button, escaping, and graceful handling of missing data.

import { assertEq, loadModule } from './lib/harness.mjs';

export async function runTests() {
  const mod = await loadModule('views/estado.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const x = 1;"],
      [/import \{ toast, escapeHtml \} from '\.\.\/helpers\.js';/, "const toast=()=>{}; const escapeHtml=(s)=>String(s).replace(/</g,'&lt;');"],
      [/import \{ t \} from '\.\.\/i18n\.js';/, "const t = (k, v) => k + (v ? JSON.stringify(v) : '');"],
      [/import \{[^}]*\} from '\.\/log\.js';/, "const parseJournalLines=()=>[],filterBootRestartNoise=(x)=>x,renderTimelineEntry=()=>'',parseEnergyLines=()=>[],computeRecentRate=()=>null;"],
      [/import \{ parseConfig, serializeConfig \} from '\.\.\/config-form\.js';/, "const parseConfig=(t)=>JSON.parse(t), serializeConfig=(m)=>JSON.stringify(m);"]
    ]
  });
  const { nightReportSummary, renderNightReportApps } = mod;
  const r = { available: true, duration_s: 7 * 3600 + 1800, level_start: 90, level_end: 80,
    apps: [{ pkg: 'com.a', mah: 40.04 }, { pkg: 'com.<b', mah: 10 }] };
  const s = nightReportSummary(r);
  assertEq(true, s.includes('"dur":"7 h 30 min"'), 'duracion');
  assertEq(true, s.includes('"rate":"1.3"'), '10% en 7,5 h = 1.3 %/h');
  assertEq('', nightReportSummary({}), 'sin informe: vacio');
  assertEq('', nightReportSummary(null), 'null: vacio');
  assertEq('', nightReportSummary({ available: true, duration_s: 0 }), 'duracion 0: vacio');
  assertEq(true, nightReportSummary({ available: true, duration_s: 3600, level_start: 50, level_end: 60 }).includes('"rate":"0.0"'), 'bateria que sube (cargando): 0 %/h, nunca negativo');
  const html = renderNightReportApps(r);
  assertEq(2, (html.match(/data-night-restrict=/g) || []).length, 'un boton por app');
  assertEq(true, html.includes('40 mAh'), 'mAh redondeado');
  assertEq(false, html.includes('com.<b'), 'nombres escapados');
  assertEq(1, (renderNightReportApps(r, 1).match(/data-night-restrict=/g) || []).length, 'respeta el limite');
  assertEq('', renderNightReportApps({ available: true, apps: [] }), 'sin apps: vacio');
}
