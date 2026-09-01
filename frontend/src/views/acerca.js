import { ICONS } from '../icons.js';
import { readModuleInfo } from '../api.js';
import { t } from '../i18n.js';

let loaded = false;

function parseProp(text, key) {
  const m = text.split('\n').find((l) => l.trim().startsWith(key + '='));
  return m ? m.split('=').slice(1).join('=').trim() : '';
}

async function loadVersion() {
  const el = document.getElementById('a-version');
  try {
    const text = await readModuleInfo();
    // module.prop's version field no longer carries a "-kherio" suffix
    // itself (the KernelSU manager reads that field directly on its own
    // module list/install screen, which we don't control - so removing
    // it there, not just here, was the actual fix). This strip is kept
    // as a harmless defensive no-op in case a future release
    // accidentally reintroduces a suffix on that field.
    const version = parseProp(text, 'version').replace(/-kherio$/i, '');
    const versionCode = parseProp(text, 'versionCode');
    el.textContent = version ? `${version} (code ${versionCode || '?'})` : t('acerca.versionUnavailable');
  } catch (e) {
    el.textContent = t('acerca.versionReadError');
  }
}

export function initAcerca() {
  document.querySelector('.about-logo').innerHTML = ICONS.gauge;

  const links = document.querySelectorAll('.about-link');
  const linkMeta = [
    { icon: ICONS.github, label: t('acerca.repoLink') },
    { icon: ICONS.list, label: t('acerca.changelogLink') },
    { icon: ICONS.info, label: t('acerca.issuesLink') }
  ];
  links.forEach((a, i) => {
    a.innerHTML = linkMeta[i].icon + '<span>' + linkMeta[i].label + '</span>';
  });
}

export function activateAcerca() {
  if (!loaded) loaded = true;
  loadVersion();
}

export function deactivateAcerca() {}
