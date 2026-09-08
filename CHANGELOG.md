### v3.49.0
  - **Night-wake window is now editable directly on its own card**, not through a separate settings form: the two times shown on "Encendidos nocturnos" are real native time pickers now - tapping either one opens the OS/WebView's own time picker right there, and the change saves immediately (same read-modify-write + `PowerSentinelctl reload` the full Automatización form already used). Replaces the global-settings-form fields added last round entirely, per the maintainer's own suggestion - one place to edit this, not two. A poll landing while the picker is open never overwrites the value mid-edit.
  - `screenwake_summary()` now also returns `start`/`end` as separate JSON fields (alongside the existing combined `window` string, kept for compatibility) - the frontend needs the two values independently for the pickers, without parsing a "HH:MM - HH:MM" display string back apart.

### v3.48.0
  - **CRITICAL FIX: Inicio kept "flickering" every ~3 seconds with content briefly disappearing** - the animation-restart bug fixed in v3.46.0 turned out not to be the whole story. Root cause: `update_status()` had never written its status file atomically - it truncated the real file in place (`echo -n >`) and then built it back up over ~20 separate appends. Any read landing in that window (the WebUI's `readStatus()`, via `cat`) saw an empty or partially-written file, hiding whichever dashboard cards depend on the missing fields until the next poll. This window always existed, but became wide enough to reliably hit in practice once `update_status()` started running every single main-loop cycle (v3.40.0) and calling out to `jq` several more times per call (the night-wake and "Hoy" summaries added since). Fixed with the same temp-file-then-atomic-rename pattern already used everywhere else in this codebase for anything the WebUI reads - confirmed with a concurrent reader/writer reproduction: 200/200 reads saw a fully-written file after the fix, versus reliably empty/partial reads before it.
  - **Night-wake window is now configurable from the WebUI**: two new fields in Automatización's global settings ("Encendidos nocturnos: inicio/fin de la franja", reusing the exact same native time-picker widget already used for the "Night" event's own schedule) - previously the only way to change the default 23:00-07:00 window was hand-editing the raw JSON. Deliberately its own pair of global fields, not tied to the "Night" event, matching the counter's own design (it never depended on that event being configured).

### v3.47.0
  - **Input validation gap found during a security/robustness audit**: `nightwake_start`/`nightwake_end` (v3.42.0's own config) and the pre-existing `night_start`/`night_end`/`thermal_threshold` fields all flowed straight from the config file into arithmetic contexts with zero format validation - unlike every other format-constrained config key, which already goes through `config_get()`'s own validation switch. Confirmed this does NOT allow command injection despite reaching a `$(( ))` context (bash only re-evaluates a literal `$(...)` written directly in an expression, never one already inside an expanded variable's stored value - verified experimentally). The real impact: a malformed value (e.g. hand-edited JSON) broke the night-wake counter, the night profile, or the thermal profile silently, logging a runtime error every single cycle with no obvious cause visible from the WebUI.
  - Fixed with a new `config_valid_time_hhmm()` validator, applied consistently to all 4 affected fields - an invalid value now behaves exactly like an unconfigured one (the existing, already-safe fallback), instead of spamming the log and leaving the feature silently broken.

### v3.46.0
  - **CRITICAL FIX: Inicio's "¿Qué está haciendo ahora?" card visibly flickered every ~3 seconds** while any event was active. Root cause: `renderActiveNow()` fully rebuilds that card's HTML on every status poll (the 3s `pollTimer`), whether or not anything actually changed - and the CSS entrance animation added for it in the previous round (`fade-up`, meant to play once when Inicio first loads) re-triggers from scratch every time a matching element is a freshly-inserted DOM node. The two together meant the card faded in again, in a loop, all day. Fixed by removing the animation from `.active-now-card` specifically (today-card/nightwake-card are unaffected - their own DOM nodes persist between polls; only their child elements' text updates).
  - Found and fixed the same underlying pattern, older and latent, on the CPU core tiles in "Detalles técnicos": `coreGrid.innerHTML` is also rebuilt on every 3s poll, so its own per-tile entrance animation (`tile-in`, present since long before this round) replayed every cycle too for anyone with that section expanded - just less visible than the always-open active-now card, which is likely why it went unreported. Fixed the same way: the tiles' resting state is now the only state, no re-triggering entrance animation.
  - Reported by the maintainer as "the Inicio screen flickers every 3 seconds" - the exact interval was the clue that led straight to the poll timer.

### v3.45.0
  - **Activity timeline redesign**: entries now sit in a real vertical timeline (a connecting rail between dots, sub-lines marked with "↳"), replacing the previous inline-dot layout - used both in Inicio's "Actividad reciente" preview and the full journal in Análisis, since both already shared the same renderer. A subtle fade-in on each entry is the first of this round's small set of polish animations.
  - **Apps tab**: removed the per-app repeated explanation ("PowerSentinel will only lower its background priority...") that used to print once per app card - replaced with a single legend at the top of the tab explaining what each of the 4 policy levels means, read once instead of N times.
  - **Bottom nav reduced to 4 primary tabs + "Más"**: Inicio / Análisis / Automatización / Apps stay one tap away; Perfiles, Ajustes, and a "Detalles técnicos" shortcut straight into Automatización now live in a bottom sheet behind "Más" (with a slide-up animation). Swipe navigation is unaffected - it still moves through every view in order, Perfiles/Ajustes included, just without their own fixed button.
  - **Small polish pass**: fixed a real dead CSS selector (`.hero-card`, a class name that no longer exists after the dashboard redesign) that had silently disabled Inicio's own fade-in-on-load animation - now applied to all of Inicio's current cards, plus a smooth color transition on the profile checklist chips.
  - Daily battery-vs-average comparison was already covered by the existing rate-vs-baseline bar on the battery card (added in an earlier round) - verified it's still working correctly after the redesign; no changes needed there.
  - This release ships together with everything from the last two development rounds (the "Hoy" card and the profile checklist), all still pending upload to `main` as of this release.

### v3.44.0
  - **"Hoy" summary card**: screen time since midnight, time since your last charging session ended, tonight's wake count (reusing the same counter from v3.42.0 - never a second source of truth for the same number), and how many PowerSentinel interventions have started today, plus a small 24-bar hourly screen-activity chart. New daemon-side tracking (`PowerSentinel-todaystats.sh`): screen-on time and its hourly breakdown reset at the calendar-day boundary, but time-since-last-charge deliberately does NOT (it can legitimately span past midnight). Interventions-today is computed straight from the existing Event Journal (counting today's "started" entries) - no new daemon-side counter needed for that one.
  - Still pending: a more visual activity timeline, a daily battery-vs-average summary, visual polish/microanimations, the Apps-tab policy explanation, and the reduced bottom nav.

### v3.43.0
  - **Profile checklist on the dashboard** (classic mode): every profile (Arranque, Cargando, Pantalla apagada, Ahorro del sistema, Noche, Temperatura alta, Manual) now shows at a glance, active ones in green with a check, the rest muted - the same visual language already used by "Hardware detectado" in Ajustes, reused deliberately rather than inventing a new one. Answers "what's active right now" in one look instead of requiring a scroll to the detailed mechanism cards further down. Adaptive-mode installs don't get this list - the gauge/tier name there already is the "what's active" answer, and the 7 classic profiles aren't independently meaningful once the adaptive engine is driving things.
  - **Removed battery % and temperature from the hero's quick stats** - they were duplicated with the battery card just below (which already shows both, plus a sparkline), and repeating them in the hero didn't add a second useful view of the same number. Only the real drain rate (%/h) remains there when available.
  - Still pending from the wider dashboard redesign (unchanged from the last few releases' notes): the full "Hoy" summary card, a more visual activity timeline, a daily battery-vs-average summary, visual polish/microanimations, the Apps-tab policy explanation, and the reduced bottom nav.

### v3.42.0
  - **Night-wake counter**: a new "Encendidos nocturnos" card on the dashboard shows how many times the screen turned on within a configurable night window (`nightwake_start`/`nightwake_end`, default 23:00-07:00), compared against the average of the previous 7 completed nights, with a tap-to-expand list of the exact wake times. Deliberately its own config rather than reusing the "night" event's own schedule fields, so it works out of the box regardless of whether that event is configured (adaptive-mode installs in particular often never touch it). Edge-triggered (only counts genuine screen off->on transitions, never re-counts a cycle where the screen was already on) and bounded (30 days of history, pruned automatically).
  - First piece of a larger "Hoy" summary card discussed with the maintainer (screen time, time since last charge, intervention count, and a small time chart are planned for a future round, along with an "Arranque" section redesign, an Apps-tab explanation of what each policy level does, and a reduced bottom nav) - not part of this release.

### v3.41.0
  - **Dashboard redesign, phase 1: the main "Inicio" card is now a real hero, not a stack of centered blocks.** Two-column layout - the gauge (mode name, score and intervention level, all still inside its center) sits next to a status column with a live "AHORA" indicator, a plain-language subtitle, and a segmented "energy pressure" bar (replacing the previous gradient-bar-with-a-dot, which showed the exact same number in a less legible shape). Quick stats (battery/temperature/rate) are now icon tiles instead of one joined text line, and the "why" sentence gets a contextual icon and its own separated row at the bottom of the card. Falls back to a single stacked column below 360px so the gauge never gets cramped.
  - First round of the wider dashboard redesign discussed with the maintainer (screen-time stats, a more visual activity timeline, a daily battery summary, and further visual polish are planned for upcoming rounds - not part of this release).
  - Deliberately NOT included: a "you saved ~18%" style summary card - it would have directly contradicted the v3.35 decision to never show an invented savings figure, since there's no way to causally attribute a saving to PowerSentinel. Left for a future round with different wording (a measured comparison, not a causal claim).
  - CHANGELOG.md is written in English from this release onward (previous entries stay in Spanish, as written at the time).

### v3.40.0
  - **CRITICAL FIX: Inicio/Estado data (battery, temperature, CPU frequencies, WiFi, Doze) only refreshed when an event started or ended**, never during a steady period (screen on, not charging, no adaptive-tier changes). The stale-data warning itself (v3.35) assumed a refresh roughly every ~3s, but nothing delivered that outside of a transition - so anyone going more than ~90s without an event transition would see the warning permanently and frozen readings, while the daemon was running completely normally. The main loop now refreshes status every cycle (reusing the detection already done that same cycle, no duplicated work) instead of depending solely on transitions.
  - Finding from a code review, verified by reading every call site of `update_status` before fixing anything.

### v3.39.0
  - **CRITICAL FIX: Safe Mode used to unsuspend every system app**, not just the ones PowerSentinel itself had suspended - directly contradicting the ownership system. Removed the global loop.
  - **CRITICAL FIX: `pause` only worked the first time** - a global variable was never reset, so a second pause ended instantly without ever actually waiting. Fixed.
  - **CRITICAL FIX: an invalid `handle_apps` value** (typo, corruption) fell through to `suspend`, the most aggressive action, instead of doing nothing. It now fails safely.
  - **CRITICAL FIX: the watchdog race was real**, and more relevant now because of the new manual restart button - two simultaneous daemon launches could genuinely happen. Fixed with a real atomic lock (`mkdir`), tested with 20 simultaneous attempts.
  - **CRITICAL FIX: `handle_proc` didn't have the same composition protection** already applied to GMS/WiFi/apps/cores - two events targeting the same process could leave it with the wrong nice value once they ended.
  - Findings from an external code review, verified with real reproductions before fixing anything.

### v3.38.0
  - **Apps sorted by policy level**: Protected first, then Gentle, Balanced, and Restricted last - previously they appeared in whatever order the system happened to return, unrelated to each app's own policy.

### v3.37.0
  - **"Restart PowerSentinel" button** inside the stale-data warning: kills and relaunches the actual daemon process (not a cooperative `reload`, which wouldn't help if the daemon is stuck in pause or hung for any other reason). Any active event automatically recovers on startup, through the same safety net that already protects against a real crash.
  - `PowerSentinelconf set/add-event/rm-event` now warn that a `reload` is needed to apply changes, just like the interactive wizard already did.

### v3.36.0
  - **CRITICAL FIX: saving the config (or loading a profile) while an event was active could leave changes applied forever.** When undoing an event after a `reload`, the daemon re-read the config from disk - but that config was already the new one, just saved moments earlier. If the active event no longer matched what the new config said, the "undo" found nothing to revert, leaving apps reniced, cores disabled, WiFi or GMS disabled permanently, with the daemon believing everything was clean. Not a rare edge case - editing an active event and saving, or switching profiles, are completely ordinary actions. Fixed by capturing a real snapshot of what was actually applied at the moment each event activates, used when undoing it instead of re-reading the config.
  - Finding from a self-audit, verified with real reproductions before fixing anything - same as the rest of this series' critical fixes.

### v3.35.0
  - **Stale-data detection**: "Actualizado HH:MM:SS" only confirmed the request itself had succeeded, not that the displayed data was actually recent - if the daemon is paused or stuck, it could show battery data from an hour ago with full confidence. The daemon now writes its own real timestamp, and the frontend clearly warns if the data has gone too long without refreshing.
  - **New comparison bar under the battery estimate**: your current consumption rate versus your real historical average, with the percentage difference - never an invented "savings" figure, since there's no way to causally measure how much would have been spent without PowerSentinel.

### v3.34.0
  - **CRITICAL FIX: ownership tracking wasn't safe across simultaneous events** - two active events requesting different actions on GMS/WiFi/apps/cores could leave the system permanently stuck in the wrong state. Fixed for GMS, WiFi, `low_ram`, and apps, verified with real reproductions.
  - **CRITICAL FIX: manual `handle_cores` restored an empty governor** on high-performance cores that weren't auto-detected; **`disable_cores` re-enabled cores** that were already offline for another reason before PowerSentinel ever acted. Both fixed with the same "restore only what changed" pattern.
  - **`action_proc_undo()` fixed**: now preserves the real original per-process `nice` value (it used to force 0 instead), and along the way two unreported bugs were fixed too: handling of processes with multiple PIDs had never worked, and an empty `IFS=` meant the user-configured nice value was never actually read.
  - **Full Inicio redesign**: the circular gauge and mode name merge into a single main card; new "why" sentence in human language (never invented); real consumption rate (%/h) alongside battery and temperature; the battery card is now always visible, with a mini chart of the last few hours; recent activity with color-coded dots by type; one-line CPU summary with direct access to technical details.

### v3.33.0
  - **CRITICAL FIX: "high power" core detection was broken on symmetric SoCs** (the most common design). `auto_map_cores()` used `uniq -u`, which only detects values that appear exactly once - with 4 cores at one frequency and 4 at another, none was "unique", leaving the high-performance core list completely empty. This meant `disable_cores=auto` disabled nothing, and `handle_cores=auto` forced power-save mode onto **every** core, including performance ones.
  - **More robust watchdog**: replaced the simple `pgrep` with a PID file plus a real liveness and process-identity check, so as not to risk a second daemon instance.
  - **CRITICAL FIX x2: GMS and WiFi now only restore what PowerSentinel actually changed** - the same pattern already fixed earlier for apps and `low_ram`. If you turn WiFi off yourself, PowerSentinel will no longer re-enable it once an event ends. Also hardened `low_ram`'s idempotency against repeated calls.
  - Findings from an external code review, verified one by one with real reproductions before fixing anything.

### v3.32.0
  - **Navigation restructured**: Inicio / Perfiles / Automatización / Apps / Análisis / Ajustes. Apps becomes its own top-level tab (it used to live inside Config → Advanced). "Log" is renamed to "Análisis", with its technical subtab renamed to "Actividad". "Acerca de" is renamed to "Ajustes".
  - **Advanced settings**: a new card in Ajustes clearly signposts the 4 technical categories (Engine, CPU, Apps, System) with a direct shortcut into Automatización's Advanced mode - nothing has been removed, it simply no longer appears the moment you open the app.
  - **Visual hierarchy in Inicio**: restructured from ~9 always-visible cards into a clear reading order (Main status → What's happening → Recent activity → Technical details, the latter collapsed by default).

### v3.31.0
  - **Apps: from "package list" to "per-app policy"** (Config → Advanced → Apps). The 4 levels were renamed to behavior language (Protected / Gentle / Balanced / Restricted) with a clear explanation of each. Every app now shows what would actually happen in your device's real situations: in classic mode, "When the screen is off" / "When the battery is low"; in adaptive mode, the 3 pressure levels (Gentle/Moderate/Extreme saving) - never the same template for both modes, since the adaptive engine doesn't break down into independent conditions the way classic events do.

### v3.30.0
  - **Activity timeline (Historial)**: the journal now logs every event start/end with the real mechanisms actually applied at that moment, instead of a generic "Active Events: X Y Z" line. The view was rewritten as a readable timeline: "23:14 🌙 Entered Night mode" + "Deep Doze enabled" + "GMS limited", "07:42 ☀️ Exited Night" + "Previous state restored". New `warning` severity level (never triggers a real notification) for when an action is skipped due to a device capability limitation - this used to only show in the technical log, now it's clearly marked with ⚠️.
  - **Energy health (Log → Energía)**: recent consumption (last 6h, %/h) compared against your previous historical average, and the time of day when you tend to drain the most battery - calculated entirely from data already collected by the energy log.

### v3.29.0
  - **Estado becomes an energy control center.** New main card: "Protección energética: ACTIVA/inactiva", battery/temperature/screen summary, and the current mode in plain language. In adaptive mode, a visual Normal → Saving → Extreme indicator positioned by the real pressure value, with "Detalles" (collapsed by default) showing the real breakdown: total pressure, and how much each factor contributes (temperature, battery, screen off, night, CPU load).
  - **"What's happening now?"**: one card per active event, with icon, plain-language name, "Active since HH:MM", the mechanisms actually applied (CPU/Doze/Apps/GMS/WiFi), and a sentence explaining why it activated.
  - **Goal vs Mechanism** in Basic mode: levels are now presented as 🚀 Maximum performance / ⚖️ Balanced / 🔋 Maximum battery life instead of Low/Medium/High, with "How it's achieved" as a collapsible technical list (Apps → limit processes, Doze → deep...) instead of always showing.
  - Background daemon work: real energy-pressure breakdown, start time of each active event, and a snapshot of resolved mechanisms per event - all exposed for the first time outside the daemon process itself.

### v3.28.0
  - **Per-app policy screen** (Config → Avanzado → Apps): browse every installed app and set its 4-level policy directly (never touch / gentle only / follow event / always aggressive), instead of only reachable through `PowerSentinelconf` on a terminal.
  - **Usage-frequency context** on the same screen, via a new `PowerSentinel-usagerank` script - queries Android's own App Standby Buckets (`am get-standby-bucket`) one app at a time using its small, documented single-package form, rather than the fragile raw `dumpsys usagestats` text dump. Purely informational, never wired into any automatic decision.
  - **Energy log analysis** (Log → Energía): a battery-level chart for the last 24h, and a "ritmo de descarga por régimen activo" breakdown comparing how many minutes it takes to drop 1% battery under each combination of active events - answering, with the device's own real data, whether a given aggressiveness level genuinely slows discharge.

### v3.27.0
  - **CRITICAL FIX: saved config was silently wiped, or crashed the daemon, on every reload.** `serializeConfig()` wrote `"version"` at the top level of the JSON, but the daemon (both the migration idempotency check and the normal config read) expects it *inside* `global`. Every save from the WebUI immediately triggers a daemon reload, which - finding the version key missing - either rebuilt the config from a stale, frozen `.conf` snapshot (discarding whatever was just saved) or crashed with "FATAL: could not migrate to v2". This affected every save made through the WebUI since the JSON config format was introduced (v3.10.0).
  - Basic mode: selecting an aggressiveness level now shows a detailed, tier-by-tier breakdown of what it actually does, generated directly from the same data used to apply the setting.
  - Config (Advanced): the allow/deny apps picker now appears right under "Gestión de apps" in each event, instead of at the very bottom of the card.
  - Hardware detection: a new "Hardware detectado" section in Acerca de shows the real device manufacturer/model and which mechanisms it actually supports. The existing Samsung/OnePlus risk warnings now only show when they're actually relevant to the detected device, instead of to everyone regardless of hardware.
  - On-demand CPU consumption ranking (Estado tab) - explicitly triggered, sorted by %, with zero ongoing cost when not in use.
  - Acerca de: removed the fork/DethByte64 attribution, added the project's Telegram channel link.
  - Expanded the README with a Philosophy section and a full Daemon architecture explanation, and brought the Features list up to date with everything built since the JSON config rewrite.

### v3.26.0
  - **3 critical fixes, all reported by a user and verified with real reproductions before being trusted.**
  - Apps: `action_apps_undo()` had no per-app record of what PowerSentinel actually changed - an app already suspended by something else before PowerSentinel touched it could get force-unsuspended once the event ended, and `nice` always hard-reset to 0 regardless of a process's real original value. Fixed with per-app ownership tracking (`PowerSentinel.appstate`) - only what PowerSentinel itself actually changed gets restored, and the real original `nice` value is preserved.
  - `low_ram`: `ro.config.low_ram` was unconditionally forced to `false` when an event ended, with no record of what it was before - a device that genuinely ships with `low_ram=true` by default would have that silently overwritten. Fixed by recording and restoring the real original value (`PowerSentinel.lowram_orig`).
  - Event composition: an ending event's undo could revert a setting (WiFi, cores, doze, GMS, low_ram) that another still-active event also needed - confirmed with a real reproduction (two events both requesting `kill_wifi=true`, one ending while the other stayed active incorrectly re-enabled WiFi). Fixed with a re-assertion pass after any event ends, re-applying whatever the remaining active events still need. Not a full policy-composition engine - if two active events want genuinely different things for the same category, there's still no defined precedence between them.

### v3.25.0
  - **Basic mode's Config screen expanded** with 4 new blocks: a live battery summary, a reassurance line showing how many apps are always protected, a list of apps flagged for real sustained background CPU use (each with one-tap "Limitar esta app" or "Ignorar"), and Safe Mode - previously only reachable via a terminal command, now a simple button that reflects its current state.
  - `appwatch.sh`'s app detections are now persisted (`PowerSentinel.flagged`) instead of living only in memory - manageable via the new WebUI blocks or `PowerSentinelconf flagged-apps list/dismiss`.

### v3.24.0
  - The mode switcher now sits in its own row above the action toolbar, separate from Guardar/Recargar/Restaurar recomendados - clearer that it's a state indicator, not a fourth action button.
  - Each aggressiveness level's description now says a bit more about what actually happens (e.g. "Alta" mentions deep Doze and low-RAM mode specifically) instead of a vague "máximo ahorro".

### v3.23.1
  - Removed the redundant "Modo avanzado" checkbox in Config - since the "?" button already lets you switch modes via the explanation screen, having a separate toggle was two ways to do the same thing. The single remaining button now shows your current mode as its own label and opens that same screen when tapped.

### v3.23.0
  - **Per-app policy in 4 levels**, replacing the binary allowlist/denylist-only model: 0 (never touch), 1 (gentle only, capped at "nice"), 2 (default, follow the event as configured), 3 (always aggressive, forces suspend). Global rather than per-event, built on top of the real CPU detection added in v3.20.0 - a level can now be an informed decision rather than a guess. Manage it now via `PowerSentinelconf app-policy set/get/rm/list`; a WebUI section is planned for a later polish pass.

### v3.22.0
  - **Redesigned Basic mode's Config screen.** The three aggressiveness levels are now cards with an icon and a one-line description of what each actually means, instead of plain unexplained buttons. A new live status line shows whether adaptive savings are genuinely doing something right now ("Ahorrando ahora mismo" / "Sin ahorro activo ahora mismo"), not just whether the setting is turned on.

### v3.21.0
  - **Proper Basic/Advanced mode choice screen.** Instead of a bare toggle, a new screen explains both modes clearly (what Basic gives you vs what Advanced requires) and appears automatically the first time you visit Config. A "?" icon next to the toggle reopens the same explanation anytime.

### v3.20.1
  - Fixed: Advanced mode's Config tab had no scrolling at all (a layout CSS rule silently stopped applying when Advanced mode's content got wrapped for the show/hide toggle in v3.18.0).
  - Fixed: an event that's active (like `boot`, which fires at every daemon start and is never explicitly undone) had no way to reach it in Config unless already explicitly added. A hint now points you to "Añadir evento" for any active event with no configured block.

### v3.20.0
  - **Problematic-app detection (observational only).** A new watch, using the stable `/proc/[pid]/stat` kernel interface rather than any fragile Android dumpsys command, flags apps sustaining real, measurable CPU use while the screen is off - recorded to the Event Journal, no automatic action taken. This is groundwork for a future per-app policy system to target apps that are actually measured as heavy, instead of an arbitrary manually-curated list.

### v3.19.0
  - **Energy log: real validation, not just correctness.** A new `PowerSentinel.energylog` records battery level, temperature, and what was active, but only when something actually changed - not every cycle. This is raw data collection for after-the-fact analysis (e.g. "did aggressiveness High actually drain slower than Medium last night", "did temperature actually drop after thermal fired") - no built-in conclusions, no new WebUI view yet, honestly a correlation tool for your own device rather than a scientific power model.

### v3.18.0
  - **Basic mode by default.** New installs now open to a simple Config view: one switch for adaptive savings and an Aggressiveness picker (Low/Medium/High) - no events, no per-field settings to understand. A visible "Modo avanzado" toggle reveals the full Form/Text editing that existed before, unchanged, for anyone who wants complete control. Purely a WebUI presentation layer - both modes read and write the exact same configuration.
  - Basic mode's aggressiveness presets never suspend apps (only the safer, reversible "nice") - that level of control is exactly what Advanced mode is for.

### v3.17.0
  - **Critical app protection.** The device's default dialer, SMS, and emergency apps - plus anything already exempted from Android's own battery optimization - are now automatically protected from `handle_apps`' kill/nice/suspend, regardless of your allowlist/denylist configuration. Losing the ability to make a call or receive a text is a different category of risk than "an app I like lags a bit". Detected via official, documented Android commands (`cmd role get-role-holders`, `dumpsys deviceidle`) - not configurable, since this is specifically about safety, not general preference.

### v3.16.2
  - **Security fix**: `PowerSentinel.json` (and `.state`/`.journal`) were world-writable (`666`) on some devices - readable and writable by any app, not just root. Found by a user while helping diagnose an unrelated issue. Every write path now sets `600` permissions, and existing installs get corrected automatically on their next daemon start.

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
