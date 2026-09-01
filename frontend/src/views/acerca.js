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
    // module.prop's raw version string carries a "-kherio" suffix
    // (needed internally so update checkers see a distinct/newer
    // version than upstream), but that suffix has no place in anything
    // the user actually reads - only in developer/repo attribution
    // (the credits below, and the GitHub link).
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
