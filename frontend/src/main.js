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

let currentView = 'estado';

function confirmLeave(fromView) {
  // Only Config currently guards against unsaved changes; other views
  // have nothing to lose by switching away.
  if (fromView === 'conf') return confirmLeaveConfig();
  return true;
}

function switchView(name) {
  if (name === currentView || VIEWS.indexOf(name) === -1) return;
  if (!confirmLeave(currentView)) return;

  document.getElementById(`view-${currentView}`).classList.remove('active');
  document.getElementById(`tab-btn-${currentView}`).classList.remove('active');
  LIFECYCLE[currentView].deactivate();

  currentView = name;

  document.getElementById(`view-${currentView}`).classList.add('active');
  document.getElementById(`tab-btn-${currentView}`).classList.add('active');
  LIFECYCLE[currentView].activate();
}

function initTabButtons() {
  VIEWS.forEach((name) => {
    document.getElementById(`tab-btn-${name}`).addEventListener('click', () => switchView(name));
  });
}

// Swipe anywhere on the app moves between Estado / Config / Log, in tab
// order. Mostly-vertical drags are ignored so normal scrolling still
// works. Unlike the old httpd/CGI pages (separate documents, full page
// navigation), this is a pure in-memory view swap - no reload, no
// beforeunload needed, and confirmLeave() runs synchronously first.
function initSwipeNav() {
  const THRESHOLD = 70;
  let startX = null, startY = null, tracking = false;

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!tracking || startX === null) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    startX = null; startY = null;

    if (Math.abs(dx) < THRESHOLD) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.3) return; // mostly-vertical, treat as scroll

    const idx = VIEWS.indexOf(currentView);
    const targetIdx = dx < 0 ? idx + 1 : idx - 1; // swipe left -> next tab, right -> previous
    if (targetIdx < 0 || targetIdx >= VIEWS.length) return;
    switchView(VIEWS[targetIdx]);
  }, { passive: true });
}

initViewportFix();
initTabButtons();
initSwipeNav();

initEstado();
initConfig();
initLog();

// Estado starts active on load; the other two only start their polling
// once the user actually switches to them (see switchView/LIFECYCLE).
activateEstado();
