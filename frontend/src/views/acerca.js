import { ICONS } from '../icons.js';
import { readModuleInfo, readStatus, readLog } from '../api.js';
import { t, getLocaleOverride, setLocaleOverride } from '../i18n.js';
import { toast } from '../helpers.js';

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
    return { version, versionCode };
  } catch (e) {
    el.textContent = t('acerca.versionReadError');
    return null;
  }
}

function initLanguageSelector() {
  const select = document.getElementById('a-language-select');
  select.value = getLocaleOverride() || 'auto';
  select.addEventListener('change', () => {
    // LOCALE is resolved once at module load across every file, so a
    // change only takes effect after reloading the page - simplest and
    // most reliable way to apply it everywhere at once, rather than
    // trying to re-render every already-mounted view live.
    setLocaleOverride(select.value === 'auto' ? null : select.value);
    location.reload();
  });
}

// Bundles version + current status + the tail of the log into one text
// block, for reporting a bug without having to jump between tabs
// copying things by hand.
async function copyDiagnostics() {
  const output = document.getElementById('a-diagnostics-output');
  try {
    const [moduleText, status, log] = await Promise.all([
      readModuleInfo().catch(() => ''),
      readStatus().catch((e) => 'Error: ' + e.message),
      readLog().catch(() => '')
    ]);
    const version = parseProp(moduleText, 'version').replace(/-kherio$/i, '');
    const versionCode = parseProp(moduleText, 'versionCode');
    const logTail = log.split('\n').filter(Boolean).slice(-40).join('\n');

    const report = [
      `PowerSentinel ${version} (code ${versionCode})`,
      `--- Status ---`,
      status.trim(),
      `--- Log (last 40 lines) ---`,
      logTail || '(empty)'
    ].join('\n');

    output.value = report;
    output.style.display = 'block';

    try {
      await navigator.clipboard.writeText(report);
      toast(t('acerca.diagnosticsCopied'), 'success');
    } catch (clipErr) {
      // Some WebViews restrict the Clipboard API even in a trusted
      // context. Fall back to showing the text selected/visible so the
      // user can copy it manually instead of silently failing.
      output.focus();
      output.select();
      toast(t('acerca.diagnosticsCopyFailed'), 'error');
    }
  } catch (e) {
    toast(t('acerca.diagnosticsError', { msg: e.message }), 'error');
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

  initLanguageSelector();

  document.getElementById('a-diagnostics-btn').innerHTML = ICONS.download + ' ' + t('acerca.copyDiagnostics');
  document.getElementById('a-diagnostics-btn').addEventListener('click', copyDiagnostics);
}

export function activateAcerca() {
  if (!loaded) loaded = true;
  loadVersion();
}

export function deactivateAcerca() {}
