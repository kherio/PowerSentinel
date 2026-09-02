import { exec } from 'kernelsu';
import { PowerSentinelApiError } from './errors.js';

// Native KernelSU WebUI transport. The page is expected to run inside a
// KernelSU/WebUI-X-capable manager WebView, where `exec()` is provided by
// the `kernelsu` JavaScript API and executes commands with root privileges.
const DATA_DIR = '/data/local/tmp/PowerSentinel';
const CONF_FILE = `${DATA_DIR}/PowerSentinel.conf`;
const STATUS_FILE = `${DATA_DIR}/PowerSentinel.status`;
const DEFAULT_LOG_FILE = `${DATA_DIR}/PowerSentinel.log`;

const RESOLVE_LOG_PATH =
  `f=$(grep '^log_file=' '${CONF_FILE}' 2>/dev/null | cut -d= -f2); ` +
  `echo "\${f:-${DEFAULT_LOG_FILE}}"`;

async function run(command) {
  const { errno, stdout, stderr } = await exec(command);
  if (errno !== 0) {
    throw new PowerSentinelApiError((stderr && stderr.trim()) || `Command failed (errno ${errno})`);
  }
  return stdout;
}

export async function readStatus() {
  return run(`cat '${STATUS_FILE}' 2>/dev/null || echo 'Error: Status Unavailable'`);
}

export async function readConfig() {
  return run(`cat '${CONF_FILE}' 2>/dev/null || echo ''`);
}

export async function writeConfig(text) {
  const b64 = btoa(unescape(encodeURIComponent(text)));
  await run(`echo '${b64}' | PowerSentinel-writefile '${CONF_FILE}'`);
  await run('PowerSentinelctl reload');
}

export async function readLog() {
  return run(`logf=$(${RESOLVE_LOG_PATH}); cat "$logf" 2>/dev/null || echo ''`);
}

export async function exportLog() {
  const dest = `/sdcard/Download/PowerSentinel-log-${Date.now()}.txt`;
  await run(`logf=$(${RESOLVE_LOG_PATH}); cp "$logf" '${dest}'`);
  return dest;
}

// ---------- Apps (allowlist/denylist picker) ----------

export async function listPackages(includeSystem) {
  const flag = includeSystem ? '' : ' -3';
  const out = await run(`pm list packages${flag} | cut -d: -f2- | sort`);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function readAppListFile(path) {
  if (!path) return '';
  return run(`cat '${path}' 2>/dev/null || echo ''`);
}

export async function writeAppListFile(path, lines) {
  const text = lines.join('\n') + (lines.length ? '\n' : '');
  const b64 = btoa(unescape(encodeURIComponent(text)));
  await run(`echo '${b64}' | PowerSentinel-writefile '${path}'`);
}

// ---------- Manual event control ----------

export async function startEvent(name) {
  await run(`PowerSentinelctl start ${name}`);
}

export async function stopEvent(name) {
  await run(`PowerSentinelctl stop ${name}`);
}

// ---------- Saved profiles ----------

const PROFILES_DIR = `${DATA_DIR}/profiles`;

function sanitizeProfileName(name) {
  const clean = (name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) throw new PowerSentinelApiError('Invalid profile name');
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
  await run(`echo '${b64}' | PowerSentinel-writefile '${PROFILES_DIR}/${clean}.conf'`);
}

export async function deleteProfile(name) {
  const clean = sanitizeProfileName(name);
  await run(`rm -f '${PROFILES_DIR}/${clean}.conf'`);
}

// ---------- Installed module info ----------

export async function readModuleInfo() {
  return run(`cat "$(find /data/adb -maxdepth 2 -type d -name PowerSentinel 2>/dev/null | head -1)/module.prop" 2>/dev/null || echo ''`);
}

// ---------- Currently-running packages ----------

export async function listRunningPackages() {
  const out = await run(`ps -A -o NAME 2>/dev/null | tail -n +2`);
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}
