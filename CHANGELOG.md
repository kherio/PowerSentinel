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
