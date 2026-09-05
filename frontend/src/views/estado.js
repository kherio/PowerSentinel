import { ICONS } from '../icons.js';
import { readStatus, readCpuRanking, readJournal, readEnergyLog, restartDaemon } from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import { t } from '../i18n.js';
import { parseJournalLines, renderTimelineEntry, parseEnergyLines, computeRecentRate } from './log.js';

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

// Tasa de descarga actual (%/h), a partir de las muestras de batería
// de esta sesión del navegador (persistidas en localStorage, hasta
// BATT_WINDOW_MS de ventana) - la MISMA fuente que ya usa
// estimateRemainingHours(), ahora expuesta por separado para poder
// mostrarla también como su propio dato ("Ritmo de consumo").
function computeBattDrainRate() {
  const cutoff = Date.now() - BATT_WINDOW_MS;
  const recent = battHistory.filter((p) => p.t >= cutoff);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const hoursElapsed = (last.t - first.t) / 3600000;
  if (hoursElapsed < 0.05) return null; // need at least ~3 minutes of real span
  const levelDrop = first.level - last.level;
  if (levelDrop <= 0) return null; // flat or charging over that window
  return levelDrop / hoursElapsed;
}

function estimateRemainingHours(currentLevel) {
  const ratePerHour = computeBattDrainRate();
  return ratePerHour ? currentLevel / ratePerHour : null;
}

// ---------- Dashboard ("centro de control energético") ----------
// Nombre amistoso, icono y explicación de "por qué" por evento -
// generados a partir de lo que el propio evento representa, no un
// texto libre inventado por evento personalizado (esos caen al
// genérico "según tu configuración"). Los mecanismos que se muestran
// (CPU/Doze/Apps/GMS/WiFi) vienen de active_mechanisms_snapshot() en
// el demonio - datos reales resueltos, nunca inventados aquí.
const EVENT_META = {
  boot: { icon: '🔌', nameKey: 'dashboard.eventBoot', whyKey: 'dashboard.whyBoot' },
  charging: { icon: '🔋', nameKey: 'dashboard.eventCharging', whyKey: 'dashboard.whyCharging' },
  screen_off: { icon: '📴', nameKey: 'dashboard.eventScreenOff', whyKey: 'dashboard.whyScreenOff' },
  low_power: { icon: '🪫', nameKey: 'dashboard.eventLowPower', whyKey: 'dashboard.whyLowPower' },
  night: { icon: '🌙', nameKey: 'dashboard.eventNight', whyKey: 'dashboard.whyNight' },
  thermal: { icon: '🌡️', nameKey: 'dashboard.eventThermal', whyKey: 'dashboard.whyThermal' },
  manual: { icon: '✋', nameKey: 'dashboard.eventManual', whyKey: 'dashboard.whyManual' },
  adaptive_tier1: { icon: '🌤️', nameKey: 'dashboard.eventTier1', whyKey: 'dashboard.whyAdaptive' },
  adaptive_tier2: { icon: '⛅', nameKey: 'dashboard.eventTier2', whyKey: 'dashboard.whyAdaptive' },
  adaptive_tier3: { icon: '⛈️', nameKey: 'dashboard.eventTier3', whyKey: 'dashboard.whyAdaptive' }
};

export function eventDisplayName(name) {
  const meta = EVENT_META[name];
  return meta ? t(meta.nameKey) : name;
}
export function eventIcon(name) {
  const meta = EVENT_META[name];
  return meta ? meta.icon : '⚙️';
}
function eventWhy(name) {
  const meta = EVENT_META[name];
  return meta ? t(meta.whyKey) : t('dashboard.whyCustom');
}
function formatSigned(n) {
  if (typeof n !== 'number') return '—';
  return (n >= 0 ? '+' : '') + n;
}
function formatSinceTime(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Solo para elegir el NOMBRE del modo (Normal/Ahorro suave/Ahorro
// moderado/Extremo) - la posición del punto en el slider usa
// directamente el score real (0-100), esto solo bucketiza contra los
// umbrales REALMENTE configurados (que difieren entre los perfiles
// Bajo/Medio/Alto), nunca un valor fijo adivinado.
function pressureScoreTier(score, thresholds) {
  const [t1, t2, t3] = thresholds || [20, 45, 70];
  if (score >= t3) return 3;
  if (score >= t2) return 2;
  if (score >= t1) return 1;
  return 0;
}

// Frase de "por qué" en lenguaje humano: en modo adaptativo, elige los
// 1-2 factores que MÁS empujan la puntuación de presión hacia arriba
// (nunca los que la reducen) y los explica con datos reales
// (porcentaje de batería, minutos con la pantalla apagada calculados
// desde ActiveEventStartTimes) - nunca una lista genérica de todos los
// factores. En modo clásico, sin desglose numérico disponible, usa el
// "por qué" ya existente del primer evento activo.
function buildWhyText(sys) {
  const active = !!(sys.activeEvents && sys.activeEvents.length);
  if (!active) return '';
  if (!sys.pressureBreakdown) {
    return eventWhy(sys.activeEvents[0]);
  }
  const b = sys.pressureBreakdown;
  const candidates = [];
  if (typeof b.battery === 'number' && b.battery > 0 && sys.battery) {
    candidates.push({ value: b.battery, text: t('dashboard.whyBatteryLow', { level: sys.battery.level }) });
  }
  if (typeof b.screen_off === 'number' && b.screen_off > 0) {
    const startTs = sys.activeEventStartTimes && sys.activeEventStartTimes.screen_off;
    const mins = startTs ? Math.max(0, Math.round(Date.now() / 1000 - startTs) / 60) : null;
    candidates.push({ value: b.screen_off, text: mins !== null ? t('dashboard.whyScreenOffDuration', { mins: Math.round(mins) }) : t('dashboard.whyScreenOffGeneric') });
  }
  if (typeof b.temperature === 'number' && b.temperature > 0 && sys.battery) {
    candidates.push({ value: b.temperature, text: t('dashboard.whyTempHigh', { temp: (sys.battery.temp / 10).toFixed(1) }) });
  }
  if (typeof b.night === 'number' && b.night > 0) {
    candidates.push({ value: b.night, text: t('dashboard.whyNightTime') });
  }
  if (typeof b.cpu_load === 'number' && b.cpu_load > 0) {
    candidates.push({ value: b.cpu_load, text: t('dashboard.whyHighLoad') });
  }
  if (!candidates.length) return t('dashboard.whyNormal');
  candidates.sort((x, y) => y.value - x.value);
  return candidates.slice(0, 2).map((c) => c.text).join(' ');
}

function renderDashboard(sys) {
  const active = !!(sys.activeEvents && sys.activeEvents.length);
  const badge = document.getElementById('e-protection-badge');
  badge.textContent = active ? t('dashboard.protectionActive') : t('dashboard.protectionInactive');
  badge.className = 'dashboard-protection-badge' + (active ? ' active' : ' inactive');

  const modeNameEl = document.getElementById('e-dashboard-mode-name');
  const interventionEl = document.getElementById('e-intervention-level');
  const sliderWrap = document.getElementById('e-dashboard-slider-wrap');
  const toggle = document.getElementById('e-dashboard-detail-toggle');
  const detailBody = document.getElementById('e-dashboard-detail-body');

  if (typeof sys.pressureScore === 'number') {
    const tier = pressureScoreTier(sys.pressureScore, sys.pressureThresholds);
    const modeNames = [t('dashboard.modeNormal'), t('dashboard.modeLight'), t('dashboard.modeModerate'), t('dashboard.modeExtreme')];
    modeNameEl.textContent = modeNames[tier];
    interventionEl.style.display = 'block';
    interventionEl.textContent = t('dashboard.interventionLevel', { score: sys.pressureScore });
    setGauge(sys.pressureScore);

    sliderWrap.style.display = 'block';
    document.getElementById('e-dashboard-slider-dot').style.left = `${Math.min(100, Math.max(0, sys.pressureScore))}%`;

    toggle.style.display = 'flex';
    if (!toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('click', () => {
        const expand = detailBody.style.display === 'none';
        detailBody.style.display = expand ? 'block' : 'none';
        toggle.classList.toggle('expanded', expand);
      });
    }
    if (sys.pressureBreakdown) {
      const b = sys.pressureBreakdown;
      const items = [
        { label: t('dashboard.pressureLabel'), value: `${sys.pressureScore}/100` },
        { label: t('dashboard.tempLabel'), value: formatSigned(b.temperature) },
        { label: t('dashboard.batteryLabel'), value: formatSigned(b.battery) },
        { label: t('dashboard.screenLabel'), value: formatSigned(b.screen_off) },
        { label: t('dashboard.nightLabel'), value: formatSigned(b.night) },
        { label: t('dashboard.loadLabel'), value: formatSigned(b.cpu_load) },
        { label: t('dashboard.chargingLabel'), value: formatSigned(b.charging) }
      ];
      detailBody.innerHTML = items.map((i) =>
        `<div class="mechanism-row"><span class="mechanism-cat">${escapeHtml(i.label)}</span><span class="mechanism-treatment">${escapeHtml(i.value)}</span></div>`
      ).join('');
    }
  } else {
    sliderWrap.style.display = 'none';
    toggle.style.display = 'none';
    detailBody.style.display = 'none';
    interventionEl.style.display = 'none';
    modeNameEl.textContent = active
      ? sys.activeEvents.map(eventDisplayName).join(', ')
      : t('dashboard.modeIdle');
    // El gauge en modo clásico usa la proporción de mecanismos de
    // ahorro activos (núcleos/wifi/doze) - se fija más abajo en
    // render(), una vez se conocen los núcleos, ya que aquí todavía no
    // están disponibles.
  }

  document.getElementById('e-dashboard-why').textContent = buildWhyText(sys);

  // Estadísticas rápidas: batería, temperatura y ritmo de consumo real
  // (computeBattDrainRate, la MISMA fuente que ya alimenta "horas
  // restantes" en la tarjeta de batería) - nunca una cifra de ahorro
  // inventada.
  const quickEl = document.getElementById('e-dashboard-quickstats');
  const quickParts = [];
  if (sys.battery) {
    quickParts.push(`🔋 ${sys.battery.level}%`);
    quickParts.push(`🌡️ ${(sys.battery.temp / 10).toFixed(1)}°C`);
    if (!sys.battery.charging) {
      const rate = computeBattDrainRate();
      if (rate !== null) quickParts.push(`⚡ ${rate.toFixed(1)}%/h`);
    }
  }
  quickEl.textContent = quickParts.join('     ');
}

// "¿Qué está haciendo ahora?" - una tarjeta por evento activo, cada
// una con sus propios mecanismos resueltos (ActiveMechanisms, ya
// individualizados por evento en el demonio) y desde cuándo
// (ActiveEventStartTimes) - nunca una mezcla combinada de "lo que
// pasa en general", sino el detalle real de cada evento por separado.
// Solo se muestran los mecanismos que están genuinamente activos - un
// "—" al lado de WiFi/GMS/CPU en cada evento no aporta nada y da la
// sensación de que algo está roto cuando no lo está.
function mechanismRows(mech) {
  const on = (v) => v && v !== 'false';
  const rows = [];
  if (on(mech.handle_cores)) rows.push({ label: t('dashboard.mechCpu'), value: '✓' });
  if (on(mech.doze)) rows.push({ label: t('dashboard.mechDoze'), value: '✓' });
  if (on(mech.handle_apps)) rows.push({ label: t('dashboard.mechApps'), value: mech.handle_apps });
  if (on(mech.handle_gms)) rows.push({ label: t('dashboard.mechGms'), value: mech.handle_gms });
  if (mech.kill_wifi === 'true') rows.push({ label: t('dashboard.mechWifi'), value: '✓' });
  return rows;
}

function renderActiveNow(sys) {
  const wrap = document.getElementById('e-active-now-wrap');
  const mechanisms = sys.activeMechanisms || [];
  if (!mechanisms.length) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = mechanisms.map((mech) => {
    const startTs = sys.activeEventStartTimes && sys.activeEventStartTimes[mech.event];
    const since = startTs ? t('dashboard.activeSince', { time: formatSinceTime(startTs) }) : '';
    const rows = mechanismRows(mech).map((r) =>
      `<div class="mechanism-row"><span class="mechanism-cat">${escapeHtml(r.label)}</span><span class="mechanism-treatment">${escapeHtml(r.value)}</span></div>`
    ).join('');
    return `<div class="card active-now-card" style="margin-bottom:14px;">
      <div class="active-now-header"><span class="active-now-icon">${eventIcon(mech.event)}</span><span class="active-now-title">${escapeHtml(eventDisplayName(mech.event))}</span></div>
      ${since ? `<div class="active-now-since">${escapeHtml(since)}</div>` : ''}
      <div class="active-now-mechanisms">${rows}</div>
      <p class="hint active-now-why">${escapeHtml(eventWhy(mech.event))}</p>
    </div>`;
  }).join('');
}

// Jerarquía visual del roadmap (Estado principal → Qué está pasando →
// Por qué → Actividad reciente → Detalles técnicos): reutiliza
// exactamente el mismo renderizado de línea de tiempo ya construido en
// log.js (parseJournalLines/renderTimelineEntry), mostrando solo las
// últimas entradas en vez de duplicar esa lógica aquí.
async function renderRecentActivity() {
  const el = document.getElementById('e-recent-activity');
  try {
    const text = await readJournal();
    const entries = parseJournalLines(text).slice(-3).reverse();
    if (!entries.length) {
      el.innerHTML = `<p class="hint">${escapeHtml(t('estado.recentActivityEmpty'))}</p>`;
      return;
    }
    el.innerHTML = entries.map(renderTimelineEntry).join('');
  } catch (e) {
    el.innerHTML = `<p class="hint">${escapeHtml(t('estado.recentActivityEmpty'))}</p>`;
  }
}

// Comparación real entre el ritmo de descarga reciente y tu media
// histórica - nunca una cifra de "ahorro" inventada, ya que no hay
// forma causal de medir cuánto se habría gastado SIN PowerSentinel.
// Reutiliza exactamente el mismo cálculo ya construido y verificado
// para "Salud energética" en Análisis (computeRecentRate/
// parseEnergyLines, el mismo split reciente/histórico sin solapar) -
// la MISMA fuente de datos, no una nueva ni menos fiable. Igual que
// "Actividad reciente", se pide una sola vez al activar la pestaña,
// nunca en el sondeo de 3s.
async function renderSavingsBar() {
  const el = document.getElementById('e-savings-bar');
  try {
    const text = await readEnergyLog();
    const samples = parseEnergyLines(text);
    if (!samples.length) { el.innerHTML = `<p class="hint">${escapeHtml(t('estado.savingsBarNoData'))}</p>`; return; }

    const last = samples[samples.length - 1];
    const recentCutoff = last.ts - 6 * 3600;
    const recentSamples = samples.filter((s) => s.ts >= recentCutoff);
    const olderSamples = samples.filter((s) => s.ts < recentCutoff);
    const recentRate = computeRecentRate(recentSamples, null);
    const baselineRate = olderSamples.length >= 2 ? computeRecentRate(olderSamples, null) : null;

    if (recentRate === null || baselineRate === null || baselineRate <= 0) {
      el.innerHTML = `<p class="hint">${escapeHtml(t('estado.savingsBarNoData'))}</p>`;
      return;
    }

    const better = recentRate < baselineRate;
    const maxRate = Math.max(recentRate, baselineRate) || 1;
    const recentPct = Math.max(4, Math.round((recentRate / maxRate) * 100));
    const baselinePct = Math.max(4, Math.round((baselineRate / maxRate) * 100));
    const diffPct = Math.round(Math.abs((recentRate - baselineRate) / baselineRate) * 100);

    el.innerHTML =
      `<div class="savings-bar-row">` +
        `<span class="savings-bar-label">${escapeHtml(t('estado.savingsBarToday'))}</span>` +
        `<div class="savings-bar-track"><div class="savings-bar-fill ${better ? 'good' : 'warn'}" style="width:${recentPct}%"></div></div>` +
        `<span class="savings-bar-value">${recentRate.toFixed(1)}%/h</span>` +
      `</div>` +
      `<div class="savings-bar-row">` +
        `<span class="savings-bar-label">${escapeHtml(t('estado.savingsBarAvg'))}</span>` +
        `<div class="savings-bar-track"><div class="savings-bar-fill neutral" style="width:${baselinePct}%"></div></div>` +
        `<span class="savings-bar-value">${baselineRate.toFixed(1)}%/h</span>` +
      `</div>` +
      `<p class="hint savings-bar-caption">${escapeHtml(better ? t('estado.savingsBarBetter', { pct: diffPct }) : t('estado.savingsBarWorse', { pct: diffPct }))}</p>`;
  } catch (e) {
    el.innerHTML = '';
  }
}

// "Salud del sistema": de las 7 capacidades que el demonio detecta,
// solo estas 4 tienen una advertencia real en el código cuando faltan
// (cores_online, cores_governor, wifi, y doze aunque sin emit propio) -
// las otras 3 (gms_installed, pm_suspend) son características del
// dispositivo, no fallos, así que no se muestran aquí como si algo
// estuviera roto cuando simplemente no aplica.
function renderSystemHealth(caps) {
  const el = document.getElementById('e-system-health');
  if (!caps) { el.innerHTML = ''; return; }
  const items = [
    { label: t('estado.healthCpuGov'), ok: !!caps.cores_governor },
    { label: t('estado.healthCoreOffline'), ok: !!caps.cores_online },
    { label: t('estado.healthDoze'), ok: !!caps.doze_force },
    { label: t('estado.healthWifi'), ok: !!(caps.rfkill_wifi || caps.svc_wifi) }
  ];
  const allOk = items.every((i) => i.ok);
  const headline = allOk
    ? `<div class="system-health-headline ok">✓ ${escapeHtml(t('estado.healthAllOk'))}</div>`
    : `<div class="system-health-headline warn">⚠ ${escapeHtml(t('estado.healthSomeLimited'))}</div>`;
  const rows = items.map((i) =>
    `<div class="system-health-row"><span class="system-health-label">${escapeHtml(i.label)}</span><span class="system-health-value ${i.ok ? 'ok' : 'warn'}">${i.ok ? '✓' : t('estado.healthUnavailable')}</span></div>`
  ).join('');
  el.innerHTML = headline + `<div class="system-health-list">${rows}</div>`;
}

function initTechDetailsToggle() {
  const toggle = document.getElementById('e-tech-details-toggle');
  const body = document.getElementById('e-tech-details-body');
  toggle.addEventListener('click', () => {
    const expand = body.style.display === 'none';
    body.style.display = expand ? 'block' : 'none';
    toggle.classList.toggle('expanded', expand);
  });
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

  renderBatterySparkline();
}

// Mini gráfico de las últimas horas de batería, con el MISMO
// battHistory ya recogido para estimateRemainingHours()/
// computeBattDrainRate() - no una fuente de datos nueva.
function renderBatterySparkline() {
  const svg = document.getElementById('e-battery-sparkline');
  const caption = document.getElementById('e-battery-sparkline-caption');
  if (battHistory.length < 2) { svg.innerHTML = ''; caption.textContent = ''; return; }

  const w = 300, h = 40, pad = 3;
  const levels = battHistory.map((p) => p.level);
  const minL = Math.min(...levels), maxL = Math.max(...levels);
  const range = Math.max(1, maxL - minL);
  const first = battHistory[0], last = battHistory[battHistory.length - 1];
  const span = last.t - first.t || 1;

  const pts = battHistory.map((p) => {
    const x = pad + ((p.t - first.t) / span) * (w - pad * 2);
    const y = pad + (1 - (p.level - minL) / range) * (h - pad * 2);
    return [x, y];
  });
  const line = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
  const fillPath = line + ` L${(w - pad).toFixed(1)},${h} L${pad},${h} Z`;
  svg.innerHTML =
    `<path class="battery-sparkline-fill" d="${fillPath}"></path>` +
    `<path class="battery-sparkline-line" d="${line}"></path>`;

  const hoursSpan = span / 3600000;
  const delta = last.level - first.level;
  const deltaText = (delta <= 0 ? '' : '+') + delta;
  caption.textContent = t('estado.battSparklineCaption', { delta: deltaText, hours: hoursSpan.toFixed(1) });
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
    } else if ((m = line.match(/^pressurescore:\s*(\d+)/i))) {
      sys.pressureScore = parseInt(m[1], 10);
    } else if ((m = line.match(/^pressurebreakdown:\s*(\{.*\})/i))) {
      try { sys.pressureBreakdown = JSON.parse(m[1]); } catch (e) { /* ignore */ }
    } else if ((m = line.match(/^pressurethresholds:\s*(\d+)\s+(\d+)\s+(\d+)/i))) {
      sys.pressureThresholds = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    } else if ((m = line.match(/^activeeventstarttimes:\s*(\{.*\})/i))) {
      try { sys.activeEventStartTimes = JSON.parse(m[1]); } catch (e) { /* ignore */ }
    } else if ((m = line.match(/^timestamp:\s*(\d+)/i))) {
      sys.daemonTimestamp = parseInt(m[1], 10);
    } else if ((m = line.match(/^activemechanisms:\s*(\[.*\])/i))) {
      try { sys.activeMechanisms = JSON.parse(m[1]); } catch (e) { /* ignore */ }
    } else if ((m = line.match(/^capabilities:\s*(.*)$/i))) {
      sys.capabilities = {};
      m[1].trim().split(/\s+/).forEach((pair) => {
        const kv = pair.split('=');
        if (kv.length === 2) sys.capabilities[kv[0]] = kv[1] === 'true';
      });
    } else if (line.toLowerCase().indexOf('error') === 0) {
      sys.error = line;
    } else {
      unmatched.push(line);
    }
  });

  renderBattery(sys.battery);
  renderSystemHealth(sys.capabilities);
  renderDashboard(sys);
  renderActiveNow(sys);

  if (sys.error) {
    setGauge(0);
    document.getElementById('e-gauge-percent').innerHTML = ICONS.warn;
    document.getElementById('e-dashboard-mode-name').textContent = t('estado.serviceUnavailable');
    document.getElementById('e-dashboard-why').textContent = sys.error + ' — ' + t('estado.daemonNotRunningHint');
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
  let avgPct = null;

  if (!sys.error && (coresWithFreq.length || sys.load1 !== undefined)) {
    freqSectionTitle.style.display = '';
    freqMetrics.style.display = '';
    freqChartCard.style.display = '';

    const cards = [];
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

  // Resumen de una línea, visible fuera de Detalles técnicos - el
  // mapa de núcleos en sí (interesante para quien quiera entrar al
  // detalle) sigue viviendo solo dentro de Detalles técnicos.
  const cpuSummaryRow = document.getElementById('e-cpu-summary-row');
  if (!sys.error && cores.length) {
    const activeNow = cores.filter((c) => c.state === 'online').length;
    cpuSummaryRow.style.display = 'block';
    document.getElementById('e-cpu-summary-text').textContent = avgPct !== null
      ? t('estado.cpuSummaryWithFreq', { pct: avgPct, active: activeNow, total: cores.length })
      : t('estado.cpuSummary', { active: activeNow, total: cores.length });
    if (!cpuSummaryRow.dataset.bound) {
      cpuSummaryRow.dataset.bound = '1';
      cpuSummaryRow.addEventListener('click', () => {
        const toggle = document.getElementById('e-tech-details-toggle');
        if (document.getElementById('e-tech-details-body').style.display === 'none') toggle.click();
      });
    }
  } else {
    cpuSummaryRow.style.display = 'none';
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

  if (!sys.error && typeof sys.pressureScore !== 'number') {
    // Este gauge de "proporción de mecanismos de ahorro activos" es
    // específico del modo clásico - en modo adaptativo, renderDashboard()
    // ya fijó el gauge con la puntuación de presión real más arriba, y
    // sobrescribirla aquí sería mostrar el número equivocado.
    const offlineC = cores.filter((c) => c.state === 'offline').length;
    const psC = cores.filter((c) => c.state === 'powersave').length;
    const totalUnits = cores.length + (sys.wifi ? 1 : 0) + (sys.doze ? 1 : 0);
    const savingUnits = (offlineC + psC) + (sys.wifi === 'disabled' ? 1 : 0) + (sys.doze && sys.doze !== 'inactive' ? 1 : 0);
    const percent = totalUnits ? Math.round((savingUnits / totalUnits) * 100) : 0;
    setGauge(percent);
  }

  const extraBox = document.getElementById('e-unmatched-box');
  if (unmatched.length) {
    extraBox.style.display = 'block';
    extraBox.querySelector('.value2').textContent = unmatched.join(' · ');
  } else {
    extraBox.style.display = 'none';
  }

  // Aviso de datos desactualizados: "Actualizado HH:MM:SS" (fijado en
  // loadStatus) solo confirma que la PETICIÓN tuvo éxito ahora mismo -
  // no dice nada sobre si el CONTENIDO leído es reciente. Si el
  // demonio está en pausa, atascado, o lleva un buen rato sin
  // completar un ciclo, una lectura puede tener éxito al instante
  // devolviendo datos de hace minutos u horas, y hasta ahora no había
  // forma de distinguir ambos casos. Compara el timestamp REAL del
  // demonio (nuevo) contra la hora actual del cliente.
  const staleWarning = document.getElementById('e-stale-warning');
  const STALE_THRESHOLD_S = 90; // 30x el delay por defecto (3s) - margen generoso
  if (typeof sys.daemonTimestamp === 'number') {
    const ageS = Math.floor(Date.now() / 1000) - sys.daemonTimestamp;
    if (ageS > STALE_THRESHOLD_S) {
      staleWarning.style.display = 'block';
      document.getElementById('e-stale-warning-text').textContent = '⚠️ ' + t('estado.staleDataWarning', { mins: Math.round(ageS / 60) });
    } else {
      staleWarning.style.display = 'none';
    }
  } else {
    staleWarning.style.display = 'none';
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
  document.getElementById('e-refresh-btn').addEventListener('click', refreshEstado);
  document.getElementById('e-cpurank-btn').textContent = t('estado.cpuRankButton');
  document.getElementById('e-cpurank-btn').addEventListener('click', loadCpuRanking);
  document.getElementById('e-recent-activity-more').textContent = t('estado.recentActivityMore');
  document.getElementById('e-recent-activity-more').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('powersentinel:navigate', { detail: { view: 'log' } }));
  });
  document.getElementById('e-restart-daemon-btn').textContent = t('estado.restartDaemonButton');
  document.getElementById('e-restart-daemon-btn').addEventListener('click', onRestartDaemonClick);
  initTechDetailsToggle();
}

// Deliberadamente solo se llama desde el click del botón de arriba -
// nunca automáticamente, ni siquiera cuando el aviso de datos
// desactualizados aparece: matar y relanzar el proceso real del
// demonio es una acción real con consecuencias (cualquier evento
// activo pierde su seguimiento en memoria hasta que
// state_reconcile() lo recupere al arrancar), así que requiere
// confirmación explícita de la persona cada vez.
async function onRestartDaemonClick() {
  if (!window.confirm(t('estado.restartDaemonConfirm'))) return;
  const btn = document.getElementById('e-restart-daemon-btn');
  btn.disabled = true;
  try {
    await restartDaemon();
    toast(t('estado.restartDaemonSuccess'), 'success');
    setTimeout(() => loadStatus(false), 2000);
  } catch (e) {
    toast(t('estado.restartDaemonError', { msg: e.message }), 'error');
  } finally {
    btn.disabled = false;
  }
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
// renderRecentActivity() is deliberately called here directly, once,
// rather than from loadStatus()/render() (which the 3s poll also
// calls) - re-reading and re-parsing the journal every 3 seconds just
// to show a static "last 3 events" preview that rarely changes that
// fast would be exactly the kind of unnecessary continuous cost this
// project avoids elsewhere (see loadCpuRanking's own comment above).
export function activateEstado() {
  loadStatus(true);
  renderRecentActivity();
  renderSavingsBar();
  if (!pollTimer) pollTimer = setInterval(() => loadStatus(true), 3000);
}

// Called when leaving the Estado tab - stops polling so a hidden view
// doesn't keep spawning root shells in the background.
export function deactivateEstado() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Used by main.js's pull-to-refresh gesture.
export function refreshEstado() {
  renderRecentActivity();
  renderSavingsBar();
  return loadStatus(false);
}
