import { ICONS } from '../icons.js';
import { readStatus, readCpuRanking, readJournal, readEnergyLog, restartDaemon, readConfig, writeConfig, readFlaggedApps, startManualTimed, stopEvent, readSuggestedNightWindow, readDrainComparison } from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import { t } from '../i18n.js';
import { parseJournalLines, renderTimelineEntry, parseEnergyLines, computeRecentRate } from './log.js';
import { parseConfig, serializeConfig } from '../config-form.js';

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

// Segment count for the "energy pressure" bar (Option B from the
// redesign notes) - 8 gives a granularity close to the mockup (42/100
// lights ~4 of 8) without needing a value per point like a full 0-100
// bar would.
const PRESSURE_SEGMENTS = 8;
function pressureSegmentClass(tier) {
  if (tier >= 3) return 'lit-danger';
  if (tier >= 2) return 'lit-warn';
  return 'lit-normal';
}
function renderPressureSegments(score, tier) {
  const lit = Math.min(PRESSURE_SEGMENTS, Math.max(0, Math.ceil((score / 100) * PRESSURE_SEGMENTS)));
  const cls = pressureSegmentClass(tier);
  let html = '';
  for (let i = 0; i < PRESSURE_SEGMENTS; i++) {
    html += `<div class="pressure-segment${i < lit ? ' ' + cls : ''}"></div>`;
  }
  document.getElementById('e-pressure-segments').innerHTML = html;
  document.getElementById('e-pressure-score-text').textContent = `${score}/100`;
}

function renderDashboard(sys) {
  const active = !!(sys.activeEvents && sys.activeEvents.length);
  const badge = document.getElementById('e-protection-badge');
  badge.textContent = active ? t('dashboard.protectionActive') : t('dashboard.protectionInactive');
  badge.className = 'dashboard-protection-badge' + (active ? ' active' : ' inactive');

  const modeNameEl = document.getElementById('e-dashboard-mode-name');
  const subtitleEl = document.getElementById('e-dashboard-subtitle');
  const pressureWrap = document.getElementById('e-pressure-wrap');
  const toggle = document.getElementById('e-dashboard-detail-toggle');
  const detailBody = document.getElementById('e-dashboard-detail-body');

  if (typeof sys.pressureScore === 'number') {
    const tier = pressureScoreTier(sys.pressureScore, sys.pressureThresholds);
    const modeNames = [t('dashboard.modeNormal'), t('dashboard.modeLight'), t('dashboard.modeModerate'), t('dashboard.modeExtreme')];
    modeNameEl.textContent = modeNames[tier];
    // "Nivel de intervención · X/100" removed per maintainer feedback -
    // it just repeated the exact same number the gauge itself already
    // shows (e-gauge-percent), one line below it, with no new
    // information. The gauge's own percentage stays as the single
    // place that number is shown.
    setGauge(sys.pressureScore);

    subtitleEl.textContent = tier > 0 ? t('dashboard.subtitleActive') : t('dashboard.subtitleIdle');
    pressureWrap.style.display = 'block';
    renderPressureSegments(sys.pressureScore, tier);

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
    pressureWrap.style.display = 'none';
    toggle.style.display = 'none';
    detailBody.style.display = 'none';
    modeNameEl.textContent = active
      ? sys.activeEvents.map(eventDisplayName).join(', ')
      : t('dashboard.modeIdle');
    subtitleEl.textContent = active ? t('dashboard.subtitleActive') : t('dashboard.subtitleIdle');
    // El gauge en modo clásico usa la proporción de mecanismos de
    // ahorro activos (núcleos/wifi/doze) - se fija más abajo en
    // render(), una vez se conocen los núcleos, ya que aquí todavía no
    // están disponibles.
  }

  const whyEl = document.getElementById('e-dashboard-why');
  const whyText = buildWhyText(sys);
  // Prefixed with a small icon per the redesign notes ("🌙 La batería
  // está bajando y..."). Plain textContent (auto-escaped by the
  // browser) is enough here - no markup involved, unlike the other
  // innerHTML-built blocks in this file.
  whyEl.textContent = whyText ? `${active ? eventIcon(sys.activeEvents[0]) : 'ℹ️'} ${whyText}` : '';

  renderProfileChecklist(sys);

  // Quick-stat tiles: only the real drain rate now (computeBattDrainRate
  // - the SAME source that already feeds "hours remaining" on the
  // battery card). Battery % and temperature were dropped from here -
  // they already appear on the battery card just below, and repeating
  // them in the hero was pure duplication, not a second useful view of
  // the same number. Never an invented savings figure either way.
  const quickEl = document.getElementById('e-dashboard-quickstats');
  const tiles = [];
  if (sys.battery && !sys.battery.charging) {
    const rate = computeBattDrainRate();
    if (rate !== null) tiles.push({ icon: '⚡', value: `${rate.toFixed(1)}%/h`, label: t('dashboard.rateQuickLabel') });
  }
  quickEl.style.display = tiles.length ? 'flex' : 'none';
  quickEl.innerHTML = tiles.map((s) =>
    `<div class="quickstat-item"><span class="qs-icon">${s.icon}</span><div class="qs-text"><div class="qs-value">${escapeHtml(s.value)}</div><div class="qs-label">${escapeHtml(s.label)}</div></div></div>`
  ).join('');
}

// Temporary performance mode (feature request: a one-tap "Máximo
// rendimiento durante 1h" that reverts itself). The daemon's own
// check_manual_expiry() (PowerSentineld) is what actually enforces
// the timer - this only ever starts it (startManualTimed(), api.js)
// and shows a countdown read straight from what the daemon reports
// (ManualExpiry in the status file) rather than tracking time locally
// in the browser, which would drift from what's actually happening
// the moment this tab isn't the one in front of the person (screen
// off, app backgrounded, etc.).
let perfModeBusy = false;
function renderPerfMode(sys) {
  const row = document.getElementById('e-perfmode-row');
  const activeBox = document.getElementById('e-perfmode-active');
  const isManualActive = !!(sys.activeEvents && sys.activeEvents.includes('manual'));
  const expiry = sys.manualExpiry;

  if (isManualActive && typeof expiry === 'number' && expiry > Math.floor(Date.now() / 1000)) {
    row.style.display = 'none';
    activeBox.style.display = 'flex';
    const remainingMin = Math.max(1, Math.round((expiry - Date.now() / 1000) / 60));
    document.getElementById('e-perfmode-active-text').textContent =
      t('dashboard.perfModeActive', { min: remainingMin });
  } else {
    row.style.display = perfModeBusy ? 'none' : 'flex';
    activeBox.style.display = 'none';
  }

  if (!row.dataset.bound) {
    row.dataset.bound = '1';
    row.querySelectorAll('.perfmode-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mins = parseInt(btn.dataset.mins, 10);
        if (!mins) return;
        perfModeBusy = true;
        row.style.display = 'none';
        try {
          await startManualTimed(mins * 60);
          toast(t('dashboard.perfModeStarted', { min: mins }), 'success');
        } catch (e) {
          toast(t('dashboard.perfModeError', { msg: e.message }), 'error');
        } finally {
          perfModeBusy = false;
        }
      });
    });
  }
  const cancelBtn = document.getElementById('e-perfmode-cancel');
  if (!cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', async () => {
      try {
        await stopEvent('manual');
        toast(t('dashboard.perfModeCancelled'), 'success');
      } catch (e) {
        toast(t('dashboard.perfModeError', { msg: e.message }), 'error');
      }
    });
  }
}

// Profile checklist ("qué está pasando y por qué" at a glance): every
// CLASSIC profile type, active ones in green with a check, the rest
// muted - same visual language as "Hardware detectado"'s hw-cap-yes/
// hw-cap-no (Acerca de). Deliberately classic-mode only
// (sys.pressureScore undefined) - in adaptive mode the gauge/tier name
// in the hero already answers "what's active" on its own, and these 7
// discrete profiles aren't independently meaningful there (adaptive
// mode replaces them with a single 0-100 score). "boot" and "manual"
// are real, ordinary members of this list, not special-cased, since
// both can genuinely be active like any other profile.
const CLASSIC_PROFILE_ORDER = ['boot', 'charging', 'screen_off', 'low_power', 'night', 'thermal', 'manual'];
function renderProfileChecklist(sys) {
  const el = document.getElementById('e-profile-checklist');
  if (typeof sys.pressureScore === 'number') { el.style.display = 'none'; return; }
  const activeSet = new Set(sys.activeEvents || []);
  el.style.display = 'flex';
  el.innerHTML = CLASSIC_PROFILE_ORDER.map((name) => {
    const isActive = activeSet.has(name);
    return `<span class="profile-chip${isActive ? ' active' : ''}">${isActive ? '✓ ' : ''}${escapeHtml(eventDisplayName(name))}</span>`;
  }).join('');
}

// "Encendidos nocturnos" mini-card: count + comparison to the average
// of the 7 completed windows before it (NightWakeSummary, computed
// entirely on the daemon side - PowerSentinel-screenwake.sh) - never
// recomputed here, so the frontend and the raw data always agree on
// what "the average" means. Hidden entirely until at least one wake
// has ever been recorded (nw.count undefined), rather than showing a
// misleading "0" on a fresh install with no history yet.
let nightwakeSaving = false;
async function saveNightwakeWindow(field, value) {
  if (nightwakeSaving) return;
  const startInput = document.getElementById('e-nightwake-start-input');
  const endInput = document.getElementById('e-nightwake-end-input');
  // BUG FIX (found during a second audit pass): start==end makes
  // _screenwake_window_bounds() (PowerSentinel-screenwake.sh) compute a
  // ZERO-LENGTH window (cur_start === cur_end) - not a crash, just a
  // count that's silently always 0 forever, with nothing telling the
  // person why. Both times individually pass config_valid_time_hhmm
  // (each is a perfectly valid HH:MM on its own), so the daemon's own
  // validation never catches this - it has to be caught here, where
  // the OTHER field's current value is actually known. Reverts the
  // input to its last real value rather than saving a window that
  // would never count anything.
  const other = field === 'nightwake_start' ? endInput.value : startInput.value;
  if (other && other === value) {
    toast(t('dashboard.nightWakeWindowSameTime'), 'error');
    (field === 'nightwake_start' ? startInput : endInput).value = field === 'nightwake_start' ? startInput.defaultValue : endInput.defaultValue;
    return;
  }
  nightwakeSaving = true;
  startInput.classList.add('saving');
  endInput.classList.add('saving');
  try {
    // Read-modify-write the whole config, exactly like the full form
    // in Automatización does (same parseConfig/serializeConfig,
    // same writeConfig() call - which already writes the file AND
    // runs `PowerSentinelctl reload` on its own) - this just changes
    // the one field the person actually touched, leaving everything
    // else in the file untouched.
    const text = await readConfig();
    const model = parseConfig(text);
    model[field] = value;
    await writeConfig(serializeConfig(model));
    startInput.defaultValue = startInput.value;
    endInput.defaultValue = endInput.value;
    toast(t('dashboard.nightWakeWindowSaved'), 'success');
  } catch (e) {
    toast(t('dashboard.nightWakeWindowSaveError', { msg: e.message }), 'error');
  } finally {
    startInput.classList.remove('saving');
    endInput.classList.remove('saving');
    nightwakeSaving = false;
  }
}
// Wake-reason categorization (feature request: "qué procesos despiertan
// la pantalla"). Deliberately NOT app/process-level - see the comment
// in PowerSentinel-screenwake.sh: there is no reliable way to get that
// on Android, with or without root. What the daemon reports is a raw
// HARDWARE wake source string (from the kernel's own wakeup_reasons
// interface), and this is purely a best-effort, keyword-based label
// for a handful of well-known, common patterns - anything that
// doesn't match one is shown as-is (the raw string), never silently
// hidden or guessed into a category it might not belong to.
const WAKE_REASON_PATTERNS = [
  { re: /rtc_alarm|alarm/i, key: 'alarm' },
  { re: /wlan|wifi|sdio|bcmsdh/i, key: 'wifi' },
  { re: /rmnet|modem|mdm_|\bril\b|smd-modem/i, key: 'mobile' },
  { re: /gcm|fcm|firebase|push/i, key: 'push' },
  { re: /usb|charger|typec|\botg\b/i, key: 'charging' },
  { re: /pwrkey|power.?key|gpio_keys|volume/i, key: 'button' },
  { re: /jobscheduler|\bsync\b/i, key: 'sync' }
];
function categorizeWakeReason(raw) {
  if (!raw) return null;
  const match = WAKE_REASON_PATTERNS.find((p) => p.re.test(raw));
  return match ? match.key : null;
}
const WAKE_REASON_LABEL_KEYS = {
  alarm: 'dashboard.wakeReasonAlarm', wifi: 'dashboard.wakeReasonWifi',
  mobile: 'dashboard.wakeReasonMobile', push: 'dashboard.wakeReasonPush',
  charging: 'dashboard.wakeReasonCharging', button: 'dashboard.wakeReasonButton',
  sync: 'dashboard.wakeReasonSync'
};

// "Remediarlo en la medida de lo posible": only ever suggests a
// mechanism the module ALREADY has (kill_wifi / handle_gms on the
// Night event) - never a blind automatic action, and never for
// categories with nothing to actually do about them (an alarm or the
// physical power button aren't something PowerSentinel can act on).
// Needs at least 2 matching wakes before suggesting anything, so one
// coincidental match doesn't trigger a recommendation.
function renderWakeRemediationHint(entries) {
  const hintEl = document.getElementById('e-nightwake-hint');
  if (!entries || !entries.length) { hintEl.style.display = 'none'; hintEl.innerHTML = ''; return; }
  const counts = {};
  entries.forEach((e) => {
    const key = categorizeWakeReason(e.reason);
    if (key) counts[key] = (counts[key] || 0) + 1;
  });
  let hintKey = null;
  if ((counts.wifi || 0) >= 2) hintKey = 'dashboard.wakeHintWifi';
  else if ((counts.mobile || 0) + (counts.push || 0) >= 2) hintKey = 'dashboard.wakeHintMobile';
  if (!hintKey) { hintEl.style.display = 'none'; hintEl.innerHTML = ''; return; }
  hintEl.style.display = 'block';
  hintEl.innerHTML = `${escapeHtml(t(hintKey))} ` +
    `<button class="link-btn nightwake-hint-link" id="e-nightwake-hint-link" type="button">${escapeHtml(t('dashboard.wakeHintAction'))}</button>`;
  document.getElementById('e-nightwake-hint-link').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('powersentinel:navigate', { detail: { view: 'conf' } }));
  });
}

function renderNightWake(nw) {
  const card = document.getElementById('e-nightwake-card');
  // BUG FIX: reported as "the card disappeared entirely" after the
  // Hoy/Encendidos-nocturnos consolidation. Root cause: this section
  // is now nested inside e-today-card, but renderTodayCard() was still
  // independently setting e-today-card's own display based ONLY on
  // whether today's stats had data - if that ever came back empty while
  // THIS data was genuinely available, the nested section stayed
  // invisible no matter what it set its OWN display to, since a
  // display:none ancestor hides everything inside it regardless. This
  // function no longer touches (or assumes anything about) the outer
  // card - see updateTodayCardVisibility() below, called once after
  // both this and renderTodayCard() run, which is the only place that
  // now decides the shared container's visibility, from BOTH data
  // sources at once.
  if (!nw || typeof nw.count !== 'number') { card.style.display = 'none'; return; }
  card.style.display = 'block';

  // Editable window: two real <input type="time"> in place of the old
  // plain-text badge - editing the window right where it's already
  // shown, instead of a separate form buried in Automatización's
  // global settings (the maintainer's own suggestion, replacing the
  // config-form fields added the previous round). Never overwrite a
  // field the person currently has focused/open - a poll landing while
  // the native time picker is up shouldn't yank the value out from
  // under them.
  const startInput = document.getElementById('e-nightwake-start-input');
  const endInput = document.getElementById('e-nightwake-end-input');
  if (nw.start && document.activeElement !== startInput) { startInput.value = nw.start; startInput.defaultValue = nw.start; }
  if (nw.end && document.activeElement !== endInput) { endInput.value = nw.end; endInput.defaultValue = nw.end; }
  if (!startInput.dataset.bound) {
    startInput.dataset.bound = '1';
    startInput.addEventListener('change', () => { if (startInput.value) saveNightwakeWindow('nightwake_start', startInput.value); });
  }
  if (!endInput.dataset.bound) {
    endInput.dataset.bound = '1';
    endInput.addEventListener('change', () => { if (endInput.value) saveNightwakeWindow('nightwake_end', endInput.value); });
  }

  const suggestBtn = document.getElementById('e-nightwake-suggest-btn');
  if (!suggestBtn.dataset.bound) {
    suggestBtn.dataset.bound = '1';
    suggestBtn.addEventListener('click', async () => {
      suggestBtn.disabled = true;
      try {
        const text = await readSuggestedNightWindow();
        const suggestion = JSON.parse(text || '{}');
        if (!suggestion.suggested_start || !suggestion.suggested_end) {
          toast(t('dashboard.nightWakeSuggestNoData'), 'error');
          return;
        }
        // Sequential, not parallel - each save is its own full
        // read-modify-write of the config (saveNightwakeWindow), so
        // awaiting the first before starting the second avoids two
        // concurrent writes racing each other over the same file.
        // Updates the inputs' own displayed value immediately too,
        // rather than waiting for the next status poll to reflect it
        // (saveNightwakeWindow itself only persists the config - it
        // doesn't touch what's currently shown, since its normal
        // caller is the input's own native `change` event, which the
        // browser has already applied to .value by the time it fires).
        startInput.value = suggestion.suggested_start;
        await saveNightwakeWindow('nightwake_start', suggestion.suggested_start);
        endInput.value = suggestion.suggested_end;
        await saveNightwakeWindow('nightwake_end', suggestion.suggested_end);
        toast(t('dashboard.nightWakeSuggestApplied', { start: suggestion.suggested_start, end: suggestion.suggested_end }), 'success');
      } catch (e) {
        toast(t('dashboard.nightWakeSuggestError', { msg: e.message }), 'error');
      } finally {
        suggestBtn.disabled = false;
      }
    });
  }

  document.getElementById('e-nightwake-count').textContent = nw.count;

  const compareEl = document.getElementById('e-nightwake-compare');
  if (typeof nw.avg === 'number') {
    const diff = nw.count - nw.avg;
    if (diff === 0) {
      compareEl.textContent = t('dashboard.nightWakeSameAsAvg', { avg: nw.avg });
    } else {
      const cls = diff > 0 ? 'up' : 'down';
      const arrow = diff > 0 ? '↑' : '↓';
      compareEl.innerHTML = `<span class="${cls}">${arrow} ${Math.abs(diff)}</span> ` +
        escapeHtml(t('dashboard.nightWakeVsAvg', { avg: nw.avg }));
    }
  } else {
    compareEl.textContent = t('dashboard.nightWakeNoHistory');
  }

  const toggle = document.getElementById('e-nightwake-toggle');
  const timesEl = document.getElementById('e-nightwake-times');
  const entries = nw.entries || (nw.times || []).map((time) => ({ time, reason: '' }));
  if (entries.length) {
    toggle.style.display = 'flex';
    timesEl.innerHTML = entries.map((e) => {
      const key = categorizeWakeReason(e.reason);
      const label = key ? `${t(WAKE_REASON_LABEL_KEYS[key])} · ${e.reason}` : (e.reason || t('dashboard.wakeReasonUnknown'));
      return `<div class="nightwake-entry"><span class="nightwake-entry-time">${escapeHtml(e.time)}</span><span class="nightwake-entry-reason">${escapeHtml(label)}</span></div>`;
    }).join('');
    renderWakeRemediationHint(entries);
    if (!toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('click', () => {
        const expand = timesEl.style.display === 'none';
        timesEl.style.display = expand ? 'block' : 'none';
        toggle.classList.toggle('expanded', expand);
      });
    }
  } else {
    toggle.style.display = 'none';
    timesEl.style.display = 'none';
    document.getElementById('e-nightwake-hint').style.display = 'none';
  }
}

function formatHoursMins(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return { h, m };
}

// BUG FIX (reported: "the night-wake card disappeared entirely" after
// consolidating it into "Hoy"): the shared outer card (e-today-card)
// must show whenever EITHER today's stats OR night-wake data is
// available - not only today's stats, which is what it was tied to
// right after the two cards were merged. Called once after both
// renderNightWake()/renderTodayCard() have already set their own
// inner section's visibility - this only ever decides the shared
// wrapper, never touches either inner section itself.
function updateTodayCardVisibility(todayStats, nightWake) {
  const card = document.getElementById('e-today-card');
  const hasNightWake = !!(nightWake && typeof nightWake.count === 'number');
  card.style.display = (todayStats || hasNightWake) ? 'block' : 'none';
}

// "Hoy" card: screen time + time-since-charge come from
// PowerSentinel-todaystats.sh (TodayStats, refreshed every poll like
// the rest of the dashboard); night wakes reuses the SAME
// NightWakeSummary already parsed for the mini-card above rather than
// a second source of truth for the same number. Interventions today
// is filled in separately by renderTodayInterventions() (journal-
// based, fetched once per tab activation - see that function).
// Only manages its OWN body's visibility (e-today-body) - see
// updateTodayCardVisibility() for why the shared outer card
// (e-today-card, since the redesign that nested "Encendidos
// nocturnos" inside it) is no longer decided from here alone.
function renderTodayCard(todayStats) {
  const body = document.getElementById('e-today-body');
  if (!todayStats) { body.style.display = 'none'; return; }
  body.style.display = 'block';

  const chargeEl = document.getElementById('e-today-charge');
  if (typeof todayStats.seconds_since_charge === 'number') {
    const { h, m } = formatHoursMins(todayStats.seconds_since_charge);
    chargeEl.textContent = t('dashboard.todaySinceCharge', { h, m });
  } else {
    chargeEl.textContent = t('dashboard.todayNoChargeData');
  }

  const screenEl = document.getElementById('e-today-screen');
  const { h: sh, m: sm } = formatHoursMins(todayStats.screen_on_seconds || 0);
  screenEl.textContent = t('dashboard.todayScreenTime', { h: sh, m: sm });

  // Night-wake count row removed: the "Encendidos nocturnos" section is
  // now nested directly inside this same card (see renderNightWake()
  // below), showing its own count prominently - repeating it a second
  // time just above would be the exact duplication consolidating the
  // two cards was meant to remove.
  renderTodayChart(todayStats.hourly);
}

// Small per-hour activity chart (redesign spec: "un pequeño gráfico
// temporal") - the same 24 hourly screen-on buckets TodayStats already
// tracks for the numbers above, not a separate/new data source. The
// current hour's bar is highlighted since it's the only one still
// filling up (comparing it to earlier, complete hours would be
// misleading).
function renderTodayChart(hourly) {
  const svg = document.getElementById('e-today-chart');
  const caption = document.getElementById('e-today-chart-caption');
  if (!hourly || !hourly.length) { svg.innerHTML = ''; caption.textContent = ''; return; }
  const w = 288, h = 40, gap = 2;
  const barW = (w / hourly.length) - gap;
  const max = Math.max(3600, ...hourly);
  const currentHour = new Date().getHours();
  svg.innerHTML = hourly.map((secs, i) => {
    const barH = Math.max(1, (secs / max) * h);
    const x = i * (barW + gap);
    const y = h - barH;
    return `<rect class="today-chart-bar${i === currentHour ? ' current' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}"></rect>`;
  }).join('');
  caption.innerHTML = '<span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>';
}

// Interventions today: counts journal entries whose message is an
// event START (e.g. "screen_off started") within today's LOCAL
// calendar day - fetched once per tab activation (activateEstado/
// refreshEstado), same cadence as renderRecentActivity() and for the
// same reason: re-fetching and re-parsing the whole journal on every
// 3s poll just for a slow-changing daily count isn't worth the
// continuous cost.
export async function renderTodayInterventions() {
  const el = document.getElementById('e-today-interventions');
  if (!el) return;
  try {
    const text = await readJournal();
    const entries = parseJournalLines(text);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const count = entries.filter((e) => e.ts >= todayStart && /started$/.test(e.message)).length;
    el.textContent = t('dashboard.todayInterventions', { count });
  } catch (e) {
    el.textContent = t('dashboard.todayInterventions', { count: 0 });
  }
}

// Flagged-apps alert (feature request: make the existing "app flagged
// for high background CPU" mechanism - PowerSentinel-appwatch.sh, its
// dismiss/limit actions already built into Automatización's Básico
// mode - actually visible without having to go looking for it there).
// Fetched once per tab activation, same cadence/reasoning as
// renderTodayInterventions() above: this is a daily-scale signal, not
// something that needs re-checking on every 3s poll. Never invents or
// duplicates appwatch's own detection - purely a louder megaphone for
// a decision the daemon already made.
export async function renderFlaggedAppsAlert() {
  const el = document.getElementById('e-flagged-alert');
  if (!el) return;
  try {
    const text = await readFlaggedApps();
    const apps = JSON.parse(text || '[]');
    if (!Array.isArray(apps) || !apps.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    document.getElementById('e-flagged-alert-text').textContent =
      apps.length === 1
        ? t('dashboard.flaggedAppSingle', { app: apps[0] })
        : t('dashboard.flaggedAppMulti', { count: apps.length });
    const btn = document.getElementById('e-flagged-alert-btn');
    btn.textContent = t('dashboard.flaggedAppAction');
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('powersentinel:navigate', { detail: { view: 'conf' } }));
      });
    }
  } catch (e) {
    el.style.display = 'none';
  }
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

// Real, measured drain-rate comparison per active event (feature
// request: "que el usuario sepa que realmente está funcionando bien").
// Deliberately cached with a slow refresh (5 min) and fetched
// separately from the normal 3s poll - readDrainComparison() scans the
// whole energy log, real work with no business running that often, and
// the underlying number itself only meaningfully changes over hours,
// not seconds. Patches just the one element for whichever event
// finished loading, rather than triggering a full renderActiveNow()
// re-render - the same "surgical update, never rebuild the whole
// card" reasoning already applied elsewhere on this dashboard.
const drainComparisonCache = new Map();
const DRAIN_COMPARISON_TTL_MS = 5 * 60 * 1000;

function scheduleDrainComparisonFetch(eventName) {
  const cached = drainComparisonCache.get(eventName);
  if (cached && cached.fetching) return;
  if (cached && (Date.now() - cached.fetchedAt) < DRAIN_COMPARISON_TTL_MS) return;
  drainComparisonCache.set(eventName, { ...(cached || {}), fetching: true });
  readDrainComparison(eventName).then((text) => {
    let display = null;
    try {
      const data = JSON.parse(text || '{}');
      if (data.with_seconds && data.without_seconds) {
        display = {
          withRate: data.with_drop_pct / (data.with_seconds / 3600),
          withoutRate: data.without_drop_pct / (data.without_seconds / 3600)
        };
      }
    } catch (e) { /* leave display as null - "not enough data yet" */ }
    drainComparisonCache.set(eventName, { display, fetchedAt: Date.now(), fetching: false });
    if (!display) return;
    const el = document.getElementById(`active-now-drain-${eventName}`);
    if (!el) return; // card for this event isn't on screen anymore
    el.textContent = t('dashboard.drainComparison', {
      with: display.withRate.toFixed(1),
      without: display.withoutRate.toFixed(1)
    });
    el.style.display = 'block';
  }).catch(() => {
    drainComparisonCache.set(eventName, { display: null, fetchedAt: Date.now(), fetching: false });
  });
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
    const cached = drainComparisonCache.get(mech.event);
    const drainText = cached && cached.display
      ? t('dashboard.drainComparison', { with: cached.display.withRate.toFixed(1), without: cached.display.withoutRate.toFixed(1) })
      : '';
    scheduleDrainComparisonFetch(mech.event);
    return `<div class="card active-now-card" style="margin-bottom:14px;">
      <div class="active-now-header"><span class="active-now-icon">${eventIcon(mech.event)}</span><span class="active-now-title">${escapeHtml(eventDisplayName(mech.event))}</span></div>
      ${since ? `<div class="active-now-since">${escapeHtml(since)}</div>` : ''}
      <div class="active-now-mechanisms">${rows}</div>
      <p class="hint active-now-why">${escapeHtml(eventWhy(mech.event))}</p>
      <p class="active-now-drain" id="active-now-drain-${escapeHtml(mech.event)}" style="${drainText ? '' : 'display:none;'}">${escapeHtml(drainText)}</p>
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

// Battery-health nudge (feature request): only ever shown when it's
// actually informative - a real, measured pattern of frequent 100%
// charges (PowerSentinel-chargehealth.sh, never assumed the same for
// everyone) AND charge_limit not already configured. Never repeats a
// suggestion for something the person has already acted on, and never
// claims a specific battery-lifespan number - only "this happens
// often on your device", which is the one part actually measured.
const CHARGEHEALTH_THRESHOLD = 20; // out of the last 30 days
function renderChargeHealth(ch) {
  const el = document.getElementById('e-chargehealth-hint');
  if (!ch || ch.charge_limit_configured || (ch.count_30d || 0) < CHARGEHEALTH_THRESHOLD) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  document.getElementById('e-chargehealth-hint-text').textContent =
    t('dashboard.chargeHealthHint', { count: ch.count_30d });
  const link = document.getElementById('e-chargehealth-hint-link');
  if (!link.dataset.bound) {
    link.dataset.bound = '1';
    link.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('powersentinel:navigate', { detail: { view: 'conf' } }));
    });
  }
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
    } else if ((m = line.match(/^nightwakesummary:\s*(\{.*\})/i))) {
      try { sys.nightWake = JSON.parse(m[1]); } catch (e) { /* ignore */ }
    } else if ((m = line.match(/^todaystats:\s*(\{.*\})/i))) {
      try { sys.todayStats = JSON.parse(m[1]); } catch (e) { /* ignore */ }
    } else if ((m = line.match(/^manualexpiry:\s*(\d+)/i))) {
      sys.manualExpiry = parseInt(m[1], 10);
    } else if ((m = line.match(/^chargehealth:\s*(\{.*\})/i))) {
      try { sys.chargeHealth = JSON.parse(m[1]); } catch (e) { /* ignore */ }
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
  renderChargeHealth(sys.chargeHealth);
  renderSystemHealth(sys.capabilities);
  renderDashboard(sys);
  renderPerfMode(sys);
  renderActiveNow(sys);
  renderNightWake(sys.nightWake);
  renderTodayCard(sys.todayStats);
  updateTodayCardVisibility(sys.todayStats, sys.nightWake);

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
  renderTodayInterventions();
  renderFlaggedAppsAlert();
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
  renderTodayInterventions();
  renderFlaggedAppsAlert();
  return loadStatus(false);
}
