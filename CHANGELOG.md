### v3.38.0
  - **Apps ordenadas por nivel de política**: Protegida primero, luego Suave, Equilibrada, y Restringida al final - antes aparecían en el orden que devolviera el sistema, sin relación con la política de cada una.

### v3.37.0
  - **Botón de "Reiniciar PowerSentinel"** dentro del aviso de datos desactualizados: mata y relanza el proceso real del demonio (no un `reload` cooperativo, que no serviría si el demonio está atascado en pausa o colgado por cualquier otra razón). Cualquier evento activo se recupera automáticamente al arrancar, por la misma red de seguridad que ya protege contra un crash real.
  - `PowerSentinelconf set/add-event/rm-event` ahora avisan de que hace falta un `reload` para aplicar los cambios, igual que ya hacía el asistente interactivo.

### v3.36.0
  - **CRITICAL FIX: guardar la configuración (o cargar un perfil) mientras un evento estaba activo podía dejar cambios aplicados para siempre**. Al deshacer un evento tras un `reload`, el demonio releía la configuración desde disco - pero esa config ya era la nueva, guardada justo antes. Si el evento activo ya no coincidía con lo que la nueva config decía, el "deshacer" no encontraba nada que revertir, dejando apps reniced, núcleos apagados, WiFi o GMS deshabilitados de forma permanente, con el demonio creyendo que todo estaba limpio. No es un caso raro - editar un evento activo y guardar, o cambiar de perfil, son acciones completamente normales. Corregido capturando una instantánea real de lo aplicado en el momento de activar cada evento, usada al deshacerlo en vez de releer la config.
  - Hallazgo de una autoauditoría, verificado con reproducciones reales antes de corregir nada - igual que el resto de fixes críticos de esta serie.

### v3.35.0
  - **Detección de datos desactualizados**: "Actualizado HH:MM:SS" solo confirmaba que la petición había tenido éxito, no que los datos mostrados fueran recientes - si el demonio está en pausa o atascado, podía mostrar batería de hace una hora con total confianza. Ahora el demonio escribe su propio timestamp real, y el frontend avisa claramente si los datos llevan demasiado tiempo sin refrescarse.
  - **Nueva barra de comparación bajo la estimación de batería**: tu ritmo de consumo actual frente a tu media histórica real, con el porcentaje de diferencia - nunca una cifra de "ahorro" inventada, ya que no hay forma de medir causalmente cuánto se habría gastado sin PowerSentinel.

### v3.34.0
  - **CRITICAL FIX: el seguimiento de propiedad (ownership) no era seguro entre eventos simultáneos** - dos eventos activos pidiendo acciones distintas sobre GMS/WiFi/apps/núcleos podían dejar el sistema atascado permanentemente en el estado equivocado. Corregido para GMS, WiFi, `low_ram` y apps, verificado con reproducciones reales.
  - **CRITICAL FIX: `handle_cores` manual restauraba un governor vacío** en núcleos de alto rendimiento no detectados automáticamente; **`disable_cores` reactivaba núcleos** que ya estaban apagados por otra razón antes de que PowerSentinel actuara. Ambos corregidos con el mismo patrón de "restaurar solo lo que cambió".
  - **`action_proc_undo()` corregida**: ahora conserva el `nice` original real por proceso (antes forzaba 0), y de paso se corrigieron dos bugs no reportados: el manejo de procesos con varios PIDs nunca había funcionado, y un `IFS=` vacío hacía que el nice configurado por el usuario nunca se leyera de verdad.
  - **Rediseño completo de Inicio**: el gauge circular y el nombre del modo se fusionan en una sola tarjeta principal; nueva frase de "por qué" en lenguaje humano (nunca inventada); ritmo de consumo real (%/h) junto a batería y temperatura; la tarjeta de batería pasa a estar siempre visible, con mini gráfico de las últimas horas; actividad reciente con puntos de color por tipo; resumen de CPU de una línea con acceso directo a los detalles técnicos.

### v3.33.0
  - **CRITICAL FIX: detección de núcleos "high power" rota en SoCs simétricos** (el diseño más común). `auto_map_cores()` usaba `uniq -u`, que solo detecta valores que aparecen exactamente una vez - con 4 núcleos a una frecuencia y 4 a otra, ninguna era "única", dejando la lista de núcleos de alto rendimiento completamente vacía. Esto hacía que `disable_cores=auto` no desactivara nada, y `handle_cores=auto` forzara el modo ahorro en **todos** los núcleos, incluidos los de rendimiento.
  - **Watchdog más robusto**: sustituido el simple `pgrep` por un fichero PID con comprobación de vida real e identidad del proceso, para no arriesgar una segunda instancia del demonio.
  - **CRITICAL FIX x2: GMS y WiFi ahora solo restauran lo que PowerSentinel cambió realmente** - mismo patrón ya corregido antes en apps y `low_ram`. Si apagas el WiFi tú mismo, PowerSentinel ya no lo reactivará al terminar un evento. Reforzada también la idempotencia de `low_ram` ante llamadas repetidas.
  - Hallazgos de una revisión de código externa, verificados uno a uno con reproducciones reales antes de corregir nada.

### v3.32.0
  - **Navegación reestructurada**: Inicio / Perfiles / Automatización / Apps / Análisis / Ajustes. Apps pasa a ser su propia pestaña de nivel superior (antes vivía dentro de Config → Avanzado). "Log" pasa a llamarse "Análisis", con su subpestaña técnica renombrada a "Actividad". "Acerca de" pasa a llamarse "Ajustes".
  - **Ajustes avanzados**: nueva tarjeta en Ajustes que señaliza claramente las 4 categorías técnicas (Motor, CPU, Apps, Sistema) con un acceso directo a Automatización en modo Avanzado - nada se ha eliminado, simplemente ya no aparece nada más abrir la app.
  - **Jerarquía visual en Inicio**: reestructurado de ~9 tarjetas siempre visibles a un orden de lectura claro (Estado principal → Qué está pasando → Actividad reciente → Detalles técnicos, este último colapsado por defecto).

### v3.31.0
  - **Apps: de "lista de paquetes" a "política por app"** (Config → Avanzado → Apps). Los 4 niveles se renombraron a lenguaje de comportamiento (Protegida / Suave / Equilibrada / Restringida) con una explicación clara de cada uno. Cada app ahora muestra qué pasaría de verdad en las situaciones reales de tu dispositivo: en modo clásico, "Cuando la pantalla está apagada" / "Cuando la batería está baja"; en modo adaptativo, los 3 niveles de presión (Ahorro suave/moderado/extremo) - nunca la misma plantilla para ambos modos, ya que el motor adaptativo no se descompone en condiciones independientes como los eventos clásicos.

### v3.30.0
  - **Timeline de actividad** (Historial): el journal ahora registra cada arranque/fin de evento con sus mecanismos reales aplicados en ese momento, en vez de una línea genérica "Active Events: X Y Z". La vista se reescribió como un timeline legible: "23:14 🌙 Entró en modo Noche" + "Doze profundo activado" + "GMS limitado", "07:42 ☀️ Salió de Noche" + "Restaurado el estado anterior". Nuevo nivel de severidad `warning` (nunca dispara notificaciones reales) para cuando una acción se salta por falta de capacidad del dispositivo - antes esto solo se veía en el log técnico, ahora aparece claramente marcado con ⚠️.
  - **Salud energética** (Log → Energía): consumo reciente (últimas 6h, %/h) comparado con tu media histórica anterior, y el momento del día donde sueles gastar más batería - calculado enteramente con los datos ya recogidos por el log de energía.

### v3.29.0
  - **Estado se convierte en un centro de control energético.** Nueva tarjeta principal: "Protección energética: ACTIVA/inactiva", resumen de batería/temperatura/pantalla, y el modo actual en lenguaje llano. En modo adaptativo, un indicador visual Normal → Ahorro → Extremo posicionado por la presión real, con "Detalles" (colapsado por defecto) mostrando el desglose real: presión total, y cuánto aporta cada factor (temperatura, batería, pantalla apagada, noche, carga de CPU).
  - **"¿Qué está haciendo ahora?"**: una tarjeta por cada evento activo, con icono, nombre en lenguaje llano, "Activo desde HH:MM", los mecanismos realmente aplicados (CPU/Doze/Apps/GMS/WiFi) y una frase explicando por qué se activó.
  - **Objetivo vs Mecanismo** en el modo Básico: los niveles ahora se presentan como 🚀 Máximo rendimiento / ⚖️ Equilibrado / 🔋 Máxima autonomía en vez de Baja/Media/Alta, con "Cómo se consigue" como una lista técnica colapsable (Apps → limitar procesos, Doze → profundo...) en vez de mostrarse siempre.
  - Trabajo de fondo en el demonio: desglose real de la presión energética, hora de inicio de cada evento activo, y foto de los mecanismos resueltos por evento - todo expuesto por primera vez fuera del propio proceso del demonio.

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
