// tests/frontend/test_status_chips_all_events.mjs
//
// Inicio (classic mode): the profile chips must list EVERY event that
// exists in Automatización (predefined and custom), in that order -
// green with a check when active, dim when not - and the per-event
// "activó este perfil porque..." sentences are gone (the chips already
// say which events are on).

import { assertEq, setupDom, loadModule } from './lib/harness.mjs';

export async function runTests() {
  setupDom('<!DOCTYPE html><html><body><div id="e-profile-checklist"></div></body></html>');
  const mod = await loadModule('views/estado.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const readDrainComparison = async () => '{}'; const readConfig = async () => globalThis.__conf || '{}';"],
      [/import \{ toast, escapeHtml \} from '\.\.\/helpers\.js';/, "const toast=()=>{}; const escapeHtml=(s)=>String(s);"],
      [/import \{ t \} from '\.\.\/i18n\.js';/, "const t = (k) => k;"],
      [/import \{[^}]*\} from '\.\/log\.js';/, "const parseJournalLines=()=>[],filterBootRestartNoise=(x)=>x,renderTimelineEntry=()=>'',parseEnergyLines=()=>[],computeRecentRate=()=>null;"],
      [/import \{ parseConfig, serializeConfig \} from '\.\.\/config-form\.js';/, "const parseConfig=(t)=>({blocks:Object.keys(JSON.parse(t).events||{}).map((n)=>({name:n}))}), serializeConfig=(m)=>JSON.stringify(m);"]
    ],
    exportNames: ['buildWhyText']
  });
  const { buildWhyText, profileChipNames, renderProfileChecklist, refreshConfiguredEvents } = mod;

  assertEq('', buildWhyText({ activeEvents: ['boot', 'charging'] }), 'modo clasico: ya no hay frases "activó este perfil porque..."');

  assertEq('boot,charging,screen_off,low_power,night,thermal,manual', profileChipNames(null, []).join(','), 'sin config leida: la lista de eventos predefinidos');
  assertEq('boot,mi_evento,night', profileChipNames(['boot', 'mi_evento', 'night'], []).join(','), 'con config: los eventos de Automatizacion, personalizados incluidos y en su orden');
  assertEq('boot,night', profileChipNames(['boot', 'adaptive_tier1', 'night'], []).join(','), 'los niveles adaptativos no son perfiles en modo clasico');
  assertEq('boot,adaptive_tier1', profileChipNames(['boot', 'adaptive_tier1'], ['adaptive_tier1']).join(','), 'pero si uno esta activo, se muestra');
  assertEq('boot,night,otro', profileChipNames(['boot', 'night'], ['otro']).join(','), 'un evento activo que no esta en la config se anade igualmente');

  renderProfileChecklist({ activeEvents: ['boot', 'charging'] });
  const chips = [...document.querySelectorAll('#e-profile-checklist .profile-chip')];
  assertEq(7, chips.length, 'sin config: 7 chips');
  assertEq(2, chips.filter((c) => c.classList.contains('active')).length, 'solo los 2 eventos activos van en verde');
  assertEq(true, chips[0].textContent.startsWith('✓') && !chips[2].textContent.startsWith('✓'), 'el activo lleva check, el apagado no');
  assertEq(true, chips.every((c) => c.classList.contains('profile-chip')), 'todos son chips del mismo tipo (los apagados atenuados por CSS)');

  // Config drives the chips: a custom event appears (dim) next to the
  // predefined ones, and the active one stays green.
  globalThis.__conf = JSON.stringify({ events: { boot: {}, charging: {}, night: {}, gaming: {}, adaptive_tier2: {} } });
  const sys = { activeEvents: ['night'] };
  renderProfileChecklist(sys);
  await refreshConfiguredEvents();
  const after = [...document.querySelectorAll('#e-profile-checklist .profile-chip')];
  assertEq('dashboard.eventBoot,dashboard.eventCharging,dashboard.eventNight,gaming', after.map((c) => c.textContent.replace('✓ ', '')).join(','), 'tras leer la config: sus eventos (con el personalizado), sin el nivel adaptativo inactivo');
  assertEq('dashboard.eventNight', after.filter((c) => c.classList.contains('active')).map((c) => c.textContent.replace('✓ ', '')).join(','), 'solo el evento activo en verde');
}
