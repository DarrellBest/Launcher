# GitHub Releases distribution + launcher self-update

Status: approved, not yet implemented.

## Problem

Launcher installers are hand-built and copied to `/var/www/html/files/` on
the game server (`192.168.1.87`). Mac already publishes to GitHub Releases
via `.github/workflows/mac-build.yml` (tag `mac-v<ver>`), but win/linux
never touch GitHub Releases — no public download page, no changelog, no
self-update. The launcher app itself has **no self-update mechanism at
all** today; `config.json`'s `Launcher.version` field is unused/stale.

## Goals

1. One GitHub Release per version (`v<ver>`), with `.exe`, `.AppImage`, and
   `.dmg` all attached to the same release — not mac split into its own tag
   track.
2. Win/Linux keep building locally on the game server (has wine + makensis;
   that doesn't change). Mac keeps building via GitHub Actions.
3. Real self-updating launcher via `electron-updater`, where the platform
   allows it:
   - Windows + Linux: full auto-download/auto-install.
   - macOS: notify-only (link to the release page) — ad-hoc signing (no
     Apple Developer ID) will fail Squirrel.Mac's signature check, so
     self-install isn't reliable there.
4. GitHub is the primary update source; the existing web server
   (`play.darrellbest.com:17080/files/`) stays as a fallback if GitHub is
   unreachable, and keeps serving installers for manual/fresh downloads
   either way.

## Non-goals

- No Apple Developer ID / notarization (out of scope, ongoing cost — can
  revisit later if wanted).
- No change to the *game* update flow (`mage-update_fork.zip` /
  `XMage.version` in `config.json`) — that's a separate, already-working
  mechanism.

## Design

### 1. Release & tag scheme

Single tag per version: `v<version>` (e.g. `v1.2.2`), read from
`electron/package.json`. Replaces the mac-only `mac-v*` scheme.

Two independent producers publish assets into the *same* release, order
-independent:

- **Mac** (`mac-build.yml`): trigger changes from `tags: ['mac-v*']` to
  `tags: ['v*']`. Otherwise unchanged — still builds on `macos-latest`,
  ad-hoc signs, and publishes via the existing
  `gh release create ... || gh release upload ... --clobber` idempotent
  pattern.
- **Win/Linux** (local build on `192.168.1.87`, extending the existing
  manual command documented in `FORK-DEPLOY.md`): after building, tag
  `v<ver>`, push the tag, then `gh release create`/`gh release upload`
  the same way.

Win/linux also upload electron-builder's generated update-manifest YAML
as release assets (`latest.yml` for win, `latest-linux.yml` for linux) —
this is what `electron-updater` reads to detect a new version and where
to fetch it from. Mac doesn't generate or need one (see build target
changes below).

### 2. Build target changes (`electron/package.json`)

- **Windows**: `target: ["portable"]` → `target: ["nsis"]`. Required —
  `electron-updater`'s Windows auto-update needs an installed app it can
  replace via the NSIS updater; portable single-file exes have no clean
  in-place-replace story. User-facing change: users now run a small
  installer once instead of a standalone portable exe. Existing
  `signAndEditExecutable: false` stays (still no code-signing cert).
- **macOS**: unchanged, `target: ["dmg"]`. No `zip` target and no
  `latest-mac.yml` needed — mac doesn't use `electron-updater`'s feed at
  all (see below), just a plain GitHub API version check, so there's
  nothing that reads that manifest.
- **Linux**: unchanged (`AppImage` already works cleanly with
  `electron-updater`).

### 3. In-app update-check behavior (`electron/main.js`)

- Add `electron-updater` as a dependency.
- On launch, configure `autoUpdater` with the GitHub provider
  (`owner: DarrellBest, repo: Launcher`).
- **Windows/Linux**: standard `electron-updater` flow — check, download in
  background, install on next restart. Surface progress/availability
  through the existing hero-button update-notifier UI pattern already
  used for game updates (per commit `68c69fa`), not a new UI paradigm.
- **macOS**: skip `autoUpdater`'s install flow. Instead, a lightweight
  check against the GitHub Releases API (`GET /repos/DarrellBest/Launcher/
  releases/latest`) comparing the tag to `app.getVersion()`; if newer,
  show the same hero-button notifier but clicking it opens the release
  page in the default browser instead of installing.
- **Fallback to own server**: wrap the GitHub check — on failure (network
  error / GitHub unreachable), reconfigure `autoUpdater` to the generic
  provider pointed at `http://play.darrellbest.com:17080/files/` and
  retry. This requires the win/linux local build step to also copy
  `latest.yml`/`latest-linux.yml` to that directory (alongside the
  installers it already copies there) so the generic-provider feed has
  something to read. Mac's notify-only check has no fallback need (it's
  a small unauthenticated API call, not a download feed) — if the GitHub
  API call fails, it just silently skips the notification for that
  launch, same as any other network hiccup.

### 4. Docs

`FORK-DEPLOY.md`'s "Launcher (separate — only when launcher code changes)"
section gets rewritten: unified tag command, note about the yml files
needing to be copied to the web server too, and a callout for the new
NSIS installer experience replacing the old portable exe.

## Testing

- Local `npm run dist:win`/`dist:linux`/`dist:mac` produce installers +
  yml manifests without errors after the target-type changes.
- A real end-to-end update test: publish a release at version N, install
  it, bump to N+1, publish again, confirm the running N app detects and
  (on win/linux) installs N+1. Do this for at least Windows and Linux
  before calling it done — mac notify-only path can be checked by mocking
  the GitHub API response or publishing a real N+1 release.
- Fallback path: verify by pointing `electron-updater` at a bad GitHub URL
  temporarily (or blocking it via `/etc/hosts`) and confirming it falls
  back to the web-server feed.

## Open risks / things to watch

- NSIS installer with no code-signing cert will still trigger Windows
  SmartScreen "unknown publisher" warnings on first run — same class of
  friction as today's unsigned portable exe, not new, but worth setting
  expectations (mirrors the existing "not notarized" mac caveat already
  documented).
- `electron-updater`'s generic-provider fallback requires the web server's
  copies of `latest.yml`/`latest-linux.yml` to always be in sync with
  whatever's on GitHub — if a future manual copy step is forgotten, the
  fallback would offer a stale version. Worth a version-audit-style check
  similar to the fork deploy's stage 5, but not required for v1 of this
  feature.
