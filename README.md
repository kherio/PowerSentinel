# PowerSentinel

**PowerSentinel** is a rooted Android battery-optimization module built around event-driven power policies. It can manage CPU cores, apps, WiFi, Doze, GMS/process priorities, logging, profiles, and safety controls.

## Philosophy

PowerSentinel's goal is not to maximize the number of power-saving actions it takes. It is to **maximize real-world battery energy savings while minimizing performance degradation, wakeups, thermal problems, application instability, notification loss, and unnecessary CPU/network activity of its own**. It should be evaluated as a real battery-management system with observable outcomes, not as a collection of Android tweaks assumed to help.

A few concrete principles this project follows in practice:

- **Never touch what it didn't create.** Actions like suspending an app, forcing a `nice` level, or flipping a system property are only ever undone if PowerSentinel itself recorded making that specific change. An app already suspended by something else, or already running at a non-default `nice` value, or a device that already shipped with a given system setting, is left exactly as it was found - not silently reset to a hardcoded default once an event ends.
- **Safety-critical apps are never negotiable.** The device's default dialer, SMS, and emergency apps, plus anything already exempted from Android's own battery optimization, are always protected regardless of event configuration. This is not a setting anyone can turn off, because losing the ability to make a call or receive a text is a different category of risk than "an app lags a bit".
- **Measure before enforcing.** Where possible, detection uses stable, documented interfaces (the Linux `/proc` filesystem, standard `getprop` build properties, official Android role/role-holder commands) rather than fragile, version-dependent `dumpsys` text parsing. Where a signal can't be independently verified from a development environment, that limitation is stated plainly in code comments rather than assumed away - and the feature is designed to fail toward "do nothing extra" rather than "do something wrong" if the signal ever stops matching.
- **Observe before acting automatically.** New detection features - like flagging an app with sustained background CPU use - start observational-only: recorded for a person to review and act on with one tap, not silently enforced, until there's real confidence in the underlying signal.
- **Zero cost unless something is actually happening.** Background checks are throttled and gated (e.g. only while the screen is off, only once a minute) rather than run on every poll cycle, and genuinely occasional questions (like "what's using the most CPU right now") are answered on demand, with no continuous background cost, rather than sampled constantly just in case someone asks.
- **Basic mode is a presentation layer, not a different mechanism.** The simplified Config view writes the exact same configuration format the full editor does; nothing behaves differently underneath depending on which mode happens to be showing.

## Requirements

- Rooted Android device with KernelSU.
- A KernelSU/WebUI-X-capable manager for the graphical WebUI.
- The module can also be operated entirely from a root shell with `PowerSentinelctl` and `PowerSentinelconf`.

> **Important:** PowerSentinel is intentionally **KernelSU-only for its WebUI**. The legacy Magisk `httpd`/CGI compatibility layer was removed in v3.8.0. There is no local HTTP server or browser fallback.

## Features

- **Event-driven power management** — boot, charging, screen-off, low-power, night, thermal, manual and fully custom events, each with independent configuration.
- **Adaptive engine** — an opt-in pressure score (0-100, from battery level, temperature, charging state, screen state, night, and CPU load) mapped to three escalating tiers, so behavior scales with how much the device actually needs rather than one fixed policy applying uniformly.
- **App management** — kill, suspend, or reprioritize applications with allow/deny lists, plus a global **per-app policy in 4 levels** (never touch / gentle only, capped at `nice` / follow whatever the active event asks for / always aggressive, forces suspend) that can override a specific app's treatment regardless of which event is currently active.
- **Critical app protection** — the device's default dialer, SMS, and emergency apps, and anything already exempt from Android's own battery optimization, are always protected. Not configurable, since this is about safety rather than preference.
- **Problematic-app detection** — a background watch flags apps sustaining real CPU use while the screen is off, using the stable `/proc/[pid]/stat` kernel interface rather than a fragile framework dump. Purely observational: flagged apps are surfaced for review (with a one-tap "limit this app" action in the WebUI), never acted on automatically.
- **On-demand CPU ranking** — a one-shot, explicitly-triggered measurement of which installed apps are using the most CPU right now, sorted by percentage. Zero ongoing cost: it only runs, and only ever costs anything, when someone asks to see it.
- **Energy log** — a change-triggered (not continuous) record of battery level, temperature, and what was active at the time, meant for after-the-fact analysis of whether a given setting is genuinely helping rather than assumed to.
- **Hardware detection** — the WebUI shows the real detected manufacturer/model and exactly which low-level mechanisms this specific device supports (core control, WiFi control method, Doze, GMS, app suspension), and only surfaces a device-specific risk warning (e.g. core disabling on some Samsung devices) when it's actually relevant to the device it's running on.
- **CPU optimization** — powersave governors and optional core disabling, gated by a Capability Manager that probes what the device can actually do once at startup, instead of blindly attempting something unsupported every cycle.
- **System controls** — Doze, WiFi, low-RAM mode (with the device's real original value preserved and restored, not overwritten to a hardcoded default), GMS and process priorities.
- **Basic/Advanced modes** — a simple aggressiveness picker (Low/Medium/High, each with a plain-language breakdown of what it actually does) for anyone who doesn't want to configure individual events by hand, and a full per-event editor with raw JSON access for anyone who does. Both read and write the exact same underlying configuration.
- **Event Journal & sane notifications** — every event transition and status change is recorded to a structured journal (viewable in the WebUI's "Historial" tab); only genuinely critical situations (Safe Mode engaging, a rejected unsafe configuration) ever reach an actual Android notification, instead of every routine status change interrupting the notification shade.
- **Profiles** — save and restore complete event configurations.
- **Safe mode** — stops every event immediately and holds off until explicitly resumed, reachable from the WebUI or `PowerSentinelctl safe`/`resume`.
- **WebUI** — native KernelSU WebUI using `kernelsu.exec()`, no local HTTP server.

## WebUI architecture

The WebUI lives in `webroot/`, which KernelSU loads directly inside the manager's WebView. The source is under `frontend/` and is built with Vite.

```text
KernelSU Manager
      ↓
   webroot/
      ↓
 frontend/src/api.js
      ↓
backend-ksu.js
      ↓
kernelsu.exec()
      ↓
PowerSentinelctl / PowerSentinel-writefile / Android commands
```

There is deliberately only one WebUI transport. PowerSentinel does **not** start `httpd`, does **not** expose port 8081, and does **not** ship CGI endpoints or WebUI session tokens.

KernelSU's documentation specifies `webroot/index.html` as the module WebUI entry point and exposes system APIs such as `exec()` to the page.

## Daemon architecture

`PowerSentineld` is split into focused pieces rather than one large script, each doing exactly one job:

```text
PowerSentineld (orchestrator, main loop, command handling)
      ↓
Event Manager (PowerSentinel-events.sh)
  - locks/tracks which events are currently active, resolves each
    event's own field values, re-asserts any still-active event's
    settings after another event ends
      ↓
Policy (PowerSentinel-policy.sh)  +  Detect (PowerSentinel-detect.sh)
  - pure decisions (night, thermal, adaptive pressure score) computed
    from pure reads (battery, CPU topology, load) - detection never
    decides anything, policy never touches the system directly
      ↓
Actions (PowerSentinel-actions.sh)
  - the only place that actually touches the system: apps, CPU cores,
    WiFi, Doze, GMS, process priorities, low-RAM mode
```

Two layers sit in front of every app-affecting action, evaluated in this order:

1. **Critical app protection** (`PowerSentinel-detect.sh`) — the device's default dialer/SMS/emergency apps and anything already exempt from battery optimization. Always wins, never configurable.
2. **Per-app policy** (`PowerSentinel-apppolicy.sh`) — a global 0-3 level per package (never / gentle only / follow the event / always aggressive) that can override what a specific event's own configuration asks for, for that one app.

A **Capability Manager** (`PowerSentinel-capabilities.sh`) probes once at startup what the device/ROM actually supports - core online/offline control, CPU governor control, which WiFi control method works, whether Doze can be forced, whether Google Mobile Services is even installed, whether `pm suspend` is supported - so actions can skip, with a clear log message, instead of blindly attempting something unsupported every single cycle.

A **State Manager** (`PowerSentinel-state.sh`) persists which events are currently active across daemon restarts and reboots, so a crash (or an unclean reboot) doesn't leave the daemon with no memory of what it previously applied - cores staying offline, apps staying suspended, or WiFi staying blocked indefinitely with nothing left to undo it. On every startup, the daemon reconciles back to a clean baseline before evaluating current conditions from scratch.

An **Event Journal** (`PowerSentinel-journal.sh`) records every event transition and status change as structured data (viewable in the WebUI's "Historial" tab), while an **Alert Bridge** (`PowerSentinel-alertbridge.sh`) is the only place that ever posts a real Android notification - and only for genuinely critical severity, not routine status.

## Installation

1. Download the latest release.
2. Install the ZIP through your KernelSU manager.
3. Reboot if requested by the manager.
4. Open PowerSentinel from the module's native **WebUI/Open** button.
5. Configure the module from the WebUI or from a root shell.

A default configuration is created automatically on first boot and lives at:

```text
/data/local/tmp/PowerSentinel/PowerSentinel.json
```

Any legacy `PowerSentinel.conf` (flat text, pre-v3.10.0) is migrated into this JSON file once, automatically, on the daemon's first start after updating - it is not read again afterward.

## Configuration

PowerSentinel supports the current v2 event-driven configuration format, stored as JSON. A minimal example:

```json
{
  "global": {
    "version": "2",
    "delay": "3",
    "log_file": "/sdcard/PowerSentinel.log",
    "log_level": "2"
  },
  "events": {
    "screen_off": {
      "handle_apps": "nice",
      "disable_cores": "cpu6 cpu7"
    },
    "low_power": {
      "doze": "light",
      "kill_wifi": "false"
    }
  }
}
```

Multiple events can be active at the same time. Configure overlapping policies carefully and keep essential applications protected.

The WebUI's Config tab offers two modes: **Básico**, the default for every fresh install, which exposes just an adaptive-savings switch and an aggressiveness level (Low/Medium/High); and **Avanzado**, which exposes the full per-event editor and a raw JSON view. Both modes read and write this exact same file - Basic mode is a simplified presentation layer, not a different underlying mechanism.

## How configuration changes take effect

Saving a change - from either mode of the WebUI, or by writing the JSON file directly - takes effect immediately. No reboot, and no manual restart of the daemon, is required.

Concretely: the WebUI's save path writes the new configuration and then runs `PowerSentinelctl reload`. On receiving that command, the daemon cleanly undoes whatever it currently has applied (so nothing from the old configuration is left half-applied), then re-executes itself in place (`exec`) - re-reading the new configuration from a clean start, with no gap where the daemon isn't running. This is different from the watchdog in `service.sh`, which only relaunches the daemon if it has actually crashed, and could take up to a minute to notice; a `reload` is immediate and self-triggered.

After a reload, the daemon's main loop evaluates real device conditions (battery level, screen state, temperature, etc.) against the new configuration on its very next cycle. If a condition your new configuration cares about isn't met yet - for example, the battery hasn't actually dropped to the level a given adaptive tier requires - nothing will visibly change until it is; that's the normal behavior of an event-driven system reacting to real conditions, not a sign that the reload didn't work. The WebUI's Estado tab, and Basic mode's own live status line, both reflect what's genuinely active right now rather than just what's configured.

## Command-line tools

Run these commands from a root shell:

```bash
PowerSentinelctl start <event>
PowerSentinelctl stop <event>
PowerSentinelctl reload
PowerSentinelctl pause
PowerSentinelctl resume
PowerSentinelctl safe
```

`PowerSentinelconf` provides an interactive wizard and direct configuration operations:

```bash
PowerSentinelconf
PowerSentinelconf show
PowerSentinelconf events
PowerSentinelconf set KEY VALUE --event screen_off
PowerSentinelconf app-policy set <package> <0-3>   # per-app override: 0=never touch, 1=gentle only, 2=follow event (default), 3=always aggressive
PowerSentinelconf flagged-apps list                # apps flagged for real, sustained background CPU use
```

If the WebUI is unavailable, these tools remain the supported recovery/configuration path.

## Development

The generated `webroot/` directory is the shipped WebUI output. Do not edit it manually.

```bash
cd frontend
npm ci
npm run build
```

The frontend depends on the `kernelsu` JavaScript package and expects to run inside a compatible KernelSU manager WebView. A normal desktop browser does not provide the root bridge.

## Security

The WebUI never sends configuration content to a local HTTP server. Configuration writes are base64-encoded and passed to `PowerSentinel-writefile`, which restricts write targets, performs atomic replacement, and keeps a backup.

See [`docs/security-audit.md`](docs/security-audit.md) for the current security model.

## Disclaimer

PowerSentinel modifies system behavior and requires root access. Aggressive settings can cause lag, missed notifications/alarms, application instability, or SystemUI problems. Use at your own risk and test changes incrementally.

## Credits

PowerSentinel retains historical attribution to the earlier PowerSentinel/Xtreme-Battery-Saver lineage and its original contributors. The project is released under GPLv3.
