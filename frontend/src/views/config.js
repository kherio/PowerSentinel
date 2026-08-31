import { ICONS } from '../icons.js';
import { readConfig, writeConfig, readStatus } from '../api.js';
import { toast, escapeHtml } from '../helpers.js';
import {
  PREDEFINED_EVENTS, FIELD_DEFS, GLOBAL_DEFS, V1_TRIGGER_DEF,
  parseConfig, serializeConfig, renderFieldsForm, renderFieldRow
} from '../config-form.js';

let model = null;
let original = '';
let coreList = null;
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

function markDirty(isDirty) { dirtyFlag.style.visibility = isDirty ? 'visible' : 'hidden'; }

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

function renderV1() {
  renderFieldsForm(document.getElementById('c-v1-fields'),
    Object.assign({}, model.v1Fields, { trigger: model.v1Fields.trigger || 'auto' }),
    [V1_TRIGGER_DEF].concat(FIELD_DEFS), coreList,
    () => markDirty(true));
}

const EVENT_ICONS = { boot: ICONS.power, charging: ICONS.plug, screen_off: ICONS.moon, low_power: ICONS.warn, manual: ICONS.manual };

function renderEvents() {
  const list = document.getElementById('c-events-list');
  list.innerHTML = '';
  model.blocks.forEach((block, idx) => {
    const card = document.createElement('div');
    card.className = 'event-card';

    const head = document.createElement('div');
    head.className = 'event-head';

    const iconEl = document.createElement('div');
    iconEl.className = 'event-icon';
    iconEl.innerHTML = EVENT_ICONS[block.name] || ICONS.bolt;
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
      nameEl.addEventListener('input', () => {
        block.name = nameEl.value.replace(/[^a-zA-Z0-9_-]/g, '');
        markDirty(true);
      });
    }
    head.appendChild(nameEl);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn ghost';
    delBtn.innerHTML = ICONS.trash;
    delBtn.title = 'Eliminar evento';
    delBtn.addEventListener('click', () => {
      model.blocks.splice(idx, 1);
      markDirty(true);
      renderEvents();
    });
    head.appendChild(delBtn);
    card.appendChild(head);

    const fieldsDiv = document.createElement('div');
    card.appendChild(fieldsDiv);
    renderFieldsForm(fieldsDiv, block.fields, FIELD_DEFS, coreList, () => markDirty(true));

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
}

function renderVersionView() {
  document.getElementById('c-version-select').value = model.version;
  document.getElementById('c-v1-card').style.display = model.version === '1' ? 'block' : 'none';
  document.getElementById('c-v2-section').style.display = model.version === '2' ? 'block' : 'none';
  renderGlobalFields();
  if (model.version === '1') renderV1(); else renderEvents();
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
    original = content;
    if (activeView === 'form') { editor.value = content; refreshHighlight(); }
    markDirty(false);
    toast('Configuración guardada', 'success');
  } catch (e) {
    toast('Error al guardar la configuración: ' + e.message, 'error');
  }
}

export function initConfig() {
  editor = document.getElementById('c-editor');
  highlightCode = document.getElementById('c-highlight').querySelector('code');
  dirtyFlag = document.getElementById('c-dirty-flag');

  document.getElementById('c-highlight').addEventListener('scroll', () => {});
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
  document.getElementById('c-dirty-flag').innerHTML =
    '<span class="badge warn"><span class="b-dot"></span>Cambios sin guardar</span>';

  document.getElementById('c-version-select').addEventListener('change', (e) => {
    model.version = e.target.value;
    markDirty(true);
    renderVersionView();
  });

  document.getElementById('c-add-predefined-btn').addEventListener('click', () => {
    const sel = document.getElementById('c-predefined-event-select');
    if (!sel.value) return;
    model.blocks.push({ name: sel.value, fields: {}, extra: [] });
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
    model.blocks.push({ name, fields: {}, extra: [] });
    input.value = '';
    markDirty(true);
    renderEvents();
  });

  document.getElementById('c-tab-form').addEventListener('click', () => switchSubTab('form'));
  document.getElementById('c-tab-text').addEventListener('click', () => switchSubTab('text'));
  document.getElementById('c-save-btn').addEventListener('click', saveFile);
  document.getElementById('c-reload-btn').addEventListener('click', () => loadFile(true));

  // Detect core count from the live status so cores in the form get
  // real chips (best-effort - fine if it stays empty on first load).
  readStatus().then((text) => {
    const cores = [];
    text.split('\n').forEach((line) => {
      const m = line.trim().match(/^cpu(\d+):/i);
      if (m) cores.push(parseInt(m[1], 10));
    });
    if (cores.length) {
      coreList = cores.sort((a, b) => a - b);
      if (loaded) renderVersionView();
    }
  }).catch(() => {});

  loadFile(false);
}

export function activateConfig() {
  // Nothing to poll - config is loaded once and edited locally.
}

export function deactivateConfig() {}

// Used by the tab-switch / swipe-nav guard in main.js: returns true if
// it's fine to leave (no changes, or the user confirmed discarding them).
export function confirmLeaveConfig() {
  if (!loaded || currentText() === original) return true;
  return window.confirm('Tienes cambios sin guardar en la configuración. ¿Salir sin guardar?');
}
