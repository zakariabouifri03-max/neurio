#!/usr/bin/env bash
# copy the web game into the Android project (run from the repo root: ./apk-project/prepare-assets.sh)
set -e
cd "$(dirname "$0")/.."
DST=apk-project/app/src/main/assets/www
rm -rf "$DST"; mkdir -p "$DST"
cp survivor3d/index.html survivor3d/manifest.webmanifest "$DST/"
mkdir -p "$DST/js" && cp survivor3d/js/*.js "$DST/js/"
# vendor + icons live one level up in the repo; the web app references ./vendor and ./icons
mkdir -p "$DST/vendor/utils" && cp vendor/three.module.js "$DST/vendor/" && cp vendor/utils/BufferGeometryUtils.js "$DST/vendor/utils/"
mkdir -p "$DST/icons" && cp icons/icon-192.png icons/icon-512.png icons/icon-maskable-512.png "$DST/icons/"
cp survivor3d/sw.js "$DST/" 2>/dev/null || true
echo "assets ready in $DST"
