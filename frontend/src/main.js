import './style.css';
import { LOCALE, applyStaticI18n, t } from './i18n.js';
import { ICONS } from './icons.js';
import { initViewportFix } from './helpers.js';
import { initEstado, activateEstado, deactivateEstado, refreshEstado } from './views/estado.js';
import { initConfig, activateConfig, deactivateConfig, confirmLeaveConfig, initAppsView, activateAppsView, deactivateAppsView } from './views/config.js';
import { initLog, activateLog, deactivateLog, refreshLog, refreshJournal } from './views/log.js';
import { initPerfiles, activatePerfiles, deactivatePerfiles } from './views/perfiles.js';
import { initAcerca, activateAcerca, deactivateAcerca } from './views/acerca.js';

// Orden de navegación: Inicio / Perfiles / Automatización / Apps /
// Análisis / Ajustes - las claves internas ('estado', 'conf', 'log',
// 'acerca') se mantienen sin cambios a propósito para no arrastrar
// renombrados a cada referencia del código ya probado; solo cambian
// las etiquetas visibles (i18n) y el orden de aparición.
const VIEWS = ['estado', 'perfiles', 'conf', 'apps', 'log', 'acerca'];
const LIFECYCLE = {
  estado: { activate: activateEstado, deactivate: deactivateEstado },
  conf: { activate: activateConfig, deactivate: deactivateConfig },
  apps: { activate: activateAppsView, deactivate: deactivateAppsView },
  log: { activate: activateLog, deactivate: deactivateLog },
  perfiles: { activate: activatePerfiles, deactivate: deactivatePerfiles },
  acerca: { activate: activateAcerca, deactivate: deactivateAcerca }
};
const NAV_ICONS = { estado: ICONS.gauge, conf: ICONS.settings, apps: ICONS.apps, log: ICONS.list, perfiles: ICONS.layers, acerca: ICONS.info };

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
    document.getElementById(`bn-icon-${name}`).innerHTML = NAV_ICONS[name];
    document.getElementById(`tab-btn-${name}`).addEventListener('click', () => {
      if (index === currentIndex) return;
      if (!confirmLeave(currentIndex)) return;
      commitToIndex(index);
    });
  });
}

// Navegación programática entre pestañas desde fuera de este módulo -
// hoy solo la usa el botón "Ver ajustes avanzados" de Ajustes, para
// saltar directamente a Automatización sin acoplar ese módulo a los
// detalles internos de enrutado de éste.
function initProgrammaticNav() {
  document.addEventListener('powersentinel:navigate', (e) => {
    const targetView = e.detail && e.detail.view;
    const index = VIEWS.indexOf(targetView);
    if (index === -1 || index === currentIndex) return;
    if (!confirmLeave(currentIndex)) return;
    commitToIndex(index);
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

// Generic pull-to-refresh: only engages when the scrollable area is
// already scrolled to the very top (so it never fights a normal scroll
// gesture), grows an indicator proportionally to the drag, and fires
// `onRefresh` once the user releases past the threshold.
function initPullToRefresh(areaId, indicatorId, onRefresh) {
  const area = document.getElementById(areaId);
  const indicator = document.getElementById(indicatorId);
  if (!area || !indicator) return;
  const THRESHOLD = 60;
  let startY = null, dragging = false, refreshing = false;

  area.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || area.scrollTop > 0 || refreshing) { startY = null; return; }
    startY = e.touches[0].clientY;
    dragging = false;
  }, { passive: true });

  area.addEventListener('touchmove', (e) => {
    if (startY === null || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) return;
    dragging = true;
    const pull = Math.min(dy * 0.5, 70);
    indicator.style.height = pull + 'px';
    indicator.classList.toggle('ready', pull >= THRESHOLD);
    indicator.innerHTML = (pull >= THRESHOLD ? ICONS.reload : ICONS.chevron) +
      (pull >= THRESHOLD ? ' ' + t('common.releaseToRefresh') : ' ' + t('common.pullToRefresh'));
  }, { passive: true });

  area.addEventListener('touchend', () => {
    if (!dragging) { startY = null; return; }
    dragging = false;
    const wasReady = indicator.classList.contains('ready');
    indicator.style.height = wasReady ? '40px' : '0';
    startY = null;
    if (!wasReady) return;
    refreshing = true;
    indicator.classList.add('spinning');
    indicator.innerHTML = ICONS.reload + ' ' + t('common.refreshing');
    Promise.resolve(onRefresh()).finally(() => {
      indicator.classList.remove('spinning', 'ready');
      indicator.style.height = '0';
      refreshing = false;
    });
  }, { passive: true });
}

document.documentElement.lang = LOCALE;
applyStaticI18n();

initViewportFix();
initTabButtons();
initProgrammaticNav();
initSwipeNav();

initEstado();
initConfig();
initAppsView();
initLog();
initPerfiles();
initAcerca();

initPullToRefresh('e-pull-area', 'e-pull-indicator', refreshEstado);
initPullToRefresh('l-pull-area', 'l-pull-indicator', refreshLog);
initPullToRefresh('j-pull-area', 'j-pull-indicator', refreshJournal);

// Estado starts active on load; the rest only start their polling once
// the user actually swipes/taps to them (see commitToIndex/LIFECYCLE).
activateEstado();
