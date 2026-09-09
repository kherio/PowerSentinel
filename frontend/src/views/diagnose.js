import { readDiagnostics } from '../api.js';
import { t } from '../i18n.js';
import { escapeHtml } from '../helpers.js';

// Every check PowerSentinel-diagnose runs exists because of a real bug
// this project actually hit and fixed (is_device validity, the
// control-file TOCTOU defense, charge_limit_node's scope, a corrupt
// config...) - see the script's own header. This module is purely
// presentational: run it, show each result with a plain pass/warn/fail
// icon and the same short message the script already wrote, nothing
// re-interpreted or summarized here.
function closeDiagnosticsModal() {
  document.getElementById('diagnose-modal-overlay').style.display = 'none';
}

async function runDiagnostics() {
  const list = document.getElementById('diagnose-list');
  const statusEl = document.getElementById('diagnose-status');
  const rerunBtn = document.getElementById('diagnose-rerun');
  list.innerHTML = '';
  statusEl.style.display = 'block';
  statusEl.textContent = t('diagnose.running');
  rerunBtn.disabled = true;
  try {
    const text = await readDiagnostics();
    const results = JSON.parse(text || '[]');
    if (!Array.isArray(results) || !results.length) {
      statusEl.textContent = t('diagnose.error');
      return;
    }
    statusEl.style.display = 'none';
    const ICON_BY_STATUS = { pass: '✅', warn: '⚠️', fail: '❌' };
    list.innerHTML = results.map((r) => {
      const icon = ICON_BY_STATUS[r.status] || 'ℹ️';
      return `<div class="diagnose-row diagnose-${escapeHtml(r.status)}">` +
        `<span class="diagnose-icon">${icon}</span>` +
        `<span class="diagnose-message">${escapeHtml(r.message)}</span></div>`;
    }).join('');
  } catch (e) {
    statusEl.style.display = 'block';
    statusEl.textContent = t('diagnose.error');
  } finally {
    rerunBtn.disabled = false;
  }
}

export function openDiagnosticsModal() {
  document.getElementById('diagnose-modal-overlay').style.display = 'flex';
  runDiagnostics();
}

export function initDiagnose() {
  document.getElementById('diagnose-close').addEventListener('click', closeDiagnosticsModal);
  document.getElementById('diagnose-rerun').addEventListener('click', runDiagnostics);
  document.getElementById('diagnose-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'diagnose-modal-overlay') closeDiagnosticsModal();
  });
}
