// tests/frontend/test_why_lists_all_active.mjs
//
// Inicio's "por qué" paragraph (classic mode) used to explain only the
// FIRST active event, so with boot + charging active it never mentioned
// charging. It must list one line per active event (each with its icon).

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
      [/import \{ parseConfig, serializeConfig \} from '\.\.\/config-form\.js';/, "const parseConfig=(t)=>JSON.parse(t), serializeConfig=(m)=>JSON.stringify(m);"]
    ],
    exportNames: ['buildWhyText']
  });
  const { buildWhyText } = mod;

  assertEq('', buildWhyText({ activeEvents: [] }), 'sin eventos activos no hay texto');

  const one = buildWhyText({ activeEvents: ['boot'] });
  assertEq(true, one.includes('dashboard.whyBoot') && !one.includes('\n'), 'un evento: una sola linea');

  const two = buildWhyText({ activeEvents: ['boot', 'charging'] });
  const lines = two.split('\n');
  assertEq(2, lines.length, 'dos eventos activos: dos lineas');
  assertEq(true, lines[0].includes('dashboard.whyBoot') && lines[1].includes('dashboard.whyCharging'), 'cada linea explica su evento, en orden');
  assertEq(true, lines[0].startsWith('🔌') && lines[1].startsWith('🔋'), 'cada linea lleva el icono de su evento');

  const adaptive = buildWhyText({ activeEvents: ['boot', 'charging'], pressureBreakdown: { battery: 0 } });
  assertEq(false, adaptive.includes('dashboard.whyBoot'), 'el modo adaptativo mantiene su propio texto (no cambia)');
}
