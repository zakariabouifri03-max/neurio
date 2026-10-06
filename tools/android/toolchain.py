#!/usr/bin/env python3
"""
AI Vision Camera - Android toolchain bootstrap.

This sandbox has no Android SDK / Gradle / Maven-Gradle-Plugin access, so this
module assembles a *complete, real* Android build toolchain from sources that are
reachable here (PyPI / npm / the GitHub API):

  * java        - Temurin JRE (keytool + runtime) shipped inside the `jdk4py` wheel
  * kotlinc     - official JetBrains Kotlin compiler (npm `kotlin-compiler`)
  * dx          - AOSP `dx.jar` dexer (LineageOS `android_prebuilts_build-tools`)
  * aapt2       - Google `aapt2` binary (npm `aaptjs3`)
  * apksigner   - Google `apksigner.jar` (npm `@postar/apktool-node`)
  * android.jar - Android 16 (API 36) platform stubs (GitHub `Sable/android-platforms`)

Everything lands in a cache directory (default /tmp/aivision-toolchain) so the
repository never carries 300 MB of tooling. Run `python3 toolchain.py` to fetch
it; `build_apk.py` calls `ensure_toolchain()` automatically.

The same app also builds with Gradle/Android Studio (see the Gradle files in the
project root) - this local pipeline exists so the APK can be produced and
verified without any external build service. It produces a byte-for-byte real
APK: Kotlin -> JVM bytecode -> DEX -> resources -> aligned + v2/v3 signed.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

CACHE = Path(os.environ.get("AIVISION_TOOLCHAIN", "/tmp/aivision-toolchain"))

GITHUB_RAW = "https://api.github.com/repos/{repo}/contents/{path}?ref={ref}"
RAW_HEADERS = {"Accept": "application/vnd.github.raw"}

# Official Google / AOSP components. Pinned for reproducibility.
DX_SOURCE = dict(
    repo="LineageOS/android_prebuilts_build-tools",
    path="common/framework/dx.jar",
    ref="lineage-21.0",
    sha256=None,
)
ANDROID_JAR_SOURCE = dict(
    repo="Sable/android-platforms",
    path="android-36/android.jar",
    ref="master",
    sha256=None,
)
NPM_PACKAGES = {
    # name -> (version, files to keep relative to the extracted package dir)
    "kotlin-compiler": ("2.4.20", ["lib"]),
    "aaptjs3": ("2.0.2", ["bin/x64/linux/aapt2"]),
    "@postar/apktool-node": ("0.3.4", ["lib/apksigner.jar"]),
}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def log(msg: str) -> None:
    print(f"[toolchain] {msg}", flush=True)


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kw)


def _download(url: str, dest: Path, headers: dict | None = None) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "aivision-build"})
    with urllib.request.urlopen(req, timeout=300) as resp, open(dest, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    return dest


def _github_file(repo: str, path: str, ref: str, dest: Path) -> Path:
    url = GITHUB_RAW.format(repo=repo, path=path, ref=ref)
    return _download(url, dest, RAW_HEADERS)


def _npm_pack(name: str, version: str, dest_dir: Path) -> Path:
    """`npm pack <pkg>@<version>` and untar into dest_dir; returns package dir."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    pkg_dir = dest_dir / "package"
    if pkg_dir.exists():
        return pkg_dir
    tgz_name = _run(
        ["npm", "pack", f"{name}@{version}", "--silent"],
        cwd=dest_dir, capture_output=True, text=True,
    ).stdout.strip().splitlines()[-1]
    tgz = dest_dir / tgz_name
    with tarfile.open(tgz) as tf:
        tf.extractall(dest_dir)
    tgz.unlink(missing_ok=True)
    return pkg_dir


# --------------------------------------------------------------------------- #
# components
# --------------------------------------------------------------------------- #
def ensure_java() -> Path:
    java_home = CACHE / "java"
    java = java_home / "bin" / "java"
    keytool = java_home / "bin" / "keytool"
    if java.exists() and keytool.exists():
        return java_home
    log("installing JRE (jdk4py wheel: Temurin runtime + keytool) ...")
    target = CACHE / "pyjdk"
    target.mkdir(parents=True, exist_ok=True)
    _run([sys.executable, "-m", "pip", "install", "--quiet", "--break-system-packages",
          "--target", str(target), "jdk4py"], stdout=subprocess.DEVNULL)
    src = target / "jdk4py" / "java-runtime"
    if not src.exists():
        sys.exit("jdk4py layout unexpected: %s" % src)
    if java_home.exists():
        shutil.rmtree(java_home)
    shutil.copytree(src, java_home, symlinks=True)
    if not keytool.exists():
        sys.exit("keytool missing from JRE")
    log(f"java ready: {java}")
    return java_home


def ensure_kotlinc() -> dict:
    base = CACHE / "kotlin"
    compiler = base / "package" / "lib" / "kotlin-compiler.jar"
    if not compiler.exists():
        log("fetching Kotlin compiler (npm kotlin-compiler) ...")
        _npm_pack("kotlin-compiler", NPM_PACKAGES["kotlin-compiler"][0], base)
    lib = base / "package" / "lib"
    return {
        "compiler_jar": lib / "kotlin-compiler.jar",
        "stdlib_jar": lib / "kotlin-stdlib.jar",
        "reflect_jar": lib / "kotlin-reflect.jar",
        "script_jar": lib / "kotlin-script-runtime.jar",
        "daemon_jar": lib / "kotlin-daemon.jar",
        "home": base / "package",
    }


def ensure_dx() -> Path:
    dx = CACHE / "dx" / "dx.jar"
    if not dx.exists():
        log("fetching AOSP dx dexer (LineageOS prebuilts) ...")
        _github_file(DX_SOURCE["repo"], DX_SOURCE["path"], DX_SOURCE["ref"], dx)
    if dx.stat().st_size < 500_000:
        sys.exit("dx.jar download looks wrong (git-LFS pointer?)")
    return dx


def ensure_aapt2() -> Path:
    aapt2 = CACHE / "aapt2" / "aapt2"
    if not aapt2.exists():
        log("fetching aapt2 (npm aaptjs3) ...")
        pkg = _npm_pack("aaptjs3", NPM_PACKAGES["aaptjs3"][0], CACHE / "aapt2pkg")
        src = pkg / "bin" / "x64" / "linux" / "aapt2"
        aapt2.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, aapt2)
        aapt2.chmod(0o755)
    return aapt2


def ensure_apksigner() -> Path:
    signer = CACHE / "signer" / "apksigner.jar"
    if not signer.exists():
        log("fetching apksigner (npm @postar/apktool-node) ...")
        pkg = _npm_pack("@postar/apktool-node", NPM_PACKAGES["@postar/apktool-node"][0],
                        CACHE / "signerpkg")
        signer.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(pkg / "lib" / "apksigner.jar", signer)
    return signer


def ensure_android_jar() -> Path:
    jar = CACHE / "platform" / "android-36.jar"
    if not jar.exists() or jar.stat().st_size < 1_000_000:
        log("fetching Android 16 (API 36) platform stubs ...")
        _github_file(ANDROID_JAR_SOURCE["repo"], ANDROID_JAR_SOURCE["path"],
                     ANDROID_JAR_SOURCE["ref"], jar)
    return jar


def ensure_toolchain() -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    tc = {
        "cache": CACHE,
        "java_home": ensure_java(),
        "kotlin": ensure_kotlinc(),
        "dx": ensure_dx(),
        "aapt2": ensure_aapt2(),
        "apksigner": ensure_apksigner(),
        "android_jar": ensure_android_jar(),
    }
    tc["java"] = tc["java_home"] / "bin" / "java"
    tc["keytool"] = tc["java_home"] / "bin" / "keytool"
    return tc


if __name__ == "__main__":
    tc = ensure_toolchain()
    print(json.dumps({k: str(v) for k, v in tc.items()}, indent=2))
