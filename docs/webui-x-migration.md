# Migrating to a native KernelSU WebUI-X `webroot/`

## Why

The module shipped its WebUI as a local `httpd` server (`action.sh` launched
`httpd -p 127.0.0.1:8081`) serving CGI scripts (`webui/cgi-bin/*.cgi`) that
`cat`/`echo`'d files on disk. This worked, but had real costs:

- **An extra long-running root process** (`httpd`) per WebUI session, only
  cleaned up if the user closed it correctly (or the "already running" guard
  we added earlier kicked in).
- **CGI scripts as the API surface**: every read/write was a shell script
  invoked per-request, with all the quoting/escaping hazards that implies
  (see `docs/security-audit.md` for what that actually cost us in
  `XtremeBSd`'s `notif()`).
- **Three separate HTML documents** (`/`, `/conf`, `/log`) with duplicated
  boilerplate, full page reloads on navigation, and no shared build tooling.
- A dependency on `httpd` and a hardcoded port (8081) being free.

KernelSU (and compatible managers - KernelSU Next, WebUI-X, SukiSU Ultra,
etc.) support a `webroot/` directory that the manager's own WebView loads
directly, with a JS bridge (the `kernelsu` npm package) exposing `exec()`,
`toast()`, `moduleInfo()`, and a few other calls, all executed via a root
shell. No local server, no port, no CGI process per request - the WebView
*is* the runtime, and `exec()` *is* the API.

## What changed

- `webui/` and `action.sh` are gone.
- `frontend/` is the new source: a small Vite project (vanilla JS, no
  framework) that builds to `webroot/`.
- The three former pages are now three `<section class="view">` blocks in
  one `index.html`, shown/hidden by `main.js` - a real SPA, so tab
  switching (including the swipe gesture) is an in-memory view swap, not a
  page navigation. This also means the "unsaved changes" guard on Config no
  longer depends on the browser's `beforeunload` (which plenty of Android
  WebViews never surface anyway) - it's a synchronous JS `confirm()` in
  `main.js`'s `confirmLeave()`, called directly before the view swap
  happens.
- `src/api.js` replaces the five CGI scripts with five functions
  (`readStatus`, `readConfig`, `writeConfig`, `readLog`, `exportLog`), each
  a single `exec()` call (or two, for `writeConfig`'s save-then-reload).
  Same on-disk paths as before (`XtremeBS.conf`, `.status`, `.log`) - only
  the transport changed.
- Config writes go through the new `XBS-writefile` helper instead of a raw
  shell redirect - see `docs/security-audit.md` for why.

## Trade-offs worth knowing about

- **Requires a WebUI-X-capable manager.** Plain old KernelSU (pre-WebUI-X)
  or a manager without WebView support can't open `webroot/` at all. This
  is the risk we discussed before starting: an earlier session had moved
  *away* from a WebUI-X-based fork specifically because of a bug attributed
  to that panel. If the same class of issue resurfaces here, the fallback
  is `XBSconf` from a terminal - it never depended on either web
  interface.
- **No more arbitrary browser access.** The old httpd approach meant you
  could open `http://127.0.0.1:8081` from any browser on the device. The
  native `webroot/` only opens from inside the manager app's WebView. For
  this module (single-user, on-device config) that's a fine trade, but
  it's a capability we're deliberately giving up.
- **Build step required.** `webroot/` is generated, not hand-written -
  changing the UI now means editing `frontend/src/*` and running
  `npm run build` (documented in the README's "WebUI development"
  section), rather than editing HTML directly.
