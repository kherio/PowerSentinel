// Parser / serializer / form renderer for XtremeBS.conf (v1 flat + v2 event blocks)
import { t } from './i18n.js';

var PREDEFINED_EVENTS = ['boot', 'charging', 'screen_off', 'low_power', 'night', 'thermal', 'manual'];

var FIELD_DEFS = [
  {
    key: 'night_start', label: t('field.nightStart.label'), type: 'time', def: '23:00',
    placeholder: '23:00', group: 'horario',
    help: t('field.nightStart.help'),
    showIf: function (f) { return f.__eventName === 'night'; }
  },
  {
    key: 'night_end', label: t('field.nightEnd.label'), type: 'time', def: '07:00',
    placeholder: '07:00', group: 'horario',
    help: t('field.nightEnd.help'),
    showIf: function (f) { return f.__eventName === 'night'; }
  },
  {
    key: 'thermal_threshold', label: t('field.thermalThreshold.label'), type: 'number', def: '45',
    group: 'temperatura',
    help: t('field.thermalThreshold.help'),
    showIf: function (f) { return f.__eventName === 'thermal'; }
  },
  {
    key: 'handle_apps', label: t('field.handleApps.label'), type: 'select', def: 'false', group: 'apps',
    options: [
      { value: 'false', label: t('field.handleApps.optFalse') },
      { value: 'kill', label: t('field.handleApps.optKill') },
      { value: 'nice', label: t('field.handleApps.optNice') },
      { value: 'suspend', label: t('field.handleApps.optSuspend') }
    ],
    help: t('field.handleApps.help')
  },
  {
    key: 'allowlist', label: t('field.allowlist.label'), type: 'text', group: 'apps',
    placeholder: '/data/local/tmp/XtremeBS/apps.allow',
    help: t('field.allowlist.help'),
    showIf: function (f) { return f.handle_apps === 'suspend'; }
  },
  {
    key: 'denylist', label: t('field.denylist.label'), type: 'text', group: 'apps',
    placeholder: '/data/local/tmp/XtremeBS/apps.deny',
    help: t('field.denylist.help')
  },
  { key: 'handle_cores', label: t('field.handleCores.label'), type: 'cores', def: 'false', group: 'cpu',
    help: t('field.handleCores.help') },
  { key: 'disable_cores', label: t('field.disableCores.label'), type: 'cores', def: 'false', group: 'cpu',
    help: t('field.disableCores.help'),
    warn: t('field.disableCores.warn') },
  {
    key: 'handle_gms', label: t('field.handleGms.label'), type: 'select', def: 'false', group: 'sistema',
    options: [
      { value: 'false', label: t('field.handleGms.optFalse') },
      { value: 'nice', label: t('field.handleGms.optNice') },
      { value: 'kill', label: t('field.handleGms.optKill') }
    ],
    help: t('field.handleGms.help')
  },
  { key: 'handle_proc', label: t('field.handleProc.label'), type: 'toggle', def: 'false', group: 'sistema',
    help: t('field.handleProc.help') },
  {
    key: 'proc_file', label: t('field.procFile.label'), type: 'text', group: 'sistema',
    placeholder: '/data/local/tmp/XtremeBS/proc.list',
    help: t('field.procFile.help'),
    showIf: function (f) { return f.handle_proc === 'true'; }
  },
  { key: 'low_ram', label: t('field.lowRam.label'), type: 'toggle', def: 'false', group: 'sistema',
    help: t('field.lowRam.help'),
    warn: t('field.lowRam.warn') },
  {
    key: 'doze', label: t('field.doze.label'), type: 'select', def: 'false', group: 'sistema',
    options: [
      { value: 'false', label: t('field.doze.optFalse') },
      { value: 'light', label: t('field.doze.optLight') },
      { value: 'deep', label: t('field.doze.optDeep') }
    ],
    help: t('field.doze.help'),
    warn: t('field.doze.warn')
  },
  { key: 'kill_wifi', label: t('field.killWifi.label'), type: 'toggle', def: 'false', group: 'sistema',
    warn: t('field.killWifi.warn') },
  { key: 'keep_on_charge', label: t('field.keepOnCharge.label'), type: 'toggle', def: 'true', group: 'sistema',
    help: t('field.keepOnCharge.help') }
];

var GLOBAL_DEFS = [
  { key: 'delay', label: t('global.delay.label'), type: 'number', def: '3',
    help: t('global.delay.help') },
  { key: 'log_file', label: t('global.logFile.label'), type: 'text', def: '/sdcard/XtremeBS.log',
    help: t('global.logFile.help') },
  {
    key: 'log_level', label: t('global.logLevel.label'), type: 'select', def: '2',
    options: [
      { value: '1', label: '1 · INFO' },
      { value: '2', label: '2 · VERBOSE' },
      { value: '3', label: '3 · DEBUG' }
    ],
    help: t('global.logLevel.help')
  },
  { key: 'notify', label: t('global.notify.label'), type: 'toggle', def: 'true',
    help: t('global.notify.help') },
  { key: 'charge_limit', label: t('global.chargeLimit.label'), type: 'number', def: '0',
    help: t('global.chargeLimit.help') },
  { key: 'charge_limit_node', label: t('global.chargeLimitNode.label'), type: 'text', def: '',
    placeholder: '/sys/class/power_supply/battery/charging_enabled',
    help: t('global.chargeLimitNode.help'),
    warn: t('global.chargeLimitNode.warn') }
];

// Quick-start templates a user can apply to any event, instead of having
// to know a sensible combination of fields from scratch. "suspend" is
// deliberately left out of these (it needs an allowlist configured first
// via the apps picker, or the daemon disables it and notifies) - presets
// only set fields that work safely with zero extra setup.
var EVENT_PRESETS = {
  balanced: {
    label: t('preset.balanced.label'),
    fields: { handle_cores: 'auto', handle_apps: 'nice', handle_gms: 'nice', low_ram: 'false', doze: 'false', kill_wifi: 'false' }
  },
  aggressive: {
    label: t('preset.aggressive.label'),
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
// Built from GLOBAL_DEFS itself (plus 'version', a special top-level key
// not in GLOBAL_DEFS) rather than a separately-maintained static list -
// a static list silently went stale when charge_limit/charge_limit_node
// were added to GLOBAL_DEFS without updating it, so parseConfig treated
// them as "known" (correctly recognized, no globalExtra fallback -
// see below) while never actually copying them onto the returned
// model, and serializeConfig had no matching model field to read them
// back from either.
var KNOWN_GLOBAL_KEYS = (function () {
  var set = { version: true };
  GLOBAL_DEFS.forEach(function (d) { set[d.key] = true; });
  return set;
})();

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

  var model = {
    version: '2',
    globalExtra: globalExtra,
    blocks: blocks
  };
  GLOBAL_DEFS.forEach(function (d) { model[d.key] = top[d.key]; });
  return model;
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
  [['false', t('cores.optDisabled')], ['auto', t('cores.optAuto')], ['custom', t('cores.optCustom')]].forEach(function (o) {
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
  row.style.marginBottom = '20px';

  var label = document.createElement('div');
  label.textContent = def.label;
  label.style.fontSize = '15px';
  label.style.fontWeight = '500';
  label.style.marginBottom = '8px';
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
    lab.appendChild(document.createTextNode(input.checked ? t('toggle.enabled') : t('toggle.disabled')));
    input.addEventListener('change', function () {
      lab.lastChild.textContent = input.checked ? t('toggle.enabled') : t('toggle.disabled');
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
  } else if (def.type === 'time') {
    // Native time picker instead of free text - the input's value format
    // (HH:MM, 24h) already matches exactly what's stored/parsed
    // elsewhere (is_night_now() in the daemon), so no conversion needed
    // in either direction, and it can't produce an unparseable string.
    var timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.className = 'filter';
    timeInput.style.width = '100%';
    timeInput.value = value;
    timeInput.addEventListener('input', function () { onChange(timeInput.value); });
    row.appendChild(timeInput);
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
    help.style.fontSize = '13px';
    help.style.lineHeight = '1.4';
    help.style.color = 'var(--muted)';
    help.style.marginTop = '6px';
    help.textContent = def.help;
    row.appendChild(help);
  }
  if (def.warn) {
    var warn = document.createElement('div');
    warn.style.fontSize = '13px';
    warn.style.lineHeight = '1.4';
    warn.style.color = 'var(--warn)';
    warn.style.marginTop = '6px';
    warn.textContent = '⚠ ' + def.warn;
    row.appendChild(warn);
  }
  return row;
}

var GROUP_LABELS = {
  horario: t('group.horario'), apps: t('group.apps'), cpu: t('group.cpu'),
  sistema: t('group.sistema'), temperatura: t('group.temperatura')
};

// Renders the full field set for one "fields" object (a block or v1Fields), re-rendering
// the container in place whenever a value changes (some fields' visibility depends on others).
// Fields sharing a consecutive `def.group` get a small subheading above them, so a long
// list of 10+ fields reads as a few short, labeled clusters instead of one flat wall.
function renderFieldsForm(container, fields, defs, coreList, onDirty) {
  function rerender() {
    container.innerHTML = '';
    var lastGroup = null;
    defs.forEach(function (def) {
      var row = renderFieldRow(def, fields, coreList, function (val) {
        fields[def.key] = val;
        onDirty();
        rerender();
      });
      if (!row) return;
      if (def.group && def.group !== lastGroup) {
        var head = document.createElement('div');
        head.className = 'field-group-title';
        head.textContent = GROUP_LABELS[def.group] || def.group;
        container.appendChild(head);
      }
      lastGroup = def.group || null;
      container.appendChild(row);
    });
  }
  rerender();
}

export {
  PREDEFINED_EVENTS, FIELD_DEFS, GLOBAL_DEFS, EVENT_PRESETS,
  parseConfig, serializeConfig, renderFieldsForm, renderFieldRow, buildRecommendedModel
};
