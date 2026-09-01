// Picks, once at startup, which backend actually works in this
// environment - the native KernelSU exec() bridge (WebUI-X-capable
// managers: KernelSU Next, etc.) or the httpd/CGI fallback that
// action.sh starts (Magisk, which has no native webroot support). Every
// other module in the app imports from here and never needs to know
// which one is actually in use - both backends export the exact same
// function set with the exact same behavior.
const FUNCTIONS = [
  'readStatus', 'readConfig', 'writeConfig', 'readLog', 'exportLog',
  'listPackages', 'readAppListFile', 'writeAppListFile',
  'startEvent', 'stopEvent',
  'listProfiles', 'readProfile', 'saveProfile', 'deleteProfile',
  'readModuleInfo', 'listRunningPackages'
];

let backendPromise = null;

async function detectBackend() {
  // Try the native bridge first (it's the richer, more secure transport
  // - no network socket involved at all) with a short timeout, since a
  // WebView with no bridge injected can otherwise hang rather than
  // reject immediately.
  const ksu = await import('./backend-ksu.js');
  try {
    await Promise.race([
      ksu.__probe(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 800))
    ]);
    return ksu;
  } catch (e) {
    const cgi = await import('./backend-cgi.js');
    await cgi.__probe(); // let this one throw for real if neither works - nothing left to fall back to
    return cgi;
  }
}

function getBackend() {
  if (!backendPromise) backendPromise = detectBackend();
  return backendPromise;
}

// A thin wrapper per function, rather than re-exporting the resolved
// module directly, since the backend isn't known synchronously at
// import time (every caller already awaits these, so the extra await
// here to resolve the backend first is free).
const api = {};
FUNCTIONS.forEach((name) => {
  api[name] = async (...args) => (await getBackend())[name](...args);
});

export const {
  readStatus, readConfig, writeConfig, readLog, exportLog,
  listPackages, readAppListFile, writeAppListFile,
  startEvent, stopEvent,
  listProfiles, readProfile, saveProfile, deleteProfile,
  readModuleInfo, listRunningPackages
} = api;

// Both backends throw this same error class for request failures, so
// callers can keep doing `catch (e) { toast(e.message) }` without
// caring which backend actually ran.
export { PowerSentinelApiError } from './errors.js';
