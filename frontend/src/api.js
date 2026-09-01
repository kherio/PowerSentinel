import { exec } from 'kernelsu';

// Same on-disk layout the daemon (XtremeBSd) and XBSconf already use -
// unchanged from the httpd/CGI era, only the transport changed.
const DATA_DIR = '/data/local/tmp/XtremeBS';
const CONF_FILE = `${DATA_DIR}/XtremeBS.conf`;
const STATUS_FILE = `${DATA_DIR}/XtremeBS.status`;
const DEFAULT_LOG_FILE = `${DATA_DIR}/XtremeBS.log`;

// Resolves the log_file path from the config the same way load_log.cgi
// (and XtremeBSd's own getconf()) did, since it's user-overridable.
const RESOLVE_LOG_PATH =
  `f=$(grep '^log_file=' '${CONF_FILE}' 2>/dev/null | cut -d= -f2); ` +
  `echo "\${f:-${DEFAULT_LOG_FILE}}"`;

class XbsApiError extends Error {}

async function run(command) {
  const { errno, stdout, stderr } = await exec(command);
  if (errno !== 0) {
    throw new XbsApiError((stderr && stderr.trim()) || `Command failed (errno ${errno})`);
  }
  return stdout;
}

export async function readStatus() {
  return run(`cat '${STATUS_FILE}' 2>/dev/null || echo 'Error: Status Unavailable'`);
}

export async function readConfig() {
  return run(`cat '${CONF_FILE}' 2>/dev/null || echo ''`);
}

// Writes go through XBS-writefile instead of a raw shell redirect: it
// only accepts paths under an allowlisted prefix, writes atomically
// (temp file + mv) and keeps a .bak of the previous content. The config
// text itself is never interpolated into the shell command line - it's
// base64-encoded first, so it can't break out of quoting no matter what
// the user typed into the raw-text editor.
export async function writeConfig(text) {
  const b64 = btoa(unescape(encodeURIComponent(text)));
  await run(`echo '${b64}' | XBS-writefile '${CONF_FILE}'`);
  await run('XBSctl reload');
}

export async function readLog() {
  return run(`logf=$(${RESOLVE_LOG_PATH}); cat "$logf" 2>/dev/null || echo ''`);
}

// Copies the live log file to Downloads instead of re-uploading its
// content (as save_log.cgi used to) - simpler and avoids re-encoding a
// potentially large file through the command line.
export async function exportLog() {
  const dest = `/sdcard/Download/XtremeBS-log-${Date.now()}.txt`;
  await run(`logf=$(${RESOLVE_LOG_PATH}); cp "$logf" '${dest}'`);
  return dest;
}

export { XbsApiError };

// ---------- Apps (allowlist/denylist picker) ----------

// Mirrors what enable_pwr_save() itself queries ("-3" = third-party only)
// plus an opt-in for system packages, since some users do want to
// restrict a preinstalled app.
export async function listPackages(includeSystem) {
  const flag = includeSystem ? '' : ' -3';
  const out = await run(`pm list packages${flag} | cut -d: -f2- | sort`);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// allow/deny-list files are plain one-package-per-line text files, at
// whatever path the config currently points to (user-editable, so not
// hardcoded like CONF_FILE/STATUS_FILE).
export async function readAppListFile(path) {
  if (!path) return '';
  return run(`cat '${path}' 2>/dev/null || echo ''`);
}

export async function writeAppListFile(path, lines) {
  const text = lines.join('\n') + (lines.length ? '\n' : '');
  const b64 = btoa(unescape(encodeURIComponent(text)));
  await run(`echo '${b64}' | XBS-writefile '${path}'`);
}

// ---------- Manual event control (the "try it now" button) ----------

export async function startEvent(name) {
  await run(`XBSctl start ${name}`);
}

export async function stopEvent(name) {
  await run(`XBSctl stop ${name}`);
}

// ---------- Saved profiles (whole event-config snapshots) ----------

const PROFILES_DIR = `${DATA_DIR}/profiles`;

// Defense in depth: even though the UI only ever lets the user type
// [a-zA-Z0-9_-] into the profile-name field, every call site here
// re-validates before building a path/command from it, the same
// posture as event names elsewhere in this codebase.
function sanitizeProfileName(name) {
  const clean = (name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) throw new XbsApiError('Invalid profile name');
  return clean;
}

export async function listProfiles() {
  const out = await run(`mkdir -p '${PROFILES_DIR}'; ls -1 '${PROFILES_DIR}' 2>/dev/null | sed 's/\\.conf$//'`);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function readProfile(name) {
  const clean = sanitizeProfileName(name);
  return run(`cat '${PROFILES_DIR}/${clean}.conf' 2>/dev/null || echo ''`);
}

export async function saveProfile(name, content) {
  const clean = sanitizeProfileName(name);
  const b64 = btoa(unescape(encodeURIComponent(content)));
  await run(`mkdir -p '${PROFILES_DIR}'`);
  await run(`echo '${b64}' | XBS-writefile '${PROFILES_DIR}/${clean}.conf'`);
}

export async function deleteProfile(name) {
  const clean = sanitizeProfileName(name);
  await run(`rm -f '${PROFILES_DIR}/${clean}.conf'`);
}

// ---------- Installed module info (for the "Acerca de" screen) ----------

export async function readModuleInfo() {
  return run(`cat "$(find /data/adb -maxdepth 2 -type d -name XtremeBS 2>/dev/null | head -1)/module.prop" 2>/dev/null || echo ''`);
}
