// tests/frontend/test_filter_boot_restart_noise.mjs
//
// Regression guard for v4.4.0's fix: "boot" flickering in and out of
// Actividad continuously. Not a bug in the event logic itself - "boot"
// only ever activates once, at daemon startup, and state_reconcile()
// correctly undoes whatever the previous run left active first. But if
// the daemon itself dies and gets relaunched repeatedly (service.sh's
// own 60s watchdog), every relaunch produces a "boot ended" immediately
// followed by a fresh "boot started" - daemon-internal bookkeeping
// noise from an invisible restart, not a meaningful transition a person
// asked to see. filterBootRestartNoise() strips exactly that pair
// (within 15 real seconds) from any view built from journal entries.

import { assertEq, loadModule } from './lib/harness.mjs';

export async function runTests() {
  const mod = await loadModule('views/log.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const readLog=async()=>'',readJournal=async()=>'',readEnergyLog=async()=>'',exportLog=async()=>'';"],
      [/import \{ toast, escapeHtml \} from '\.\.\/helpers\.js';/, "const toast=()=>{}; const escapeHtml=(s)=>String(s);"],
      [/import \{ t \} from '\.\.\/i18n\.js';/, "const t = (k) => k;"],
      [/import \{ eventDisplayName, eventIcon \} from '\.\/estado\.js';/, "const eventDisplayName=(n)=>n, eventIcon=()=>'';"]
    ]
  });
  const { filterBootRestartNoise } = mod;

  const restart = (ts) => [
    { ts, event: 'boot', message: 'boot ended' },
    { ts: ts + 2, event: 'boot', message: 'boot started' }
  ];

  const entries = [
    { ts: 1000, event: 'screen_off', message: 'screen_off started' },
    ...restart(1500),
    { ts: 2000, event: 'night', message: 'night started' }
  ];
  const filtered = filterBootRestartNoise(entries);
  assertEq(2, filtered.length, 'un reinicio real del demonio (boot ended + started en 2s) se filtra por completo');
  assertEq(['screen_off started', 'night started'], filtered.map((e) => e.message), 'quedan solo las entradas reales, sin el par de reinicio');

  const isolatedBoot = [
    { ts: 1000, event: 'boot', message: 'boot started' },
    { ts: 2000, event: 'night', message: 'night started' }
  ];
  assertEq(2, filterBootRestartNoise(isolatedBoot).length, 'un "boot started" aislado (arranque real del dispositivo) nunca se filtra');

  const tooSlow = [
    { ts: 1000, event: 'boot', message: 'boot ended' },
    { ts: 1060, event: 'boot', message: 'boot started' }
  ];
  assertEq(2, filterBootRestartNoise(tooSlow).length, 'boot ended seguido de started con 60s de diferencia (demasiado lento para ser un reinicio) no se filtra');

  assertEq(0, filterBootRestartNoise([]).length, 'lista vacia no rompe nada');
}
