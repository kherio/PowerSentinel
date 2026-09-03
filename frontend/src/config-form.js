// Parser / serializer / form renderer for PowerSentinel.json (event-block based config)
import { t } from './i18n.js';

var PREDEFINED_EVENTS = ['boot', 'charging', 'screen_off', 'low_power', 'night', 'thermal', 'adaptive_tier1', 'adaptive_tier2', 'adaptive_tier3', 'manual'];

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
    placeholder: '/data/local/tmp/PowerSentinel/apps.allow',
    help: t('field.allowlist.help'),
    showIf: function (f) { return f.handle_apps === 'suspend'; }
  },
  {
    key: 'denylist', label: t('field.denylist.label'), type: 'text', group: 'apps',
    placeholder: '/data/local/tmp/PowerSentinel/apps.deny',
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
    placeholder: '/data/local/tmp/PowerSentinel/proc.list',
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
  { key: 'log_file', label: t('global.logFile.label'), type: 'text', def: '/sdcard/PowerSentinel.log',
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
    warn: t('global.chargeLimitNode.warn') },
  { key: 'adaptive_mode', label: t('global.adaptiveMode.label'), type: 'toggle', def: 'false',
    help: t('global.adaptiveMode.help') },
  { key: 'adaptive_tier1_threshold', label: t('global.adaptiveTier1.label'), type: 'number', def: '20',
    help: t('global.adaptiveTier1.help'),
    showIf: function (f) { return f.adaptive_mode === 'true'; } },
  { key: 'adaptive_tier2_threshold', label: t('global.adaptiveTier2.label'), type: 'number', def: '45',
    help: t('global.adaptiveTier2.help'),
    showIf: function (f) { return f.adaptive_mode === 'true'; } },
  { key: 'adaptive_tier3_threshold', label: t('global.adaptiveTier3.label'), type: 'number', def: '70',
    help: t('global.adaptiveTier3.help'),
    showIf: function (f) { return f.adaptive_mode === 'true'; } }
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
    log_file: '/sdcard/PowerSentinel.log',
    log_level: '2',
    notify: 'true',
    blocks: [
      { name: 'boot', fields: {} },
      { name: 'charging', fields: Object.assign({}, EVENT_PRESETS.balanced.fields) },
      { name: 'screen_off', fields: Object.assign({}, EVENT_PRESETS.balanced.fields) },
      { name: 'low_power', fields: Object.assign({}, EVENT_PRESETS.aggressive.fields) },
      { name: 'night', fields: Object.assign({ night_start: '23:00', night_end: '07:00' }, EVENT_PRESETS.balanced.fields) }
    ]
  };
}

// ---------- Parsing ----------
//
// The on-disk/wire format is now plain JSON ({"global": {...}, "events":
// {name: {...}}}), matching what the daemon itself reads via jq
// (PowerSentinel-config.sh) - previously both sides parsed a bespoke
// text grammar independently, which is exactly the kind of duplicated,
// drift-prone parsing this project has been trying to move away from.
//
// Because JSON round-trips arbitrary keys generically, there's no need
// for the old KNOWN_FIELD_KEYS/KNOWN_GLOBAL_KEYS "is this a field we
// recognize, or do we need to preserve it verbatim so we don't silently
// drop it" distinction, or the globalExtra/extra arrays that existed
// solely to carry unrecognized lines through a parse->serialize round
// trip - every key a block or the global object has just survives
// automatically, recognized or not, so an event field this version of
// the form doesn't have a control for (a newer daemon feature, a
// hand-edited addition, etc.) is never lost.

function parseConfig(text) {
  var data = JSON.parse(text); // deliberately not caught here - callers
  // (see switchSubTab) already handle invalid JSON as a parse error and
  // warn the user, exactly like they handled a malformed .conf before.

  if (!data || typeof data !== 'object') data = {};
  var global = (data.global && typeof data.global === 'object') ? data.global : {};
  var events = (data.events && typeof data.events === 'object') ? data.events : {};

  var model = { version: '2' };
  Object.keys(global).forEach(function (k) {
    model[k] = global[k] === null || global[k] === undefined ? '' : String(global[k]);
  });

  model.blocks = Object.keys(events).map(function (name) {
    var raw = (events[name] && typeof events[name] === 'object') ? events[name] : {};
    var fields = {};
    Object.keys(raw).forEach(function (k) {
      fields[k] = raw[k] === null || raw[k] === undefined ? '' : String(raw[k]);
    });
    return { name: name, fields: fields };
  });

  return model;
}

function serializeConfig(model) {
  // BUG FIX: this used to put "version" at the top level, as a sibling
  // of "global"/"events" - but the daemon (both
  // migrate_conf_to_json()'s idempotency check AND config_load_global's
  // normal, everyday read of every global setting) reads it from
  // *inside* "global" (.global.version), via the exact same
  // `.global | to_entries[]` walk used for every other global field.
  // Confirmed end to end: any save from this WebUI immediately runs
  // `PowerSentinelctl reload`, restarting the daemon and re-running
  // migrate_conf_to_json() - which, finding .global.version missing,
  // did not recognize the file as already migrated. If the old,
  // frozen PowerSentinel.conf still existed on disk, this silently
  // rebuilt the JSON from that stale snapshot, discarding whatever was
  // just saved (exactly the reported symptom: add an event, save,
  // reopen the app, and it's gone). If .conf was already empty/absent,
  // the save survived on disk, but $version still resolved to the
  // default "1" via the same missing-key fallback used everywhere else
  // - triggering the v3.16.0 "FATAL: could not migrate to v2" exit
  // (v1 support was removed entirely that version, so there's no
  // longer a fallback behavior for version=1) on every single reload.
  var global = { version: '2' };
  Object.keys(model).forEach(function (k) {
    if (k === 'blocks' || k === 'version') return;
    if (model[k] === undefined) return;
    global[k] = model[k];
  });

  var events = {};
  model.blocks.forEach(function (b) {
    var fields = {};
    Object.keys(b.fields).forEach(function (k) {
      // '__'-prefixed keys are in-memory-only UI bookkeeping (e.g.
      // __eventName, the apps-picker's __apps cache) and never belong in
      // the saved config. Everything else is written as-is, INCLUDING an
      // empty string - unlike the old serializer, which skipped empty
      // values entirely. That was a real, if minor, latent bug: a cores
      // field left in "Personalizado, nothing picked yet" (a legitimate
      // value of '') would be dropped from the output entirely, then
      // silently reappear as "Desactivado" after the next save+reload -
      // the same class of bug fixed for the *live* UI in a previous
      // version, just reachable through a save/reload instead.
      if (k.indexOf('__') === 0) return;
      if (b.fields[k] === undefined) return;
      fields[k] = b.fields[k];
    });
    events[b.name] = fields;
  });

  return JSON.stringify({ global: global, events: events }, null, 2) + '\n';
}

// ---------- Rendering helpers ----------

function fieldValue(fields, def) {
  return fields[def.key] !== undefined ? fields[def.key] : (def.def || '');
}

function renderCoresControl(value, coreList, onChange) {
  var wrap = document.createElement('div');
  // BUG FIX: this used to be `(value === 'false' || value === 'auto' ||
  // value === '' || value === undefined) ? value || 'false' : 'custom'`,
  // which mishandled the empty-string case - `'' || 'false'` evaluates
  // to 'false' in JS (an empty string is falsy), so picking
  // "Personalizado" with no cores selected yet (a legitimate value of
  // '') was immediately redisplayed as "Desactivado" on the very next
  // render. Empty string can only ever come from an explicit custom
  // selection (fieldValue() falls back to the field's def, 'false', for
  // a truly-unset value - never to ''), so it must always map to
  // 'custom', never silently reinterpreted as 'false' by a truthiness
  // fallback.
  var mode;
  if (value === 'auto') mode = 'auto';
  else if (value === 'false' || value === undefined) mode = 'false';
  else mode = 'custom';

  // Segmented buttons instead of a native <select>: this field only ever
  // needs one of 3 fixed choices, and a native OS picker dialog (which a
  // <select> triggers on Android) was found to sometimes revert the
  // choice back to "Desactivado" right after picking "Automático" or
  // "Personalizado" - button taps have simple, unambiguous click
  // handling with no separate native dialog involved, sidestepping that
  // class of issue entirely. Mirrors the same button style already used
  // for the individual core chips below.
  var modeRow = document.createElement('div');
  modeRow.style.display = 'flex';
  modeRow.style.flexWrap = 'wrap';
  modeRow.style.gap = '6px';
  var modeButtons = {};
  [['false', t('cores.optDisabled')], ['auto', t('cores.optAuto')], ['custom', t('cores.optCustom')]].forEach(function (o) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn' + (o[0] === mode ? ' primary' : ' ghost');
    btn.style.padding = '8px 12px';
    btn.style.fontSize = '13px';
    btn.textContent = o[1];
    btn.addEventListener('click', function () {
      if (o[0] === mode) return;
      mode = o[0];
      Object.keys(modeButtons).forEach(function (k) {
        modeButtons[k].className = 'btn' + (k === mode ? ' primary' : ' ghost');
      });
      if (mode === 'custom') {
        customWrap.style.display = 'block';
        renderCustom('');
        onChange('');
      } else {
        customWrap.style.display = 'none';
        onChange(mode);
      }
    });
    modeButtons[o[0]] = btn;
    modeRow.appendChild(btn);
  });
  wrap.appendChild(modeRow);

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
