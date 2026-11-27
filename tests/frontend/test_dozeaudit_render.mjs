// tests/frontend/test_dozeaudit_render.mjs
//
// Doze-exemption list: only user-added exemptions get a "Remove" button
// (system ones are shown as plain text), removable apps come first, names
// are escaped, and unavailable/empty data render a hint instead of failing.

import { assertEq, loadModule } from './lib/harness.mjs';

export async function runTests() {
  const mod = await loadModule('views/estado.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const x = 1;"],
      [/import \{ toast, escapeHtml \} from '\.\.\/helpers\.js';/, "const toast=()=>{}; const escapeHtml=(s)=>String(s).replace(/</g,'&lt;');"],
      [/import \{ t \} from '\.\.\/i18n\.js';/, "const t = (k) => k;"],
      [/import \{[^}]*\} from '\.\/log\.js';/, "const parseJournalLines=()=>[],filterBootRestartNoise=(x)=>x,renderTimelineEntry=()=>'',parseEnergyLines=()=>[],computeRecentRate=()=>null;"],
      [/import \{ parseConfig, serializeConfig \} from '\.\.\/config-form\.js';/, "const parseConfig=(t)=>JSON.parse(t), serializeConfig=(m)=>JSON.stringify(m);"]
    ]
  });
  const { renderDozeAudit } = mod;
  const html = renderDozeAudit({ available: true, apps: [
    { pkg: 'com.z.sys', kind: 'system', removable: false },
    { pkg: 'com.b.user', kind: 'user', removable: true },
    { pkg: 'com.a.user', kind: 'user', removable: true }] });
  assertEq(2, (html.match(/data-doze-remove=/g) || []).length, 'solo las 2 apps de usuario tienen boton');
  assertEq(true, html.indexOf('com.a.user') < html.indexOf('com.b.user') && html.indexOf('com.b.user') < html.indexOf('com.z.sys'), 'removibles primero, alfabeticas; sistema al final');
  assertEq(true, html.includes('estado.dozeauditSystem'), 'las de sistema se marcan como tales');
  assertEq(true, renderDozeAudit({ available: false, apps: [] }).includes('dozeauditUnavailable'), 'no disponible: aviso');
  assertEq(true, renderDozeAudit({ available: true, apps: [] }).includes('dozeauditEmpty'), 'lista vacia: aviso');
  assertEq(true, renderDozeAudit(null).includes('dozeauditUnavailable'), 'null: aviso, sin excepcion');
  assertEq(false, renderDozeAudit({ available: true, apps: [{ pkg: '<b>x', removable: true }] }).includes('<b>x'), 'nombres escapados');
}
