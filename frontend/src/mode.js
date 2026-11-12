// Preferencia global Sencillo/Avanzado. Misma clave que ya usaba la
// pestaña Automatización, así quien ya eligió Avanzado lo sigue viendo.
// Los bloques marcados .adv-only se ocultan por CSS salvo body.advanced.
export const ADVANCED_MODE_KEY = 'powersentinel-advanced-mode';
export const MODE_CHOSEN_KEY = 'powersentinel-mode-chosen';

export function isAdvancedMode() {
  try { return localStorage.getItem(ADVANCED_MODE_KEY) === 'true'; } catch (e) { return false; }
}

export function applyGlobalMode() {
  document.body.classList.toggle('advanced', isAdvancedMode());
  const toggle = document.getElementById('more-advanced-toggle');
  if (toggle) toggle.checked = isAdvancedMode();
}

export function setAdvancedMode(advanced) {
  try {
    localStorage.setItem(ADVANCED_MODE_KEY, advanced ? 'true' : 'false');
    localStorage.setItem(MODE_CHOSEN_KEY, 'true');
  } catch (e) {}
  applyGlobalMode();
  document.dispatchEvent(new document.defaultView.CustomEvent('powersentinel:modechange'));
}
