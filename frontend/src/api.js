// PowerSentinel WebUI uses the native KernelSU bridge exclusively.
// The manager WebView provides the `kernelsu` JavaScript API, so there is
// no local HTTP server, CGI transport, browser token, or runtime backend
// detection in the module.
export {
  readStatus, readConfig, writeConfig, readLog, exportLog, readJournal, readEnergyLog,
  listPackages, readAppListFile, writeAppListFile,
  startEvent, stopEvent, startManualTimed,
  listProfiles, readProfile, saveProfile, deleteProfile, exportProfile,
  readModuleInfo, listRunningPackages,
  enterSafeMode, exitSafeMode, restartDaemon,
  readFlaggedApps, dismissFlaggedApp, setAppPolicy, readCpuRanking, readSuggestedNightWindow, readDiagnostics, readDrainComparison,
  readAppPolicies, readUsageBuckets
} from './backend-ksu.js';

export { PowerSentinelApiError } from './errors.js';
