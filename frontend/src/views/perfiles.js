import { ICONS } from '../icons.js';
import { listProfiles, readProfile, saveProfile, deleteProfile, readConfig, writeConfig } from '../api.js';
import { toast } from '../helpers.js';

let loaded = false;

async function renderList() {
  const list = document.getElementById('p-list');
  try {
    const names = await listProfiles();
    if (!names.length) {
      list.innerHTML = '<div class="log-empty">Todavía no has guardado ningún perfil.</div>';
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
      loadBtn.title = 'Cargar este perfil (sustituye la configuración actual)';
      loadBtn.addEventListener('click', async () => {
        const ok = window.confirm(`Cargar el perfil "${name}" sustituirá tu configuración actual (se recargará el demonio). ¿Continuar?`);
        if (!ok) return;
        try {
          const content = await readProfile(name);
          await writeConfig(content);
          toast(`Perfil "${name}" cargado`, 'success');
        } catch (e) {
          toast('Error al cargar el perfil: ' + e.message, 'error');
        }
      });
      row.appendChild(loadBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn ghost';
      delBtn.innerHTML = ICONS.trash;
      delBtn.title = 'Eliminar perfil';
      delBtn.addEventListener('click', async () => {
        const ok = window.confirm(`¿Eliminar el perfil "${name}"? Esta acción no se puede deshacer.`);
        if (!ok) return;
        try {
          await deleteProfile(name);
          toast(`Perfil "${name}" eliminado`, 'success');
          renderList();
        } catch (e) {
          toast('Error al eliminar: ' + e.message, 'error');
        }
      });
      row.appendChild(delBtn);

      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = '<div class="log-empty">No se pudieron cargar los perfiles.</div>';
  }
}

export function initPerfiles() {
  document.getElementById('p-refresh-btn').innerHTML = ICONS.reload;
  document.getElementById('p-refresh-btn').title = 'Actualizar lista';
  document.getElementById('p-refresh-btn').addEventListener('click', renderList);

  document.getElementById('p-save-btn').addEventListener('click', async () => {
    const input = document.getElementById('p-name-input');
    const name = input.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) { toast('Escribe un nombre de perfil válido', 'error'); return; }
    try {
      const content = await readConfig();
      await saveProfile(name, content);
      input.value = '';
      toast(`Perfil "${name}" guardado`, 'success');
      renderList();
    } catch (e) {
      toast('Error al guardar el perfil: ' + e.message, 'error');
    }
  });
}

export function activatePerfiles() {
  if (!loaded) { loaded = true; renderList(); }
  else renderList();
}

export function deactivatePerfiles() {}
