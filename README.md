# XMage Launcher (Darrell's Fork)

Electron launcher for [DarrellBest/mage-modern](https://github.com/DarrellBest/mage-modern), a fork of [XMage](https://github.com/magefree/mage). Installs the bundled Java runtime and XMage client/server, launches the game, and keeps itself and the game up to date.

**Downloads:** [Releases](https://github.com/DarrellBest/Launcher/releases) — Windows (`.exe`), Linux (`.AppImage`), and macOS (`.dmg`) builds are published together under one version per release.

## Development

```bash
cd electron
npm install
npm start
```

## Building installers

```bash
cd electron
npm run dist:win     # NSIS installer (Windows)
npm run dist:linux   # AppImage (Linux)
npm run dist:mac     # dmg (macOS — must run on macOS)
```

## Releasing

See `../mage-modern/FORK-DEPLOY.md` for the full release runbook. In short: bump the version in `electron/package.json`, then run `./tools/release-launcher.sh` on the game server — it builds win/linux, tags the repo, and publishes all three platforms to the same [GitHub Release](https://github.com/DarrellBest/Launcher/releases).
