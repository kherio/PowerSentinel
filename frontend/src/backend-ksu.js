import { exec } from 'kernelsu';
import { PowerSentinelApiError } from './errors.js';

// Native KernelSU WebUI transport. The page is expected to run inside a
// KernelSU/WebUI-X-capable manager WebView, where `exec()` is provided by
// the `kernelsu` JavaScript API and executes commands with root privileges.
const DATA_DIR = '/data/local/tmp/PowerSentinel';
const CONF_FILE = `${DATA_DIR}/PowerSentinel.json`;
const STATUS_FILE = `${DATA_DIR}/PowerSentinel.status`;
const DEFAULT_LOG_FILE = `${DATA_DIR}/PowerSentinel.log`;
const JOURNAL_FILE = `${DATA_DIR}/PowerSentinel.journal`;

// Reads log_file the same way the daemon itself does now (jq against
// the JSON config) rather than grepping the old .conf text - that grep
// was a fourth independent parser of the config file, on top of the
// daemon's own (PowerSentinel-config.sh), this frontend's
// (config-form.js), and the one that used to live inline in
// handle_event() before it was centralized too.
const RESOLVE_LOG_PATH =
  `f=$(jq -r '.global.log_file // empty' '${CONF_FILE}' 2>/dev/null); ` +
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

// Journal is JSON Lines (one JSON object per line: ts/event/severity/
// message) written by PowerSentinel-journal.sh - returned as raw text,
// same convention as readLog(); the caller parses each line.
export async function readJournal() {
  return run(`cat '${JOURNAL_FILE}' 2>/dev/null || echo ''`);
}

// ---------- Safe mode ----------
// Current state is read from the already-loaded config (model.safemode
// === 'true'), not a separate call - these two only ever WRITE.

export async function enterSafeMode() {
  await run('PowerSentinelctl safe');
}

export async function exitSafeMode() {
  await run('PowerSentinelctl resume');
}

// ---------- Flagged apps (appwatch) + per-app policy ----------
// Direct jq manipulation of their own small JSON files, the same
// pattern config/state/journal already use daemon-side - not by
// shelling out to PowerSentinelconf, which is a separate, standalone
// terminal tool for the same data, not something the WebUI depends on
// being present in a particular way.
//
// Package names here can end up interpolated into a shell command, so
// unlike startEvent/stopEvent above (which trust the caller since an
// event name only ever comes from this project's own fixed list),
// validate first - a flagged/installed package name should always be
// a plain dotted identifier, and rejecting anything else here costs
// nothing.
const FLAGGED_FILE = `${DATA_DIR}/PowerSentinel.flagged`;
const APP_POLICY_FILE = `${DATA_DIR}/PowerSentinel.apppolicy`;

function assertPackageName(pkg) {
  if (!/^[a-zA-Z0-9_.]+$/.test(pkg)) {
    throw new PowerSentinelApiError(`Invalid package name: ${pkg}`);
  }
}

export async function readFlaggedApps() {
  return run(`cat '${FLAGGED_FILE}' 2>/dev/null || echo '[]'`);
}

export async function dismissFlaggedApp(pkg) {
  assertPackageName(pkg);
  const cmd =
    `[ -s '${FLAGGED_FILE}' ] || echo '[]' > '${FLAGGED_FILE}'; ` +
    `tmp=$(mktemp '${DATA_DIR}/.PowerSentinel.flagged.XXXXXX'); ` +
    `jq --arg p '${pkg}' 'map(select(. != $p))' '${FLAGGED_FILE}' > "$tmp" ` +
    `&& chmod 600 "$tmp" && mv "$tmp" '${FLAGGED_FILE}'`;
  await run(cmd);
}

export async function setAppPolicy(pkg, level) {
  assertPackageName(pkg);
  if (![0, 1, 2, 3].includes(level)) {
    throw new PowerSentinelApiError(`Invalid app policy level: ${level}`);
  }
  const cmd =
    `[ -s '${APP_POLICY_FILE}' ] || echo '{}' > '${APP_POLICY_FILE}'; ` +
    `tmp=$(mktemp '${DATA_DIR}/.PowerSentinel.apppolicy.XXXXXX'); ` +
    `jq --arg a '${pkg}' --argjson l ${level} '.[$a] = $l' '${APP_POLICY_FILE}' > "$tmp" ` +
    `&& chmod 600 "$tmp" && mv "$tmp" '${APP_POLICY_FILE}'`;
  await run(cmd);
}

// One-shot, on-demand CPU consumption ranking (PowerSentinel-cpurank) -
// deliberately never called automatically by any poll/refresh loop in
// this WebUI. Takes ~2+ seconds (it samples twice, a couple of seconds
// apart) and involves real overhead (reading every installed third-
// party app's /proc/[pid]/stat), so it only runs when a person
// explicitly asks to see it.
export async function readCpuRanking() {
  return run(`PowerSentinel-cpurank 2 2>/dev/null || echo '[]'`);
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
