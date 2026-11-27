// tests/frontend/test_app_drain_picker.mjs
//
// Apps picker: the per-app battery estimate (PowerSentinel-appdrain) is
// parsed defensively (bad/unavailable output -> picker works as before),
// the "sort by usage" option puts the heaviest apps first and apps with no
// figure last in their original order, and the mAh label is compact.

import { assertEq, setupDom, loadModule } from './lib/harness.mjs';

export async function runTests() {
  setupDom('<!DOCTYPE html><html><body></body></html>');
  const mod = await loadModule('views/apps-picker.js', {
    replacements: [
      [/import \{ ICONS \} from '\.\.\/icons\.js';/, 'const ICONS = {};'],
      [/import \{[^}]*\} from '\.\.\/api\.js';/, "const listPackages=async()=>[],listRunningPackages=async()=>new Set(),readAppListFile=async()=>'',writeAppListFile=async()=>{},readAppDrain=async()=>'{}',startAppDrainMeasurement=async()=>'{}';"],
      [/import \{ toast \} from '\.\.\/helpers\.js';/, 'const toast=()=>{};'],
      [/import \{ t \} from '\.\.\/i18n\.js';/, 'const t = (k) => k;']
    ]
  });
  const { parseDrain, sortByDrain, formatMah, groupPackages } = mod;

  const good = JSON.stringify({ available: true, window: 'snapshot', since: 1000, elapsed_s: 1200,
    apps: [{ pkg: 'com.b', mah: 12.5, fg: 0, bg: 12, cached: 0.5, shared: 1 }, { pkg: 'com.a', mah: 40, fg: 1, bg: 39, cached: 0, shared: 2 }] });
  const d = parseDrain(good);
  assertEq(true, d.available, 'salida valida: disponible');
  assertEq(40, d.map['com.a'].mah, 'indexado por paquete');
  assertEq('snapshot', d.window, 'ventana de snapshot');
  assertEq(1200, d.elapsed, 'tiempo transcurrido');

  assertEq(false, parseDrain('not json').available, 'basura: no disponible, sin excepcion');
  assertEq(false, parseDrain('').available, 'vacio: no disponible');
  assertEq(false, parseDrain('{"available":false,"apps":[]}').available, 'el script dice no disponible');
  assertEq(0, Object.keys(parseDrain('{"available":true}').map).length, 'sin apps: mapa vacio');

  const pk = ['com.a', 'com.b', 'com.c', 'com.d'];
  assertEq('com.a,com.b,com.c,com.d', sortByDrain(pk, d.map).join(','), 'mayor consumo primero; sin dato al final en orden original');
  assertEq('com.a,com.b,com.c,com.d', sortByDrain(pk, {}).join(','), 'sin datos: orden original intacto');
  assertEq('com.b,com.a,com.c', sortByDrain(['com.b', 'com.a', 'com.c'], { 'com.b': { mah: 5 }, 'com.a': { mah: 5 } }).join(','), 'empate: orden original (estable)');

  assertEq('334', formatMah(334.2), '>=100: entero');
  assertEq('12', formatMah(12.4), '10-100: entero');
  assertEq('1.5', formatMah(1.46), '<10: un decimal');

  // Order: selected, then running (green dot), then the rest; alphabetical
  // inside each group.
  const all = ['a.one', 'b.two', 'c.three', 'd.four', 'e.five', 'f.six'];
  const g = groupPackages(all, new Set(['e.five']), new Set(['a.one']), new Set(['b.two', 'd.four', 'a.one']), null);
  assertEq('a.one,e.five', g.selected.join(','), 'seleccionadas primero (aunque esten en ejecucion)');
  assertEq('b.two,d.four', g.live.join(','), 'luego las que tienen proceso, sin repetir las seleccionadas');
  assertEq('c.three,f.six', g.rest.join(','), 'el resto al final');
  const g2 = groupPackages(all, new Set(), new Set(), new Set(), null);
  assertEq('', g2.live.join(','), 'sin procesos: grupo vacio');
  assertEq(all.join(','), g2.rest.join(','), 'sin seleccion ni procesos: orden original');
  const g3 = groupPackages(all, new Set(), new Set(), new Set(['b.two', 'd.four']), (x) => sortByDrain(x, { 'd.four': { mah: 9 }, 'b.two': { mah: 1 } }));
  assertEq('d.four,b.two', g3.live.join(','), 'ordenar por consumo se aplica dentro de cada grupo');
}
