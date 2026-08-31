// Parser / serializer / form renderer for XtremeBS.conf (v1 flat + v2 event blocks)

var PREDEFINED_EVENTS = ['boot', 'charging', 'screen_off', 'low_power', 'night', 'manual'];

var FIELD_DEFS = [
  {
    key: 'night_start', label: 'Hora de inicio', type: 'text', def: '23:00',
    placeholder: '23:00',
    help: 'Formato 24h HH:MM. El perfil nocturno se activa/desactiva por horario, en paralelo a los demás eventos (pantalla, carga, batería baja...).',
    showIf: function (f) { return f.__eventName === 'night'; }
  },
  {
    key: 'night_end', label: 'Hora de fin', type: 'text', def: '07:00',
    placeholder: '07:00',
    help: 'Puede cruzar la medianoche (ej. inicio 23:00, fin 07:00).',
    showIf: function (f) { return f.__eventName === 'night'; }
  },
  {
    key: 'handle_apps', label: 'Gestión de apps', type: 'select', def: 'false',
    options: [
      { value: 'false', label: 'No gestionar' },
      { value: 'kill', label: 'Matar (kill)' },
      { value: 'nice', label: 'Reducir prioridad (nice)' },
      { value: 'suspend', label: 'Suspender' }
    ],
    help: '"Suspender" requiere una allowlist válida o las apps dejarán de funcionar. "Matar" las cierra por completo; "nice" solo baja su prioridad, siguen en segundo plano.'
  },
  {
    key: 'allowlist', label: 'Lista de apps permitidas (allowlist)', type: 'text',
    placeholder: '/data/local/tmp/XtremeBS/apps.allow',
    help: 'Apps que NUNCA se tocan, elígelas abajo con el selector.',
    showIf: function (f) { return f.handle_apps === 'suspend'; }
  },
  {
    key: 'denylist', label: 'Apps del sistema a gestionar (denylist)', type: 'text',
    placeholder: '/data/local/tmp/XtremeBS/apps.deny',
    help: 'Apps de sistema (preinstaladas) a incluir además de las de terceros. Vacío por defecto.'
  },
  { key: 'handle_cores', label: 'Núcleos en modo ahorro (powersave)', type: 'cores', def: 'false',
    help: '"Automático" detecta y usa los núcleos de baja potencia del chip. "Personalizado" te deja elegir cuáles.' },
  { key: 'disable_cores', label: 'Núcleos a desactivar', type: 'cores', def: 'false',
    help: 'Apaga núcleos por completo (más agresivo que solo bajarles la frecuencia).',
    warn: 'Evitar en dispositivos Samsung.' },
  {
    key: 'handle_gms', label: 'Google Mobile Services', type: 'select', def: 'false',
    options: [
      { value: 'false', label: 'No gestionar' },
      { value: 'nice', label: 'Reducir prioridad' },
      { value: 'kill', label: 'Matar (rompe SafetyNet / Play Integrity)' }
    ],
    help: 'Servicios de Google en segundo plano; suelen consumir batería incluso sin usar apps de Google.'
  },
  { key: 'handle_proc', label: 'Reprocesar prioridad de procesos', type: 'toggle', def: 'false',
    help: 'Aplica la lista de procesos y prioridades definida en "Archivo de procesos".' },
  {
    key: 'proc_file', label: 'Archivo de procesos', type: 'text',
    placeholder: '/data/local/tmp/XtremeBS/proc.list',
    help: 'Una línea por proceso: "nombre_proceso prioridad" (ej. "com.example.app 15").',
    showIf: function (f) { return f.handle_proc === 'true'; }
  },
  { key: 'low_ram', label: 'Modo RAM baja', type: 'toggle', def: 'false',
    help: 'Activa la marca de sistema "RAM baja", que hace que Android sea más agresivo cerrando apps en segundo plano.',
    warn: 'Puede causar reinicios aleatorios en algunos OnePlus.' },
  {
    key: 'doze', label: 'Forzar Doze', type: 'select', def: 'false',
    options: [
      { value: 'false', label: 'Desactivado' },
      { value: 'light', label: 'Ligero' },
      { value: 'deep', label: 'Profundo' }
    ],
    help: 'Fuerza el modo de ahorro "Doze" de Android antes de que se active por sí solo.',
    warn: 'Puede retrasar alarmas y notificaciones.'
  },
  { key: 'kill_wifi', label: 'Desactivar WiFi', type: 'toggle', def: 'false',
    warn: 'También desactiva el interruptor de WiFi en Ajustes.' },
  { key: 'keep_on_charge', label: 'Mantener ajustes mientras carga', type: 'toggle', def: 'true',
    help: 'Si está activado, este evento no se desactiva automáticamente al enchufar el cargador.' }
];

var GLOBAL_DEFS = [
  { key: 'delay', label: 'Intervalo de sondeo (segundos)', type: 'number', def: '3',
    help: 'Valores altos ahorran CPU pero detectan eventos más despacio.' },
  { key: 'log_file', label: 'Archivo de log', type: 'text', def: '/sdcard/XtremeBS.log',
    help: 'Dónde escribe el demonio su registro de actividad (visible en la pestaña Log).' },
  {
    key: 'log_level', label: 'Nivel de log', type: 'select', def: '2',
    options: [
      { value: '1', label: '1 · INFO' },
      { value: '2', label: '2 · VERBOSE' },
      { value: '3', label: '3 · DEBUG' }
    ],
    help: 'Más alto = más detalle en el log, pero también un fichero que crece más rápido.'
  },
  { key: 'notify', label: 'Mostrar notificaciones', type: 'toggle', def: 'true',
    help: 'Notificación del sistema cada vez que XtremeBS activa o desactiva algo.' }
];

// Quick-start templates a user can apply to any event, instead of having
// to know a sensible combination of fields from scratch. "suspend" is
// deliberately left out of these (it needs an allowlist configured first
// via the apps picker, or the daemon disables it and notifies) - presets
// only set fields that work safely with zero extra setup.
var EVENT_PRESETS = {
  balanced: {
    label: 'Equilibrado',
    fields: { handle_cores: 'auto', handle_apps: 'nice', handle_gms: 'nice', low_ram: 'false', doze: 'false', kill_wifi: 'false' }
  },
  aggressive: {
    label: 'Ahorro agresivo',
    fields: { handle_cores: 'auto', disable_cores: 'auto', handle_apps: 'kill', handle_gms: 'kill', low_ram: 'true', doze: 'deep', kill_wifi: 'true' }
  }
};

// "Restaurar valores recomendados": replaces the whole in-memory form
// with a fresh, sensible starting config (nothing is written to disk
// until the user hits Guardar). boot is left inert on purpose - it only
// runs once at startup, so a global preset there would apply to every
// future boot silently.
function buildRecommendedModel() {
  return {
    version: '2',
    delay: '3',
    log_file: '/sdcard/XtremeBS.log',
    log_level: '2',
    notify: 'true',
    globalExtra: [],
    blocks: [
      { name: 'boot', fields: {}, extra: [] },
      { name: 'charging', fields: Object.assign({}, EVENT_PRESETS.balanced.fields), extra: [] },
      { name: 'screen_off', fields: Object.assign({}, EVENT_PRESETS.balanced.fields), extra: [] },
      { name: 'low_power', fields: Object.assign({}, EVENT_PRESETS.aggressive.fields), extra: [] },
      { name: 'night', fields: Object.assign({ night_start: '23:00', night_end: '07:00' }, EVENT_PRESETS.balanced.fields), extra: [] }
    ]
  };
}

// ---------- Parsing ----------

var KNOWN_FIELD_KEYS = (function () {
  var set = {};
  FIELD_DEFS.forEach(function (d) { set[d.key] = true; });
  return set;
})();
var KNOWN_GLOBAL_KEYS = { version: 1, delay: 1, log_file: 1, log_level: 1, notify: 1 };

function parseConfig(text) {
  var lines = text.split('\n');
  var top = {};
  var globalExtra = [];
  var blocks = [];
  var current = null;
  var blockHeaderRe = /^([a-zA-Z0-9_-]+)=\{\s*$/;
  var kvRe = /^([a-zA-Z0-9_]+)\s*=\s*(.*)$/;

  lines.forEach(function (raw) {
    var trimmed = raw.trim();
    if (current && trimmed === '}') { current = null; return; }
    var m;
    if (!current && (m = trimmed.match(blockHeaderRe))) {
      current = { name: m[1], fields: {}, extra: [] };
      blocks.push(current);
      return;
    }
    // Drop pure blank lines entirely (they'd otherwise accumulate on every
    // parse -> serialize round trip). Only real comments are preserved.
    if (trimmed === '') return;
    if (trimmed.charAt(0) === '#') {
      (current ? current.extra : globalExtra).push(raw);
      return;
    }
    if ((m = trimmed.match(kvRe))) {
      var key = m[1], val = m[2];
      var known = current ? KNOWN_FIELD_KEYS[key] : KNOWN_GLOBAL_KEYS[key];
      if (known) {
        (current ? current.fields : top)[key] = val;
      } else {
        // Unrecognized top-level key: preserve verbatim rather than
        // silently dropping it. This is also where a legacy v1 config's
        // flat fields (handle_apps=..., low_ram=..., etc. with no event
        // block) land, since the form no longer edits v1 configs - the
        // original lines are kept intact instead of being lost.
        (current ? current.extra : globalExtra).push(raw);
      }
      return;
    }
    (current ? current.extra : globalExtra).push(raw);
  });

  return {
    version: '2',
    delay: top.delay,
    log_file: top.log_file,
    log_level: top.log_level,
    notify: top.notify,
    globalExtra: globalExtra,
    blocks: blocks
  };
}

function serializeConfig(model) {
  var out = [];
  out.push('version=2');
  GLOBAL_DEFS.forEach(function (d) {
    var v = model[d.key];
    if (v !== undefined && v !== '') out.push(d.key + '=' + v);
  });
  if (model.globalExtra && model.globalExtra.length) {
    out = out.concat(model.globalExtra);
  }

  model.blocks.forEach(function (b) {
    out.push('');
    out.push(b.name + '={');
    FIELD_DEFS.forEach(function (d) {
      var v = b.fields[d.key];
      if (v !== undefined && v !== '') out.push('  ' + d.key + '=' + v);
    });
    if (b.extra && b.extra.length) out = out.concat(b.extra);
    out.push('}');
  });
  return out.join('\n') + '\n';
}

// ---------- Rendering helpers ----------

function fieldValue(fields, def) {
  return fields[def.key] !== undefined ? fields[def.key] : (def.def || '');
}

function renderCoresControl(value, coreList, onChange) {
  var wrap = document.createElement('div');
  var mode = (value === 'false' || value === 'auto' || value === '' || value === undefined) ? value || 'false' : 'custom';

  var select = document.createElement('select');
  select.className = 'filter';
  [['false', 'Desactivado'], ['auto', 'Automático'], ['custom', 'Personalizado']].forEach(function (o) {
    var opt = document.createElement('option');
    opt.value = o[0]; opt.textContent = o[1];
    if (o[0] === mode) opt.selected = true;
    select.appendChild(opt);
  });
  wrap.appendChild(select);

  var customWrap = document.createElement('div');
  customWrap.style.marginTop = '8px';
  customWrap.style.display = mode === 'custom' ? 'block' : 'none';
  wrap.appendChild(customWrap);

  function renderCustom(current) {
    customWrap.innerHTML = '';
    var selected = (current === 'false' || current === 'auto') ? [] : current.split(/\s+/).filter(Boolean);
    if (coreList && coreList.length) {
      var chipRow = document.createElement('div');
      chipRow.style.display = 'flex';
      chipRow.style.flexWrap = 'wrap';
      chipRow.style.gap = '6px';
      coreList.forEach(function (n) {
        var id = 'cpu' + n;
        var active = selected.indexOf(id) !== -1;
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'btn' + (active ? ' primary' : ' ghost');
        chip.style.padding = '6px 10px';
        chip.style.fontSize = '12px';
        chip.textContent = id;
        chip.addEventListener('click', function () {
          var idx = selected.indexOf(id);
          if (idx === -1) selected.push(id); else selected.splice(idx, 1);
          onChange(selected.join(' '));
          renderCustom(selected.join(' '));
        });
        chipRow.appendChild(chip);
      });
      customWrap.appendChild(chipRow);
    } else {
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'filter';
      input.style.width = '100%';
      input.placeholder = 'cpu6 cpu7';
      input.value = selected.join(' ');
      input.addEventListener('input', function () { onChange(input.value); });
      customWrap.appendChild(input);
    }
  }
  renderCustom(mode === 'custom' ? value : '');

  select.addEventListener('change', function () {
    if (select.value === 'custom') {
      customWrap.style.display = 'block';
      renderCustom('');
      onChange('');
    } else {
      customWrap.style.display = 'none';
      onChange(select.value);
    }
  });

  return wrap;
}

function renderFieldRow(def, fields, coreList, onChange) {
  var visible = !def.showIf || def.showIf(fields);
  if (!visible) return null;

  var row = document.createElement('div');
  row.className = 'field-row';
  row.style.marginBottom = '14px';

  var label = document.createElement('div');
  label.textContent = def.label;
  label.style.fontSize = '13px';
  label.style.fontWeight = '500';
  label.style.marginBottom = '6px';
  row.appendChild(label);

  var value = fieldValue(fields, def);

  if (def.type === 'toggle') {
    var lab = document.createElement('label');
    lab.className = 'switch';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value === 'true';
    input.addEventListener('change', function () { onChange(input.checked ? 'true' : 'false'); });
    lab.appendChild(input);
    lab.appendChild(document.createTextNode(input.checked ? 'Activado' : 'Desactivado'));
    input.addEventListener('change', function () {
      lab.lastChild.textContent = input.checked ? 'Activado' : 'Desactivado';
    });
    row.appendChild(lab);
  } else if (def.type === 'select') {
    var sel = document.createElement('select');
    sel.className = 'filter';
    def.options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () { onChange(sel.value); });
    row.appendChild(sel);
  } else if (def.type === 'cores') {
    row.appendChild(renderCoresControl(value, coreList, onChange));
  } else if (def.type === 'number') {
    var num = document.createElement('input');
    num.type = 'number';
    num.className = 'filter';
    num.style.width = '100%';
    num.value = value;
    num.addEventListener('input', function () { onChange(num.value); });
    row.appendChild(num);
  } else {
    var txt = document.createElement('input');
    txt.type = 'text';
    txt.className = 'filter';
    txt.style.width = '100%';
    txt.placeholder = def.placeholder || '';
    txt.value = value;
    txt.addEventListener('input', function () { onChange(txt.value); });
    row.appendChild(txt);
  }

  if (def.help) {
    var help = document.createElement('div');
    help.style.fontSize = '11px';
    help.style.color = 'var(--muted)';
    help.style.marginTop = '4px';
    help.textContent = def.help;
    row.appendChild(help);
  }
  if (def.warn) {
    var warn = document.createElement('div');
    warn.style.fontSize = '11px';
    warn.style.color = 'var(--warn)';
    warn.style.marginTop = '4px';
    warn.textContent = '⚠ ' + def.warn;
    row.appendChild(warn);
  }
  return row;
}

// Renders the full field set for one "fields" object (a block or v1Fields), re-rendering
// the container in place whenever a value changes (some fields' visibility depends on others).
function renderFieldsForm(container, fields, defs, coreList, onDirty) {
  function rerender() {
    container.innerHTML = '';
    defs.forEach(function (def) {
      var row = renderFieldRow(def, fields, coreList, function (val) {
        fields[def.key] = val;
        onDirty();
        rerender();
      });
      if (row) container.appendChild(row);
    });
  }
  rerender();
}

export {
  PREDEFINED_EVENTS, FIELD_DEFS, GLOBAL_DEFS, EVENT_PRESETS,
  parseConfig, serializeConfig, renderFieldsForm, renderFieldRow, buildRecommendedModel
};
