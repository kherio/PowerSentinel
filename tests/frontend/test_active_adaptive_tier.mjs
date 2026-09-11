// tests/frontend/test_active_adaptive_tier.mjs
//
// Regression guard for v4.6.0's fix: Inicio's own mode-name display used
// to recompute the adaptive tier independently from the raw pressure
// score (pressureScoreTier(), a plain no-hysteresis comparison) -
// completely separate from the daemon's real, hysteresis-protected
// decision. Even after the backend stopped flickering, this could have
// kept showing a possibly-different, self-recomputed answer that
// disagreed with what Actividad's own timeline said actually happened.
// activeAdaptiveTier() reads the real, authoritative state instead -
// sys.activeEvents, the exact same array driving the journal.

import { assertEq, loadModule } from './lib/harness.mjs';

export async function runTests() {
  const mod = await loadModule('views/estado.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const x = 1;"],
      [/import \{ toast, escapeHtml \} from '\.\.\/helpers\.js';/, "const toast=()=>{}; const escapeHtml=(s)=>String(s);"],
      [/import \{ t \} from '\.\.\/i18n\.js';/, "const t = (k) => k;"],
      [/import \{[^}]*\} from '\.\/log\.js';/, "const parseJournalLines=()=>[],filterBootRestartNoise=(x)=>x,renderTimelineEntry=()=>'',parseEnergyLines=()=>[],computeRecentRate=()=>null;"],
      [/import \{ parseConfig, serializeConfig \} from '\.\.\/config-form\.js';/, "const parseConfig=(t)=>JSON.parse(t), serializeConfig=(m)=>JSON.stringify(m);"]
    ],
    exportNames: ['activeAdaptiveTier']
  });
  const { activeAdaptiveTier } = mod;

  assertEq(0, activeAdaptiveTier({}), 'sin activeEvents en absoluto -> tier 0');
  assertEq(0, activeAdaptiveTier({ activeEvents: [] }), 'activeEvents vacio -> tier 0');
  assertEq(1, activeAdaptiveTier({ activeEvents: ['adaptive_tier1'] }), 'adaptive_tier1 activo -> tier 1');
  assertEq(2, activeAdaptiveTier({ activeEvents: ['screen_off', 'adaptive_tier2'] }), 'adaptive_tier2 junto a otro evento -> tier 2 (no se confunde con el otro evento)');
  assertEq(3, activeAdaptiveTier({ activeEvents: ['adaptive_tier3'] }), 'adaptive_tier3 activo -> tier 3');
  assertEq(0, activeAdaptiveTier({ activeEvents: ['night', 'manual'] }), 'eventos clasicos activos (sin ningun adaptive_tier) -> tier 0, no se inventa un tier de eventos no adaptativos');
}
