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
let paneWidth = 0; // measured in real px, never a % - see setPaneWidths() below
const track = () => document.getElementById('view-track');

function confirmLeave(fromIndex) {
  // Only Config currently guards against unsaved changes; other views
  // have nothing to lose by switching away.
  if (VIEWS[fromIndex] === 'conf') return confirmLeaveConfig();
  return true;
}

// Measures the real viewport width and applies it as an explicit inline
// px width to the track (3 panes wide) and each pane - deliberately NOT
// percentages, and deliberately NOT measured from .view-viewport or any
// element inside this layout.
//
// Earlier attempt measured `.view-viewport.clientWidth` here, which
// seemed reasonable but was actually circular: before any width had
// been fixed, .view's own content (a metrics grid, core tiles, etc.)
// could size the flex track wider than the physical screen, and THAT
// inflated width is what clientWidth would report back - baking the
// exact bug this function exists to fix into its own measurement.
// window.innerWidth (with documentElement.clientWidth as a fallback) is
// the browser's own notion of the layout viewport, established
// independently of anything this page's CSS does, so it can't be
// inflated by our own content no matter what state that content is in.
function setPaneWidths() {
  paneWidth = window.innerWidth || document.documentElement.clientWidth;
  const t = track();
  t.style.width = (paneWidth * VIEWS.length) + 'px';
  Array.from(t.children).forEach((child) => {
    child.style.width = paneWidth + 'px';
  });
  goToIndex(currentIndex, 0);
}

function setTabActive(index) {
  VIEWS.forEach((name, i) => {
    document.getElementById(`tab-btn-${name}`).classList.toggle('active', i === index);
  });
}

// Animates (or, mid-drag, immediately applies) the track to `index`.
// `extraPx` is an additional live pixel offset used while the finger is
// still down (0 once settled). Everything here is plain pixels - no %.
function goToIndex(index, extraPx) {
  track().style.transform = `translateX(${-index * paneWidth + extraPx}px)`;
}

function commitToIndex(newIndex) {
  if (newIndex === currentIndex) { goToIndex(currentIndex, 0); return; }
  const oldIndex = currentIndex;
  currentIndex = newIndex;
  setTabActive(currentIndex);
  goToIndex(currentIndex, 0);
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

// Real-time swipe: the track follows the finger 1:1 during touchmove (no
// CSS transition while dragging, so there's zero lag), with a small
// rubber-band damping past the first/last pane. On release, either snaps
// forward to the next/previous pane (animated) or springs back to the
// current one, depending on how far the drag went.
function initSwipeNav() {
  const THRESHOLD_PX = 60;       // minimum drag to consider "intentional"
  const COMMIT_FRACTION = 0.28;  // or dragged past this fraction of the pane width
  let startX = null, startY = null, tracking = false, dragging = false;

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    dragging = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const touch = e.touches[0];
    let dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!dragging) {
      // Decide once per gesture whether this is a horizontal swipe or a
      // vertical scroll - once it's horizontal, commit to dragging the
      // track for the rest of this gesture.
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.3) { tracking = false; return; }
      dragging = true;
      track().classList.add('dragging');
    }

    // Once we're actually dragging the track horizontally, stop the page
    // from also scrolling/rubber-banding vertically underneath it - but
    // only from this point on, so a genuine vertical scroll (the early
    // returns above) is never touched.
    e.preventDefault();

    // Rubber-band resistance at the edges instead of a hard stop, so the
    // drag still visibly responds to the finger even when there's no
    // adjacent pane to reveal.
    if ((currentIndex === 0 && dx > 0) || (currentIndex === VIEWS.length - 1 && dx < 0)) {
      dx *= 0.35;
    }
    goToIndex(currentIndex, dx);
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    if (!dragging) return;
    dragging = false;
    track().classList.remove('dragging');

    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const fraction = paneWidth ? Math.abs(dx) / paneWidth : 0;

    let targetIndex = currentIndex;
    if (Math.abs(dx) > THRESHOLD_PX && fraction > COMMIT_FRACTION) {
      targetIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1;
    }
    targetIndex = Math.max(0, Math.min(VIEWS.length - 1, targetIndex));

    if (targetIndex !== currentIndex && !confirmLeave(currentIndex)) {
      targetIndex = currentIndex; // guard declined the swipe away from Config
    }
    commitToIndex(targetIndex);
  }, { passive: true });
}

initViewportFix();
initTabButtons();
initSwipeNav();

initEstado();
initConfig();
initLog();

setPaneWidths();
window.addEventListener('resize', setPaneWidths);
window.addEventListener('orientationchange', setPaneWidths);

// Estado starts active on load; the other two only start their polling
// once the user actually swipes/taps to them (see commitToIndex/LIFECYCLE).
activateEstado();
