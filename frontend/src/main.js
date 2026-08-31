import './style.css';
import { initViewportFix } from './helpers.js';
import { initEstado, activateEstado, deactivateEstado } from './views/estado.js';
import { initConfig, activateConfig, deactivateConfig, confirmLeaveConfig } from './views/config.js';
import { initLog, activateLog, deactivateLog } from './views/log.js';

const VIEWS = ['estado', 'conf', 'log'];
const LIFECYCLE = {
  estado: { activate: activateEstado, deactivate: deactivateEstado },
  conf: { activate: activateConfig, deactivate: deactivateConfig },
  log: { activate: activateLog, deactivate: deactivateLog }
};

let currentIndex = 0;

function confirmLeave(fromIndex) {
  // Only Config currently guards against unsaved changes; other views
  // have nothing to lose by switching away.
  if (VIEWS[fromIndex] === 'conf') return confirmLeaveConfig();
  return true;
}

function setTabActive(index) {
  VIEWS.forEach((name, i) => {
    document.getElementById(`tab-btn-${name}`).classList.toggle('active', i === index);
    document.getElementById(`view-${name}`).classList.toggle('active', i === index);
  });
}

function commitToIndex(newIndex) {
  if (newIndex === currentIndex) return;
  const oldIndex = currentIndex;
  currentIndex = newIndex;
  setTabActive(currentIndex);
  LIFECYCLE[VIEWS[oldIndex]].deactivate();
  LIFECYCLE[VIEWS[currentIndex]].activate();
}

function initTabButtons() {
  VIEWS.forEach((name, index) => {
    document.getElementById(`tab-btn-${name}`).addEventListener('click', () => {
      if (index === currentIndex) return;
      if (!confirmLeave(currentIndex)) return;
      commitToIndex(index);
    });
  });
}

// Swipe just switches tabs on release - it does not visually follow the
// finger mid-drag. An earlier version tried a live-dragging carousel
// (transform-based, tracking pane width in JS), but that kept rendering
// wider than the screen on-device across three different fix attempts
// (percentage flex sizing, then two different pixel-measurement
// strategies), all impossible to verify without a real browser in the
// development environment. This version has zero width/transform math
// at all - it can't have that class of bug - at the cost of the drag
// no longer visibly tracking the finger before release.
function initSwipeNav() {
  const THRESHOLD_PX = 60;
  let startX = null, startY = null, tracking = false;

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (Math.abs(dx) < THRESHOLD_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.3) return; // mostly-vertical, treat as scroll

    const targetIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1; // swipe left -> next, right -> previous
    if (targetIndex < 0 || targetIndex >= VIEWS.length) return;
    if (!confirmLeave(currentIndex)) return;
    commitToIndex(targetIndex);
  }, { passive: true });
}

initViewportFix();
initTabButtons();
initSwipeNav();

initEstado();
initConfig();
initLog();

// Estado starts active on load; the other two only start their polling
// once the user actually swipes/taps to them (see commitToIndex/LIFECYCLE).
activateEstado();
