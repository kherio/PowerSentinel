import { PowerSentinelApiError } from './errors.js';

// Talks to the httpd/CGI backend (webui/cgi-bin/*.cgi) that action.sh
// starts, used when the page isn't running inside a WebUI-X-capable
// manager's WebView (i.e. Magisk, which has no native webroot support).
// Every exported function here mirrors backend-ksu.js's signature and
// behavior exactly, so api.js can pick either one transparently.

// action.sh opens this page with ?token=... in the URL - every request
// back to the CGI scripts must carry the same token (see
// webui/cgi-bin/cgi-common.sh's require_token()), since httpd is
// reachable by any app on the device, not just this page.
const TOKEN = new URLSearchParams(location.search).get('token') || '';

function withToken(path) {
  const sep = path.indexOf('?') === -1 ? '?' : '&';
  return `${path}${sep}token=${encodeURIComponent(TOKEN)}`;
}

async function cgiGet(path) {
  const res = await fetch(withToken(path));
  const text = await res.text();
  if (!res.ok || text.startsWith('Error:')) {
    throw new PowerSentinelApiError(text.replace(/^Error:\s*/, '') || `Request failed (${res.status})`);
  }
  return text;
}

async function cgiPost(path, body) {
  const res = await fetch(withToken(path), { method: 'POST', body: body || '' });
  const text = await res.text();
  if (!res.ok || text.startsWith('Error:')) {
    throw new PowerSentinelApiError(text.replace(/^Error:\s*/, '') || `Request failed (${res.status})`);
  }
  return text;
}

// Used by api.js to decide, once at startup, whether this backend is
// usable - if there's no token in the URL at all, this page definitely
// wasn't opened by action.sh, so don't even try.
export async function __probe() {
  if (!TOKEN) throw new Error('no session token in URL');
  await cgiGet('/cgi-bin/status.cgi');
}

export async function readStatus() {
  return cgiGet('/cgi-bin/status.cgi');
}

export async function readConfig() {
  return cgiGet('/cgi-bin/load.cgi');
}

export async function writeConfig(text) {
  const b64 = btoa(unescape(encodeURIComponent(text)));
  await cgiPost('/cgi-bin/save.cgi', b64);
}

export async function readLog() {
  return cgiGet('/cgi-bin/load_log.cgi');
}

export async function exportLog() {
  return (await cgiPost('/cgi-bin/export_log.cgi')).trim();
}


// ---------- Apps (allowlist/denylist picker) ----------

export async function listPackages(includeSystem) {
  const out = await cgiGet(`/cgi-bin/apps_list.cgi?system=${includeSystem ? '1' : '0'}`);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function readAppListFile(path) {
  if (!path) return '';
  return cgiGet(`/cgi-bin/applist_read.cgi?path=${encodeURIComponent(path)}`);
}

export async function writeAppListFile(path, lines) {
  const text = lines.join('\n') + (lines.length ? '\n' : '');
  const b64 = btoa(unescape(encodeURIComponent(text)));
  await cgiPost(`/cgi-bin/applist_write.cgi?path=${encodeURIComponent(path)}`, b64);
}

// ---------- Manual event control (the "try it now" button) ----------

export async function startEvent(name) {
  await cgiGet(`/cgi-bin/event.cgi?action=start&name=${encodeURIComponent(name)}`);
}

export async function stopEvent(name) {
  await cgiGet(`/cgi-bin/event.cgi?action=stop&name=${encodeURIComponent(name)}`);
}

// ---------- Saved profiles (whole event-config snapshots) ----------

function sanitizeProfileName(name) {
  const clean = (name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) throw new PowerSentinelApiError('Invalid profile name');
  return clean;
}

export async function listProfiles() {
  const out = await cgiGet('/cgi-bin/profiles_list.cgi');
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function readProfile(name) {
  const clean = sanitizeProfileName(name);
  return cgiGet(`/cgi-bin/profile_read.cgi?name=${encodeURIComponent(clean)}`);
}

export async function saveProfile(name, content) {
  const clean = sanitizeProfileName(name);
  const b64 = btoa(unescape(encodeURIComponent(content)));
  await cgiPost(`/cgi-bin/profile_save.cgi?name=${encodeURIComponent(clean)}`, b64);
}

export async function deleteProfile(name) {
  const clean = sanitizeProfileName(name);
  await cgiGet(`/cgi-bin/profile_delete.cgi?name=${encodeURIComponent(clean)}`);
}

// ---------- Installed module info (for the "Acerca de" screen) ----------

export async function readModuleInfo() {
  return cgiGet('/cgi-bin/module_info.cgi');
}

// ---------- Currently-running packages (apps picker "running now" hint) ----------

export async function listRunningPackages() {
  const out = await cgiGet('/cgi-bin/running.cgi');
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}
