// tests/frontend/test_simple_advanced_mode.mjs
//
// v4.19.0 modo sencillo/avanzado: (1) mode.js alterna body.advanced y
// persiste en la misma clave que ya usaba Automatización; (2) el
// markup real marca como .adv-only lo que el usuario normal no debe
// ver, y NO marca lo esencial (batería, modo actual, «Hoy»); (3) la
// regla CSS que oculta .adv-only existe.
import fs from 'node:fs';
import { assertEq, setupDom, loadModule } from './lib/harness.mjs';

export async function runTests() {
  setupDom(`<!DOCTYPE html><html><body><input type="checkbox" id="more-advanced-toggle"></body></html>`);
  const mod = await loadModule('mode.js', { replacements: [] });
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };

  assertEq(false, mod.isAdvancedMode(), 'sin preferencia guardada: modo sencillo');
  mod.applyGlobalMode();
  assertEq(false, document.body.classList.contains('advanced'), 'sencillo: body sin .advanced');

  mod.setAdvancedMode(true);
  assertEq('true', store['powersentinel-advanced-mode'], 'se persiste en la clave heredada de Automatización');
  assertEq(true, document.body.classList.contains('advanced'), 'avanzado: body.advanced');
  assertEq(true, document.getElementById('more-advanced-toggle').checked, 'el interruptor refleja el modo');

  mod.setAdvancedMode(false);
  assertEq(false, document.body.classList.contains('advanced'), 'volver a sencillo quita .advanced');

  const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  const hasAdv = (id) => new RegExp(`<[^>]*class="[^"]*\\badv-only\\b[^"]*"[^>]*id="${id}"|<[^>]*id="${id}"[^>]*class="[^"]*\\badv-only\\b`).test(html);
  for (const id of ['e-nightwake-card', 'e-tech-details-body', 'e-cpu-summary-row', 'e-tech-details-toggle', 'e-pressure-wrap', 'e-dashboard-detail-toggle', 'more-item-diagnose', 'more-item-details']) {
    assertEq(true, hasAdv(id), `${id} es solo-avanzado`);
  }
  for (const id of ['e-battery-card', 'e-today-card', 'e-dashboard-mode-name', 'e-dashboard-why', 'e-dashboard-mechanisms']) {
    assertEq(false, hasAdv(id), `${id} se ve en modo sencillo`);
  }
  const css = fs.readFileSync(new URL('../../frontend/src/style.css', import.meta.url), 'utf8');
  assertEq(true, /body:not\(\.advanced\) \.adv-only \{ display: none !important; \}/.test(css), 'regla CSS que oculta .adv-only');
}
