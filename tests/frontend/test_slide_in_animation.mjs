// tests/frontend/test_slide_in_animation.mjs
//
// Covers main.js's playSlideInAnimation() (v4.8.0, "que se note el
// swipe"): applies the class matching the direction of travel, and
// removes it once the animation finishes so a later, unrelated display
// toggle of that same view can never accidentally replay it. Also
// verifies rapid back-and-forth navigation restarts the animation
// (removes any stale class before re-adding) rather than leaving the
// element in a mixed state.

import { assertEq, assertTrue, setupDom, extractFunction } from './lib/harness.mjs';

export async function runTests() {
  const playSlideInAnimation = extractFunction('main.js', 'playSlideInAnimation');

  setupDom('<!DOCTYPE html><html><body><div id="view-conf" class="active"></div></body></html>');
  const el = document.getElementById('view-conf');

  playSlideInAnimation('conf', 'forward');
  assertTrue(el.classList.contains('slide-in-from-right'), 'direccion forward aplica slide-in-from-right');
  assertTrue(!el.classList.contains('slide-in-from-left'), 'no aplica la clase contraria a la vez');

  el.dispatchEvent(new window.Event('animationend'));
  assertTrue(!el.classList.contains('slide-in-from-right'), 'la clase se quita sola al terminar la animacion (animationend)');

  playSlideInAnimation('conf', 'back');
  assertTrue(el.classList.contains('slide-in-from-left'), 'direccion back aplica slide-in-from-left');
  assertTrue(el.classList.contains('active'), 'la clase active (ajena a la animacion) nunca se toca');

  // Navegacion rapida de ida y vuelta antes de que termine la animacion
  // anterior: no debe quedar con las dos clases a la vez.
  playSlideInAnimation('conf', 'forward');
  assertTrue(el.classList.contains('slide-in-from-right'), 'un segundo cambio de direccion antes de terminar aplica la nueva clase');
  assertTrue(!el.classList.contains('slide-in-from-left'), 'y quita la anterior, sin quedarse con ambas a la vez');
}
