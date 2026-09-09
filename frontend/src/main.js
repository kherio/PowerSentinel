import './style.css';
import { LOCALE, applyStaticI18n, t } from './i18n.js';
import { ICONS } from './icons.js';
import { initViewportFix } from './helpers.js';
import { initEstado, activateEstado, deactivateEstado, refreshEstado } from './views/estado.js';
import { initConfig, activateConfig, deactivateConfig, confirmLeaveConfig, initAppsView, activateAppsView, deactivateAppsView } from './views/config.js';
import { initLog, activateLog, deactivateLog, refreshLog, refreshJournal } from './views/log.js';
import { initPerfiles, activatePerfiles, deactivatePerfiles } from './views/perfiles.js';
import { initAcerca, activateAcerca, deactivateAcerca } from './views/acerca.js';
import { initDiagnose, openDiagnosticsModal } from './views/diagnose.js';

// Orden de navegación: Inicio / Análisis / Automatización / Apps -
// las 4 acciones principales, siempre visibles en la barra inferior -
// seguidas de Perfiles/Ajustes, que solo se alcanzan a través del
// botón "Más" (redesign item "nav inferior reducida"). El orden de
// swipe sigue este mismo array: deslizar más allá de Apps lleva a
// Perfiles y luego a Ajustes, aunque no tengan su propio botón fijo.
// Las claves internas ('estado', 'conf', 'log', 'acerca') se
// mantienen sin cambios a propósito para no arrastrar renombrados a
// cada referencia del código ya probado; solo cambian las etiquetas
// visibles (i18n) y el orden de aparición.
const VIEWS = ['estado', 'log', 'conf', 'apps', 'perfiles', 'acerca'];
// Vistas con un botón propio en la barra inferior - el resto
// (perfiles, acerca) solo se resalta a través de "Más".
const PRIMARY_NAV_VIEWS = ['estado', 'log', 'conf', 'apps'];
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
  const activeName = VIEWS[index];
  VIEWS.forEach((name) => {
    document.getElementById(`view-${name}`).classList.toggle('active', name === activeName);
  });
  // Only the 4 primary views have their own bottom-nav button - the
  // rest (perfiles/acerca) are reached through "Más", which lights up
  // instead of a button that doesn't exist for them.
  PRIMARY_NAV_VIEWS.forEach((name) => {
    document.getElementById(`tab-btn-${name}`).classList.toggle('active', name === activeName);
  });
  document.getElementById('tab-btn-more').classList.toggle('active', !PRIMARY_NAV_VIEWS.includes(activeName));
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
    document.getElementById(`bn-icon-${name}`) && (document.getElementById(`bn-icon-${name}`).innerHTML = NAV_ICONS[name]);
    const btn = document.getElementById(`tab-btn-${name}`);
    if (!btn) return; // perfiles/acerca: no fixed button, reached via "Más"
    btn.addEventListener('click', () => {
      if (index === currentIndex) return;
      if (!confirmLeave(currentIndex)) return;
      commitToIndex(index);
    });
  });
}

// "Más" sheet: a lightweight bottom sheet (reuses the same
// .modal-overlay pattern already used for the basic/advanced mode
// picker) listing Perfiles, Ajustes, and a "Detalles técnicos"
// shortcut straight into Automatización - the same destination the
// existing "Ver ajustes avanzados" shortcut in Ajustes already uses,
// just reachable from one tap further down too.
function initMoreSheet() {
  const overlay = document.getElementById('more-sheet-overlay');
  const open = () => { overlay.style.display = 'flex'; };
  const close = () => { overlay.style.display = 'none'; };

  document.getElementById('bn-icon-more').innerHTML = ICONS.more;
  document.getElementById('more-icon-diagnose').innerHTML = ICONS.gauge;
  document.getElementById('more-icon-perfiles').innerHTML = NAV_ICONS.perfiles;
  document.getElementById('more-icon-acerca').innerHTML = NAV_ICONS.acerca;
  document.getElementById('more-icon-details').innerHTML = ICONS.settings;

  document.getElementById('tab-btn-more').addEventListener('click', open);
  document.getElementById('more-sheet-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Diagnóstico deliberately doesn't navigate to a tab like the other
  // items - it's a one-shot check-and-show-results panel, not a place
  // someone lives/edits things, so a modal (openDiagnosticsModal(),
  // estado.js) fits its "run it, read it, close it" nature better than
  // a full swipeable view would.
  document.getElementById('more-item-diagnose').addEventListener('click', () => {
    close();
    openDiagnosticsModal();
  });
  overlay.querySelectorAll('.more-sheet-item[data-view]').forEach((item) => {
    item.addEventListener('click', () => {
      close();
      const index = VIEWS.indexOf(item.dataset.view);
      if (index === -1 || index === currentIndex) return;
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
initMoreSheet();
initDiagnose();
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
