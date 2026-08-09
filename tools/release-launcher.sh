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

# npm install can rewrite package-lock.json's version fields (e.g. to match a
# package.json bump that hasn't been reflected in the lockfile yet). Commit
# that drift now so the tag/release always corresponds to a clean, consistent
# working tree — see v1.2.2 release postmortem where this was missed.
if ! git diff --quiet -- package-lock.json 2>/dev/null; then
  echo ">> package-lock.json changed by npm install — committing drift"
  git add package-lock.json
  git commit -m "launcher: sync package-lock.json for ${TAG}"
fi

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
