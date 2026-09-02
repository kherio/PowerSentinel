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

A default configuration is stored at:

```text
/data/local/tmp/PowerSentinel/PowerSentinel.conf
```

## Configuration

PowerSentinel supports the current v2 event-driven configuration format. A minimal example:

```bash
version=2
delay=3
log_file=/sdcard/PowerSentinel.log
log_level=2

screen_off={
  handle_apps=nice
  disable_cores=cpu6 cpu7
}

low_power={
  doze=light
  kill_wifi=false
}
```

Multiple events can be active at the same time. Configure overlapping policies carefully and keep essential applications protected.

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
