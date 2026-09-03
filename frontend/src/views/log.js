import { ICONS } from '../icons.js';
import { readLog, exportLog, readJournal } from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import { t } from '../i18n.js';

let rawLog = '';
let rawJournal = '';
let activeSubView = 'log';
let pollTimer = null;

const LEVEL_KEY = 'powersentinel-log-level';
const SCROLL_KEY = 'powersentinel-log-autoscroll';
const SEVERITY_KEY = 'powersentinel-journal-severity';

// ---------- Log (free-text) sub-view ----------

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

// ---------- Historial (Event Journal) sub-view ----------
//
// Journal entries are JSON Lines (one JSON object per line: ts/event/
// severity/message) written by PowerSentinel-journal.sh's emit() -
// every event transition and status change the daemon records, not
// just the handful that reach a real Android notification (see
// PowerSentinel-alertbridge.sh - only "critical" severity ever does).
// This view is the full history; a malformed/unparseable line is
// skipped rather than breaking the whole render, since the journal
// could in principle be read mid-write.

function parseJournalLines(text) {
  return text.split('\n').filter((l) => l.trim().length).map((line) => {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object' && obj.ts && obj.severity && obj.message) return obj;
    } catch (e) { /* skip unparseable line */ }
    return null;
  }).filter(Boolean);
}

function formatJournalTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderJournal() {
  const wrap = document.getElementById('j-journal-wrap');
  const severityFilter = document.getElementById('j-severity-filter');
  const filter = severityFilter.value;
  const entries = parseJournalLines(rawJournal);

  if (!entries.length) {
    wrap.innerHTML = `<div class="log-empty">${t('log.noEntries')}</div>`;
    document.getElementById('j-journal-count').textContent = '';
    return;
  }

  let shownCount = 0;
  // Most recent first - a running history reads more naturally newest-
  // on-top, unlike the free-text log (which the daemon already appends
  // oldest-first and autoscroll follows to the bottom for).
  wrap.innerHTML = entries.slice().reverse().map((entry) => {
    const isCritical = entry.severity === 'critical';
    let cls = 'log-line ' + (isCritical ? 'journal-critical' : 'journal-info');
    if (filter !== 'ALL' && entry.severity !== filter) cls += ' hidden'; else shownCount++;
    const badgeCls = isCritical ? 'critical' : 'info';
    const badgeLabel = isCritical ? t('log.severityCritical') : t('log.severityInfo');
    return `<div class="${cls}"><span class="journal-time">${formatJournalTime(entry.ts)}</span>` +
      `<span class="journal-badge ${badgeCls}">${escapeHtml(badgeLabel)}</span>${escapeHtml(entry.message)}</div>`;
  }).join('');

  document.getElementById('j-journal-count').textContent = filter === 'ALL' ?
    t('log.linesCount', { n: entries.length }) : t('log.linesFiltered', { shown: shownCount, total: entries.length, level: filter });
}

async function loadJournal(showToast) {
  try {
    rawJournal = await readJournal();
    renderJournal();
    if (showToast) toast(t('log.updated'), 'success');
  } catch (e) {
    toast(t('log.loadError'), 'error');
  }
}

// ---------- Sub-tab switching (same pattern as Config's Form/Text) ----------

function switchLogSubTab(view) {
  if (view === activeSubView) return;
  activeSubView = view;
  document.getElementById('l-view-log').style.display = view === 'log' ? 'block' : 'none';
  document.getElementById('l-view-journal').style.display = view === 'journal' ? 'block' : 'none';
  document.getElementById('l-tab-log').classList.toggle('active', view === 'log');
  document.getElementById('l-tab-journal').classList.toggle('active', view === 'journal');
}

export function initLog() {
  const levelFilter = document.getElementById('l-level-filter');
  const autoscroll = document.getElementById('l-autoscroll');
  const severityFilter = document.getElementById('j-severity-filter');

  try {
    const savedLevel = localStorage.getItem(LEVEL_KEY);
    if (savedLevel) levelFilter.value = savedLevel;
    const savedScroll = localStorage.getItem(SCROLL_KEY);
    if (savedScroll !== null) autoscroll.checked = savedScroll === 'true';
    const savedSeverity = localStorage.getItem(SEVERITY_KEY);
    if (savedSeverity) severityFilter.value = savedSeverity;
  } catch (e) { /* localStorage may be unavailable/cleared - fall back to defaults */ }

  document.getElementById('l-refresh-btn').innerHTML = ICONS.reload;
  document.getElementById('l-refresh-btn').title = t('common.updateNow');
  document.getElementById('l-save-btn').innerHTML = ICONS.download + ' ' + t('log.export');
  document.getElementById('j-refresh-btn').innerHTML = ICONS.reload;
  document.getElementById('j-refresh-btn').title = t('common.updateNow');

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
  severityFilter.addEventListener('change', () => {
    try { localStorage.setItem(SEVERITY_KEY, severityFilter.value); } catch (e) {}
    renderJournal();
  });

  document.getElementById('l-refresh-btn').addEventListener('click', () => loadLog(true));
  document.getElementById('l-save-btn').addEventListener('click', doExportLog);
  document.getElementById('j-refresh-btn').addEventListener('click', () => loadJournal(true));

  document.getElementById('l-tab-log').addEventListener('click', () => switchLogSubTab('log'));
  document.getElementById('l-tab-journal').addEventListener('click', () => switchLogSubTab('journal'));
}

export function activateLog() {
  loadLog(false);
  loadJournal(false);
  if (!pollTimer) pollTimer = setInterval(() => { loadLog(false); loadJournal(false); }, 4000);
}

export function deactivateLog() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Used by main.js's pull-to-refresh gesture on each sub-view.
export function refreshLog() {
  return loadLog(false);
}

export function refreshJournal() {
  return loadJournal(false);
}
