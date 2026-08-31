
### v3.2.2-kherio
  - **Carousel width fix, attempt 2**: v3.2.1's fix (adding `display:flex` to the view container) addressed the height chain but the reported width overflow persisted. Root cause was different from initially diagnosed: the carousel used percentage-based flex sizing (`.view-track` at `width:300%`, each `.view` at `flex-basis:33.3333%`), which is sensitive to how a given engine resolves flex-basis/min-width against a pane's own content - evidently not clipping as expected on-device. Rewrote it to use fixed pixel widths instead: `main.js` measures the real rendered viewport width and sets it as an explicit inline `width` (in px, not %) on the track and each pane, recalculated on resize/orientation change. This removes percentage-based flex sizing from the carousel entirely - flex is only used for row arrangement now, not for sizing math.
  - Added defensive `min-width: 0` and `overflow-x: hidden` at a few more points in the layout chain (`.view-viewport`, `.view`, `html`) as extra safety margin.
  - Could not be verified with an actual rendered browser in the development environment (no headless browser available to install) - needs on-device confirmation again.

### v3.2.1-kherio
  - **Critical fix**: v3.2.0's carousel broke the whole layout on-device (all three tabs wider than the screen, Config cut off/incomplete). Root cause: `.app-shell > main` was missing `display: flex; flex-direction: column;`, so `.view-viewport`'s `flex: 1` was inert (flex properties only apply inside a flex container) - it never received a resolved height, which broke the entire `height: 100%` chain down through `.view-track` and each `.view` pane, and let the 300%-wide track overflow the viewport horizontally instead of being clipped to one pane's width. One-line fix; the rest of v3.2.0 is unchanged.

### v3.2.0-kherio
  - Config tab, usability improvements:
    - **App picker**: search/select installed apps visually for the allowlist/denylist instead of hand-editing text files (new `listPackages`/`readAppListFile`/`writeAppListFile` in the WebUI's `exec()`-based API).
    - **Visual core selector**: confirmed/polished - `handle_cores`/`disable_cores` already show tappable per-core chips (reusing live core data from Estado) instead of a free-text field whenever the daemon's core list is available.
    - **Quick-start templates**: "Equilibrado" / "Ahorro agresivo" presets fill in a sensible set of fields for any event in one tap.
    - **Contextual help**: every field in the form now has an explanatory line (previously only some did).
    - **Inline safety warning**: if "Suspender" is selected with no apps in the allowlist, the form now shows the same warning the daemon would otherwise apply silently (it disables suspend and notifies).
    - **v1 removed from the form entirely** (not just hidden): the legacy v1/v2 toggle and v1 field editor are gone. A legacy v1 config's lines are preserved verbatim (not lost) if one is ever loaded, but are no longer form-editable - only the raw-text editor can touch them. New/reset configs are always v2.
    - **Duplicate event**: clone an existing event's settings into a new custom event instead of starting from blank fields.
    - **Try it now**: per-event "Aplicar ahora" / "Detener" buttons call `XBSctl start|stop <event>` directly, to see an event's effect immediately instead of waiting for its real trigger condition.
    - **Night profile**: new independent, time-of-day-based event (`night_start`/`night_end`, HH:MM, wraps past midnight) that the daemon activates/deactivates purely on wall-clock time - in parallel with, not instead of, the other events (screen/charging/battery). Requires a reload after changing its hours.
    - **Restore recommended defaults**: a button that replaces the in-memory form with a sensible starting config (boot/charging/screen_off/low_power/night, balanced/aggressive presets) - nothing is written to disk until Guardar is pressed.
  - **Swipe navigation reworked into a real sliding carousel**: the track now follows the finger 1:1 during the drag (with edge rubber-banding) instead of jumping instantly on release, and tab-bar taps animate the same way.
  - **Fixed a real bug**: the "unsaved changes" prompt could fire when leaving Config with zero actual edits, because it compared the raw loaded file text against the form's freshly re-serialized text - any formatting difference (key order, spacing) between the two showed up as a false "unsaved change". Dirtiness is now tracked as an explicit flag set only by genuine edits (a field change, an apps-picker toggle, or typing in the raw editor), not by diffing text.
  - Fixed a v3.0.0 regression: several Config-tab styles (event cards, subtabs) and the raw-text editor's element IDs were left behind in the old per-page stylesheets when `webui/` was removed, and never carried over into the new shared `style.css` - the editor highlighting and event card styling silently didn't apply. All restored and verified against the built `webroot/`.

### v3.0.0-kherio
  - **Breaking change**: replaced the local httpd/CGI web interface (`webui/`, `action.sh`) with a native KernelSU WebUI-X `webroot/`, built from a new Vite frontend (`frontend/`). No local server is started anymore; the manager's WebView loads `webroot/` directly and talks to the system through `kernelsu`'s `exec()`.
  - Added `XBS-writefile`: a hardened helper for writes coming from the webui - base64-encoded content over stdin (never interpolated into a shell command), path allowlisted to XtremeBS's own data dir, atomic write (temp file + `mv`), automatic `.bak` of the previous content.
  - Security audit of the existing scripts (see `docs/security-audit.md`): found and fixed a real command-injection path in `XtremeBSd`'s `notif()` (reachable via the world-writable control file) and a TOCTOU/insecure-tempfile issue with the default `ctl_file` location; both `XtremeBSd` and `XBSctl` now default `ctl_file` inside XtremeBS's own data dir and refuse to trust a pre-existing file not owned by root.
  - `customize.sh`: sets explicit permissions for the new `XBS-writefile` binary; documented that `webroot/` permissions/SELinux context are managed by KernelSU itself.
  - Added `docs/webui-x-migration.md` (rationale/architecture) and `docs/security-audit.md` (full findings + remediations) for future reference.

### v2.2.1-kherio
  - Version bump only (v2.1.4-kherio -> v2.2.1-kherio), no functional changes since the previous release

### v2.1.4-kherio
  - Forked release: module now updates from this repo directly, no longer depends on DethByte64's update.json/zip
  - Added XBSconf CLI for terminal-based configuration
  - Reworked WebUI: shared assets, redesigned Estado/Config/Log tabs, swipe navigation between tabs
  - Daemon now reports per-core frequency and system load in its status output
  - action.sh: avoid launching a duplicate httpd instance

### v2.1.4
  - Improve Wifi handling - Authored by [vikasmistry](https://github.com/vikasmistry)

### v2.1.3
  - Added a fallback for kill_wifi to support devices that dont have rfkill support

### v2.1.2
  - Improved handling of manual
  - Added `notify` flag for those pesky notifications

### v2.1.1
  - Improved start for v2 configs. Now on boot, it activates events that should be active (charging, screen_off, low_power)
  - Fixed status checks for the WebUI
  - Fixed kill_wifi handling
  - Added bc (1.08.1) binary for upcoming battery prediction update

### v2.1.0
  - Improved WebUI to show the status of a few things
  - Improved WebUI to show the log amd allow copying to storage for easy bug reports
  - Logging will no longer fill up your storage
  - Improved reloading
  - Safe Mode is persistent until its turned off. (also you can enter safe mode using `safemode=1` in your config)
  - other minor improvements and bug fixes

### v2.0.0
  - Add event handling (different triggers, which makes the module dynamic)
  - Added support for custom events
  - Added support for Doze mode
  - Added the ability to disable the wifi radios
  - Added logging and log levels
  - Added a migration function, this will automatically convert your original config into the v2 config. just put `version=2` in your config file and reboot
  - Removed battery prediction, it was buggy and could use some work, it will be back in a later version.
  - Optimized CPU core handling.

### v1.0.6
  - add webui for easy config
  - attempt ksu and apatch support (no testing done, someone with these let me know if it works or not)
  - Samsung devices should no longer have SystemUI crashes

### v1.0.5
  - change low_ram default value to false

### v1.0.4

  - fix a bug where XtremeBS would continually enable when `trigger=boot` is set
  - math changed in battery time prediction
  - process handling now ensures that the
  nice level doesnt get changed behind us
  - proc_file will now take a nice level per process
  if you dont change your file, nice is 10
  nice levels are 0 (normal) - 19 (very nice)
  - added `keep_on_charge` option, this leads to extremely fast charging speeds and is only needed if using `trigger=auto`

### v1.0.3

  - add battery time prediction
  - removed undocumented function
  - removed old function from pre-v0.0.1
  - made app handling faster (still needs to be faster. WIP)

### v1.0.2

  - make requested changes for MMAR
  - configs are now located in `/data/local/tmp/XtremeBS/`

### v1.0.1

  - Add manual control

### v1.0.0

  - FIRST OFFICIAL RELEASE
  - fixed daemon command handling
  - fixed a bug in process handling

### v0.0.3

  - fixed a bug that prevented powersave from starting

### v0.0.2

  - minor improvements
  - fixed a bug.

### v0.0.1

  - initial release
