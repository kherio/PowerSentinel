# PowerSentinel

**PowerSentinel** is a rooted Android battery-optimization module built around event-driven power policies. It can manage CPU cores, apps, WiFi, Doze, GMS/process priorities, logging, profiles, and safety controls.

## Requirements

- Rooted Android device with KernelSU.
- A KernelSU/WebUI-X-capable manager for the graphical WebUI.
- The module can also be operated entirely from a root shell with `PowerSentinelctl` and `PowerSentinelconf`.

> **Important:** PowerSentinel is intentionally **KernelSU-only for its WebUI**. The legacy Magisk `httpd`/CGI compatibility layer was removed in v3.8.0. There is no local HTTP server or browser fallback.

## Features

- **App management** — kill, suspend, or reprioritize applications with allow/deny lists.
- **CPU optimization** — powersave governors and optional core disabling.
- **System controls** — Doze, WiFi, low-RAM mode, GMS and process priorities.
- **Event-driven control** — boot, charging, screen-off, low-power, manual and custom events.
- **Profiles** — save and restore complete event configurations.
- **WebUI** — native KernelSU WebUI using `kernelsu.exec()`.
- **Safety** — safe mode, sanity checks, atomic configuration writes and backups.

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
