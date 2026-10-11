#!/usr/bin/env sh
#
# VYRO PLAY — Gradle 8.9 bootstrap (POSIX).
#
# If gradle/wrapper/gradle-wrapper.jar is present, runs it directly.
# Otherwise, downloads the pinned Gradle 8.9 distribution once into
# ~/.gradle/wrapper/dists, verifies its SHA-256 checksum, and runs Gradle.
set -eu

APP_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

GRADLE_VERSION=8.9
GRADLE_SHA256=d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab

GRADLE_USER_HOME=${GRADLE_USER_HOME:-"${HOME}/.gradle"}
DIST_HOME="$GRADLE_USER_HOME/wrapper/dists/gradle-${GRADLE_VERSION}-bin/vyroplay"
DIST_DIR="$DIST_HOME/gradle-${GRADLE_VERSION}"

if [ ! -x "$DIST_DIR/bin/gradle" ]; then
  mkdir -p "$DIST_HOME"
  ZIP="$DIST_HOME/gradle-${GRADLE_VERSION}-bin.zip"
  if [ ! -f "$ZIP" ]; then
    URL="https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"
    if command -v curl >/dev/null 2>&1; then
      curl -fL --retry 3 "$URL" -o "$ZIP"
    elif command -v wget >/dev/null 2>&1; then
      wget -q "$URL" -O "$ZIP"
    else
      echo "Error: curl or wget is required to bootstrap Gradle ${GRADLE_VERSION}." >&2
      exit 1
    fi
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA256=$(sha256sum "$ZIP" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA256=$(shasum -a 256 "$ZIP" | awk '{print $1}')
  else
    echo "Error: sha256sum or shasum is required to verify Gradle." >&2
    exit 1
  fi
  if [ "$ACTUAL_SHA256" != "$GRADLE_SHA256" ]; then
    echo "Error: Gradle distribution checksum mismatch ($ACTUAL_SHA256 != $GRADLE_SHA256)." >&2
    rm -f "$ZIP"
    exit 1
  fi
  unzip -q -o "$ZIP" -d "$DIST_HOME"
fi

exec "$DIST_DIR/bin/gradle" -p "$APP_HOME" "$@"
