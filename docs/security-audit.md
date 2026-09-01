# Security audit — XtremeBS scripts

Scope: `system/bin/XtremeBSd`, `system/bin/XBSctl`, `system/bin/XBSconf`,
and the new `system/bin/XBS-writefile` + `frontend/src/api.js`. Everything
here runs as root (the daemon directly; the CLI tools and the WebUI's
`exec()` calls via `su`), so the threat model is: **what can an
unprivileged app on the same device do to influence what root executes?**

## Findings

### 1. Command injection in `XtremeBSd`'s `notif()` — Critical — Fixed

```sh
# before
notif() {
  if [ "$(getconf notify true)" = "true" ]; then
    su -lp 2000 -c "cmd notification post -S bigtext -t 'XtremeBS' 'STATUS' \"$1\"" >/dev/null
  fi
}
```

`$1` is interpolated into a string that `su -c` hands to a **new shell to
parse and execute** - not just to display. Any shell metacharacters in
`$1` are executed, not shown.

Most callers pass a static string (`notif "Config Loaded"`, etc.) - safe.
One does not: `handle_event()` builds `notif "Active Events: $active_notif"`
from `$active_events[]`, which includes event names that can come directly
from the **control file** (`$cmd_event`, extracted from whatever was last
written to `ctl_file` via `handle_event "$cmd_event" 1`). Combined with
finding #2 below (the control file historically lived somewhere any app
could write to), this was a real, remotely-triggerable path to command
execution as UID 2000 (system) - not merely a theoretical one.

**Fix applied**: the message is base64-encoded before being placed in the
`su -c` string, and decoded inside the invoked shell (`system/bin/XtremeBSd`,
`notif()`). Base64's alphabet contains no shell metacharacters, so no
content can break out of the quoting regardless of what the original
message contains. Same technique used for `XBS-writefile`'s config writes
(finding is structurally identical: untrusted content that must reach a
shell command safely).

### 2. Insecure/racy `ctl_file` location — High — Fixed

`ctl_file` defaulted to `/data/local/tmp/xbs` - directly inside
`/data/local/tmp`, which is world-writable (`drwxrwxrwt`, mode 1777) on
Android. The sticky bit stops other users from deleting/renaming files
they don't own, but **not** from creating a new file first. Any
unprivileged app can pre-create `/data/local/tmp/xbs` before the daemon
ever runs (e.g. immediately after boot, racing the daemon's own startup),
keeping ownership and permissions of its choosing - including
world-writable - indefinitely. From then on, every `cat "$ctl_file"` the
daemon does reads attacker-controlled content, feeding directly into
`handle_event "$cmd_event" 1` and finding #1 above.

**Fix applied**:
- Default `ctl_file` moved to `/data/local/tmp/XtremeBS/xbs` (inside the
  module's own data directory, created by the daemon with normal root
  ownership - not the world-writable `/data/local/tmp` root) in both
  `XtremeBSd` and `XBSctl`.
- A new `ensure_ctl_file()` helper (duplicated in both scripts, since they
  don't share a library) checks the file's owner via `stat -c '%u'` before
  trusting it; if it exists and isn't owned by root (uid 0), it's deleted
  and recreated. The file is `chmod 600`'d either way. This is defense in
  depth for anyone who overrides `ctl_file` back into a shared directory
  via config.

This does not eliminate every theoretical race (a sufficiently
well-timed attacker could still win a single boot-time window before
`ensure_ctl_file` runs), but it removes the *persistent* compromise: once
`ensure_ctl_file` has run once with the file root-owned and `600`, no
unprivileged app can write to it again.

### 3. Package names used as unescaped regex — Low — Fixed

```sh
# before
if grep -q -E "$app" "$allowlist"; then
```

(`system/bin/XtremeBSd`, both `enable_pwr_save()` and `disable_pwr_save()`)

`$app` comes from `pm list packages` output or the denylist file, and was
used as an **extended regex** against the allowlist, not a literal
string. Dots match any character in a regex, so a package whose name
happened to be a "near miss" of an allowlist entry (differing only where
the allowlist has a literal dot) could match when it shouldn't, or an
unrelated package could match via substring. Impact was a wrong
suspend/allow decision for a single app, not code execution.

**Fix applied**: `grep -Fxq -- "$app" "$allowlist"` - fixed string (`-F`,
no regex interpretation) and whole-line (`-x`, no partial/substring
match). Verified with a standalone repro: with the old `-E`, the pattern
`com.example.app` falsely matched an allowlist line `comXexampleXapp`
(the dots acted as wildcards); with `-Fxq` it correctly does not match.
This does mean the allowlist no longer supports partial/regex matching
if anyone was relying on that (undocumented) behavior - exact package
names only, matching how the WebUI's app picker already writes it.

### 4. Unquoted word-splitting in app/process loops — Low — Fixed

```sh
# before
for app in $(pm list packages -3 | cut -d: -f2- && [ -s "$denylist" ] && cat "$denylist"); do
```
```sh
# before
pid="$(pgrep $proc)"
```

Both loops iterated over unquoted command substitutions, so both word
splitting and pathname (glob) expansion applied to each line. A
`denylist`/`proc_file` line containing a shell glob character (e.g. `*`)
could expand against filenames in the daemon's working directory instead
of being treated as a literal package/process name.

**Fix applied**: both `for app in $(...)` loops (`enable_pwr_save()` and
`disable_pwr_save()`) are now `while IFS= read -r app; do ... done < <(...)`,
and both `pgrep $proc` calls are now `pgrep "$proc"`, with `read -r` used
throughout. Verified with a standalone repro: with the old unquoted
`for`, a denylist containing a `*` line expanded to every filename in the
test directory (`allowlist`, `denylist_glob`, unrelated files); with the
`while read` version it's preserved as the literal string `*`.

### 5. `frontend/`'s dev-only dependency (esbuild) — Moderate, dev-only — Not applicable to shipped code

`npm audit` flags `esbuild <=0.24.2` (pulled in by `vite@5.x`):
`GHSA-67mh-4wv8-2f99` - the **Vite dev server** (`npm run dev`) accepts
requests from any origin and can leak source contents. This only affects
running `vite`'s dev server locally during development; it has no bearing
on the built `webroot/` output that actually ships in the module (static
files, no dev server involved). Noted here so it isn't mistaken for a
runtime finding; not fixed because the available fix (`vite@8`) is a
breaking major-version jump untested against this project.

## What `XBS-writefile` and `frontend/src/api.js` do differently by design

These are new in this release, built with the above findings already in
mind rather than audited after the fact:

- **Content never touches a shell command line as raw text.** The config
  editor accepts arbitrary text (including quotes, backticks, `$(...)`,
  newlines); `writeConfig()` base64-encodes it client-side and
  `XBS-writefile` decodes it server-side. The only thing interpolated into
  a shell command is the base64 string itself, whose alphabet
  (`A-Za-z0-9+/=`) contains no shell metacharacters.
- **Path allowlisting.** `XBS-writefile` only accepts targets under
  `/data/local/tmp/XtremeBS/`, rejects any path containing `..`, and
  refuses to write through a symlink (`-L` check) - even though today's
  only caller (`api.js`) only ever asks it to write `XtremeBS.conf`, this
  means a bug in a future caller can't turn into an arbitrary-file-write.
- **Atomic writes.** Write to `*.tmp.$$`, then `mv` into place, so a crash
  or killed WebView mid-write can't leave `XtremeBS.conf` truncated or
  half-written for the daemon to read next.
- **Automatic backup.** One `.bak` of the previous content is kept before
  every write, matching what `XBSconf` already did.

## Not in scope

`XBSconf` was reviewed and found clean (uses `awk -v` for all
variable-into-pattern cases, no `eval`/`sh -c`/`su -c` with interpolated
untrusted content) - no findings there.

## Addendum: the Magisk httpd/CGI backend's threat model

Magisk has no native WebUI-X support, so `backend-cgi.js` +
`webui/cgi-bin/*.cgi` (revived from the pre-v3.0.0 architecture) exist
specifically for it. This reintroduces the exact attack surface
`docs/webui-x-migration.md` originally moved away from: **on Android, a
loopback socket (`127.0.0.1`) is reachable by any app on the device that
merely holds the `INTERNET` permission** - one of the most common,
least-scrutinized permissions there is. This is fundamentally different
from the KernelSU `exec()` bridge, which only the manager app itself
(already holding actual root-grant privileges) can invoke.

**Mitigation**: every CGI endpoint requires a per-session token
(`webui/cgi-bin/cgi-common.sh`'s `require_token()`), generated fresh by
`action.sh` each time it starts httpd and opens the browser:

- The token is never served as a static file from `DOCUMENT_ROOT` - it's
  written to `/data/local/tmp/XtremeBS/.token` (mode 600, root-owned,
  outside the served directory) and only ever appears in the URL
  `action.sh` opens (`?token=...`), read from `location.search` by
  `backend-cgi.js` and attached to every subsequent request.
- A fresh, unpredictable token (`/proc/sys/kernel/random/uuid`) is
  generated on every `action.sh` run, invalidating any previously-open
  session - verified with a standalone test that two consecutive runs
  produce different tokens.
- `require_token()` was verified against all four cases: correct token
  (passes), wrong token, no token at all, and no active session (`.token`
  missing) - the latter three all fail closed with the same generic
  error, not distinguishing *why* a request was rejected.
- Only `webroot/` and `webui/cgi-bin/` are ever exposed via httpd -
  `action.sh` builds a dedicated serving directory
  (`/data/local/tmp/XtremeBS/.serve/`) containing just symlinks to
  those two, rather than pointing httpd at the module's own directory
  (which also holds the daemon binary, `module.prop`, etc.).
- `applist_read.cgi` independently re-implements `XBS-writefile`'s path
  allowlist (must be under `/data/local/tmp/XtremeBS/`, no `..`, not a
  symlink) for *reads*, since reads don't go through `XBS-writefile` at
  all - without this, a valid token would otherwise make this endpoint
  an arbitrary-file-read oracle (any root-readable file on the device,
  not just XtremeBS's own data).
- `event.cgi`, `profile_*.cgi` re-validate event/profile names
  server-side (`sanitize_name()`, same `[a-zA-Z0-9_-]` charset the
  frontend already enforces) rather than trusting the client - the
  token proves the *request* is legitimate, not that its *parameters*
  are safe to use unchecked.

**Residual risk, stated plainly**: this is still a materially larger
attack surface than the KernelSU path. A malicious app that can read
another app's *currently displayed URL* (which requires either an
accessibility-service grant or a compromised WebView/browser - not a
default capability) could in principle capture a live token during the
brief window the WebUI is open. This is a meaningfully higher bar than
"any app with INTERNET permission," but it is not zero. Users who want
the KernelSU-level security posture should prefer a WebUI-X-capable
manager; the Magisk path is offered as a real, hardened option, not
represented as risk-equivalent to the native one.
