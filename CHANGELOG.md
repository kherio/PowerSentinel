### v3.16.1
  - **CRITICAL FIX: `is_event_locked()` was accidentally deleted in v3.13.0.** This has meant that **no event has ever actually applied its settings on any release from v3.13.0 through v3.16.0** - screen_off, adaptive tiers, low power, all of it. Every single "enable" attempt silently failed and returned early. Found during a full-codebase audit. If you're on any version from v3.13.0 to v3.16.0, this update is essential - please update immediately.
  - **CRITICAL FIX: `PowerSentinelconf` (the terminal CLI configurator, documented in the README as a full WebUI alternative) has silently done nothing since v3.10.0** - it read and wrote the old `.conf` file directly, but the daemon has only read `PowerSentinel.json` since then. Every `set`/`add-event`/`rm-event` command reported success while having zero real effect. Rewritten to operate on the actual JSON config. `PowerSentinelctl` had a narrower version of the same issue (only affecting a customized `ctl_file` path) - also fixed.
  - Fixed a persistent "FATAL: could not migrate config to v2" startup loop some users hit after updating: the migration process couldn't tell a genuinely-completed migration apart from a minimal, incomplete one left behind if `jq` ever failed partway through - it now retries automatically on the next start instead of getting permanently stuck, and a new early check gives a specific, actionable message if `jq` itself doesn't work on your device.
  - Removed dead code that never worked (an undefined `magic_remount_rw`/`ro` call present since this project's very first commit) and fixed two long-standing busy-loops that pegged a CPU core at 100% while safe mode was active.

### v3.16.0
  - **v1 compatibility mode removed entirely.** Anyone still on a legacy v1 config (or any config missing event blocks, for any reason) now auto-migrates to v2 automatically on the very next daemon start - no manual edit needed anymore, unlike before. Since every install is now guaranteed to reach v2, the ~180 lines of v1-only code (a completely separate, unmaintained code path that received none of the last ~15 versions of improvements) have been removed.
  - **Fixed a real, long-standing bug** found while doing this: the background process-priority monitor (`handle_proc`) relied on a variable that was never actually set in v2, so it silently never looped for any v2 user - it's been non-functional independent of this release's changes. Now correctly checks the persisted state file instead.
  - No user-facing configuration changes - if you were somehow still on v1, your settings carry over automatically and unattended.

### v3.15.0
  - **Front 5: State Manager.** A new `PowerSentinel-state.sh` persists which events are currently active across daemon restarts and reboots. Previously, a crash (relaunched by the watchdog) or an unclean reboot left the daemon with no memory of what it had previously applied - cores could stay offline, apps stay suspended, or WiFi stay blocked indefinitely with no awareness to undo any of it. Now the daemon reconciles back to a clean baseline on every startup before evaluating current conditions.
  - **New "Historial" tab in the WebUI** (next to Log): shows the full structured Event Journal introduced in v3.14.0 - not just the small fraction of messages that ever reach a real Android notification - with a severity filter and newest-first ordering.
  - No user-facing behavior changes beyond the crash-recovery fix and the new tab.

### v3.14.0
  - **Notification system redesign.** Every event transition and status change used to post a real Android notification - "Config Loaded", "status: Enabled", "Active Events: ...", etc. Only 2 of the 10 messages the daemon ever sent were genuinely critical; the rest were routine status noise interrupting your notification shade for no good reason. Now: a new `PowerSentinel-journal.sh` records everything (a full, structured history for a future WebUI view), but only genuinely critical situations - Safe Mode being active, or a config safety guard rejecting an unsafe setting - actually reach Android's notification tray, via a new `PowerSentinel-alertbridge.sh`.
  - **`PowerSentinel-events.sh` (Event Manager)**: event locking, field resolution, and dispatch extracted out of the daemon into its own file - the first piece of the still-upcoming centralized policy system, pulled forward since it was needed here anyway.
  - Verified: simulated all 10 original notification-triggering messages and confirmed exactly 4 (down from 10) would reach Android's real notification system, while all 10 are still recorded for history. The "Notificaciones" setting still works exactly as before - turning it off suppresses even critical alerts.

### v3.13.0
  - **Front 2 of the architecture pass complete: detect -> policy -> action separation.** `PowerSentinel-detect.sh`, `PowerSentinel-policy.sh`, and `PowerSentinel-actions.sh` now cleanly separate what used to be one large daemon file.
  - **Front 3: Capability Manager.** A new `PowerSentinel-capabilities.sh` probes once at startup what your specific device/ROM actually supports (CPU core control, WiFi control method, doze support, whether Google Mobile Services is even installed, `pm suspend` support), so the daemon skips - with a clear log message - instead of blindly attempting something unsupported every cycle. Notably: GMS handling and doze force-idle used to run unconditionally even on devices/ROMs without Google services or a responsive deviceidle service.
  - Fixed two real bugs found while separating detect/policy/action: manually-specified CPU core selection could restore the wrong governor on disable, or apply powersave to the wrong core on enable. Both only affect manual core selection, not "auto" mode.
  - No user-facing behavior changes beyond the fixes above.

### v3.11.1
  - **URGENT FIX**: event field settings (handle_apps, handle_cores, doze, kill_wifi, etc.) saved through the WebUI since v3.10.0 had no effect on daemon behavior - `handle_event()` was still reading them from the frozen, no-longer-updated `PowerSentinel.conf` instead of the live JSON config. Only global settings (delay, adaptive_mode, etc.) were actually working correctly. Root cause: the v3.10.0 commit's message described this fix, but the actual `PowerSentineld` changes were never included in that commit (a `git add` oversight) - this release genuinely applies them, re-verified against the real files this time. If you saved event-specific settings via the WebUI on v3.10.0 or v3.11.0, please open Config and re-save after updating to make sure they take effect.
  - Also reapplies two related fixes described but not shipped in v3.10.0: safe mode's persisted flag unified to `"true"`/`"false"`, and the daemon's startup sequence correctly builds `PowerSentinel.json` from an existing config on first run after updating.

### v3.11.0
  - **Front 2 of the architecture pass, part 1/3: `PowerSentinel-detect.sh`** - a new file holding every side-effect-free read of device state (battery, temperature, charging, CPU load, screen). Consolidates four independent `dumpsys battery` calls that had accumulated across the daemon into one shared read per poll cycle, so every consumer sees a consistent snapshot instead of four separate ones a few lines apart.
  - Removed dead code left over from an earlier, incomplete refactor attempt (`PowerSentinel-events.sh`, never actually wired into anything) that had started duplicating this same territory and had already begun silently drifting from the real behavior.
  - No user-facing changes - this is internal groundwork. Policy and action separation (parts 2/3 and 3/3) are next.

### v3.10.0
  - **Configuration is now JSON, not a hand-rolled text format** (front 1 of a broader architecture pass - detect/policy/action separation, a capability manager, centralized policy, persistent state, and splitting up monolithic scripts are next). The daemon reads/writes `PowerSentinel.json` via a bundled, statically-linked `jq` instead of the old bespoke `.conf` grammar. Existing installs upgrade automatically and silently the first time this version runs - your current settings are converted once, nothing to do manually.
  - The WebUI's "Texto sin formato" tab is now genuinely a developer mode: it shows and edits the real JSON directly, validated before saving.
  - Eliminated three independent, hand-rolled parsers of the config file that had accumulated over time (inside the daemon's `handle_event()`, and in the WebUI's log-path resolution) - everything now goes through one shared reader.
  - Fixed several real bugs found while doing this: safe mode's persisted flag was inconsistently `"1"`/`"0"` instead of `"true"`/`"false"` like every other setting; saving directly from the raw-text tab never validated JSON first (a typo there could have silently broken every setting); and a cores field left in "Personalizado, nothing picked yet" (a legitimate empty value) used to vanish on any save+reload cycle instead of being preserved.
  - Verified extensively before shipping: the migration logic in isolation, a full daemon bootstrap simulation against both a genuine legacy config and a fresh install, and the frontend's parse/serialize round-trip including unknown-key preservation and invalid-JSON handling.

### v3.9.2
  - **Fixed**: the app allow/restrict picker only ever appeared for whichever event already had "Gestión de apps" set to something other than "No gestionar" when its card was first expanded (in practice, usually just `screen_off`) - changing that dropdown afterward, in any event, never made the picker appear or disappear. Root cause: the picker was mounted once at card-expand time and never re-mounted on subsequent field changes, unlike every other field in the form. Now re-mounts on every field change within the event, so it correctly shows only while "Matar"/"Reducir prioridad"/"Suspender" is selected, in every event, and hides again the moment it's set back to "No gestionar". Verified the full on/off/on sequence (nice → suspend → false → kill) against a non-`screen_off` event.

### v3.9.1
  - **Fixed**: selecting "Automático" or "Personalizado" for "Núcleos en modo ahorro" or "Núcleos a desactivar" would immediately revert to showing "Desactivado". Root cause: picking "Personalizado" with no cores chosen yet stores an empty string, and the mode-detection logic used a `value || 'false'` fallback that treats an empty string as falsy - silently reinterpreting it as "Desactivado" on the very next render. Replaced the native `<select>` for this 3-way choice with tap buttons (matching the existing core-chip style) and fixed the mode detection to handle the empty-string case explicitly instead of relying on JS truthiness. Verified the full click sequence (Desactivado → Automático → Personalizado → pick a core → Desactivado) for both fields against the built bundle.
  - Release asset naming reverted to `PowerSentinel-vX.Y.Z.zip` (lowercase v).

### v3.9.0
  - **Adaptive pressure engine** (opt-in, `adaptive_mode`): replaces the classic fixed events (charging/low_power/screen_off/night/thermal) with a single 0-100 "pressure" score recomputed every poll cycle from battery level, temperature, charging state, screen state, night hours, and CPU load - mapped to one of three escalating tiers (`adaptive_tier1`/`2`/`3`, plain config blocks with the same fields as any other event, so the whole existing Config UI works unchanged). Tier boundaries are user-configurable (`adaptive_tier1_threshold`/`2`/`3`, default 20/45/70). Fully backward compatible: disabled by default, and when off the daemon behaves exactly as before.
  - Verified the scoring formula standalone against 6 scenarios: full battery/charging/screen-on (score 0), low battery/screen-off/night (moderate-high), low battery/hot/screen-off (maximum), low battery *while charging* (relieved sharply), and a same-scenario A/B comparing high vs. low CPU load (confirms the daemon holds back automatically when the device is actively busy, not just when it's idle).
  - Fixed a reactivity gap found while adding the tier-threshold fields: the global settings section didn't re-render on change, so a field's `showIf` (used to hide the tier thresholds unless adaptive mode is on) would never actually apply - now consistent with how event fields already behave.
  - `PowerSentinel-config.sh`'s validation table extended to cover the new keys (boolean/numeric), matching the existing pattern for every other setting.

### v3.8.0
  - **KernelSU-only WebUI**: removed the Magisk `httpd`/CGI compatibility path and all runtime backend detection.
  - Removed `action.sh`, `frontend/src/backend-cgi.js`, `webui/httpd.conf`, and all `webui/cgi-bin/*.cgi` endpoints.
  - The frontend now uses `frontend/src/backend-ksu.js` directly through the native `kernelsu` JavaScript API.
  - Removed the WebUI session-token, loopback HTTP server, `.serve` staging directory, and port 8081 attack surface.
  - Simplified module permissions because no HTTP/CGI files need special handling anymore.
  - Updated security documentation to reflect the single KernelSU transport.
  - Bumped module version to `v3.8.0` / versionCode `380`.

### v3.7.1
  - App picker: allowed/restricted apps are pinned to the top of the list.

### v3.7.0
  - Added a Magisk `httpd`/CGI WebUI compatibility path. This path is intentionally removed in v3.8.0 in favor of a smaller, KernelSU-native attack surface.

### v3.6.0
  - Delete-event confirmation, native night-profile time picker, daemon watchdog, thermal profile, optional charge limiter, manual language selector, diagnostics export, running-app indicators, and automatic global-key parsing.

### v3.5.1
  - Fixed the manager-visible version string so it no longer exposes the internal `-kherio` suffix.

### v3.5.0-kherio
  - Full English/Spanish WebUI translation with automatic locale detection.

### v3.4.x
  - WebUI navigation, battery information, active-event display, persistent chart history, profiles, About screen, pull-to-refresh, and related UI improvements.

### v3.3.x
  - Config UI overhaul, security hardening of app/process handling, improved field grouping, and safer allowlist matching.

### v3.0.0-kherio
  - Introduced the native KernelSU WebUI-X architecture and Vite frontend.
  - Added the hardened `PowerSentinel-writefile` helper and the first security audit of the daemon/configuration paths.

### Earlier releases
  - Event-driven power management, custom events, Doze/WiFi controls, logging, CPU optimization, safe mode, `PowerSentinelctl`, and `PowerSentinelconf` originated in the earlier PowerSentinel/Xtreme-Battery-Saver lineage.
