// Parser / serializer / form renderer for XtremeBS.conf (v1 flat + v2 event blocks)

var PREDEFINED_EVENTS = ['boot', 'charging', 'screen_off', 'low_power', 'manual'];

var FIELD_DEFS = [
  {
    key: 'handle_apps', label: 'Gestión de apps', type: 'select', def: 'false',
    options: [
      { value: 'false', label: 'No gestionar' },
      { value: 'kill', label: 'Matar (kill)' },
      { value: 'nice', label: 'Reducir prioridad (nice)' },
      { value: 'suspend', label: 'Suspender' }
    ],
    help: '"Suspender" requiere una allowlist válida o las apps dejarán de funcionar.'
  },
  {
    key: 'allowlist', label: 'Lista de apps permitidas (allowlist)', type: 'text',
    placeholder: '/data/local/tmp/XtremeBS/apps.allow',
    showIf: function (f) { return f.handle_apps === 'suspend'; }
  },
  {
    key: 'denylist', label: 'Apps del sistema a gestionar (denylist)', type: 'text',
    placeholder: '/data/local/tmp/XtremeBS/apps.deny'
  },
  { key: 'handle_cores', label: 'Núcleos en modo ahorro (powersave)', type: 'cores', def: 'false' },
  { key: 'disable_cores', label: 'Núcleos a desactivar', type: 'cores', def: 'false',
    warn: 'Evitar en dispositivos Samsung.' },
  {
    key: 'handle_gms', label: 'Google Mobile Services', type: 'select', def: 'false',
    options: [
      { value: 'false', label: 'No gestionar' },
      { value: 'nice', label: 'Reducir prioridad' },
      { value: 'kill', label: 'Matar (rompe SafetyNet / Play Integrity)' }
    ]
  },
  { key: 'handle_proc', label: 'Reprocesar prioridad de procesos', type: 'toggle', def: 'false' },
  {
    key: 'proc_file', label: 'Archivo de procesos', type: 'text',
    placeholder: '/data/local/tmp/XtremeBS/proc.list',
    showIf: function (f) { return f.handle_proc === 'true'; }
  },
  { key: 'low_ram', label: 'Modo RAM baja', type: 'toggle', def: 'false',
    warn: 'Puede causar reinicios aleatorios en algunos OnePlus.' },
  {
    key: 'doze', label: 'Forzar Doze', type: 'select', def: 'false',
    options: [
      { value: 'false', label: 'Desactivado' },
      { value: 'light', label: 'Ligero' },
      { value: 'deep', label: 'Profundo' }
    ],
    warn: 'Puede retrasar alarmas y notificaciones.'
  },
  { key: 'kill_wifi', label: 'Desactivar WiFi', type: 'toggle', def: 'false',
    warn: 'También desactiva el interruptor de WiFi en Ajustes.' },
  { key: 'keep_on_charge', label: 'Mantener ajustes mientras carga', type: 'toggle', def: 'true' }
];

var GLOBAL_DEFS = [
  { key: 'delay', label: 'Intervalo de sondeo (segundos)', type: 'number', def: '3',
    help: 'Valores altos ahorran CPU pero detectan eventos más despacio.' },
  { key: 'log_file', label: 'Archivo de log', type: 'text', def: '/sdcard/XtremeBS.log' },
  {
    key: 'log_level', label: 'Nivel de log', type: 'select', def: '2',
    options: [
      { value: '1', label: '1 · INFO' },
      { value: '2', label: '2 · VERBOSE' },
      { value: '3', label: '3 · DEBUG' }
    ]
  },
  { key: 'notify', label: 'Mostrar notificaciones', type: 'toggle', def: 'true' }
];

var V1_TRIGGER_DEF = {
  key: 'trigger', label: 'Disparador (trigger)', type: 'select', def: 'auto',
  options: [
    { value: 'auto', label: 'Automático (ahorro de batería)' },
    { value: 'boot', label: 'Al arrancar' },
    { value: 'manual', label: 'Manual' }
  ]
};

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
      // Top-level keys can be v2 globals (version/delay/...), OR v1-style flat
      // fields (trigger, handle_apps, ...) sharing the same key set as block fields.
      var known = current
        ? KNOWN_FIELD_KEYS[key]
        : (KNOWN_GLOBAL_KEYS[key] || KNOWN_FIELD_KEYS[key] || key === 'trigger');
      if (known) {
        (current ? current.fields : top)[key] = val;
      } else {
        // Unrecognized key: preserve verbatim rather than silently dropping it.
        (current ? current.extra : globalExtra).push(raw);
      }
      return;
    }
    (current ? current.extra : globalExtra).push(raw);
  });

  var version = top.version === '1' ? '1' : '2';
  var model = {
    version: version,
    delay: top.delay,
    log_file: top.log_file,
    log_level: top.log_level,
    notify: top.notify,
    globalExtra: globalExtra,
    v1Fields: {},
    blocks: blocks
  };

  var knownTop = { version: 1, delay: 1, log_file: 1, log_level: 1, notify: 1 };
  Object.keys(top).forEach(function (k) {
    if (knownTop[k]) return;
    if (version === '1') model.v1Fields[k] = top[k];
    else model.globalExtra.push(k + '=' + top[k]);
  });

  return model;
}

function serializeConfig(model) {
  var out = [];
  out.push('version=' + model.version);
  GLOBAL_DEFS.forEach(function (d) {
    var v = model[d.key];
    if (v !== undefined && v !== '') out.push(d.key + '=' + v);
  });
  if (model.globalExtra && model.globalExtra.length) {
    out = out.concat(model.globalExtra);
  }

  if (model.version === '1') {
    out.push('trigger=' + (model.v1Fields.trigger || 'auto'));
    FIELD_DEFS.forEach(function (d) {
      var v = model.v1Fields[d.key];
      if (v !== undefined && v !== '') out.push(d.key + '=' + v);
    });
  } else {
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
  }
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
  PREDEFINED_EVENTS, FIELD_DEFS, GLOBAL_DEFS, V1_TRIGGER_DEF,
  parseConfig, serializeConfig, renderFieldsForm, renderFieldRow
};
