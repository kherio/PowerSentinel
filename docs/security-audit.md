# Security audit — PowerSentinel

PowerSentinel's WebUI now uses the native KernelSU JavaScript bridge exclusively. The legacy Magisk `httpd`/CGI transport has been removed.

## Runtime trust boundary

The WebUI is loaded by a KernelSU/WebUI-X-capable manager from the module's `webroot/`. The frontend uses the `kernelsu` npm package's `exec()` API to run the small set of required root commands. KernelSU documents that `webroot/` is the native module WebUI location and that `exec()` executes commands through the manager-provided system API. citeturn0search1turn0search3

There is deliberately no module-owned HTTP listener, no loopback port, no CGI endpoint, and no browser session token.

## Findings retained from the daemon audit

### 1. Notification command injection — Fixed

`PowerSentineld` previously interpolated notification text into a `su -c` command. The message is now encoded before crossing the shell boundary, so event-controlled text cannot break the command syntax.

### 2. Insecure/racy control-file location — Fixed

The default control file was moved from world-writable `/data/local/tmp` into `/data/local/tmp/PowerSentinel/powersentinel`. Both `PowerSentineld` and `PowerSentinelctl` verify ownership and enforce restrictive permissions before trusting the file.

### 3. Package-name regex matching — Fixed

Allowlist matching uses fixed-string, whole-line matching (`grep -Fxq`) rather than extended regular expressions.

### 4. Unquoted app/process loops — Fixed

App and process lists are consumed with `read -r`/quoted arguments instead of unquoted command substitutions, preventing pathname expansion and word splitting.

### 5. WebUI write path — Hardened

`PowerSentinel-writefile` remains the only WebUI write helper. The frontend base64-encodes user content before passing it to the helper. The helper restricts writes to PowerSentinel's data directory, rejects traversal/symlink targets, performs atomic replacement, and keeps a backup.

## Legacy HTTP/CGI removal

The following attack surface has been intentionally removed:

- `action.sh` HTTP launcher
- `frontend/src/backend-cgi.js`
- `webui/httpd.conf`
- `webui/cgi-bin/*.cgi`
- `.token` session files
- `.serve` HTTP document-root staging
- port `127.0.0.1:8081`
- runtime backend detection/fallback

This means PowerSentinel no longer exposes a root-owned HTTP service for its WebUI. The frontend has a single transport: `backend-ksu.js` → `kernelsu.exec()`.

## Development dependency

The Vite development server is not part of the shipped module. `webroot/` contains the generated static frontend. Development-time dependency advisories therefore do not create a runtime HTTP attack surface on the device.

## Operational note

The native WebUI requires a KernelSU/WebUI-X-capable manager. Users without that environment can still operate the module through `PowerSentinelctl` and `PowerSentinelconf`, but there is intentionally no browser/HTTP fallback.
