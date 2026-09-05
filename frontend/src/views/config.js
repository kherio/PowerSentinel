import { ICONS } from '../icons.js';
import {
  readConfig, writeConfig, readStatus, startEvent, stopEvent,
  enterSafeMode, exitSafeMode, readFlaggedApps, dismissFlaggedApp, setAppPolicy,
  readAppPolicies, readUsageBuckets, listPackages
} from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import { t } from '../i18n.js';
import { mountAppsPicker, persistAppsPicker } from './apps-picker.js';
import {
  PREDEFINED_EVENTS, FIELD_DEFS, GLOBAL_DEFS, EVENT_PRESETS,
  parseConfig, serializeConfig, renderFieldsForm, renderFieldRow, buildRecommendedModel,
  setDetectedManufacturer
} from '../config-form.js';

// Splits the per-event field list so the apps picker widget (allow/
// deny app selection) can be inserted right after "Gestión de apps"
// (handle_apps/allowlist/denylist, the "apps" group) instead of at the
// very bottom of the card, after every other field (cores, doze,
// GMS...). The one cross-field dependency within FIELD_DEFS
// (allowlist's showIf checks handle_apps) stays entirely within this
// same "apps" split, so rendering the two halves as separate,
// independently-updating forms doesn't break it.
const APPS_GROUP_DEFS = FIELD_DEFS.filter((d) => d.group === 'apps');
const OTHER_FIELD_DEFS = FIELD_DEFS.filter((d) => d.group !== 'apps');

let model = null;
let original = '';
let coreList = null;
let activeEventNames = new Set();
let lastBattery = null;
let lastCriticalAppsCount = null;
let lastManufacturer = null;
let lastModel = null;
let lastCapabilities = null;
let activeView = 'form';
let loaded = false;

let editor, highlightCode, dirtyFlag;

// ---------- Modo básico / avanzado ----------
//
// Puramente una capa de presentación: el modo básico nunca escribe nada
// que el modo avanzado no pudiera escribir también - ambos pasan por el
// mismo `model` y el mismo serializeConfig()/writeConfig(). El demonio
// no sabe ni le importa en qué modo está el WebUI.
//
// Por defecto (ninguna preferencia guardada todavía, instalación
// nueva) se muestra el modo básico - ver AGGRESSION_PRESETS más abajo
// para el razonamiento de seguridad detrás de cada nivel.
const ADVANCED_MODE_KEY = 'powersentinel-advanced-mode';
// Distinto de ADVANCED_MODE_KEY: registra si el usuario ha visto/
// elegido activamente un modo alguna vez, para diferenciar "nunca se
// ha decidido nada, es la primera visita" de "ya eligió básico
// explícitamente" - solo el primer caso abre la pantalla de elección
// automáticamente.
const MODE_CHOSEN_KEY = 'powersentinel-mode-chosen';

function isAdvancedMode() {
  try { return localStorage.getItem(ADVANCED_MODE_KEY) === 'true'; } catch (e) { return false; }
}

function hasChosenMode() {
  try { return localStorage.getItem(MODE_CHOSEN_KEY) === 'true'; } catch (e) { return false; }
}

function chooseMode(advanced) {
  try {
    localStorage.setItem(ADVANCED_MODE_KEY, advanced ? 'true' : 'false');
    localStorage.setItem(MODE_CHOSEN_KEY, 'true');
  } catch (e) {}
  closeModeModal();
  applyMode();
}

function openModeModal() {
  document.getElementById('mode-modal-overlay').style.display = 'flex';
}

function closeModeModal() {
  document.getElementById('mode-modal-overlay').style.display = 'none';
}

// Los 3 niveles de "Agresividad" del modo básico. Deliberadamente
// nunca usan handle_apps=suspend (una app suspendida sin que el
// usuario haya curado una allowlist es justo el tipo de sorpresa que
// el modo básico existe para evitar) - solo "nice" (reversible, sin
// riesgo de perder acceso a una app), además de doze/GMS/low_ram
// escalando con el nivel. Los umbrales (adaptive_tierN_threshold) son
// los mismos campos reales que ya existían en el modo avanzado -
// "Media" usa exactamente los valores por defecto de siempre.
const AGGRESSION_PRESETS = {
  low: {
    thresholds: { adaptive_tier1_threshold: '35', adaptive_tier2_threshold: '60', adaptive_tier3_threshold: '85' },
    tiers: {
      adaptive_tier1: { handle_apps: 'nice' },
      adaptive_tier2: { handle_apps: 'nice', doze: 'light' },
      adaptive_tier3: { handle_apps: 'nice', doze: 'light', handle_gms: 'nice' }
    }
  },
  medium: {
    thresholds: { adaptive_tier1_threshold: '20', adaptive_tier2_threshold: '45', adaptive_tier3_threshold: '70' },
    tiers: {
      adaptive_tier1: { handle_apps: 'nice' },
      adaptive_tier2: { handle_apps: 'nice', doze: 'light', handle_gms: 'nice' },
      adaptive_tier3: { handle_apps: 'nice', doze: 'deep', handle_gms: 'nice' }
    }
  },
  high: {
    thresholds: { adaptive_tier1_threshold: '10', adaptive_tier2_threshold: '30', adaptive_tier3_threshold: '55' },
    tiers: {
      adaptive_tier1: { handle_apps: 'nice', doze: 'light' },
      adaptive_tier2: { handle_apps: 'nice', doze: 'deep', handle_gms: 'nice' },
      adaptive_tier3: { handle_apps: 'nice', doze: 'deep', handle_gms: 'nice', low_ram: 'true' }
    }
  }
};

function currentAggressionLevel() {
  if (!model) return null;
  const t1 = model.adaptive_tier1_threshold;
  return Object.keys(AGGRESSION_PRESETS).find((lvl) => AGGRESSION_PRESETS[lvl].thresholds.adaptive_tier1_threshold === t1) || null;
}

function applyMode() {
  const advanced = isAdvancedMode();
  const modeBtn = document.getElementById('c-mode-info-btn');
  modeBtn.textContent = advanced ? t('config.modeButtonAdvanced') : t('config.modeButtonBasic');
  modeBtn.title = t('config.modeInfoTitle');
  modeBtn.setAttribute('aria-label', t('config.modeInfoTitle'));
  document.getElementById('c-view-basic').style.display = advanced ? 'none' : 'block';
  document.getElementById('c-view-advanced').style.display = advanced ? 'flex' : 'none';
  // Guardar/recargar/restaurar son conceptos del modo avanzado (el
  // básico guarda solo, sin un paso de "guardar" separado que alguien
  // que "no quiere o no entiende" tendría que descubrir).
  document.getElementById('c-save-btn').style.display = advanced ? '' : 'none';
  document.getElementById('c-reload-btn').style.display = advanced ? '' : 'none';
  document.getElementById('c-restore-btn').style.display = advanced ? '' : 'none';
}

// Meta por nivel: icono (reutiliza los mismos ya usados para las tiers
// adaptativas reales en el editor avanzado - hoja/gauge/rayo, la misma
// progresión visual de intensidad) y clave de la descripción de una
// línea que se muestra en la tarjeta.
const AGGRESSION_META = {
  low: { emoji: '🚀', labelKey: 'config.basicGoalPerformance', descKey: 'config.basicLowDesc' },
  medium: { emoji: '⚖️', labelKey: 'config.basicGoalBalanced', descKey: 'config.basicMediumDesc' },
  high: { emoji: '🔋', labelKey: 'config.basicGoalAutonomy', descKey: 'config.basicHighDesc' }
};

function renderBasicMode() {
  if (!model) return;
  const enabled = model.adaptive_mode === 'true';
  document.getElementById('cb-adaptive-toggle').checked = enabled;
  document.getElementById('cb-aggression-wrap').style.display = enabled ? 'block' : 'none';
  renderAggressionButtons();

  // Feedback real de si el ahorro adaptativo está haciendo algo AHORA
  // MISMO, no solo si está "activado" en la configuración - responde
  // directamente a la idea de que esto se evalúe como un sistema real,
  // no como un simple interruptor que se asume que funciona.
  const statusLine = document.getElementById('cb-status-line');
  if (!enabled) {
    statusLine.style.display = 'none';
  } else {
    statusLine.style.display = 'block';
    const activeTier = ['adaptive_tier3', 'adaptive_tier2', 'adaptive_tier1'].find((name) => activeEventNames.has(name));
    if (activeTier) {
      statusLine.textContent = t('config.basicStatusActive', { n: activeTier.slice(-1) });
      statusLine.classList.add('is-active');
    } else {
      statusLine.textContent = t('config.basicStatusIdle');
      statusLine.classList.remove('is-active');
    }
  }

  renderBatterySummary();
  renderProtectedApps();
  renderFlaggedApps();
  renderSafeMode();
}

function renderBatterySummary() {
  const el = document.getElementById('cb-battery-line');
  if (!lastBattery) { el.textContent = ''; return; }
  const icon = lastBattery.charging ? '⚡' : '🔋';
  const statusText = lastBattery.charging ? t('config.basicCharging') : t('config.basicNotCharging');
  el.textContent = `${icon} ${lastBattery.level}% · ${statusText}`;
}

function renderProtectedApps() {
  const el = document.getElementById('cb-protected-line');
  if (lastCriticalAppsCount === null) { el.textContent = ''; return; }
  el.textContent = t('config.basicProtectedCount', { n: lastCriticalAppsCount });
}

// Apps que el demonio ha marcado por consumo real y sostenido de CPU en
// segundo plano (PowerSentinel-appwatch.sh) - convierte un dato antes
// solo observacional en algo accionable con un toque, sin exigir que el
// usuario navegue listas de apps por sí mismo.
function renderFlaggedApps() {
  readFlaggedApps().then((text) => {
    let apps = [];
    try { apps = JSON.parse(text); } catch (e) { apps = []; }
    const card = document.getElementById('cb-flagged-card');
    const list = document.getElementById('cb-flagged-list');
    if (!Array.isArray(apps) || apps.length === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    list.innerHTML = '';
    apps.forEach((pkg) => {
      const row = document.createElement('div');
      row.className = 'flagged-app-row';
      row.innerHTML =
        `<span class="flagged-app-name">${escapeHtml(pkg)}</span>` +
        `<button class="btn ghost flagged-dismiss">${escapeHtml(t('config.basicDismiss'))}</button>` +
        `<button class="btn primary flagged-limit">${escapeHtml(t('config.basicLimitApp'))}</button>`;
      row.querySelector('.flagged-limit').addEventListener('click', () => limitFlaggedApp(pkg));
      row.querySelector('.flagged-dismiss').addEventListener('click', () => dismissFlagged(pkg));
      list.appendChild(row);
    });
  }).catch(() => {});
}

async function limitFlaggedApp(pkg) {
  try {
    // Nivel 3 (siempre agresivo): la app ya se confirmó pesada por
    // medición real, no por sospecha - ver PowerSentinel-apppolicy.sh.
    await setAppPolicy(pkg, 3);
    await dismissFlaggedApp(pkg);
    toast(t('config.basicLimitedToast', { pkg }), 'success');
    renderFlaggedApps();
  } catch (e) {
    toast(t('config.basicActionError', { msg: e.message }), 'error');
  }
}

async function dismissFlagged(pkg) {
  try {
    await dismissFlaggedApp(pkg);
    renderFlaggedApps();
  } catch (e) {
    toast(t('config.basicActionError', { msg: e.message }), 'error');
  }
}

// ---------- App policy screen (Config > Avanzado > Apps) ----------
// Lets a person browse every installed app and set its 4-level policy
// directly, instead of only reachable through PowerSentinelconf or by
// waiting for appwatch to flag something. Usage-frequency data (App
// Standby Buckets) is loaded separately, on demand, since it queries
// every app individually (see PowerSentinel-usagerank) and is purely
// informational context, never required for the policy list itself to
// be useful.
const APP_POLICY_LEVELS = [0, 1, 2, 3];
let appPolicyState = { allPkgs: null, level: {}, usage: {}, filter: '', liveConfig: null };

async function renderAppPolicyScreen() {
  const list = document.getElementById('ap-policy-list');
  list.innerHTML = `<p class="hint">${escapeHtml(t('apps.loading'))}</p>`;
  try {
    const [pkgs, policyText, configText] = await Promise.all([
      listPackages(false),
      readAppPolicies(),
      readConfig()
    ]);
    let policyMap = {};
    try { policyMap = JSON.parse(policyText); } catch (e) { policyMap = {}; }
    appPolicyState.allPkgs = pkgs;
    appPolicyState.level = policyMap;
    try { appPolicyState.liveConfig = parseConfig(configText); } catch (e) { appPolicyState.liveConfig = null; }
    drawAppPolicyList();
  } catch (e) {
    list.innerHTML = `<p class="hint">${escapeHtml(t('apps.listError', { msg: e.message }))}</p>`;
  }
}

// Política por app, en lenguaje de comportamiento real - no solo un
// nivel técnico 0-3, sino qué pasa DE VERDAD en las situaciones que le
// importan al usuario. Los nombres reutilizan el mismo vocabulario ya
// establecido en el dashboard de Estado (Ahorro suave/moderado/
// extremo) para que un mismo concepto se llame igual en toda la app.
const APP_POLICY_LEVEL_LABELS = ['apppolicy.protected', 'apppolicy.gentle', 'apppolicy.balanced', 'apppolicy.restricted'];
const APP_POLICY_EXPLANATIONS = ['apppolicy.explain0', 'apppolicy.explain1', 'apppolicy.explain2', 'apppolicy.explain3'];
const ACTION_VERB_KEYS = { false: 'apppolicy.actionNone', nice: 'apppolicy.actionNice', kill: 'apppolicy.actionKill', suspend: 'apppolicy.actionSuspend' };

function getEventHandleApps(model, eventName) {
  if (!model || !model.blocks) return 'false';
  const block = model.blocks.find((b) => b.name === eventName);
  return (block && block.fields.handle_apps) || 'false';
}

// Réplica exacta, en JS, de apppolicy_effective_action() en
// PowerSentinel-apppolicy.sh - la MISMA regla que decide de verdad qué
// le pasa a una app, para que esta pantalla nunca describa un
// comportamiento distinto del que el demonio realmente aplicaría.
function effectiveActionForLevel(eventAction, level) {
  if (level === 0) return 'false';
  if (level === 1) return eventAction === 'false' ? 'false' : 'nice';
  if (level === 3) return 'suspend';
  return eventAction;
}

function actionVerb(action) {
  return t(ACTION_VERB_KEYS[action] || 'apppolicy.actionNone');
}

// El motor adaptativo NO se descompone en "pantalla apagada" / "batería
// baja" como condiciones independientes - combina ambas (y más) en un
// único score. Describir esa realidad con las mismas dos frases que el
// modo clásico usa sería sencillamente falso, así que cada modo
// muestra su propia estructura real: 2 situaciones concretas en modo
// clásico, 3 niveles de presión en modo adaptativo.
function describeAppSituations(level, model) {
  if (!model) return [];
  if (model.adaptive_mode === 'true') {
    const tierNames = ['adaptive_tier1', 'adaptive_tier2', 'adaptive_tier3'];
    const tierLabels = ['dashboard.eventTier1', 'dashboard.eventTier2', 'dashboard.eventTier3'];
    return tierNames.map((tier, i) => ({
      label: t(tierLabels[i]),
      value: actionVerb(effectiveActionForLevel(getEventHandleApps(model, tier), level))
    }));
  }
  return [
    { label: t('apppolicy.whenScreenOff'), value: actionVerb(effectiveActionForLevel(getEventHandleApps(model, 'screen_off'), level)) },
    { label: t('apppolicy.whenLowBattery'), value: actionVerb(effectiveActionForLevel(getEventHandleApps(model, 'low_power'), level)) }
  ];
}

function drawAppPolicyList() {
  const list = document.getElementById('ap-policy-list');
  const q = (appPolicyState.filter || '').toLowerCase();
  const levelOf = (pkg) => appPolicyState.level[pkg] !== undefined ? appPolicyState.level[pkg] : 2;
  // Ordenadas por nivel de política - Protegida primero, Restringida al
  // final - con el nombre de paquete como criterio secundario dentro de
  // cada grupo, para que el orden sea predecible y no dependa de lo que
  // `pm list packages` devuelva.
  const pkgs = (appPolicyState.allPkgs || [])
    .filter((p) => p.toLowerCase().indexOf(q) !== -1)
    .sort((a, b) => levelOf(a) - levelOf(b) || a.localeCompare(b));
  list.innerHTML = '';
  pkgs.forEach((pkg) => {
    const level = levelOf(pkg);
    const usage = appPolicyState.usage[pkg];
    const situations = describeAppSituations(level, appPolicyState.liveConfig);
    const row = document.createElement('div');
    row.className = 'card apppolicy-row';
    row.innerHTML =
      `<div class="apppolicy-name">${escapeHtml(pkg)}${usage ? ` <span class="apppolicy-usage">${escapeHtml(usage)}</span>` : ''}</div>` +
      `<div class="apppolicy-levels">${APP_POLICY_LEVELS.map((lvl) =>
        `<button class="apppolicy-lvl-btn${lvl === level ? ' selected' : ''}" data-lvl="${lvl}">${escapeHtml(t(APP_POLICY_LEVEL_LABELS[lvl]))}</button>`
      ).join('')}</div>` +
      (situations.length ? `<div class="apppolicy-situations">${situations.map((s) =>
        `<div class="apppolicy-situation-row"><span class="apppolicy-situation-label">${escapeHtml(s.label)}</span><span class="apppolicy-situation-value">${escapeHtml(s.value)}</span></div>`
      ).join('')}</div>` : '') +
      `<p class="hint apppolicy-explain">${escapeHtml(t(APP_POLICY_EXPLANATIONS[level]))}</p>`;
    row.querySelectorAll('.apppolicy-lvl-btn').forEach((btn) => {
      btn.addEventListener('click', () => setPolicyForApp(pkg, parseInt(btn.dataset.lvl, 10)));
    });
    list.appendChild(row);
  });
  if (pkgs.length === 0) {
    list.innerHTML = `<p class="hint">${escapeHtml(t('apps.noResults'))}</p>`;
  }
}

async function setPolicyForApp(pkg, level) {
  try {
    await setAppPolicy(pkg, level);
    appPolicyState.level[pkg] = level;
    drawAppPolicyList();
  } catch (e) {
    toast(t('config.saveError', { msg: e.message }), 'error');
  }
}

const USAGE_BUCKET_LABELS = {
  5: 'apppolicy.usageExempted', 10: 'apppolicy.usageActive', 20: 'apppolicy.usageWorking',
  30: 'apppolicy.usageFrequent', 40: 'apppolicy.usageRare', 50: 'apppolicy.usageNever'
};

async function loadUsageBuckets() {
  const btn = document.getElementById('ap-usage-btn');
  btn.disabled = true;
  btn.textContent = t('apppolicy.usageLoading');
  try {
    const text = await readUsageBuckets();
    let entries = [];
    try { entries = JSON.parse(text); } catch (e) { entries = []; }
    const usage = {};
    if (Array.isArray(entries)) {
      entries.forEach((e) => {
        const labelKey = USAGE_BUCKET_LABELS[e.bucket];
        if (e.package && labelKey) usage[e.package] = t(labelKey);
      });
    }
    appPolicyState.usage = usage;
    drawAppPolicyList();
  } catch (e) {
    toast(t('apppolicy.usageError', { msg: e.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('apppolicy.usageButton');
  }
}

function renderSafeMode() {
  const active = model.safemode === 'true';
  const hint = document.getElementById('cb-safemode-hint');
  const btn = document.getElementById('cb-safemode-btn');
  hint.textContent = active ? t('config.basicSafeModeActiveHint') : t('config.basicSafeModeHint');
  btn.textContent = active ? t('config.basicSafeModeExit') : t('config.basicSafeModeEnter');
  btn.className = active ? 'btn primary' : 'btn ghost';
}

async function toggleSafeMode() {
  const active = model.safemode === 'true';
  try {
    if (active) {
      await exitSafeMode();
      toast(t('config.basicSafeModeExitedToast'), 'success');
    } else {
      await enterSafeMode();
      toast(t('config.basicSafeModeEnteredToast'), 'success');
    }
    model.safemode = active ? 'false' : 'true';
    renderSafeMode();
  } catch (e) {
    toast(t('config.basicActionError', { msg: e.message }), 'error');
  }
}

// Traduce un objeto de campos (los mismos que se aplican de verdad,
// via AGGRESSION_PRESETS) a frases legibles - un texto por campo
// presente, para el desglose de "qué hace este nivel" en el modo
// básico. Si un mecanismo nuevo se añade alguna vez a
// AGGRESSION_PRESETS sin tener aquí una traducción, se muestra el
// propio nombre técnico del campo como último recurso, en vez de
// omitirlo silenciosamente.
// Objetivo vs Mecanismo: el usuario elige un OBJETIVO (rendimiento /
// equilibrio / autonomía) sin necesitar entender los mecanismos
// técnicos que lo consiguen - esos quedan detrás de "Cómo se
// consigue", generados directamente desde los mismos datos reales
// que se aplican (AGGRESSION_PRESETS), nunca escritos a mano aparte.
const MECHANISM_INFO = {
  handle_apps: { category: 'config.mechCategoryApps', treatments: { nice: 'config.mechTreatmentAppsNice' } },
  doze: { category: 'config.mechCategoryDoze', treatments: { light: 'config.mechTreatmentDozeLight', deep: 'config.mechTreatmentDozeDeep' } },
  handle_gms: { category: 'config.mechCategoryGms', treatments: { nice: 'config.mechTreatmentGmsNice' } },
  low_ram: { category: 'config.mechCategoryRam', treatments: { true: 'config.mechTreatmentRamOn' } }
};

function describeMechanisms(fields) {
  return Object.keys(fields).map((key) => {
    const info = MECHANISM_INFO[key];
    const category = info ? t(info.category) : key;
    const treatmentKey = info && info.treatments[fields[key]];
    const treatment = treatmentKey ? t(treatmentKey) : String(fields[key]);
    return { category, treatment };
  });
}

function renderAggressionDetail(level) {
  const el = document.getElementById('cb-aggression-detail');
  const preset = level && AGGRESSION_PRESETS[level];
  if (!preset) { el.innerHTML = ''; return; }
  // tier3 es siempre el techo real de cada nivel (la escalada solo
  // añade o profundiza mecanismos, nunca los retira - confirmado
  // contra los propios datos), así que muestra de un vistazo TODO lo
  // que ese nivel puede llegar a hacer, sin fragmentarlo por umbral.
  const mechanisms = describeMechanisms(preset.tiers.adaptive_tier3);
  el.innerHTML =
    `<button class="aggression-detail-toggle" id="cb-detail-toggle" type="button">` +
    `<span>${escapeHtml(t('config.basicHowTitle'))}</span><span class="aggression-detail-caret">›</span></button>` +
    `<div class="aggression-detail-body" id="cb-detail-body" style="display:none;">` +
    mechanisms.map((m) =>
      `<div class="mechanism-row"><span class="mechanism-cat">${escapeHtml(m.category)}</span>` +
      `<span class="mechanism-arrow">→</span><span class="mechanism-treatment">${escapeHtml(m.treatment)}</span></div>`
    ).join('') +
    `</div>`;
  const toggle = document.getElementById('cb-detail-toggle');
  const body = document.getElementById('cb-detail-body');
  toggle.addEventListener('click', () => {
    const expand = body.style.display === 'none';
    body.style.display = expand ? 'block' : 'none';
    toggle.classList.toggle('expanded', expand);
  });
}

function renderAggressionButtons() {
  const wrap = document.getElementById('cb-aggression-buttons');
  const current = currentAggressionLevel();
  wrap.innerHTML = '';
  Object.keys(AGGRESSION_PRESETS).forEach((level) => {
    const meta = AGGRESSION_META[level];
    const card = document.createElement('div');
    card.className = 'aggression-card' + (level === current ? ' selected' : '');
    card.innerHTML =
      `<div class="aggression-icon aggression-emoji">${meta.emoji}</div>` +
      `<div class="aggression-title">${escapeHtml(t(meta.labelKey))}</div>` +
      `<div class="aggression-desc">${escapeHtml(t(meta.descKey))}</div>`;
    card.addEventListener('click', () => applyAggressionPreset(level));
    wrap.appendChild(card);
  });
  document.getElementById('cb-aggression-hint').textContent = current ? '' : t('config.basicCustomHint');
  renderAggressionDetail(current);
}

async function saveBasicChanges() {
  activeView = 'form'; // currentText()/saveFile() usan serializeConfig(model), no el editor de texto
  await saveFile();
  renderBasicMode();
}

function applyAggressionPreset(level) {
  const preset = AGGRESSION_PRESETS[level];
  if (!preset || !model) return;
  model.adaptive_mode = 'true';
  Object.keys(preset.thresholds).forEach((k) => { model[k] = preset.thresholds[k]; });
  Object.keys(preset.tiers).forEach((tierName) => {
    let block = model.blocks.find((b) => b.name === tierName);
    if (!block) { block = { name: tierName, fields: {} }; model.blocks.push(block); }
    block.fields = Object.assign({}, preset.tiers[tierName]);
  });
  saveBasicChanges();
}

function setAdaptiveEnabled(enabled) {
  if (!model) return;
  model.adaptive_mode = enabled ? 'true' : 'false';
  if (enabled && !currentAggressionLevel()) {
    applyAggressionPreset('medium'); // primera vez, sin preset previo - un punto de partida sensato
  } else {
    saveBasicChanges();
  }
}

// Tokenizes one line of the raw JSON the developer-mode editor shows -
// good enough highlighting (keys, string values, punctuation) without
// pulling in a full JSON tokenizer, matching the same line-by-line
// approach the old .conf-grammar highlighter used. Reuses the same CSS
// classes that grammar already defined (tok-key/tok-op/tok-val/
// tok-punct) - nothing new needed in style.css.
function highlightLine(line) {
  const kv = line.match(/^(\s*)"([^"]*)"(\s*:\s*)(.*)$/);
  if (kv) {
    const indent = kv[1], key = kv[2], sep = kv[3], rest = kv[4];
    const strVal = rest.match(/^"([^"]*)"(,?)\s*$/);
    if (strVal) {
      return indent + `<span class="tok-key">"${escapeHtml(key)}"</span>` +
        `<span class="tok-op">${escapeHtml(sep)}</span>` +
        `<span class="tok-val">"${escapeHtml(strVal[1])}"</span>` +
        `<span class="tok-punct">${escapeHtml(strVal[2])}</span>`;
    }
    return indent + `<span class="tok-key">"${escapeHtml(key)}"</span>` +
      `<span class="tok-op">${escapeHtml(sep)}</span>` +
      `<span class="tok-punct">${escapeHtml(rest)}</span>`;
  }
  if (/^\s*[{}[\],]*\s*$/.test(line)) {
    return `<span class="tok-punct">${escapeHtml(line)}</span>`;
  }
  return escapeHtml(line);
}

function refreshHighlight() {
  highlightCode.innerHTML = editor.value.split('\n').map(highlightLine).join('\n') + '\n';
}

let isDirty = false;
function markDirty(dirty) { isDirty = dirty; dirtyFlag.style.visibility = dirty ? 'visible' : 'hidden'; }

function renderGlobalFields() {
  const container = document.getElementById('c-global-fields');
  container.innerHTML = '';
  GLOBAL_DEFS.forEach((def) => {
    const row = renderFieldRow(def, model, null, (val) => {
      model[def.key] = val;
      markDirty(true);
      renderGlobalFields();
    });
    if (row) container.appendChild(row);
  });
}

const EVENT_ICONS = {
  boot: ICONS.power, charging: ICONS.plug, screen_off: ICONS.moon,
  low_power: ICONS.warn, night: ICONS.moon, thermal: ICONS.thermometer,
  adaptive_tier1: ICONS.leaf, adaptive_tier2: ICONS.gauge, adaptive_tier3: ICONS.bolt,
  manual: ICONS.manual
};

function summarizeFields(fields) {
  const bits = [];
  if (fields.handle_apps && fields.handle_apps !== 'false') bits.push(t('config.summaryApps', { v: fields.handle_apps }));
  if (fields.handle_cores && fields.handle_cores !== 'false') bits.push(t('config.summaryCores', { v: fields.handle_cores }));
  if (fields.disable_cores && fields.disable_cores !== 'false') bits.push(t('config.summaryDisableCores'));
  if (fields.handle_gms && fields.handle_gms !== 'false') bits.push(t('config.summaryGms', { v: fields.handle_gms }));
  if (fields.doze && fields.doze !== 'false') bits.push(t('config.summaryDoze', { v: fields.doze }));
  if (fields.kill_wifi === 'true') bits.push(t('config.summaryWifiOff'));
  if (fields.low_ram === 'true') bits.push(t('config.summaryLowRam'));
  if (fields.handle_proc === 'true') bits.push(t('config.summaryProcesses'));
  if (fields.night_start) bits.push(`${fields.night_start}–${fields.night_end || ''}`);
  if (fields.thermal_threshold) bits.push(`≥${fields.thermal_threshold}°C`);
  return bits.length ? bits.join(' · ') : t('config.summaryNone');
}

function renderEvents() {
  const list = document.getElementById('c-events-list');
  list.innerHTML = '';

  // Some events (notably "boot") are triggered unconditionally by the
  // daemon itself and never explicitly undone, so they can show up as
  // "active" (Estado, the is-active-now badge below) even when the
  // user never added a block to configure them - there being no card
  // for something the daemon reports as active is confusing on its
  // own. Deliberately just a hint pointing at "Añadir evento" rather
  // than silently synthesizing a block into `model` for this: doing
  // that would risk it getting persisted to disk the next time
  // anything saves, even though the user never asked to configure it.
  const configuredNames = new Set(model.blocks.map((b) => b.name));
  const unconfiguredActive = [...activeEventNames].filter((name) => !configuredNames.has(name));
  const notice = document.getElementById('c-unconfigured-notice');
  if (unconfiguredActive.length) {
    notice.textContent = t('config.unconfiguredActive', { names: unconfiguredActive.join(', ') });
    notice.style.display = 'block';
  } else {
    notice.style.display = 'none';
  }

  model.blocks.forEach((block, idx) => {
    const card = document.createElement('div');
    const isActiveNow = activeEventNames.has(block.name);
    card.className = 'event-card' + (block.__expanded ? ' expanded' : '') + (isActiveNow ? ' is-active-now' : '');

    const head = document.createElement('div');
    head.className = 'event-head';
    head.addEventListener('click', () => {
      block.__expanded = !block.__expanded;
      renderEvents();
    });

    const iconEl = document.createElement('div');
    iconEl.className = 'event-icon';
    iconEl.innerHTML = EVENT_ICONS[block.name] || ICONS.bolt;
    if (isActiveNow) iconEl.title = t('config.activeNowTitle');
    head.appendChild(iconEl);

    const isPredefined = PREDEFINED_EVENTS.indexOf(block.name) !== -1;
    let nameEl;
    if (isPredefined) {
      nameEl = document.createElement('div');
      nameEl.className = 'event-name';
      nameEl.textContent = block.name;
    } else {
      nameEl = document.createElement('input');
      nameEl.className = 'event-name custom-input';
      nameEl.value = block.name;
      nameEl.addEventListener('click', (e) => e.stopPropagation());
      nameEl.addEventListener('input', () => {
        block.name = nameEl.value.replace(/[^a-zA-Z0-9_-]/g, '');
        markDirty(true);
      });
    }
    head.appendChild(nameEl);

    if (isActiveNow) {
      const activeBadge = document.createElement('span');
      activeBadge.className = 'badge on event-active-badge';
      activeBadge.innerHTML = '<span class="b-dot"></span>' + t('config.activeNow');
      head.appendChild(activeBadge);
    }

    const actions = document.createElement('div');
    actions.className = 'event-head-actions';
    actions.addEventListener('click', (e) => e.stopPropagation());

    // Try-it-now: fires the event immediately via PowerSentinelctl, without
    // waiting for its real trigger condition (screen off, low battery...)
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn ghost';
    applyBtn.innerHTML = ICONS.bolt;
    applyBtn.title = t('config.applyNow');
    applyBtn.addEventListener('click', async () => {
      try { await startEvent(block.name); toast(t('config.applied', { name: block.name }), 'success'); }
      catch (e) { toast(t('config.applyError', { msg: e.message }), 'error'); }
    });
    actions.appendChild(applyBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn ghost';
    stopBtn.innerHTML = ICONS.power;
    stopBtn.title = t('config.stop');
    stopBtn.addEventListener('click', async () => {
      try { await stopEvent(block.name); toast(t('config.stopped', { name: block.name }), 'success'); }
      catch (e) { toast(t('config.stopError', { msg: e.message }), 'error'); }
    });
    actions.appendChild(stopBtn);

    const dupBtn = document.createElement('button');
    dupBtn.className = 'btn ghost';
    dupBtn.innerHTML = ICONS.plus;
    dupBtn.title = t('config.duplicate');
    dupBtn.addEventListener('click', () => {
      let base = block.name.replace(/_copy\d*$/, '') + '_copy';
      let name = base, n = 2;
      const existing = model.blocks.map((b) => b.name);
      while (existing.indexOf(name) !== -1) { name = base + n; n++; }
      const clonedFields = Object.assign({}, block.fields);
      delete clonedFields.__apps; // don't share the (unsaved) apps-picker state between events
      model.blocks.push({ name, fields: clonedFields, __expanded: true });
      markDirty(true);
      renderEvents();
    });
    actions.appendChild(dupBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn ghost';
    delBtn.innerHTML = ICONS.trash;
    delBtn.title = t('config.deleteEvent');
    delBtn.addEventListener('click', () => {
      if (!window.confirm(t('config.deleteConfirm', { name: block.name }))) return;
      model.blocks.splice(idx, 1);
      markDirty(true);
      renderEvents();
    });
    actions.appendChild(delBtn);
    head.appendChild(actions);

    const chevron = document.createElement('div');
    chevron.className = 'event-chevron';
    chevron.innerHTML = ICONS.chevron;
    head.appendChild(chevron);

    card.appendChild(head);

    const summary = document.createElement('div');
    summary.className = 'event-summary';
    summary.textContent = summarizeFields(block.fields);
    card.appendChild(summary);

    if (block.__expanded) {
      const body = document.createElement('div');
      body.className = 'event-body';

      // Quick-start template row
      const presetRow = document.createElement('div');
      presetRow.style.marginBottom = '16px';
      const presetSelect = document.createElement('select');
      presetSelect.className = 'filter';
      presetSelect.style.width = '100%';
      const noneOpt = document.createElement('option');
      noneOpt.value = ''; noneOpt.textContent = t('config.applyTemplate');
      presetSelect.appendChild(noneOpt);
      Object.keys(EVENT_PRESETS).forEach((key) => {
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = EVENT_PRESETS[key].label;
        presetSelect.appendChild(opt);
      });
      presetSelect.addEventListener('change', () => {
        if (!presetSelect.value) return;
        const preset = EVENT_PRESETS[presetSelect.value];
        Object.assign(block.fields, preset.fields);
        markDirty(true);
        toast(t('config.templateApplied', { label: preset.label, name: block.name }), 'success');
        renderEvents();
      });
      presetRow.appendChild(presetSelect);
      body.appendChild(presetRow);

      // __eventName is a hidden marker (not serialized - see serializeConfig,
      // which only ever writes known FIELD_DEFS keys) so field defs like
      // night_start/night_end can show themselves only within the "night"
      // event's own card via showIf, without config-form.js needing to know
      // about block names at all.
      block.fields.__eventName = block.name;

      const fieldsDiv = document.createElement('div');
      body.appendChild(fieldsDiv);
      const appsDiv = document.createElement('div');
      body.appendChild(appsDiv);
      const otherFieldsDiv = document.createElement('div');
      body.appendChild(otherFieldsDiv);

      // Mounting the apps picker is tied to handle_apps' current value
      // (mountAppsPicker no-ops unless it's kill/nice/suspend), but
      // renderFieldsForm's own onChange callback fires for ANY field
      // change within this event - handle_apps included, since it's
      // just another field. Re-mounting on every change (not only at
      // initial card-expand time) is what makes the picker actually
      // react to the user flipping handle_apps on/off, instead of only
      // ever reflecting whatever its value happened to be the moment
      // the card was first expanded.
      const onAnyFieldChange = () => {
        markDirty(true);
        summary.textContent = summarizeFields(block.fields);
        mountAppsPicker(appsDiv, block.fields, () => markDirty(true));
      };
      renderFieldsForm(fieldsDiv, block.fields, APPS_GROUP_DEFS, coreList, onAnyFieldChange);
      mountAppsPicker(appsDiv, block.fields, () => markDirty(true));
      renderFieldsForm(otherFieldsDiv, block.fields, OTHER_FIELD_DEFS, coreList, onAnyFieldChange);

      card.appendChild(body);
    }

    list.appendChild(card);
  });

  if (!model.blocks.length) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = t('config.noEvents');
    list.appendChild(empty);
  }

  const predefSelect = document.getElementById('c-predefined-event-select');
  predefSelect.innerHTML = '';
  const existing = model.blocks.map((b) => b.name);
  const available = PREDEFINED_EVENTS.filter((e) => existing.indexOf(e) === -1);
  if (!available.length) {
    const opt = document.createElement('option');
    opt.textContent = t('config.allPredefinedAdded');
    opt.disabled = true;
    predefSelect.appendChild(opt);
    document.getElementById('c-add-predefined-btn').disabled = true;
  } else {
    document.getElementById('c-add-predefined-btn').disabled = false;
    available.forEach((e) => {
      const opt = document.createElement('option');
      opt.value = e; opt.textContent = e;
      predefSelect.appendChild(opt);
    });
  }

  filterEventCards();
}

// Filters the (collapsed-by-default) event list by name or by whatever
// shows in the one-line summary (e.g. "apps: nice · WiFi off"), so a
// search for "wifi" finds events touching WiFi without needing to open
// every card first.
function filterEventCards() {
  const term = document.getElementById('c-event-search').value.trim().toLowerCase();
  const cards = document.querySelectorAll('#c-events-list .event-card');
  cards.forEach((card) => {
    const matches = !term || card.textContent.toLowerCase().indexOf(term) !== -1;
    card.style.display = matches ? '' : 'none';
  });
}

function renderVersionView() {
  renderGlobalFields();
  renderEvents();
  renderBasicMode();
}

function switchSubTab(view) {
  if (view === activeView) return;
  if (view === 'text') {
    editor.value = serializeConfig(model);
    refreshHighlight();
  } else if (view === 'form') {
    try {
      model = parseConfig(editor.value);
    } catch (e) {
      toast(t('config.parseError'), 'error');
      return;
    }
    renderVersionView();
  }
  activeView = view;
  document.getElementById('c-view-form').style.display = view === 'form' ? 'block' : 'none';
  document.getElementById('c-view-text').style.display = view === 'text' ? 'flex' : 'none';
  document.getElementById('c-tab-form').classList.toggle('active', view === 'form');
  document.getElementById('c-tab-text').classList.toggle('active', view === 'text');
}

function currentText() {
  return activeView === 'text' ? editor.value : serializeConfig(model);
}

async function loadFile(showToast) {
  try {
    const data = await readConfig();
    original = data;
    model = parseConfig(data);
    editor.value = data;
    refreshHighlight();
    renderVersionView();
    markDirty(false);
    if (showToast) toast(t('config.reloaded'), 'success');
    loaded = true;
  } catch (e) {
    toast(t('config.loadError', { msg: e.message }), 'error');
  }
}

async function saveFile() {
  // Guard against writing invalid JSON to disk: switching *out* of the
  // text tab already validates (see switchSubTab), but saving directly
  // while still in it never did - the daemon reads this file with jq,
  // so broken JSON there would silently break every setting, not just
  // whatever the user was mid-editing.
  if (activeView === 'text') {
    try {
      parseConfig(editor.value);
    } catch (e) {
      toast(t('config.parseError'), 'error');
      return;
    }
  }

  const content = currentText();
  try {
    await writeConfig(content);
    // Apps picker edits live outside PowerSentinel.json (separate allow/deny
    // files), so they're persisted alongside it here rather than being
    // part of the serialized config text.
    await Promise.all(model.blocks.map((b) => persistAppsPicker(b.fields)));
    original = content;
    if (activeView === 'form') { editor.value = content; refreshHighlight(); }
    markDirty(false);
    toast(t('config.saved'), 'success');
  } catch (e) {
    toast(t('config.saveError', { msg: e.message }), 'error');
  }
}

async function restoreRecommended() {
  const ok = window.confirm(t('config.restoreConfirm'));
  if (!ok) return;
  model = buildRecommendedModel();
  activeView = 'form';
  document.getElementById('c-view-form').style.display = 'block';
  document.getElementById('c-view-text').style.display = 'none';
  document.getElementById('c-tab-form').classList.add('active');
  document.getElementById('c-tab-text').classList.remove('active');
  renderVersionView();
  markDirty(true);
  toast(t('config.restoreApplied'), 'success');
}

export function initConfig() {
  editor = document.getElementById('c-editor');
  highlightCode = document.getElementById('c-highlight').querySelector('code');
  dirtyFlag = document.getElementById('c-dirty-flag');

  editor.addEventListener('scroll', () => {
    document.getElementById('c-highlight').scrollTop = editor.scrollTop;
    document.getElementById('c-highlight').scrollLeft = editor.scrollLeft;
  });
  editor.addEventListener('input', () => {
    refreshHighlight();
    markDirty(editor.value !== original);
  });

  document.getElementById('c-save-btn').innerHTML = ICONS.save + ' ' + t('config.save');
  document.getElementById('c-reload-btn').innerHTML = ICONS.reload + ' ' + t('config.reload');
  document.getElementById('c-restore-btn').innerHTML = ICONS.leaf + ' ' + t('config.restore');
  document.getElementById('c-dirty-flag').innerHTML =
    '<span class="badge warn"><span class="b-dot"></span>' + t('config.unsaved') + '</span>';

  document.getElementById('c-add-predefined-btn').addEventListener('click', () => {
    const sel = document.getElementById('c-predefined-event-select');
    if (!sel.value) return;
    const fields = sel.value === 'night' ? { night_start: '23:00', night_end: '07:00' } :
      sel.value === 'thermal' ? { thermal_threshold: '45' } : {};
    model.blocks.push({ name: sel.value, fields, __expanded: true });
    markDirty(true);
    renderEvents();
  });

  document.getElementById('c-add-custom-btn').addEventListener('click', () => {
    const input = document.getElementById('c-custom-event-input');
    const name = input.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) { toast(t('config.invalidEventName'), 'error'); return; }
    if (model.blocks.some((b) => b.name === name)) {
      toast(t('config.eventExists'), 'error'); return;
    }
    model.blocks.push({ name, fields: {}, __expanded: true });
    input.value = '';
    markDirty(true);
    renderEvents();
  });

  document.getElementById('c-tab-form').addEventListener('click', () => switchSubTab('form'));
  document.getElementById('c-event-search').addEventListener('input', filterEventCards);
  document.getElementById('c-tab-text').addEventListener('click', () => switchSubTab('text'));
  document.getElementById('c-save-btn').addEventListener('click', saveFile);
  document.getElementById('c-reload-btn').addEventListener('click', () => loadFile(true));
  document.getElementById('c-restore-btn').addEventListener('click', restoreRecommended);

  document.getElementById('cb-adaptive-toggle').addEventListener('change', (e) => setAdaptiveEnabled(e.target.checked));
  document.getElementById('cb-safemode-btn').addEventListener('click', toggleSafeMode);

  document.getElementById('c-mode-info-btn').addEventListener('click', openModeModal);
  document.getElementById('mode-choice-basic-btn').addEventListener('click', () => chooseMode(false));
  document.getElementById('mode-choice-advanced-btn').addEventListener('click', () => chooseMode(true));
  document.getElementById('mode-modal-close-btn').addEventListener('click', () => {
    try { localStorage.setItem(MODE_CHOSEN_KEY, 'true'); } catch (err) {}
    closeModeModal();
  });

  applyMode();
  if (!hasChosenMode()) openModeModal();

  // Detect core count + currently-active events from the live status so
  // cores in the form get real chips and event cards can show an
  // "active now" badge (best-effort - fine if it stays empty at first).
  refreshLiveStatus();

  loadFile(false).then(renderBasicMode);
}

function refreshLiveStatus() {
  return readStatus().then((text) => {
    const cores = [];
    let activeEvents = [];
    text.split('\n').forEach((rawLine) => {
      const line = rawLine.trim();
      let m;
      if ((m = line.match(/^cpu(\d+):/i))) cores.push(parseInt(m[1], 10));
      else if ((m = line.match(/^activeevents:\s*(.*)$/i))) {
        activeEvents = m[1].trim() ? m[1].trim().split(/\s+/) : [];
      } else if ((m = line.match(/^battery:\s*level=(\d+)\s+temp=\S+\s+voltage=\S+\s+charging=(\w+)/i))) {
        lastBattery = { level: parseInt(m[1], 10), charging: m[2] === 'true' };
      } else if ((m = line.match(/^criticalappscount:\s*(\d+)/i))) {
        lastCriticalAppsCount = parseInt(m[1], 10);
      } else if ((m = line.match(/^manufacturer:\s*(.*)$/i))) {
        lastManufacturer = m[1].trim();
        setDetectedManufacturer(lastManufacturer);
      } else if ((m = line.match(/^model:\s*(.*)$/i))) {
        lastModel = m[1].trim();
      } else if ((m = line.match(/^capabilities:\s*(.*)$/i))) {
        lastCapabilities = {};
        m[1].trim().split(/\s+/).forEach((pair) => {
          const [k, v] = pair.split('=');
          if (k) lastCapabilities[k] = v === 'true';
        });
      }
    });
    if (cores.length) coreList = cores.sort((a, b) => a - b);
    activeEventNames = new Set(activeEvents);
    if (loaded) renderVersionView();
  }).catch(() => {});
}

export function activateConfig() {
  // Re-aplica el modo guardado cada vez, no solo al iniciar - por
  // ejemplo, si el usuario llega aquí desde el botón "Ver ajustes
  // avanzados" de la pestaña Ajustes, que fija el modo Avanzado antes
  // de navegar; sin esto, si esta pestaña ya se había visitado antes
  // en Básico, el salto no cambiaría lo que se ve.
  applyMode();
  // Refresh which events are active-right-now (for the accordion badges)
  // whenever the user switches into this tab - safe to re-render at this
  // moment since nothing here has input focus yet.
  refreshLiveStatus();
}

export function deactivateConfig() {}

// Used by the tab-switch / swipe-nav guard in main.js: returns true if
// it's fine to leave (no changes, or the user confirmed discarding them).
export function confirmLeaveConfig() {
  if (!loaded || !isDirty) return true;
  return window.confirm(t('config.leaveConfirm'));
}

// ---------- Apps (now its own top-level tab, not a Config subtab) ----------
// The screen itself (renderAppPolicyScreen, drawAppPolicyList, etc.)
// stays defined above in this same file - only its entry points move
// here, since it no longer shares a lifecycle with Config's own
// Basic/Advanced editing.
let appsViewInited = false;

export function initAppsView() {
  if (appsViewInited) return;
  appsViewInited = true;
  document.getElementById('ap-usage-btn').textContent = t('apppolicy.usageButton');
  document.getElementById('ap-usage-btn').addEventListener('click', loadUsageBuckets);
  document.getElementById('ap-policy-search').addEventListener('input', (e) => {
    appPolicyState.filter = e.target.value;
    drawAppPolicyList();
  });
}

export function activateAppsView() {
  renderAppPolicyScreen();
}

export function deactivateAppsView() {}
