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
