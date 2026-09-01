
### v3.6.0
  - **Delete-event confirmation** in Config, matching what profile deletion already had - previously one accidental tap could wipe an event's whole configuration with no warning.
  - **Native time picker** for the night profile's start/end hours, replacing free text.
  - **Daemon watchdog**: relaunches `XtremeBSd` if it dies unexpectedly (crash, OOM kill), instead of leaving the device unmanaged until the next reboot.
  - **Thermal profile**: new independent `thermal` event, active whenever the battery reaches a configured temperature, with hysteresis to avoid rapid on/off flapping - same design as the existing time-of-day `night` profile.
  - **Optional charge limiter**: pauses charging once the battery reaches a configured percentage, resumes a few percent below it. Entirely opt-in and requires a device-specific sysfs path (there's no universal one) - does nothing if that path isn't set or isn't writable, rather than guessing.
  - **Manual language selector** in About, in addition to the existing automatic (system-language) detection.
  - **Copy diagnostics** button in About: bundles the installed version, live status, and the last 40 log lines into one block, copied to the clipboard (with a manual-copy fallback).
  - **App picker** now shows a small indicator next to apps that are currently running.
  - **Fixed a real bug**: `KNOWN_GLOBAL_KEYS` (used to parse the config file) was a hand-maintained list that had drifted out of sync with the actual set of global fields - newly added fields were silently dropped from the in-memory config model and risked being duplicated on save. Now derived automatically from the field definitions, so this can't happen again for future fields.
  - Also fixed two leftover untranslated strings the previous release's translation pass had missed (group section headers, and the toggle switch's "Enabled/Disabled" text) - neither had an accented character, which is why a simple search hadn't caught them.
  - All daemon-side logic (watchdog detection, thermal hysteresis, charge-limit behavior including the safety case of a misconfigured path) and the config-parsing fix were verified with standalone test scripts before being included.

### v3.5.1
  - **Fixed**: "kherio" was still showing on the module's install/list screen in the root manager app (KernelSU Next, ReSukiSU, etc.), because that screen reads `module.prop`'s `version` field directly - the earlier fix only stripped it from the WebUI's own "Acerca de"/"About" tab, not from the field the manager itself displays. `module.prop` and `update.json`'s `version` fields no longer carry the "-kherio" suffix at all; `versionCode` (a plain integer, already higher than upstream's) is what the update checker actually compares, so this doesn't affect update detection. The suffix is now only used internally in the Release/tag name, which the manager UI never shows.

### v3.5.0-kherio
  - **Full English translation**, automatic based on the device's default language: the WebUI now shows English for any non-Spanish system locale, and Spanish otherwise. New `src/i18n.js` (locale detection + a full es/en dictionary + a `t()` helper) is used across every view - static HTML labels via `data-i18n` attributes, dynamic text (toasts, generated summaries, form field labels/help/warnings, event presets) via `t()` calls. Verified: locale detection checks only the browser's *primary* (default) language, ignoring secondary preferences - a first version incorrectly matched Spanish anywhere in the preference list, fixed and re-verified against several `navigator.languages` combinations (Spanish-primary, English-primary-Spanish-secondary, non-Spanish-only, empty). Also verified variable interpolation and the fallback-to-key behavior for the `t()` helper.
  - `module.prop`'s description field updated.

### v3.4.1-kherio
  - Acerca de: the displayed version no longer shows the internal "-kherio" suffix (e.g. "v3.4.1" instead of "v3.4.1-kherio") - that suffix only exists internally so update checkers see a distinct/newer version than upstream, it has no place in anything the user reads. Left untouched everywhere it's actual developer/repo attribution (the credits line, the GitHub links).

### v3.4.0-kherio
  - **Bottom navigation bar** replaces the old top tab strip - icon + label per section, scales cleanly to the two new sections below instead of feeling cramped. The header is now just the app title.
  - **Battery info on Estado**: level, charging state, temperature, voltage (`dumpsys battery`, added to `XtremeBSd`'s status output alongside a new anchored-regex parser to avoid matching the wrong `voltage:`/`level:` line), plus a rough remaining-time estimate from the battery-level samples collected across the browsing session (persisted in `localStorage`, so it survives a page reload).
  - **Currently-active event(s) shown on Estado**: the daemon now reports `ActiveEvents:` in its status (tracking the existing internal `active_events[]` array), rendered as chips under the savings gauge - previously you could see a savings % with no way to tell *which* event caused it.
  - Frequency/load chart history now persists across page reloads (was previously wiped on every reload).
  - **Config tab**: a search box filters the (collapsed) event list by name or by whatever appears in its one-line summary; each event card also shows an "Activo" badge (pulsing dot on the icon) when it's the one currently applied, cross-referencing the same `ActiveEvents` data Estado uses.
  - **New: Perfiles tab** - save the current `XtremeBS.conf` as a named profile, and load or delete saved profiles later. Profiles are plain files under `XtremeBS/profiles/`, written through the same hardened `XBS-writefile` path as the main config.
  - **New: Acerca de tab** - shows the installed module version (read live from `module.prop`) and links to the repo, changelog, and issue tracker.
  - **Pull-to-refresh** added to Estado and Log (in addition to the existing toolbar refresh button) - drag down from the top of either list to refresh.
  - Verified: the daemon's `dumpsys battery` parsing against a realistic sample dump (correctly ignores "Max charging voltage:" when looking for "voltage:"), and the battery-parsing/remaining-time-estimate JS logic against several synthetic histories (normal drain, too-short window, level going up, no data) - all matched expectations.

### v3.3.1-kherio
  - **Closed the two remaining low-severity findings from `docs/security-audit.md`** (both left deliberately open in the original audit, now fixed):
    - `system/bin/XtremeBSd`'s app-handling loops (`enable_pwr_save()` and `disable_pwr_save()`) used an unquoted `for app in $(...)`, which both word-splits and glob-expands every line - a denylist entry containing a shell glob character (e.g. `*`) could expand to filenames in the daemon's working directory instead of being read as a literal package name. Rewrote as a hardened `while IFS= read -r app; do ... done < <(...)`. Verified with a standalone repro: the old loop expanded a `*` denylist line to every file in a test directory; the new one preserves it as the literal string `*`.
    - The same functions matched a package against the allowlist with `grep -E` (extended regex), so a dot in a package name acted as a "match any character" wildcard instead of a literal dot - a package name could false-positive match a similarly-shaped, unrelated allowlist entry. Switched to `grep -Fxq` (fixed string, whole line). Verified: with the old `-E`, `com.example.app` falsely matched an allowlist line `comXexampleXapp`; with `-Fxq` it correctly doesn't.
    - Also quoted two `pgrep $proc` calls that had the same unquoted-expansion issue against `proc_file` lines.
  - `docs/security-audit.md` updated to reflect both findings as fixed, with the verification method used for each.
  - No user-facing/UI changes in this release.

### v3.3.0-kherio
  - **Config tab UX overhaul**:
    - **Fixed a real bug**: the shared `.filter` class was only styled via a `select.filter` CSS selector, so every text/number `<input class="filter">` (paths, night hours, custom event name, app search...) had zero theme styling and rendered with the browser's tiny default form-control look. This was very likely the biggest single contributor to "the text is too small" - fixed by styling `.filter` generically for both `<input>` and `<select>`.
    - Bumped field labels (13→15px) and help/warning text (11→13px, tighter line-height) - readable without squinting on a phone screen.
    - More breathing room between fields (14px → 20px margin).
    - **Fields grouped into labeled clusters** (Horario / Apps / CPU / Sistema) within each event instead of one flat list of 14 fields - `config-form.js`'s `FIELD_DEFS` entries now carry a `group`, and `renderFieldsForm` inserts a small subheading whenever the group changes.
    - **Event cards are now a collapsed-by-default accordion**: each shows just its icon, name, and a one-line auto-generated summary (e.g. "apps: nice · núcleos: auto · WiFi off") until tapped open. A newly added or duplicated event starts expanded (so you can configure it immediately); existing/loaded events start collapsed, so 5 events x 14 fields no longer means scrolling through a huge wall on open.
    - Event header reworked: bigger touch targets, the 4 action buttons (aplicar/detener/duplicar/eliminar) grouped together with a visual divider instead of sitting flush against the name, and a chevron indicating expand state.
  - Verified with a standalone jsdom test that field grouping renders the expected group headers for both a config-managing event (Apps/CPU/Sistema) and the night event (Horario first).

### v3.2.4-kherio
  - **Reverted the live-dragging carousel after 3 failed fix attempts (v3.2.1/2/3), confirmed still broken by on-device screenshots**: each pane was still rendering wider than the screen (grid rows and toolbar buttons visibly cut off past the right edge), across percentage-based flex sizing and two different pixel-measurement strategies. Rather than keep guessing blind without a way to render-test locally, reverted the switching mechanism to the simple, previously-confirmed-working approach: only the active tab is rendered (`display:none` on the others), toggled instantly on tab tap or swipe.
  - Swipe still switches tabs (a completed left/right drag past a small threshold), it just no longer visually tracks the finger mid-drag - that tracking is exactly the part that kept breaking, and isn't worth the reliability cost until it can be revisited with actual on-device debugging tools rather than remote guessing.
  - Nothing else changed in this release - all v3.2.0-v3.2.3 functionality (night profile, app picker, presets, etc.) is intact.

### v3.2.3-kherio
  - **Carousel width fix, attempt 3 - actual root cause found from screenshots**: v3.2.2's pixel-based approach was on the right track but measured the wrong thing. `setPaneWidths()` read `.view-viewport.clientWidth` - but at that point nothing had constrained `.view-viewport`'s own width yet (it had no explicit `width`, only `flex:1` relying on flexbox's cross-axis "stretch" behavior), so its content (`.view-track`'s children, sized by their own wide grids/cards before any pane width was fixed) could inflate it first, and that inflated number got measured back and applied as "the fix" - baking the exact bug into itself. Confirmed from screenshots: grid rows (frequency/load metrics, core tiles) were visibly cut off past the right edge of the phone screen in both Estado and Config.
    - `.view-viewport` (and `.app-shell > main`, defensively) now get an explicit `width: 100%` instead of relying on flex stretch.
    - `setPaneWidths()` now measures `window.innerWidth` (falling back to `document.documentElement.clientWidth`) - the browser's own layout viewport size, which cannot be inflated by this page's own content no matter what state it's in - instead of any element inside the carousel itself.
  - Verified the pane-width math (not the actual CSS rendering, which still needs a real device) with a jsdom-based standalone test: correct pixel widths for both a phone-sized (412px) and tablet-sized (900px) viewport, before and after a simulated resize.

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
