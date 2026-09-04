import { ICONS } from '../icons.js';
import { readModuleInfo, readStatus, readLog } from '../api.js';
import { t, getLocaleOverride, setLocaleOverride } from '../i18n.js';
import { toast, escapeHtml } from '../helpers.js';

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

// Reads the same status file the raw diagnostics text already
// includes, but formats manufacturer/model/capabilities as a plain,
// readable list instead of a copyable technical blob - "detección
// automática de hardware" so a person can actually see what their
// specific device supports without needing to interpret raw daemon
// output. The underlying data (Manufacturer/Model/Capabilities lines)
// comes straight from getprop and the already-existing Capability
// Manager (PowerSentinel-capabilities.sh) - nothing new is detected
// here, this is purely a friendlier presentation of data the daemon
// already computes at startup.
async function renderHardwareInfo() {
  const el = document.getElementById('a-hardware-info');
  const capLabels = {
    cores_online: t('acerca.capCoresOnline'),
    cores_governor: t('acerca.capCoresGovernor'),
    rfkill_wifi: t('acerca.capRfkillWifi'),
    svc_wifi: t('acerca.capSvcWifi'),
    doze_force: t('acerca.capDoze'),
    gms_installed: t('acerca.capGms'),
    pm_suspend: t('acerca.capSuspend')
  };
  try {
    const status = await readStatus();
    const manufacturer = (/^manufacturer:\s*(.*)$/im.exec(status) || [])[1] || '';
    const model = (/^model:\s*(.*)$/im.exec(status) || [])[1] || '';
    const capsLine = (/^capabilities:\s*(.*)$/im.exec(status) || [])[1] || '';
    const caps = {};
    capsLine.trim().split(/\s+/).forEach((pair) => {
      const eq = pair.indexOf('=');
      if (eq > 0) caps[pair.slice(0, eq)] = pair.slice(eq + 1) === 'true';
    });

    let html = `<div class="hw-device">${escapeHtml((manufacturer + ' ' + model).trim() || '?')}</div>`;
    html += '<ul class="hw-cap-list">';
    Object.keys(capLabels).forEach((key) => {
      const supported = !!caps[key];
      html += `<li class="${supported ? 'hw-cap-yes' : 'hw-cap-no'}">${supported ? '✓' : '✕'} ${escapeHtml(capLabels[key])}</li>`;
    });
    html += '</ul>';
    el.innerHTML = html;
  } catch (e) {
    el.textContent = t('acerca.hardwareError');
  }
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
    { icon: ICONS.info, label: t('acerca.issuesLink') },
    { icon: ICONS.telegram, label: t('acerca.telegramLink') }
  ];
  links.forEach((a, i) => {
    a.innerHTML = linkMeta[i].icon + '<span>' + linkMeta[i].label + '</span>';
  });

  initLanguageSelector();

  document.getElementById('a-diagnostics-btn').innerHTML = ICONS.download + ' ' + t('acerca.copyDiagnostics');
  document.getElementById('a-diagnostics-btn').addEventListener('click', copyDiagnostics);

  // "Ajustes avanzados" no duplica el editor real - lo señala y lleva
  // directamente a él (Automatización, en modo Avanzado), en vez de
  // reconstruir un segundo editor del mismo modelo compartido en una
  // pestaña distinta, lo que introduciría un riesgo real de estado
  // desincronizado entre dos ediciones simultáneas de la misma config.
  document.getElementById('aj-open-advanced-btn').textContent = t('ajustes.openAdvanced');
  document.getElementById('aj-open-advanced-btn').addEventListener('click', () => {
    try {
      localStorage.setItem('powersentinel-advanced-mode', 'true');
      localStorage.setItem('powersentinel-mode-chosen', 'true');
    } catch (e) { /* localStorage puede no estar disponible; la navegación sigue funcionando igual */ }
    document.dispatchEvent(new CustomEvent('powersentinel:navigate', { detail: { view: 'conf' } }));
  });
  renderHardwareInfo();
}

export function activateAcerca() {
  if (!loaded) loaded = true;
  loadVersion();
}

export function deactivateAcerca() {}
