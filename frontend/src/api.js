// PowerSentinel WebUI uses the native KernelSU bridge exclusively.
// The manager WebView provides the `kernelsu` JavaScript API, so there is
// no local HTTP server, CGI transport, browser token, or runtime backend
// detection in the module.
export {
  readStatus, readConfig, writeConfig, readLog, exportLog,
  listPackages, readAppListFile, writeAppListFile,
  startEvent, stopEvent,
  listProfiles, readProfile, saveProfile, deleteProfile,
  readModuleInfo, listRunningPackages
} from './backend-ksu.js';

export { PowerSentinelApiError } from './errors.js';
