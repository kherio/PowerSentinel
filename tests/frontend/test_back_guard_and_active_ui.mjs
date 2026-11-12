// tests/frontend/test_back_guard_and_active_ui.mjs
//
// (1) System-Back guard: armed only while Automatización has unsaved
// edits; Back then asks, staying re-arms, leaving goes back; with no
// unsaved edits there is no sentinel at all (no extra Back press).
// (2) Markup/CSS/i18n for the "active now" banner and pill.
import fs from 'node:fs';
import { assertEq, setupDom } from './lib/harness.mjs';

export async function runTests() {
  setupDom(`<!DOCTYPE html><html><body></body></html>`);
  const src = fs.readFileSync(new URL('../../frontend/src/main.js', import.meta.url), 'utf8');
  const m = src.match(/function initBackGuard\(\) \{[\s\S]*?\n\}\n/);
  assertEq(true, !!m, 'initBackGuard existe en main.js');

  const calls = { push: 0, back: 0, confirm: 0 };
  let confirmAnswer = false;
  const listeners = {};
  const fakeHistory = { pushState() { calls.push++; }, back() { calls.back++; } };
  const fakeWindow = { addEventListener: (n, f) => { listeners[n] = f; }, confirm: () => { calls.confirm++; return confirmAnswer; } };
  const docListeners = {};
  const fakeDocument = { addEventListener: (n, f) => { docListeners[n] = f; } };
  const t = (k) => k;
  new Function('history', 'window', 'document', 't', m[0] + '\ninitBackGuard();')(fakeHistory, fakeWindow, fakeDocument, t);
  const dirty = (d) => docListeners['powersentinel:dirtychange']({ detail: { dirty: d } });

  listeners.popstate();
  assertEq(0, calls.confirm, 'sin cambios sin guardar: Back no pregunta');
  assertEq(0, calls.push, 'sin cambios sin guardar: no hay entrada centinela');

  dirty(true);
  assertEq(1, calls.push, 'al haber cambios se arma el centinela');
  dirty(true);
  assertEq(1, calls.push, 'no se arma dos veces');

  confirmAnswer = false; listeners.popstate();
  assertEq(1, calls.confirm, 'con cambios: Back pregunta');
  assertEq(2, calls.push, 'si se queda, se vuelve a armar');
  assertEq(0, calls.back, 'si se queda, no se sale');

  confirmAnswer = true; listeners.popstate();
  assertEq(1, calls.back, 'si confirma salir, se retrocede');

  // guardar: disarm quietly
  dirty(true);                       // arm again after leaving? (armed=false now)
  const pushesBefore = calls.push;
  dirty(false);
  assertEq(2, calls.back, 'al guardar se retira el centinela con un back propio');
  listeners.popstate();              // that own pop must not ask anything
  assertEq(2, calls.confirm, 'el popstate propio no pregunta');
  assertEq(true, pushesBefore >= 3, 'se armo de nuevo tras salir');

  const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  assertEq(true, html.includes('id="c-active-banner"'), 'banner de eventos activos en Automatizacion');
  const css = fs.readFileSync(new URL('../../frontend/src/style.css', import.meta.url), 'utf8');
  assertEq(true, css.includes('.event-card.is-active-now .event-active-pill { display: inline-block; }'), 'la pastilla ACTIVO se muestra en eventos activos');
  const i18n = fs.readFileSync(new URL('../../frontend/src/i18n.js', import.meta.url), 'utf8');
  for (const k of ['config.activeNowPill', 'config.activeBanner', 'config.noneActive']) {
    assertEq(2, (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "'", 'g')) || []).length, `${k} en ES y EN`);
  }
}
