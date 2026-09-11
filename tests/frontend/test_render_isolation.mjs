// tests/frontend/test_render_isolation.mjs
//
// CRITICAL regression guard for v4.10.0's fix: Inicio's mode name stuck
// showing "Normal" even when something was genuinely active. Root cause:
// render()'s sequence of sub-renderers ran completely unguarded, one
// after another - an exception thrown by an EARLIER one (a malformed or
// unexpected value in this specific device's own battery/capabilities
// data, impossible to reproduce against every real device) aborted the
// whole render() call right there, so renderDashboard() (the one that
// actually sets the mode name) never even ran for that poll. If the
// same condition holds on every subsequent poll, the mode name freezes
// indefinitely. Fixed with safeRender(), a small per-call try/catch
// wrapper - this test verifies its actual isolation behavior directly.

import { assertTrue, extractConst } from './lib/harness.mjs';

export async function runTests() {
  const safeRender = extractConst('views/estado.js', 'safeRender');

  let secondRan = false;
  let loggedError = null;
  const realConsoleError = console.error;
  console.error = (...args) => { loggedError = args.join(' '); };
  try {
    safeRender(() => { throw new Error('fallo simulado en un renderizador anterior'); }, 'renderBattery');
    safeRender(() => { secondRan = true; }, 'renderDashboard');
  } finally {
    console.error = realConsoleError;
  }

  assertTrue(secondRan, 'un fallo en el primer renderizador NUNCA impide que el siguiente se ejecute - este era exactamente el bug real (renderDashboard nunca corria)');
  assertTrue(!!loggedError && loggedError.includes('renderBattery'), 'el fallo se registra en consola identificando que renderizador fue, para poder diagnosticarlo');

  let threw = false;
  console.error = () => {};
  try {
    safeRender(() => { throw new Error('otro fallo'); }, 'algo');
  } catch (e) {
    threw = true;
  } finally {
    console.error = realConsoleError;
  }
  assertTrue(!threw, 'safeRender nunca deja escapar la excepcion hacia quien lo llama');
}
