import { ICONS } from '../icons.js';
import { listPackages, listRunningPackages, readAppListFile, writeAppListFile } from '../api.js';
import { toast } from '../helpers.js';
import { t } from '../i18n.js';

// Cache the installed-package list across renders/events within one
// session - it doesn't change while the user is editing config, and
// `pm list packages` over a root shell isn't instant on some devices.
let pkgCachePromise = null;
function getPackages(includeSystem) {
  if (!pkgCachePromise || getPackages._sys !== includeSystem) {
    getPackages._sys = includeSystem;
    pkgCachePromise = listPackages(includeSystem).catch((e) => {
      toast(t('apps.listError', { msg: e.message }), 'error');
      return [];
    });
  }
  return pkgCachePromise;
}

// "Currently running" is just a helpful hint, not critical data - fail
// silently (empty set) rather than bothering the user with a toast if it
// can't be read, and re-fetch it fresh each time the picker mounts
// (unlike the package list, this genuinely changes moment to moment).
function getRunningPackages() {
  return listRunningPackages().catch(() => new Set());
}

function parseListFile(text) {
  const set = new Set();
  text.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && trimmed.charAt(0) !== '#') set.add(trimmed);
  });
  return set;
}

// Mounts (or re-mounts) the picker into `container` for one event's
// fields. Loads lazily and caches its loaded state on the `fields`
// object itself (fields.__apps), so switching sub-tabs or re-rendering
// the form (e.g. after an unrelated field change) doesn't re-fetch or
// lose in-progress edits until the user actually saves.
export function mountAppsPicker(container, fields, onDirty) {
  container.innerHTML = '';
  if (fields.handle_apps === 'false' || !fields.handle_apps) return;

  const box = document.createElement('div');
  box.className = 'card';
  box.style.marginTop = '4px';
  box.innerHTML = `<div style="font-size:13px;font-weight:500;margin-bottom:8px;">${t('apps.chooseApps')}</div>
    <div id="ap-status" style="font-size:12px;color:var(--muted);">${t('apps.loading')}</div>`;
  container.appendChild(box);

  const allowPath = fields.allowlist || '/data/local/tmp/XtremeBS/apps.allow';
  const denyPath = fields.denylist || '/data/local/tmp/XtremeBS/apps.deny';

  if (!fields.__apps) fields.__apps = { loaded: false, dirty: false, allow: new Set(), deny: new Set(), includeSystem: false };
  const state = fields.__apps;

  function warnBox() {
    if (fields.handle_apps === 'suspend' && state.allow.size === 0) {
      return `<div class="event-name" style="color:var(--warn);font-weight:500;font-size:12px;margin-bottom:8px;">${ICONS.warn} ${t('config.suspendWarn')}</div>`;
    }
    return '';
  }

  function renderList(filter) {
    Promise.all([getPackages(state.includeSystem), getRunningPackages()]).then(([pkgs, running]) => {
      const list = document.createElement('div');
      list.style.maxHeight = '260px';
      list.style.overflowY = 'auto';
      list.style.marginTop = '8px';
      const q = (filter || '').toLowerCase();
      const shown = pkgs.filter((p) => p.toLowerCase().indexOf(q) !== -1);

      if (!shown.length) {
        list.innerHTML = `<div class="log-empty">${t('apps.noResults')}</div>`;
      } else {
        shown.forEach((pkg) => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '8px';
          row.style.padding = '6px 0';
          row.style.borderBottom = '1px solid var(--border)';

          const name = document.createElement('div');
          name.textContent = pkg;
          name.title = running.has(pkg) ? t('apps.runningNow') : '';
          name.style.flex = '1';
          name.style.fontSize = '12px';
          name.style.fontFamily = 'var(--mono)';
          name.style.overflow = 'hidden';
          name.style.textOverflow = 'ellipsis';
          name.style.whiteSpace = 'nowrap';
          if (running.has(pkg)) {
            name.style.display = 'flex';
            name.style.alignItems = 'center';
            name.style.gap = '6px';
            const dot = document.createElement('span');
            dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none;';
            name.prepend(dot);
          }
          row.appendChild(name);

          const group = document.createElement('div');
          group.style.display = 'flex';
          group.style.gap = '4px';

          const isAllow = state.allow.has(pkg);
          const isDeny = state.deny.has(pkg);

          const allowBtn = document.createElement('button');
          allowBtn.className = 'btn' + (isAllow ? ' primary' : ' ghost');
          allowBtn.style.padding = '4px 8px';
          allowBtn.style.fontSize = '11px';
          allowBtn.textContent = t('apps.allow');
          allowBtn.addEventListener('click', () => {
            state.deny.delete(pkg);
            if (isAllow) state.allow.delete(pkg); else state.allow.add(pkg);
            state.dirty = true;
            if (onDirty) onDirty();
            mountAppsPicker(container, fields, onDirty);
          });

          const denyBtn = document.createElement('button');
          denyBtn.className = 'btn' + (isDeny ? ' primary' : ' ghost');
          denyBtn.style.padding = '4px 8px';
          denyBtn.style.fontSize = '11px';
          denyBtn.textContent = t('apps.deny');
          denyBtn.addEventListener('click', () => {
            state.allow.delete(pkg);
            if (isDeny) state.deny.delete(pkg); else state.deny.add(pkg);
            state.dirty = true;
            if (onDirty) onDirty();
            mountAppsPicker(container, fields, onDirty);
          });

          group.appendChild(allowBtn);
          group.appendChild(denyBtn);
          row.appendChild(group);
          list.appendChild(row);
        });
      }

      const existingList = box.querySelector('.ap-list');
      if (existingList) existingList.remove();
      list.className = 'ap-list';
      box.appendChild(list);
    });
  }

  function renderLoaded() {
    box.innerHTML = `<div style="font-size:13px;font-weight:500;margin-bottom:8px;">${t('apps.chooseApps')}</div>
      ${warnBox()}
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <input class="filter" id="ap-search" type="text" placeholder="${t('apps.searchPlaceholder')}" style="flex:1;">
        <label class="switch" style="font-size:12px;"><input type="checkbox" id="ap-system"${state.includeSystem ? ' checked' : ''}> ${t('apps.includeSystem')}</label>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">
        ${t('apps.summary', { allow: state.allow.size, deny: state.deny.size })}
      </div>`;

    box.querySelector('#ap-search').addEventListener('input', (e) => renderList(e.target.value));
    box.querySelector('#ap-system').addEventListener('change', (e) => {
      state.includeSystem = e.target.checked;
      renderList(box.querySelector('#ap-search').value);
    });
    renderList('');
  }

  if (state.loaded) {
    renderLoaded();
    return;
  }

  Promise.all([readAppListFile(allowPath), readAppListFile(denyPath)])
    .then(([allowText, denyText]) => {
      state.allow = parseListFile(allowText);
      state.deny = parseListFile(denyText);
      state.loaded = true;
      renderLoaded();
    })
    .catch((e) => {
      box.querySelector('#ap-status').textContent = t('apps.readError', { msg: e.message });
    });
}

// Called from config.js's saveFile() for every block/v1Fields whose
// picker was touched, alongside the main XtremeBS.conf write.
export async function persistAppsPicker(fields) {
  const state = fields.__apps;
  if (!state || !state.dirty) return;
  const allowPath = fields.allowlist || '/data/local/tmp/XtremeBS/apps.allow';
  const denyPath = fields.denylist || '/data/local/tmp/XtremeBS/apps.deny';
  await writeAppListFile(allowPath, Array.from(state.allow).sort());
  await writeAppListFile(denyPath, Array.from(state.deny).sort());
  state.dirty = false;
}
