import { ICONS } from '../icons.js';
import { listProfiles, readProfile, saveProfile, deleteProfile, readConfig, writeConfig } from '../api.js';
import { toast } from '../helpers.js';
import { t } from '../i18n.js';

let loaded = false;

async function renderList() {
  const list = document.getElementById('p-list');
  try {
    const names = await listProfiles();
    if (!names.length) {
      list.innerHTML = `<div class="log-empty">${t('perfiles.noneYet')}</div>`;
      return;
    }
    list.innerHTML = '';
    names.sort().forEach((name) => {
      const row = document.createElement('div');
      row.className = 'profile-item';

      const nameEl = document.createElement('div');
      nameEl.className = 'profile-name';
      nameEl.textContent = name;
      row.appendChild(nameEl);

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn ghost';
      loadBtn.innerHTML = ICONS.upload;
      loadBtn.title = t('perfiles.loadTitle');
      loadBtn.addEventListener('click', async () => {
        const ok = window.confirm(t('perfiles.loadConfirm', { name }));
        if (!ok) return;
        try {
          const content = await readProfile(name);
          await writeConfig(content);
          toast(t('perfiles.loaded', { name }), 'success');
        } catch (e) {
          toast(t('perfiles.loadError', { msg: e.message }), 'error');
        }
      });
      row.appendChild(loadBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn ghost';
      delBtn.innerHTML = ICONS.trash;
      delBtn.title = t('common.delete');
      delBtn.addEventListener('click', async () => {
        const ok = window.confirm(t('perfiles.deleteConfirm', { name }));
        if (!ok) return;
        try {
          await deleteProfile(name);
          toast(t('perfiles.deleted', { name }), 'success');
          renderList();
        } catch (e) {
          toast(t('perfiles.deleteError', { msg: e.message }), 'error');
        }
      });
      row.appendChild(delBtn);

      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = `<div class="log-empty">${t('perfiles.listError')}</div>`;
  }
}

export function initPerfiles() {
  document.getElementById('p-refresh-btn').innerHTML = ICONS.reload;
  document.getElementById('p-refresh-btn').title = t('perfiles.refresh');
  document.getElementById('p-refresh-btn').addEventListener('click', renderList);

  document.getElementById('p-save-btn').addEventListener('click', async () => {
    const input = document.getElementById('p-name-input');
    const name = input.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) { toast(t('perfiles.invalidName'), 'error'); return; }
    try {
      const content = await readConfig();
      await saveProfile(name, content);
      input.value = '';
      toast(t('perfiles.savedToast', { name }), 'success');
      renderList();
    } catch (e) {
      toast(t('perfiles.saveError', { msg: e.message }), 'error');
    }
  });
}

export function activatePerfiles() {
  if (!loaded) { loaded = true; renderList(); }
  else renderList();
}

export function deactivatePerfiles() {}
