import { ICONS } from '../icons.js';
import { readLog, exportLog } from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import { t } from '../i18n.js';

let rawLog = '';
let pollTimer = null;

const LEVEL_KEY = 'xbs-log-level';
const SCROLL_KEY = 'xbs-log-autoscroll';

function renderLog() {
  const logWrap = document.getElementById('l-log-wrap');
  const levelFilter = document.getElementById('l-level-filter');
  const autoscroll = document.getElementById('l-autoscroll');
  const filter = levelFilter.value;
  const lines = rawLog.split('\n').filter((l) => l.length);

  if (!lines.length) {
    logWrap.innerHTML = `<div class="log-empty">${t('log.noEntries')}</div>`;
    document.getElementById('l-log-count').textContent = '';
    return;
  }

  let shownCount = 0;
  logWrap.innerHTML = lines.map((line) => {
    const m = line.match(/\[(INFO|VERBOSE|DEBUG)\]/);
    const lvl = m ? m[1] : null;
    let cls = 'log-line' + (lvl ? ' lvl-' + lvl : '');
    if (filter !== 'ALL' && lvl !== filter) cls += ' hidden'; else shownCount++;
    return `<div class="${cls}">${escapeHtml(line)}</div>`;
  }).join('');

  document.getElementById('l-log-count').textContent = filter === 'ALL' ?
    t('log.linesCount', { n: lines.length }) : t('log.linesFiltered', { shown: shownCount, total: lines.length, level: filter });

  if (autoscroll.checked) logWrap.scrollTop = logWrap.scrollHeight;
}

async function loadLog(showToast) {
  try {
    rawLog = await readLog();
    renderLog();
    if (showToast) toast(t('log.updated'), 'success');
  } catch (e) {
    toast(t('log.loadError'), 'error');
  }
}

async function doExportLog() {
  try {
    const dest = await exportLog();
    toast(t('log.exportedTo', { dest }), 'success');
  } catch (e) {
    toast(t('log.exportError', { msg: e.message }), 'error');
  }
}

export function initLog() {
  const levelFilter = document.getElementById('l-level-filter');
  const autoscroll = document.getElementById('l-autoscroll');

  try {
    const savedLevel = localStorage.getItem(LEVEL_KEY);
    if (savedLevel) levelFilter.value = savedLevel;
    const savedScroll = localStorage.getItem(SCROLL_KEY);
    if (savedScroll !== null) autoscroll.checked = savedScroll === 'true';
  } catch (e) { /* localStorage may be unavailable/cleared - fall back to defaults */ }

  document.getElementById('l-refresh-btn').innerHTML = ICONS.reload;
  document.getElementById('l-refresh-btn').title = t('common.updateNow');
  document.getElementById('l-save-btn').innerHTML = ICONS.download + ' ' + t('log.export');

  levelFilter.addEventListener('change', () => {
    try { localStorage.setItem(LEVEL_KEY, levelFilter.value); } catch (e) {}
    renderLog();
  });
  autoscroll.addEventListener('change', () => {
    try { localStorage.setItem(SCROLL_KEY, autoscroll.checked); } catch (e) {}
    if (autoscroll.checked) {
      const logWrap = document.getElementById('l-log-wrap');
      logWrap.scrollTop = logWrap.scrollHeight;
    }
  });
  document.getElementById('l-refresh-btn').addEventListener('click', () => loadLog(true));
  document.getElementById('l-save-btn').addEventListener('click', doExportLog);
}

export function activateLog() {
  loadLog(false);
  if (!pollTimer) pollTimer = setInterval(() => loadLog(false), 4000);
}

export function deactivateLog() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Used by main.js's pull-to-refresh gesture.
export function refreshLog() {
  return loadLog(false);
}
