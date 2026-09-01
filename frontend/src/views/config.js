import { ICONS } from '../icons.js';
import { readConfig, writeConfig, readStatus, startEvent, stopEvent } from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import { mountAppsPicker, persistAppsPicker } from './apps-picker.js';
import {
  PREDEFINED_EVENTS, FIELD_DEFS, GLOBAL_DEFS, EVENT_PRESETS,
  parseConfig, serializeConfig, renderFieldsForm, renderFieldRow, buildRecommendedModel
} from '../config-form.js';

let model = null;
let original = '';
let coreList = null;
let activeEventNames = new Set();
let activeView = 'form';
let loaded = false;

let editor, highlightCode, dirtyFlag;

function highlightLine(line) {
  if (/^\s*#/.test(line)) return `<span class="tok-comment">${escapeHtml(line)}</span>`;
  const blockMatch = line.match(/^(\s*)([a-zA-Z0-9_-]+)(=\{)(\s*)$/);
  if (blockMatch) {
    return blockMatch[1] + `<span class="tok-block">${escapeHtml(blockMatch[2])}</span>` +
      `<span class="tok-punct">${escapeHtml(blockMatch[3])}</span>` + blockMatch[4];
  }
  if (/^\s*\}\s*$/.test(line)) return `<span class="tok-punct">${escapeHtml(line)}</span>`;
  const kv = line.match(/^(\s*)([a-zA-Z0-9_]+)(\s*=\s*)(.*)$/);
  if (kv) {
    return kv[1] + `<span class="tok-key">${escapeHtml(kv[2])}</span>` +
      `<span class="tok-op">${escapeHtml(kv[3])}</span>` +
      `<span class="tok-val">${escapeHtml(kv[4])}</span>`;
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
    });
    if (row) container.appendChild(row);
  });
}

const EVENT_ICONS = {
  boot: ICONS.power, charging: ICONS.plug, screen_off: ICONS.moon,
  low_power: ICONS.warn, night: ICONS.moon, manual: ICONS.manual
};

function summarizeFields(fields) {
  const bits = [];
  if (fields.handle_apps && fields.handle_apps !== 'false') bits.push('apps: ' + fields.handle_apps);
  if (fields.handle_cores && fields.handle_cores !== 'false') bits.push('núcleos: ' + fields.handle_cores);
  if (fields.disable_cores && fields.disable_cores !== 'false') bits.push('desactiva núcleos');
  if (fields.handle_gms && fields.handle_gms !== 'false') bits.push('GMS: ' + fields.handle_gms);
  if (fields.doze && fields.doze !== 'false') bits.push('doze: ' + fields.doze);
  if (fields.kill_wifi === 'true') bits.push('WiFi off');
  if (fields.low_ram === 'true') bits.push('low RAM');
  if (fields.handle_proc === 'true') bits.push('procesos');
  if (fields.night_start) bits.push(`${fields.night_start}–${fields.night_end || ''}`);
  return bits.length ? bits.join(' · ') : 'Sin ajustes activos';
}

function renderEvents() {
  const list = document.getElementById('c-events-list');
  list.innerHTML = '';
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
    if (isActiveNow) iconEl.title = 'Activo ahora mismo';
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
      activeBadge.innerHTML = '<span class="b-dot"></span>Activo';
      head.appendChild(activeBadge);
    }

    const actions = document.createElement('div');
    actions.className = 'event-head-actions';
    actions.addEventListener('click', (e) => e.stopPropagation());

    // Try-it-now: fires the event immediately via XBSctl, without
    // waiting for its real trigger condition (screen off, low battery...)
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn ghost';
    applyBtn.innerHTML = ICONS.bolt;
    applyBtn.title = 'Aplicar ahora (probar el evento)';
    applyBtn.addEventListener('click', async () => {
      try { await startEvent(block.name); toast(`"${block.name}" aplicado`, 'success'); }
      catch (e) { toast('Error al aplicar: ' + e.message, 'error'); }
    });
    actions.appendChild(applyBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn ghost';
    stopBtn.innerHTML = ICONS.power;
    stopBtn.title = 'Detener (deshacer la prueba)';
    stopBtn.addEventListener('click', async () => {
      try { await stopEvent(block.name); toast(`"${block.name}" detenido`, 'success'); }
      catch (e) { toast('Error al detener: ' + e.message, 'error'); }
    });
    actions.appendChild(stopBtn);

    const dupBtn = document.createElement('button');
    dupBtn.className = 'btn ghost';
    dupBtn.innerHTML = ICONS.plus;
    dupBtn.title = 'Duplicar como evento personalizado';
    dupBtn.addEventListener('click', () => {
      let base = block.name.replace(/_copy\d*$/, '') + '_copy';
      let name = base, n = 2;
      const existing = model.blocks.map((b) => b.name);
      while (existing.indexOf(name) !== -1) { name = base + n; n++; }
      const clonedFields = Object.assign({}, block.fields);
      delete clonedFields.__apps; // don't share the (unsaved) apps-picker state between events
      model.blocks.push({ name, fields: clonedFields, extra: [], __expanded: true });
      markDirty(true);
      renderEvents();
    });
    actions.appendChild(dupBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn ghost';
    delBtn.innerHTML = ICONS.trash;
    delBtn.title = 'Eliminar evento';
    delBtn.addEventListener('click', () => {
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
      noneOpt.value = ''; noneOpt.textContent = 'Aplicar plantilla…';
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
        toast(`Plantilla "${preset.label}" aplicada a ${block.name}`, 'success');
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
      renderFieldsForm(fieldsDiv, block.fields, FIELD_DEFS, coreList, () => { markDirty(true); summary.textContent = summarizeFields(block.fields); });

      const appsDiv = document.createElement('div');
      body.appendChild(appsDiv);
      mountAppsPicker(appsDiv, block.fields, () => markDirty(true));

      card.appendChild(body);
    }

    list.appendChild(card);
  });

  if (!model.blocks.length) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = 'Sin eventos configurados todavía.';
    list.appendChild(empty);
  }

  const predefSelect = document.getElementById('c-predefined-event-select');
  predefSelect.innerHTML = '';
  const existing = model.blocks.map((b) => b.name);
  const available = PREDEFINED_EVENTS.filter((e) => existing.indexOf(e) === -1);
  if (!available.length) {
    const opt = document.createElement('option');
    opt.textContent = 'Todos los eventos predefinidos añadidos';
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
}

function switchSubTab(view) {
  if (view === activeView) return;
  if (view === 'text') {
    editor.value = serializeConfig(model);
    refreshHighlight();
  } else {
    try {
      model = parseConfig(editor.value);
    } catch (e) {
      toast('No se pudo interpretar el texto, revisa el formato', 'error');
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
    if (showToast) toast('Configuración recargada', 'success');
    loaded = true;
  } catch (e) {
    toast('No se pudo cargar la configuración: ' + e.message, 'error');
  }
}

async function saveFile() {
  const content = currentText();
  try {
    await writeConfig(content);
    // Apps picker edits live outside XtremeBS.conf (separate allow/deny
    // files), so they're persisted alongside it here rather than being
    // part of the serialized config text.
    await Promise.all(model.blocks.map((b) => persistAppsPicker(b.fields)));
    original = content;
    if (activeView === 'form') { editor.value = content; refreshHighlight(); }
    markDirty(false);
    toast('Configuración guardada', 'success');
  } catch (e) {
    toast('Error al guardar la configuración: ' + e.message, 'error');
  }
}

async function restoreRecommended() {
  const ok = window.confirm(
    'Esto reemplaza el formulario por una configuración recomendada de partida ' +
    '(boot, charging, screen_off, low_power y night con ajustes equilibrados). ' +
    'No se escribe nada en el dispositivo hasta que pulses Guardar. ¿Continuar?'
  );
  if (!ok) return;
  model = buildRecommendedModel();
  activeView = 'form';
  document.getElementById('c-view-form').style.display = 'block';
  document.getElementById('c-view-text').style.display = 'none';
  document.getElementById('c-tab-form').classList.add('active');
  document.getElementById('c-tab-text').classList.remove('active');
  renderVersionView();
  markDirty(true);
  toast('Valores recomendados cargados - revisa y pulsa Guardar', 'success');
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

  document.getElementById('c-save-btn').innerHTML = ICONS.save + ' Guardar';
  document.getElementById('c-reload-btn').innerHTML = ICONS.reload + ' Recargar';
  document.getElementById('c-restore-btn').innerHTML = ICONS.leaf + ' Recomendados';
  document.getElementById('c-dirty-flag').innerHTML =
    '<span class="badge warn"><span class="b-dot"></span>Cambios sin guardar</span>';

  document.getElementById('c-add-predefined-btn').addEventListener('click', () => {
    const sel = document.getElementById('c-predefined-event-select');
    if (!sel.value) return;
    const fields = sel.value === 'night' ? { night_start: '23:00', night_end: '07:00' } : {};
    model.blocks.push({ name: sel.value, fields, extra: [], __expanded: true });
    markDirty(true);
    renderEvents();
  });

  document.getElementById('c-add-custom-btn').addEventListener('click', () => {
    const input = document.getElementById('c-custom-event-input');
    const name = input.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) { toast('Escribe un nombre de evento válido', 'error'); return; }
    if (model.blocks.some((b) => b.name === name)) {
      toast('Ese evento ya existe', 'error'); return;
    }
    model.blocks.push({ name, fields: {}, extra: [], __expanded: true });
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

  // Detect core count + currently-active events from the live status so
  // cores in the form get real chips and event cards can show an
  // "activo ahora" badge (best-effort - fine if it stays empty at first).
  refreshLiveStatus();

  loadFile(false);
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
      }
    });
    if (cores.length) coreList = cores.sort((a, b) => a - b);
    activeEventNames = new Set(activeEvents);
    if (loaded) renderVersionView();
  }).catch(() => {});
}

export function activateConfig() {
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
  return window.confirm('Tienes cambios sin guardar en la configuración. ¿Salir sin guardar?');
}
