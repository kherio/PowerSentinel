import { ICONS } from '../icons.js';
import { readLog, exportLog, readJournal, readEnergyLog } from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import { t } from '../i18n.js';
import { eventDisplayName, eventIcon } from './estado.js';

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

export function parseJournalLines(text) {
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

// "Timeline de actividad" del roadmap: convierte las entradas ya
// existentes del journal ("night started" + su detalle de mecanismos
// resueltos, "night ended", avisos de capacidad) en algo legible,
// reutilizando exactamente el mismo icono/nombre de evento que ya usa
// el dashboard de Estado (eventDisplayName/eventIcon), para que un
// mismo evento se vea siempre igual en toda la app.
function timelineMechanismPhrases(detail) {
  if (!detail) return [];
  const on = (v) => v && v !== 'false';
  const phrases = [];
  if (on(detail.handle_cores)) phrases.push(t('journal.mechCores'));
  if (detail.doze === 'light') phrases.push(t('journal.mechDozeLight'));
  else if (detail.doze === 'deep') phrases.push(t('journal.mechDozeDeep'));
  if (on(detail.handle_apps)) phrases.push(t('journal.mechApps'));
  if (on(detail.handle_gms)) phrases.push(t('journal.mechGms'));
  if (detail.kill_wifi === 'true') phrases.push(t('journal.mechWifi'));
  if (detail.low_ram === 'true') phrases.push(t('journal.mechLowRam'));
  return phrases;
}

export function renderTimelineEntry(entry) {
  const time = formatJournalTime(entry.ts);
  if (entry.severity === 'warning' || entry.severity === 'critical') {
    return `<div class="timeline-entry timeline-warning">` +
      `<div class="timeline-main"><span class="timeline-dot dot-warn"></span><span class="timeline-time">${time}</span>⚠️ ${escapeHtml(entry.message)}</div>` +
      `</div>`;
  }
  const startedMatch = /^(.+) started$/.exec(entry.message);
  const endedMatch = /^(.+) ended$/.exec(entry.message);
  if (startedMatch) {
    const name = eventDisplayName(entry.event);
    const phrases = timelineMechanismPhrases(entry.detail);
    return `<div class="timeline-entry">` +
      `<div class="timeline-main"><span class="timeline-dot dot-start"></span><span class="timeline-time">${time}</span>${eventIcon(entry.event)} ${escapeHtml(t('journal.entered', { mode: name }))}</div>` +
      phrases.map((p) => `<div class="timeline-sub"><span class="timeline-time"></span>${escapeHtml(p)}</div>`).join('') +
      `</div>`;
  }
  if (endedMatch) {
    const name = eventDisplayName(entry.event);
    return `<div class="timeline-entry">` +
      `<div class="timeline-main"><span class="timeline-dot dot-end"></span><span class="timeline-time">${time}</span>${eventIcon(entry.event)} ${escapeHtml(t('journal.exited', { mode: name }))}</div>` +
      `<div class="timeline-sub"><span class="timeline-time"></span>${escapeHtml(t('journal.restored'))}</div>` +
      `</div>`;
  }
  // Cualquier otra entrada (appwatch, safemode...) - se muestra como
  // hasta ahora, sin intentar reinterpretarla como una transición de
  // evento que no es.
  const isCritical = entry.severity === 'critical';
  const badgeCls = isCritical ? 'critical' : 'info';
  const badgeLabel = isCritical ? t('log.severityCritical') : t('log.severityInfo');
  return `<div class="log-line ${isCritical ? 'journal-critical' : 'journal-info'}">` +
    `<span class="journal-time">${time}</span><span class="journal-badge ${badgeCls}">${escapeHtml(badgeLabel)}</span>${escapeHtml(entry.message)}</div>`;
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
    const matchesFilter = filter === 'ALL' || entry.severity === filter;
    if (matchesFilter) shownCount++;
    const html = renderTimelineEntry(entry);
    return matchesFilter ? html : html.replace('<div class="timeline-entry', '<div class="hidden timeline-entry').replace('<div class="log-line ', '<div class="hidden log-line ');
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

// ---------- Energy log analysis ----------
// The daemon only ever collects this (PowerSentinel-energylog.sh) -
// deliberately no analysis or conclusions baked in there, since
// building a view before there was real data to look at would mean
// guessing what the data would even look like. Now that samples
// genuinely accumulate over real usage, this is that follow-up.
//
// A malformed/unparseable line is skipped rather than breaking the
// whole render, same reasoning as parseJournalLines above - the file
// could in principle be read mid-write.
function parseEnergyLines(text) {
  return text.split('\n').filter((l) => l.trim().length).map((line) => {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.ts === 'number' && typeof obj.battery === 'number') return obj;
    } catch (e) { /* skip unparseable line */ }
    return null;
  }).filter(Boolean).sort((a, b) => a.ts - b.ts);
}

// Attributes each interval's battery drop to whatever was active at
// the START of that interval, then averages minutes-per-1%-battery
// per distinct "regime" (the exact active-events string at the time) -
// directly answering the project's own stated goal of checking
// whether a given setting genuinely slows discharge, rather than
// assuming it does. Charging intervals are excluded entirely (a
// battery going up, or holding steady while plugged in, isn't a
// "Salud energética" del roadmap: consumo reciente (%/h) y comparación
// con la media histórica - la MISMA función sirve para ambas ventanas,
// solo cambia cuántas horas hacia atrás se consideran. Reutiliza
// exactamente la misma exclusión de tramos cargando ya establecida en
// computeDischargeRates (una batería subiendo o estable enchufada no
// es una tasa de descarga real).
function computeRecentRate(samples, hoursBack) {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  const cutoff = hoursBack ? last.ts - hoursBack * 3600 : -Infinity;
  const scoped = samples.filter((s) => s.ts >= cutoff);
  let totalDrop = 0, totalSeconds = 0;
  for (let i = 1; i < scoped.length; i++) {
    const prev = scoped[i - 1], cur = scoped[i];
    if (prev.charging === 'true' || cur.charging === 'true') continue;
    const drop = prev.battery - cur.battery;
    const seconds = cur.ts - prev.ts;
    if (drop <= 0 || seconds <= 0) continue;
    totalDrop += drop;
    totalSeconds += seconds;
  }
  if (totalSeconds === 0) return null;
  return totalDrop / (totalSeconds / 3600);
}

// "Momento de mayor gasto": agrupa cada tramo de descarga por la HORA
// del día en la que empezó (0-23), sumando a lo largo de todos los
// días registrados, y devuelve la hora con mayor tasa media. Una
// simplificación deliberada frente a buscar el intervalo aislado de
// mayor caída: con un log que solo registra en cada cambio (no a
// intervalo fijo), un único tramo corto puede dar una tasa extrapolada
// muy ruidosa: agrupar por hora del día busca un patrón que se repite
// entre días, no un pico aislado y probablemente casual.
function computePeakHour(samples) {
  const hourTotals = {};
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1], cur = samples[i];
    if (prev.charging === 'true' || cur.charging === 'true') continue;
    const drop = prev.battery - cur.battery;
    const seconds = cur.ts - prev.ts;
    if (drop <= 0 || seconds <= 0) continue;
    const hour = new Date(prev.ts * 1000).getHours();
    if (!hourTotals[hour]) hourTotals[hour] = { drop: 0, seconds: 0 };
    hourTotals[hour].drop += drop;
    hourTotals[hour].seconds += seconds;
  }
  let bestHour = null, bestRate = -Infinity;
  Object.keys(hourTotals).forEach((h) => {
    const rate = hourTotals[h].drop / (hourTotals[h].seconds / 3600);
    if (rate > bestRate) { bestRate = rate; bestHour = parseInt(h, 10); }
  });
  return bestHour === null ? null : { hour: bestHour, ratePerHour: bestRate };
}

function formatHourRange(hour) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hour)}:00–${pad((hour + 1) % 24)}:00`;
}

// discharge rate). Higher minutes-per-1% is better (the battery lasts
// longer under that regime).
function computeDischargeRates(samples) {
  const totals = {};
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev.charging === 'true' || cur.charging === 'true') continue;
    const drop = prev.battery - cur.battery;
    const seconds = cur.ts - prev.ts;
    if (drop <= 0 || seconds <= 0) continue;
    const regime = prev.active && prev.active.trim() ? prev.active.trim() : t('energy.noActiveRegime');
    if (!totals[regime]) totals[regime] = { seconds: 0, drop: 0 };
    totals[regime].seconds += seconds;
    totals[regime].drop += drop;
  }
  return Object.keys(totals).map((regime) => ({
    regime,
    minutesPerPercent: (totals[regime].seconds / 60) / totals[regime].drop
  })).sort((a, b) => b.minutesPerPercent - a.minutesPerPercent);
}

function energySparkline(values, w, h, min, max) {
  if (values.length < 2) return '';
  const range = (max - min) || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - ((v - min) / range) * h]);
  return 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
}

let energySamples = [];

async function loadEnergyLog() {
  const summary = document.getElementById('energy-summary');
  summary.innerHTML = `<p class="hint">${escapeHtml(t('energy.loading'))}</p>`;
  try {
    const text = await readEnergyLog();
    energySamples = parseEnergyLines(text);
    renderEnergyView();
  } catch (e) {
    summary.innerHTML = `<p class="hint">${escapeHtml(t('energy.error', { msg: e.message }))}</p>`;
  }
}

// "Salud energética": tasa reciente (últimas 6h) comparada contra el
// histórico ANTERIOR a ese tramo (no solapado, para que la comparación
// sea limpia) y el momento de mayor gasto habitual.
function renderEnergyHealth() {
  const el = document.getElementById('energy-health');
  const last = energySamples[energySamples.length - 1];
  const recentCutoff = last.ts - 6 * 3600;
  const recentSamples = energySamples.filter((s) => s.ts >= recentCutoff);
  const olderSamples = energySamples.filter((s) => s.ts < recentCutoff);

  const recentRate = computeRecentRate(recentSamples, null);
  const baselineRate = olderSamples.length >= 2 ? computeRecentRate(olderSamples, null) : null;
  const peak = computePeakHour(energySamples);

  const parts = [];
  if (recentRate !== null) {
    parts.push(`<div class="energy-health-row"><span class="energy-health-label">${escapeHtml(t('energy.recentRate'))}</span><span class="energy-health-value">${recentRate.toFixed(1)}%/h</span></div>`);
    if (baselineRate !== null && baselineRate > 0) {
      const cmpText = recentRate < baselineRate ? t('energy.betterThanAverage') : t('energy.worseThanAverage');
      parts.push(`<p class="hint">${escapeHtml(cmpText)}</p>`);
    }
  } else {
    parts.push(`<p class="hint">${escapeHtml(t('energy.noRecentData'))}</p>`);
  }
  if (peak) {
    parts.push(`<div class="energy-health-row"><span class="energy-health-label">${escapeHtml(t('energy.peakLabel'))}</span><span class="energy-health-value">${escapeHtml(formatHourRange(peak.hour))}</span></div>`);
  }
  el.innerHTML = parts.join('');
}

function renderEnergyView() {
  const summary = document.getElementById('energy-summary');
  const healthEl = document.getElementById('energy-health');
  if (energySamples.length < 2) {
    summary.innerHTML = `<p class="hint">${escapeHtml(t('energy.notEnoughData'))}</p>`;
    document.getElementById('energy-chart').innerHTML = '';
    document.getElementById('energy-chart-legend').innerHTML = '';
    document.getElementById('energy-regimes').innerHTML = '';
    healthEl.innerHTML = `<p class="hint">${escapeHtml(t('energy.notEnoughData'))}</p>`;
    return;
  }

  renderEnergyHealth();

  const first = energySamples[0];
  const last = energySamples[energySamples.length - 1];
  const spanHours = ((last.ts - first.ts) / 3600).toFixed(1);
  summary.innerHTML = `<p class="hint">${escapeHtml(t('energy.summary', { n: energySamples.length, hours: spanHours }))}</p>`;

  const dayAgo = last.ts - 24 * 3600;
  const recent = energySamples.filter((s) => s.ts >= dayAgo);
  const chartSamples = recent.length >= 2 ? recent : energySamples;
  const w = 300, h = 90;
  const batteryPath = energySparkline(chartSamples.map((s) => s.battery), w, h, 0, 100);
  document.getElementById('energy-chart').innerHTML =
    batteryPath ? `<path d="${batteryPath}" fill="none" stroke="var(--accent)" stroke-width="2"></path>` : '';
  document.getElementById('energy-chart-legend').innerHTML =
    `<span>${escapeHtml(formatEnergyTime(chartSamples[0].ts))}</span><span>${escapeHtml(formatEnergyTime(chartSamples[chartSamples.length - 1].ts))}</span>`;

  const rates = computeDischargeRates(energySamples);
  const regimesEl = document.getElementById('energy-regimes');
  if (rates.length === 0) {
    regimesEl.innerHTML = `<p class="hint">${escapeHtml(t('energy.noDischargeData'))}</p>`;
  } else {
    regimesEl.innerHTML = rates.map((r) =>
      `<div class="energy-regime-row"><span class="energy-regime-name">${escapeHtml(r.regime)}</span>` +
      `<span class="energy-regime-rate">${r.minutesPerPercent.toFixed(1)} ${escapeHtml(t('energy.minPerPercent'))}</span></div>`
    ).join('');
  }
}

function formatEnergyTime(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---------- Sub-tab switching (same pattern as Config's Form/Text) ----------

function switchLogSubTab(view) {
  if (view === activeSubView) return;
  activeSubView = view;
  document.getElementById('l-view-log').style.display = view === 'log' ? 'block' : 'none';
  document.getElementById('l-view-journal').style.display = view === 'journal' ? 'block' : 'none';
  document.getElementById('l-view-energy').style.display = view === 'energy' ? 'block' : 'none';
  document.getElementById('l-tab-log').classList.toggle('active', view === 'log');
  document.getElementById('l-tab-journal').classList.toggle('active', view === 'journal');
  document.getElementById('l-tab-energy').classList.toggle('active', view === 'energy');
  if (view === 'energy') loadEnergyLog();
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
  document.getElementById('l-tab-energy').addEventListener('click', () => switchLogSubTab('energy'));
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
