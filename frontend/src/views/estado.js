import { ICONS } from '../icons.js';
import { readStatus, readCpuRanking } from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import { t } from '../i18n.js';

const GAUGE_C = 2 * Math.PI * 52;
const HISTORY_MAX = 30; // ~90s at 3s polling
const HISTORY_KEY = 'powersentinel-estado-history';
const BATT_WINDOW_MS = 3 * 60 * 60 * 1000; // keep up to 3h of battery samples for the drain-rate estimate

function loadPersisted() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function savePersisted() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ freqHistory, loadHistory, battHistory }));
  } catch (e) { /* storage full/unavailable - charts just won't survive a reload this time */ }
}

const persisted = loadPersisted();
let freqHistory = persisted.freqHistory || [];
let loadHistory = persisted.loadHistory || [];
let battHistory = persisted.battHistory || [];
let maxLoadSeen = 1;
let pollTimer = null;
let firstLoad = true;

function badgeHtml(cls, label) {
  return `<span class="badge ${cls}"><span class="b-dot"></span>${label}</span>`;
}

function sparklinePath(values, w, h) {
  if (values.length < 2) return { line: '', fill: '' };
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - (v / 100) * h]);
  const line = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
  const fill = line + ` L${w.toFixed(1)},${h} L0,${h} Z`;
  return { line, fill };
}

function renderChart() {
  const svg = document.getElementById('e-freq-chart');
  const w = 300, h = 64;
  const freqPath = sparklinePath(freqHistory, w, h);
  const loadPath = sparklinePath(loadHistory, w, h);
  svg.innerHTML =
    (freqPath.fill ? `<path class="chart-fill-freq" d="${freqPath.fill}"></path>` : '') +
    (loadPath.fill ? `<path class="chart-fill-load" d="${loadPath.fill}"></path>` : '') +
    (freqPath.line ? `<path class="chart-line-freq" d="${freqPath.line}"></path>` : '') +
    (loadPath.line ? `<path class="chart-line-load" d="${loadPath.line}"></path>` : '');
}

function setGauge(percent) {
  const fill = document.getElementById('e-gauge-fill');
  const offset = GAUGE_C * (1 - percent / 100);
  fill.style.strokeDasharray = GAUGE_C;
  fill.style.strokeDashoffset = offset;
  fill.style.stroke = percent >= 60 ? 'var(--accent)' : (percent >= 25 ? 'var(--warn)' : 'var(--muted)');
  document.getElementById('e-gauge-percent').textContent = percent + '%';
}

function coreMeta() {
  return {
    online: { cls: 'core-active', mapCls: 'active', label: t('estado.legendActive'), icon: ICONS.bolt },
    powersave: { cls: 'core-save', mapCls: 'save', label: t('estado.legendSave'), icon: ICONS.leaf },
    offline: { cls: 'core-off', mapCls: 'off', label: t('estado.legendOff'), icon: ICONS.power }
  };
}

// Rough remaining-time estimate from the battery-level samples collected
// in this browsing session (persisted in localStorage, so it survives a
// page reload too) - not a substitute for Android's own estimate, just a
// simple drop-per-hour projection from whatever window of data we have.
function estimateRemainingHours(currentLevel) {
  const cutoff = Date.now() - BATT_WINDOW_MS;
  const recent = battHistory.filter((p) => p.t >= cutoff);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const hoursElapsed = (last.t - first.t) / 3600000;
  if (hoursElapsed < 0.05) return null; // need at least ~3 minutes of real span
  const levelDrop = first.level - last.level;
  if (levelDrop <= 0) return null; // flat or charging over that window
  const ratePerHour = levelDrop / hoursElapsed;
  return ratePerHour > 0 ? currentLevel / ratePerHour : null;
}

function renderBattery(batt) {
  const card = document.getElementById('e-battery-card');
  if (!batt) { card.style.display = 'none'; return; }
  card.style.display = 'flex';

  const fill = document.getElementById('e-battery-fill');
  fill.style.width = batt.level + '%';
  fill.classList.toggle('low', batt.level <= 20 && !batt.charging);
  fill.classList.toggle('mid', batt.level > 20 && batt.level <= 50 && !batt.charging);
  document.getElementById('e-battery-pct').textContent = batt.level + '%';
  document.getElementById('e-battery-status').textContent = batt.charging ? t('estado.batteryCharging') : t('estado.batteryLabel');

  if (!batt.charging) {
    battHistory.push({ t: Date.now(), level: batt.level });
    const cutoff = Date.now() - BATT_WINDOW_MS;
    battHistory = battHistory.filter((p) => p.t >= cutoff);
  }

  const bits = [`${(batt.temp / 10).toFixed(1)}°C`, `${(batt.voltage / 1000).toFixed(2)} V`];
  if (batt.charging) {
    bits.push(t('estado.batteryCharging2'));
  } else {
    const hours = estimateRemainingHours(batt.level);
    if (hours !== null) {
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      bits.push(t('estado.batteryRemaining', { h, m }));
    }
  }
  document.getElementById('e-battery-sub').textContent = bits.join(' · ');
}

function render(text) {
  document.getElementById('e-raw-status').textContent = text;

  const cores = [];
  const sys = {};
  const unmatched = [];

  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    let m;
    if ((m = line.match(/^cpu(\d+):\s*(online|offline|powersave)(?:\s+freq=(\d+)\/(\d+))?$/i))) {
      const core = { n: m[1], state: m[2].toLowerCase() };
      if (m[3] && m[4]) { core.curFreq = parseInt(m[3], 10); core.maxFreq = parseInt(m[4], 10); }
      cores.push(core);
    } else if ((m = line.match(/^load:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)$/i))) {
      sys.load1 = parseFloat(m[1]); sys.load5 = parseFloat(m[2]); sys.load15 = parseFloat(m[3]);
    } else if ((m = line.match(/^low ram:\s*(.*)$/i))) {
      sys.lowRam = m[1].trim().toLowerCase();
    } else if ((m = line.match(/^wifi:\s*(enabled|disabled)$/i))) {
      sys.wifi = m[1].toLowerCase();
    } else if ((m = line.match(/^doze:\s*(light|deep|inactive)$/i))) {
      sys.doze = m[1].toLowerCase();
    } else if ((m = line.match(/^battery:\s*level=(\d+)\s+temp=(-?\d+)\s+voltage=(\d+)\s+charging=(true|false)$/i))) {
      sys.battery = { level: parseInt(m[1], 10), temp: parseInt(m[2], 10), voltage: parseInt(m[3], 10), charging: m[4] === 'true' };
    } else if ((m = line.match(/^activeevents:\s*(.*)$/i))) {
      sys.activeEvents = m[1].trim() ? m[1].trim().split(/\s+/) : [];
    } else if (line.toLowerCase().indexOf('error') === 0) {
      sys.error = line;
    } else {
      unmatched.push(line);
    }
  });

  const heroTitle = document.getElementById('e-hero-title');
  const heroSub = document.getElementById('e-hero-sub');

  renderBattery(sys.battery);

  const aeRow = document.getElementById('e-active-events');
  aeRow.innerHTML = (sys.activeEvents && sys.activeEvents.length)
    ? sys.activeEvents.map((e) => `<span class="ae-chip">${escapeHtml(e)}</span>`).join('')
    : '';

  if (sys.error) {
    setGauge(0);
    document.getElementById('e-gauge-percent').innerHTML = ICONS.warn;
    heroTitle.textContent = t('estado.serviceUnavailable');
    heroSub.textContent = sys.error + ' — ' + t('estado.daemonNotRunningHint');
  }

  const coreGrid = document.getElementById('e-core-grid');
  const coreCounts = document.getElementById('e-core-counts');
  const coreMap = document.getElementById('e-core-map');
  const CORE_META = coreMeta();

  if (sys.error) {
    coreGrid.innerHTML = `<div class="stat-card"><div class="label">${ICONS.cpu} ${t('estado.daemonLabel')}</div>${badgeHtml('off', t('estado.daemonUnavailable'))}</div>`;
    coreCounts.textContent = '';
    coreMap.innerHTML = '';
  } else if (cores.length) {
    cores.sort((a, b) => parseInt(a.n, 10) - parseInt(b.n, 10));

    coreMap.innerHTML = cores.map((c) => {
      const meta = CORE_META[c.state] || CORE_META.online;
      return `<div class="cm-dot ${meta.mapCls}" title="cpu${c.n} · ${meta.label}">${c.n}</div>`;
    }).join('');

    coreGrid.innerHTML = cores.map((c, i) => {
      const meta = CORE_META[c.state] || CORE_META.online;
      let freqBit = '';
      if (c.curFreq && c.maxFreq) {
        const pct = Math.round((c.curFreq / c.maxFreq) * 100);
        freqBit = `<div class="ct-freq">${(c.curFreq / 1000).toFixed(0)}/${(c.maxFreq / 1000).toFixed(0)} MHz</div>` +
          `<div class="ct-freqbar"><div class="ct-freqbar-fill" style="width:${pct}%"></div></div>`;
      }
      return `<div class="core-tile ${meta.cls}" style="animation-delay:${i * 25}ms">` +
        `<div class="ct-icon">${meta.icon}</div>` +
        `<div class="ct-name">cpu${c.n}</div>` +
        `<div class="ct-state">${meta.label}</div>` +
        freqBit +
        `</div>`;
    }).join('');

    const activeCount = cores.filter((c) => c.state === 'online').length;
    const offCount = cores.filter((c) => c.state === 'offline').length;
    const psCount = cores.filter((c) => c.state === 'powersave').length;
    coreCounts.textContent = t('estado.coresActiveOf', { active: activeCount, total: cores.length }) +
      ((offCount || psCount)
        ? (offCount && psCount
          ? t('estado.savingSuffixBoth', { n: offCount + psCount, off: offCount, ps: psCount })
          : offCount
            ? t('estado.savingSuffixOff', { n: offCount + psCount })
            : t('estado.savingSuffixPs', { n: offCount + psCount }))
        : '');
  } else {
    coreGrid.innerHTML = `<div class="stat-card"><div class="label">${ICONS.cpu} ${t('estado.coresLabel')}</div><div class="value" style="color:var(--muted)">${t('estado.noData')}</div></div>`;
    coreCounts.textContent = '';
    coreMap.innerHTML = '';
  }

  const freqSectionTitle = document.getElementById('e-freq-section-title');
  const freqMetrics = document.getElementById('e-freq-metrics');
  const freqChartCard = document.getElementById('e-freq-chart-card');
  const coresWithFreq = cores.filter((c) => c.curFreq && c.maxFreq);

  if (!sys.error && (coresWithFreq.length || sys.load1 !== undefined)) {
    freqSectionTitle.style.display = '';
    freqMetrics.style.display = '';
    freqChartCard.style.display = '';

    const cards = [];
    let avgPct = null;
    if (coresWithFreq.length) {
      avgPct = Math.round(coresWithFreq.reduce((s, c) => s + (c.curFreq / c.maxFreq) * 100, 0) / coresWithFreq.length);
      cards.push(`<div class="metric-card"><div class="mc-label"><span style="width:12px;height:12px;display:inline-flex">${ICONS.bolt}</span> ${t('estado.avgFreq')}</div>` +
        `<div class="mc-value">${avgPct}<span class="mc-unit">% ${t('estado.pctOfMax')}</span></div></div>`);
      freqHistory.push(avgPct);
      if (freqHistory.length > HISTORY_MAX) freqHistory.shift();
    }
    if (sys.load1 !== undefined) {
      cards.push(`<div class="metric-card"><div class="mc-label">${t('estado.load1min')}</div><div class="mc-value">${sys.load1.toFixed(2)}</div></div>`);
      cards.push(`<div class="metric-card"><div class="mc-label">${t('estado.load515min')}</div><div class="mc-value" style="font-size:14px;">${sys.load5.toFixed(2)} / ${sys.load15.toFixed(2)}</div></div>`);
      maxLoadSeen = Math.max(maxLoadSeen, sys.load1, 1);
      loadHistory.push(Math.min(100, (sys.load1 / maxLoadSeen) * 100));
      if (loadHistory.length > HISTORY_MAX) loadHistory.shift();
    }
    freqMetrics.innerHTML = cards.join('');

    const nowBits = [];
    if (avgPct !== null) nowBits.push(avgPct + '%');
    if (sys.load1 !== undefined) nowBits.push(t('estado.loadWord') + ' ' + sys.load1.toFixed(2));
    document.getElementById('e-chart-now').textContent = nowBits.join(' · ');

    renderChart();
  } else {
    freqSectionTitle.style.display = 'none';
    freqMetrics.style.display = 'none';
    freqChartCard.style.display = 'none';
  }

  const sysGrid = document.getElementById('e-sys-grid');
  const sysCards = [];
  if (sys.wifi) {
    sysCards.push(`<div class="stat-card"><div class="label">${ICONS.wifi} ${t('estado.wifi')}</div>${badgeHtml(sys.wifi === 'disabled' ? 'on' : 'neutral', sys.wifi === 'disabled' ? t('estado.disabled') : t('estado.active'))}</div>`);
  }
  if (sys.doze) {
    const dozeLabel = sys.doze === 'light' ? t('estado.light') : (sys.doze === 'deep' ? t('estado.deep') : t('estado.inactive'));
    sysCards.push(`<div class="stat-card"><div class="label">${ICONS.moon} ${t('estado.doze')}</div>${badgeHtml(sys.doze === 'inactive' ? 'neutral' : 'on', dozeLabel)}</div>`);
  }
  if (sys.lowRam === 'true' || sys.lowRam === 'false') {
    sysCards.push(`<div class="stat-card"><div class="label">${ICONS.ram} ${t('estado.lowRam')}</div>${badgeHtml(sys.lowRam === 'true' ? 'on' : 'neutral', sys.lowRam === 'true' ? t('estado.enabled') : t('estado.disabled'))}</div>`);
  } else {
    sysCards.push(`<div class="stat-card"><div class="label">${ICONS.ram} ${t('estado.lowRam')}</div>${badgeHtml('neutral', t('estado.notApplicable'))}</div>`);
  }
  sysGrid.innerHTML = sysCards.length ? sysCards.join('') :
    `<div class="stat-card"><div class="label">${t('estado.systemTitle')}</div><div class="value" style="color:var(--muted)">${t('estado.noData')}</div></div>`;

  if (!sys.error) {
    const offlineC = cores.filter((c) => c.state === 'offline').length;
    const psC = cores.filter((c) => c.state === 'powersave').length;
    const totalUnits = cores.length + (sys.wifi ? 1 : 0) + (sys.doze ? 1 : 0);
    const savingUnits = (offlineC + psC) + (sys.wifi === 'disabled' ? 1 : 0) + (sys.doze && sys.doze !== 'inactive' ? 1 : 0);
    const percent = totalUnits ? Math.round((savingUnits / totalUnits) * 100) : 0;
    setGauge(percent);

    if (totalUnits === 0) {
      heroTitle.textContent = t('estado.noDataYet');
      heroSub.textContent = t('estado.waitingFirstReading');
    } else if (percent >= 60) {
      heroTitle.textContent = t('estado.savingActiveTitle');
      heroSub.textContent = t('estado.savingActiveSub');
    } else if (percent >= 25) {
      heroTitle.textContent = t('estado.savingPartialTitle');
      heroSub.textContent = t('estado.savingPartialSub');
    } else {
      heroTitle.textContent = t('estado.savingNoneTitle');
      heroSub.textContent = t('estado.savingNoneSub');
    }
  }

  const extraBox = document.getElementById('e-unmatched-box');
  if (unmatched.length) {
    extraBox.style.display = 'block';
    extraBox.querySelector('.value2').textContent = unmatched.join(' · ');
  } else {
    extraBox.style.display = 'none';
  }

  savePersisted();
}

async function loadStatus(silent) {
  try {
    const data = await readStatus();
    render(data);
    document.getElementById('e-updated').textContent = t('estado.updatedAt', { time: new Date().toLocaleTimeString() });
    document.querySelector('#view-estado .scroll-area').classList.add('loaded');
    firstLoad = false;
  } catch (e) {
    document.getElementById('e-updated').textContent = t('estado.updateError');
    if (!silent) toast(t('estado.updateFailedToast'), 'error');
  }
}

export function initEstado() {
  document.getElementById('e-refresh-btn').innerHTML = ICONS.reload + ' ' + t('common.update');
  document.getElementById('e-refresh-btn').addEventListener('click', () => loadStatus(false));
  document.getElementById('e-cpurank-btn').textContent = t('estado.cpuRankButton');
  document.getElementById('e-cpurank-btn').addEventListener('click', loadCpuRanking);
}

// Deliberately only ever called from the button click above - never
// from activateEstado()'s poll loop, since this involves real,
// non-trivial cost (a multi-second /proc sample across every
// installed app) that shouldn't run just because the tab happens to
// be open.
async function loadCpuRanking() {
  const btn = document.getElementById('e-cpurank-btn');
  const list = document.getElementById('e-cpurank-list');
  btn.disabled = true;
  btn.textContent = t('estado.cpuRankMeasuring');
  list.innerHTML = '';
  try {
    const text = await readCpuRanking();
    const apps = JSON.parse(text);
    if (!Array.isArray(apps) || apps.length === 0) {
      list.innerHTML = `<p class="hint">${escapeHtml(t('estado.cpuRankEmpty'))}</p>`;
    } else {
      list.innerHTML = apps.slice(0, 10).map((a) =>
        `<div class="cpurank-row"><span class="cpurank-name">${escapeHtml(a.package)}</span>` +
        `<span class="cpurank-pct">${escapeHtml(String(a.pct))}%</span></div>`
      ).join('');
    }
  } catch (e) {
    toast(t('estado.cpuRankError', { msg: e.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('estado.cpuRankButton');
  }
}

// Called when the Estado tab becomes visible - (re)starts the 3s poll.
export function activateEstado() {
  loadStatus(true);
  if (!pollTimer) pollTimer = setInterval(() => loadStatus(true), 3000);
}

// Called when leaving the Estado tab - stops polling so a hidden view
// doesn't keep spawning root shells in the background.
export function deactivateEstado() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Used by main.js's pull-to-refresh gesture.
export function refreshEstado() {
  return loadStatus(false);
}
