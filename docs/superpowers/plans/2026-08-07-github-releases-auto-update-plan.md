# GitHub Releases distribution + launcher self-update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish every launcher build (win/linux/mac) to one unified GitHub Release per version, and give the launcher app real self-update capability on Windows/Linux (GitHub primary, own web server as fallback) with a manual-download notice on macOS.

**Architecture:** Win/linux build locally on the game server (unchanged — needs wine+makensis) via a new `tools/release-launcher.sh`, which tags `v<version>`, pushes it (triggering the existing mac GitHub Actions workflow retargeted to the same tag scheme), and publishes win/linux assets to that release. The launcher app gains an `electron-updater`-based self-update path for win/linux and a lightweight GitHub-API version check for mac, wired through the existing IPC (main → preload → renderer) pattern already used for game updates — kept as a clearly separate concern from the existing game-update flow.

**Tech Stack:** Electron 32, electron-builder ^24, electron-updater (new dependency, ^6), Node 20, `gh` CLI, GitHub Actions (existing `mac-build.yml`), bash.

## Global Constraints

- One release tag scheme: `v<version>` (from `electron/package.json`), replacing the old mac-only `mac-v*` scheme. No task should reintroduce `mac-v*`.
- GitHub repo for releases/updates: `DarrellBest/Launcher` (owner `DarrellBest`, repo `Launcher`).
- No Apple Developer ID — macOS never self-installs; it only notifies + links to the release page. Do not add mac auto-install logic.
- Windows must build the `nsis` target, not `portable` — required for `electron-updater` to self-install.
- Update-check fallback URL if GitHub is unreachable: `http://play.darrellbest.com:17080/files` (generic `electron-updater` provider), which mirrors `latest.yml` / `latest-linux.yml` + installers.
- The launcher app's self-update is a **separate concern** from the existing game (client/server jar) update flow already in `main.js`/`app.js` — do not merge their state variables, IPC channels, or UI elements.
- This codebase has no automated test framework (no jest/mocha in `package.json`). "Test" steps below are manual verification (run the command/app, inspect real output) — that's the established pattern here (see `mage-modern`'s `tools/full-deploy.sh` stage 3-5 "verify" style).

---

### Task 1: Build config — electron-updater dependency, NSIS target, publish config

**Files:**
- Modify: `electron/package.json`

**Interfaces:**
- Produces: `electron-updater` available as a dependency for Task 2. `npm run dist:win` now emits an NSIS installer (`XMageLauncher-<ver>-Setup.exe`) instead of a portable exe. `npm run dist:win`/`dist:linux` now also emit `dist/latest.yml` / `dist/latest-linux.yml` (electron-builder's update manifests, generated because `build.publish` is configured, even with `--publish never`).

- [ ] **Step 1: Add the electron-updater dependency**

```bash
cd /home/user/projects/Launcher/electron
npm install electron-updater@^6 --save
```

- [ ] **Step 2: Verify it installed**

Run: `grep '"electron-updater"' package.json package-lock.json | head -5`
Expected: a `"electron-updater": "^6.x.x"` line in `package.json`'s `dependencies`, and matching entries in `package-lock.json`.

- [ ] **Step 3: Switch the Windows target from portable to NSIS, add publish config**

In `electron/package.json`, replace:

```json
    "win": {
      "target": [
        "portable"
      ],
      "signAndEditExecutable": false,
      "artifactName": "XMageLauncher-${version}.${ext}"
    },
    "mac": {
      "target": [
        "dmg"
      ],
      "category": "public.app-category.games",
      "artifactName": "XMageLauncher-${version}.${ext}"
    }
  }
}
```

with:

```json
    "win": {
      "target": [
        "nsis"
      ],
      "signAndEditExecutable": false,
      "artifactName": "XMageLauncher-${version}-Setup.${ext}"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    },
    "mac": {
      "target": [
        "dmg"
      ],
      "category": "public.app-category.games",
      "artifactName": "XMageLauncher-${version}.${ext}"
    },
    "publish": {
      "provider": "github",
      "owner": "DarrellBest",
      "repo": "Launcher"
    }
  }
}
```

- [ ] **Step 4: Update the dist scripts to skip auto-publish (we publish via `gh` CLI ourselves)**

Replace:

```json
    "dist:linux": "electron-builder --linux AppImage",
    "dist:win": "electron-builder --win portable",
    "dist:mac": "electron-builder --mac dmg --universal"
```

with:

```json
    "dist:linux": "electron-builder --linux AppImage --publish never",
    "dist:win": "electron-builder --win nsis --publish never",
    "dist:mac": "electron-builder --mac dmg --universal --publish never"
```

- [ ] **Step 5: Verify — build the Linux target locally and check outputs**

Run (from `electron/`): `npm run dist:linux`
Expected: succeeds, and `ls dist/` shows `XMageLauncher-1.2.1.AppImage` and `latest-linux.yml`.

- [ ] **Step 6: Verify — build the Windows target locally (this box has wine + makensis)**

Run (from `electron/`): `npm run dist:win`
Expected: succeeds, and `ls dist/` shows `XMageLauncher-1.2.1-Setup.exe` and `latest.yml`.

- [ ] **Step 7: Commit**

```bash
cd /home/user/projects/Launcher
git add electron/package.json electron/package-lock.json
git commit -m "launcher: add electron-updater, switch win target to nsis, configure GitHub publish"
```

---

### Task 2: Main process — self-update logic (mac notify-only, win/linux electron-updater + fallback)

**Files:**
- Modify: `electron/main.js`

**Interfaces:**
- Consumes: `autoUpdater` from `electron-updater` (Task 1's dependency).
- Produces: `checkLauncherUpdate()` (called from a new IPC handler). Sends renderer IPC channel `launcher:update` with payloads `{ state: 'downloading', version }`, `{ state: 'ready', version }`, or `{ state: 'available-manual', version, url }`. New IPC handlers: `launcher:checkUpdate`, `launcher:installUpdate`.

- [ ] **Step 1: Add the electron-updater require**

In `electron/main.js`, replace:

```js
const tar = require('tar');
const extractZip = require('extract-zip');
```

with:

```js
const tar = require('tar');
const extractZip = require('extract-zip');
const { autoUpdater } = require('electron-updater');
```

- [ ] **Step 2: Add GitHub/update constants next to `CONFIG_URL`**

Replace:

```js
const CONFIG_URL = process.env.XMAGE_CONFIG || 'http://play.darrellbest.com:17080/config.json';
```

with:

```js
const CONFIG_URL = process.env.XMAGE_CONFIG || 'http://play.darrellbest.com:17080/config.json';
const GITHUB_OWNER = 'DarrellBest';
const GITHUB_REPO = 'Launcher';
const UPDATE_FALLBACK_URL = 'http://play.darrellbest.com:17080/files';
```

- [ ] **Step 3: Let `httpGet` pass custom headers (needed for the GitHub API's User-Agent requirement)**

Replace:

```js
function httpGet(url) {
  return new Promise((resolve, reject) => {
    (url.startsWith('https') ? https : http).get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(httpGet(res.headers.location)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = ''; res.on('data', (c) => data += c); res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
```

with:

```js
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const opts = headers ? { headers } : undefined;
    (url.startsWith('https') ? https : http).get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(httpGet(res.headers.location, headers)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = ''; res.on('data', (c) => data += c); res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
```

This is backward-compatible — every existing call site (`httpGet(CONFIG_URL)`) omits the second argument, which stays `undefined` and behaves exactly as before.

- [ ] **Step 4: Add the launcher self-update section**

Insert this new section right before the `// ---- IPC ----` comment (i.e., right after the `install()` function and before `// ---- launch ----`... check the actual file: it should go right before the line `// ---- IPC ----`):

```js
// ---- launcher self-update ----
// The GAME (client/server jars) updates via ensureXMage/config.json above; this
// section is a separate concern — keeping the launcher APP ITSELF current, via
// GitHub Releases.
function versionGt(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// macOS: no self-install (ad-hoc signing fails Squirrel.Mac's signature check) — just
// tell the user a newer build exists and let them grab it from the release page.
async function checkMacUpdate() {
  try {
    const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest';
    const data = JSON.parse(await httpGet(url, { 'User-Agent': 'xmage-launcher' }));
    const latest = String(data.tag_name || '').replace(/^v/, '');
    if (latest && versionGt(latest, app.getVersion())) {
      log('sys', 'Launcher update available: v' + latest);
      send('launcher:update', { state: 'available-manual', version: latest, url: data.html_url });
    }
  } catch (e) {
    log('sys', 'Launcher update check failed: ' + (e.message || e));
  }
}

let updaterWired = false, usedFallbackFeed = false;
function wireAutoUpdater() {
  if (updaterWired) return; updaterWired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', (info) => {
    log('sys', 'Launcher update available: v' + info.version + ' — downloading…');
    send('launcher:update', { state: 'downloading', version: info.version });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log('ok2', 'Launcher update v' + info.version + ' ready — restart to install.');
    send('launcher:update', { state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    log('sys', 'Launcher update check failed: ' + (err && err.message || err));
  });
}

// Windows + Linux: real self-install via electron-updater, GitHub primary / own web
// server as fallback if GitHub can't be reached.
async function checkWinLinuxUpdate() {
  wireAutoUpdater();
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    if (usedFallbackFeed) { log('sys', 'Launcher update check failed (fallback unreachable too): ' + (e.message || e)); return; }
    usedFallbackFeed = true;
    log('sys', 'GitHub unreachable for launcher updates — falling back to ' + UPDATE_FALLBACK_URL);
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FALLBACK_URL });
    try { await autoUpdater.checkForUpdates(); } catch (e2) { log('sys', 'Launcher update check failed: ' + (e2.message || e2)); }
  }
}

function checkLauncherUpdate() {
  if (!app.isPackaged) { log('sys', 'Launcher update check skipped (dev mode).'); return; }
  return PLAT === 'darwin' ? checkMacUpdate() : checkWinLinuxUpdate();
}
```

- [ ] **Step 5: Add the two new IPC handlers**

Replace:

```js
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('win:min', () => win.minimize());

app.whenReady().then(createWindow);
```

with:

```js
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('win:min', () => win.minimize());
ipcMain.handle('launcher:checkUpdate', () => checkLauncherUpdate());
ipcMain.handle('launcher:installUpdate', () => { if (PLAT !== 'darwin') autoUpdater.quitAndInstall(); });

app.whenReady().then(createWindow);
```

- [ ] **Step 6: Verify — the app still starts cleanly in dev mode**

Run (from `electron/`): `npm start`
Expected: the launcher window opens normally (same as before this task), and the console/terminal panel inside it logs `Launcher update check skipped (dev mode).` (confirms the `app.isPackaged` guard works and nothing throws). Close the app when done.

- [ ] **Step 7: Commit**

```bash
cd /home/user/projects/Launcher
git add electron/main.js
git commit -m "launcher: add self-update logic (electron-updater win/linux, GitHub API check mac)"
```

---

### Task 3: Preload + renderer — expose IPC, add the update-available UI

**Files:**
- Modify: `electron/preload.js`
- Modify: `electron/renderer/index.html`
- Modify: `electron/renderer/app.js`

**Interfaces:**
- Consumes: IPC channels/handlers from Task 2 (`launcher:checkUpdate`, `launcher:installUpdate`, `launcher:update` event).
- Produces: `window.xmage.checkLauncherUpdate()`, `window.xmage.installLauncherUpdate()`, `window.xmage.onLauncherUpdate(cb)` — available to renderer code.

- [ ] **Step 1: Expose the new IPC calls in preload.js**

Replace:

```js
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  winClose: () => ipcRenderer.invoke('win:close'),
  winMin: () => ipcRenderer.invoke('win:min'),
  onConsole: (cb) => ipcRenderer.on('console:line', (_e, p) => cb(p)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
  onPhase: (cb) => ipcRenderer.on('phase', (_e, p) => cb(p)),
  onProcState: (cb) => ipcRenderer.on('proc:state', (_e, p) => cb(p)),
});
```

with:

```js
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  winClose: () => ipcRenderer.invoke('win:close'),
  winMin: () => ipcRenderer.invoke('win:min'),
  checkLauncherUpdate: () => ipcRenderer.invoke('launcher:checkUpdate'),
  installLauncherUpdate: () => ipcRenderer.invoke('launcher:installUpdate'),
  onConsole: (cb) => ipcRenderer.on('console:line', (_e, p) => cb(p)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
  onPhase: (cb) => ipcRenderer.on('phase', (_e, p) => cb(p)),
  onProcState: (cb) => ipcRenderer.on('proc:state', (_e, p) => cb(p)),
  onLauncherUpdate: (cb) => ipcRenderer.on('launcher:update', (_e, p) => cb(p)),
});
```

- [ ] **Step 2: Add the update pill to index.html**

Replace:

```html
        <div class="meta">
          <span class="pill"><span id="srvdot" class="dot"></span> <span id="srvtxt">play.darrellbest.com</span></span>
          <span class="pill">build <b id="ver">—</b></span>
        </div>
```

with:

```html
        <div class="meta">
          <span class="pill"><span id="srvdot" class="dot"></span> <span id="srvtxt">play.darrellbest.com</span></span>
          <span class="pill">build <b id="ver">—</b></span>
          <span class="pill" id="launcherUpdatePill" style="display:none">launcher <span class="badge new" id="launcherUpdateBadge">Update</span></span>
        </div>
```

(The `.badge.new` class already exists in the stylesheet — a gold, clickable badge — currently unused since commit `68c69fa` removed the old status badge in favor of the hero button. This reuses that existing style for a distinct purpose: the launcher app's own version, not the game's.)

- [ ] **Step 3: Register the listener and trigger the check in app.js**

Replace:

```js
// Track the running client so the play button stays disabled until it exits.
window.xmage.onProcState((p) => {
  if (p.kind !== 'client') return;
  CLIENT_RUNNING = p.running;
  refreshPlayButton();
});

// ---- client settings modal ----
```

with:

```js
// Track the running client so the play button stays disabled until it exits.
window.xmage.onProcState((p) => {
  if (p.kind !== 'client') return;
  CLIENT_RUNNING = p.running;
  refreshPlayButton();
});

// ---- launcher self-update (the launcher APP, not the game) ----
window.xmage.onLauncherUpdate((p) => {
  const pill = $('launcherUpdatePill'), badge = $('launcherUpdateBadge');
  if (p.state === 'downloading') return; // logged to console already; nothing actionable yet
  if (p.state === 'ready') {
    pill.style.display = '';
    badge.textContent = 'Restart to update';
    badge.onclick = () => window.xmage.installLauncherUpdate();
  } else if (p.state === 'available-manual') {
    pill.style.display = '';
    badge.textContent = 'v' + p.version + ' available';
    badge.onclick = () => window.xmage.openUrl(p.url);
  }
});

// ---- client settings modal ----
```

- [ ] **Step 4: Trigger the check during boot()**

Replace:

```js
  log('sys', 'Launcher ready. Install root: ' + info.installRoot);
  log('sys', 'Reading config from ' + info.configUrl);
```

with:

```js
  log('sys', 'Launcher ready. Install root: ' + info.installRoot);
  window.xmage.checkLauncherUpdate(); // fire-and-forget; UI updates via onLauncherUpdate
  log('sys', 'Reading config from ' + info.configUrl);
```

- [ ] **Step 5: Verify — run the app in dev mode**

Run (from `electron/`): `npm start`
Expected: window opens, no console errors (open devtools with the usual Electron shortcut or check the terminal launching `npm start` for stack traces), and the update pill stays hidden (dev mode skips the check per Task 2 Step 6's guard, so `onLauncherUpdate` never fires — this just confirms nothing broke by adding the dead code path). Close the app when done.

- [ ] **Step 6: Commit**

```bash
cd /home/user/projects/Launcher
git add electron/preload.js electron/renderer/index.html electron/renderer/app.js
git commit -m "launcher: wire self-update IPC + update-available UI pill"
```

---

### Task 4: Retarget the mac workflow to the unified tag scheme

**Files:**
- Modify: `.github/workflows/mac-build.yml`

**Interfaces:**
- Produces: the workflow now triggers on `v*` tag pushes (matching `tools/release-launcher.sh` from Task 5) instead of `mac-v*`.

- [ ] **Step 1: Update the trigger**

Replace:

```yaml
on:
  push:
    tags: ['mac-v*']
  workflow_dispatch: {}
```

with:

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
```

- [ ] **Step 2: Update the explanatory comment at the top of the file**

Replace:

```yaml
# The dev boxes are Linux — electron-builder can only produce mac targets on macOS,
# so this runs on a GitHub-hosted mac runner. Trigger by pushing a tag like
# "mac-v1.2.1" (publishes a release with the dmg) or manually via workflow_dispatch.
```

with:

```yaml
# The dev boxes are Linux — electron-builder can only produce mac targets on macOS,
# so this runs on a GitHub-hosted mac runner. Triggered by the same "v<version>" tag
# push that tools/release-launcher.sh uses for win/linux — this job just adds the mac
# dmg to that same release. Can also run manually via workflow_dispatch.
```

- [ ] **Step 3: Verify — YAML is well-formed**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/mac-build.yml'))" && echo OK`
Expected: `OK` (no parse errors). Full functional verification (does it actually trigger and build) happens in Task 8, when a real tag gets pushed.

- [ ] **Step 4: Commit**

```bash
cd /home/user/projects/Launcher
git add .github/workflows/mac-build.yml
git commit -m "ci: retarget mac-build.yml from mac-v* to the unified v* tag scheme"
```

---

### Task 5: `tools/release-launcher.sh` — the win/linux build-and-publish script

**Files:**
- Create: `tools/release-launcher.sh`

**Interfaces:**
- Consumes: `electron/package.json`'s `version` field, the `dist:win`/`dist:linux` npm scripts (Task 1), `gh` CLI (already authenticated on this box), `git` remote `origin`.
- Produces: a script that, when run, builds+ships win/linux installers and publishes/updates the `v<version>` GitHub Release. Exercised for real in Task 8.

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
#
# release-launcher.sh — build the Windows + Linux launcher installers locally and
# publish them, together with the mac dmg, to one GitHub Release.
#
#   ./tools/release-launcher.sh
#
# Must run on a box with wine + makensis (NSIS installer needs both to cross-build on
# Linux) — that's the game server, 192.168.1.87, where this normally runs.
#
# What it does:
#   1. npm install + build the win (nsis) and linux (AppImage) installers, plus the
#      electron-updater manifests (latest.yml, latest-linux.yml) electron-builder
#      generates alongside them.
#   2. Copy installers + manifests to the web server's download dir (also serves as
#      the electron-updater fallback feed if GitHub is unreachable).
#   3. Tag the repo v<version> (read from electron/package.json) and push it — this
#      also triggers mac-build.yml on GitHub Actions, which adds the mac dmg to the
#      same release.
#   4. Publish (or update, if the mac job got there first) the GitHub Release with
#      the win/linux assets.
#
set -euo pipefail

cd "$(dirname "$0")/.."                        # repo root
WEBDIR=/var/www/html/files

cd electron
VER=$(node -p "require('./package.json').version")
TAG="v${VER}"
echo ">> building launcher ${TAG} (win nsis + linux AppImage)"
npm install
npx electron-builder --win nsis --x64 --publish never
npx electron-builder --linux AppImage --x64 --publish never

echo ">> staging installers + update manifests to ${WEBDIR}"
cp -f dist/XMageLauncher-*-Setup.exe dist/XMageLauncher-*.AppImage dist/latest.yml dist/latest-linux.yml "$WEBDIR/"

cd ..
echo ">> tagging and pushing ${TAG}"
git tag "$TAG"
git push origin "$TAG"

echo ">> publishing GitHub release ${TAG}"
ASSETS=(electron/dist/XMageLauncher-*-Setup.exe electron/dist/XMageLauncher-*.AppImage electron/dist/latest.yml electron/dist/latest-linux.yml)
gh release create "$TAG" "${ASSETS[@]}" \
  --title "Launcher ${TAG}" \
  --notes "Windows + Linux build of the XMage fork launcher. macOS build published separately by mac-build.yml on the same tag." \
  || gh release upload "$TAG" "${ASSETS[@]}" --clobber

echo ">> DONE — ${TAG} built, staged to ${WEBDIR}, and published to GitHub Releases."
echo "   Mac dmg publishes separately via GitHub Actions (mac-build.yml) on the same tag — check:"
echo "   https://github.com/DarrellBest/Launcher/actions"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x /home/user/projects/Launcher/tools/release-launcher.sh
```

- [ ] **Step 3: Verify — syntax check (do NOT run it yet — that publishes a real release, saved for Task 8)**

Run: `bash -n /home/user/projects/Launcher/tools/release-launcher.sh && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
cd /home/user/projects/Launcher
git add tools/release-launcher.sh
git commit -m "launcher: add release-launcher.sh (build win/linux, tag, publish to GitHub Releases)"
```

---

### Task 6: Rewrite the `FORK-DEPLOY.md` "Launcher" section

**Files:**
- Modify: `/home/user/projects/mage-modern/FORK-DEPLOY.md` (this doc lives in the `mage-modern` repo, not `Launcher` — it's the shared fork-ops runbook covering both repos)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Replace the Launcher section**

In `/home/user/projects/mage-modern/FORK-DEPLOY.md`, replace everything from `## Launcher (separate — only when launcher code changes)` through the end of the `### macOS build` subsection (i.e. through the line ending `...Contents/Home\`).`) with:

```markdown
## Launcher (separate — only when launcher code changes)

The Electron launcher (`~/projects/Launcher`) is a **different artifact** and is NOT part of `full-deploy.sh`. It only rebuilds when its own code changes.

**One version → one GitHub Release, all three platforms.** Bump the version in `Launcher/electron/package.json`, commit, then on the **x86_64 server** (has wine + makensis; the aarch64 DGX cannot cross-build a working Windows exe):

\`\`\`bash
cd ~/projects/Launcher && ./tools/release-launcher.sh
\`\`\`

That one script builds win (NSIS installer) + linux (AppImage) locally, copies them
(plus the `electron-updater` manifests) to `/var/www/html/files/`, tags `v<ver>`, pushes
it — which also triggers `mac-build.yml` on GitHub Actions to build + ad-hoc-sign the
mac dmg — and publishes the win/linux assets to the GitHub Release (the mac job adds
its dmg to that same release; whichever job gets there first creates it, the other
uploads into it).

Watch the mac build finish (usually a few minutes): `https://github.com/DarrellBest/Launcher/actions`

Download links (same for everyone, and where the launcher's own auto-updater fetches from):
- GitHub Release page: `https://github.com/DarrellBest/Launcher/releases/tag/v<ver>`
- Web mirror (also the auto-updater's fallback feed if GitHub is unreachable):
  `http://play.darrellbest.com:17080/files/XMageLauncher-<ver>-Setup.exe` (and `.AppImage`, `.dmg`)

### Launcher self-update

Windows and Linux builds check GitHub Releases on launch and self-install updates via
`electron-updater` (GitHub primary, falls back to the web mirror above if GitHub can't
be reached). **macOS does not self-install** — ad-hoc signing (no Apple Developer ID)
fails Squirrel.Mac's signature check, so mac just shows "update available" with a link
to the release page for a manual download, same as before.

Mac-user caveats (no Apple Developer ID → not notarized):
- First launch: right-click → Open, or System Settings → Privacy & Security → "Open Anyway" (macOS 15+ removed the right-click bypass).
- Apple Silicon needs Rosetta 2 for the bundled x64 Java 8 (`softwareupdate --install-rosetta --agree-to-license`); the launcher itself runs natively.
- The mac Java tarball (`jre-8u201-macosx-x64.tar.gz`) is already hosted in `/var/www/html/files/java/` and the launcher already handles the mac JRE layout (`Contents/Home`).

Windows caveat (no code-signing cert): the NSIS installer will still trigger a
SmartScreen "unknown publisher" warning on first run (click "More info" → "Run
anyway") — same class of friction as the old unsigned portable exe, just at install
time instead of every launch.
\`\`\`
```

(Note: the triple-backtick block above is shown escaped for this plan document; when editing the actual file, use real triple backticks, not `\`\`\``.)

- [ ] **Step 2: Verify — read it back**

Run: `sed -n '/^## Launcher/,/^## Hard-won gotchas/p' /home/user/projects/mage-modern/FORK-DEPLOY.md`
Expected: shows the new section content in full, ending right before the "Hard-won gotchas" heading (i.e. the old macOS subsection is gone, replaced cleanly).

- [ ] **Step 3: Commit**

```bash
cd /home/user/projects/mage-modern
git add FORK-DEPLOY.md
git commit -m "docs: update Launcher section for unified GitHub Releases + self-update flow"
git push origin ui-modernization
```

---

### Task 7: Real release — bump version, run the script, verify the GitHub Release

**Files:**
- Modify: `electron/package.json` (version bump only)

**Interfaces:** none new — exercises everything built in Tasks 1-6 for real.

**⚠️ This task publishes a real, public GitHub Release and pushes a git tag that triggers GitHub Actions — pause here and get explicit confirmation before running Step 2.**

- [ ] **Step 1: Bump the version**

In `electron/package.json`, change `"version": "1.2.1"` to `"version": "1.2.2"`.

```bash
cd /home/user/projects/Launcher
git add electron/package.json
git commit -m "launcher: bump to 1.2.2 — first unified GitHub Releases build"
```

- [ ] **Step 2: Run the release script for real**

```bash
cd /home/user/projects/Launcher && ./tools/release-launcher.sh
```

Expected: ends with `DONE — v1.2.2 built, staged to /var/www/html/files, and published to GitHub Releases.`

- [ ] **Step 3: Verify the GitHub Release has the win/linux assets**

Run: `gh release view v1.2.2 --repo DarrellBest/Launcher`
Expected: lists `XMageLauncher-1.2.2-Setup.exe`, `XMageLauncher-1.2.2.AppImage`, `latest.yml`, `latest-linux.yml`.

- [ ] **Step 4: Verify the web mirror got the same files**

Run: `ls -la /var/www/html/files/ | grep -E '1\.2\.2|latest'`
Expected: `XMageLauncher-1.2.2-Setup.exe`, `XMageLauncher-1.2.2.AppImage`, `latest.yml`, `latest-linux.yml` all present.

- [ ] **Step 5: Wait for and verify the mac build**

Run: `gh run list --repo DarrellBest/Launcher --workflow=mac-build.yml --limit 1`
Expected: a run for tag `v1.2.2`. Poll `gh run view --repo DarrellBest/Launcher <run-id>` (or just `gh release view v1.2.2 --repo DarrellBest/Launcher` again after a few minutes) until it shows `success` and the release additionally lists `XMageLauncher-1.2.2.dmg`.

- [ ] **Step 6: Report back to the user**

Summarize: release URL (`https://github.com/DarrellBest/Launcher/releases/tag/v1.2.2`), confirmation all 3 platform assets are attached, and that the update-manifest files are present.

---

### Task 8: Manual in-app verification (requires a GUI session — hand off to the user)

**Files:** none — verification only.

**This task needs a real display** (Electron is a GUI app) to observe the update pill and click-to-install flow. Do this task by asking the user to perform it, or by using a remote-desktop/VNC session if one is available and you can drive it yourself — don't claim this step passed without actually seeing it happen.

- [ ] **Step 1: Build the OLD version's Linux AppImage, from before the version bump**

```bash
cd /home/user/projects/Launcher
git log --oneline -3 -- electron/package.json   # find the commit before "bump to 1.2.2"
git checkout <commit-before-the-1.2.2-bump> -- electron/package.json
cd electron && npm run dist:linux
git checkout HEAD -- ../electron/package.json   # restore package.json to 1.2.2 on disk
```

Expected: `electron/dist/XMageLauncher-1.2.1.AppImage` now exists, built against the pre-bump version while `package.json` in the working tree ends up back at `1.2.2` (only that one build used the old version number).

- [ ] **Step 2: Run it as a real AppImage (not `npm start`) so `app.isPackaged` is true and `APPIMAGE` env var is set**

```bash
chmod +x /path/to/XMageLauncher-1.2.1.AppImage
/path/to/XMageLauncher-1.2.1.AppImage
```

- [ ] **Step 3: Watch the "Arcane Console" panel inside the launcher window**

Expected log lines within a few seconds: `Launcher update available: v1.2.2 — downloading…` then (once the download finishes) `Launcher update v1.2.2 ready — restart to install.` The new pill next to "build" in the top-left should appear reading "Restart to update".

- [ ] **Step 4: Click the pill**

Expected: the app quits and relaunches as v1.2.2 (check the "build" pill or window title after relaunch reflects the new version).

- [ ] **Step 5: (Optional but recommended) Verify the GitHub-unreachable fallback path**

Temporarily block GitHub for the app (e.g. add `0.0.0.0 api.github.com` and `0.0.0.0 github.com` to `/etc/hosts`, run the launcher, confirm the console logs `GitHub unreachable for launcher updates — falling back to http://play.darrellbest.com:17080/files`, and that it still finds and offers the update). Remove the `/etc/hosts` entries afterward.

- [ ] **Step 6: Report results to the user**

Confirm pass/fail for each of steps 3-5, with the actual console output observed — not an assumption.
