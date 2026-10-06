#!/usr/bin/env python3
"""
Build + sign AI Vision Camera into a real, installable APK - no Gradle, no
Android Studio, no external build service.

    python3 tools/android/build_apk.py [--project ai-vision-camera] [--release]

Pipeline:
    Kotlin  --kotlinc-->  JVM bytecode  --AOSP dx-->  classes.dex
    resources --aapt2 compile/link--> base.apk
    base.apk + classes.dex --zipflinger--> aligned apk --apksigner v2/v3--> ai-vision-camera.apk
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from toolchain import ensure_toolchain  # noqa: E402
from zipalign import Entry, build_apk, read_entries  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MIN_SDK = 26
TARGET_SDK = 36
DEBUG_KEYSTORE_PASS = "android"      # standard Android debug-key convention
DEBUG_KEYSTORE_ALIAS = "androiddebugkey"


def log(msg: str) -> None:
    print(f"\033[36m[build]\033[0m {msg}", flush=True)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    printable = " ".join(str(c) for c in cmd)
    if len(printable) > 400:
        printable = printable[:400] + " ..."
    print(f"    $ {printable}")
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


class Builder:
    def __init__(self, project: Path, release: bool):
        self.project = project
        self.app = project / "app"
        self.build = self.app / "build"
        self.release = release
        self.tc = ensure_toolchain()

    # ------------------------------------------------------------------ utils
    def java(self, *args: str, **kw) -> subprocess.CompletedProcess:
        return run([self.tc["java"], *args], **kw)

    def clean(self, *paths: Path) -> None:
        for p in paths:
            if p.is_dir():
                shutil.rmtree(p)
            elif p.exists():
                p.unlink()

    def kotlin_sources(self) -> list[Path]:
        return sorted((self.app / "src").rglob("*.kt"))

    # -------------------------------------------------------------- 1. kotlin
    def compile_kotlin(self) -> Path:
        out = self.build / "classes"
        self.clean(out)
        out.mkdir(parents=True, exist_ok=True)
        sources = self.kotlin_sources()
        if not sources:
            sys.exit("no Kotlin sources found")
        log(f"compiling {len(sources)} Kotlin files -> JVM bytecode")
        k = self.tc["kotlin"]
        compiler_cp = os.pathsep.join(str(p) for p in [
            k["compiler_jar"], k["stdlib_jar"], k["reflect_jar"],
            k["script_jar"], k["daemon_jar"],
        ])
        classpath = os.pathsep.join([str(self.tc["android_jar"]), str(k["stdlib_jar"])])
        args = [
            "-Xmx3g", "-cp", compiler_cp,
            "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
            "-classpath", classpath,
            "-jvm-target", "1.8",
            # dx cannot emit invokedynamic, so force the class-based lowering
            "-Xlambdas=class", "-Xsam-conversions=class",
            "-Xno-param-assertions", "-Xno-call-assertions", "-Xno-receiver-assertions",
            "-no-stdlib", "-nowarn",
            "-d", str(out),
            *[str(s) for s in sources],
        ]
        self.java(*args, stdout=subprocess.DEVNULL) if False else None
        proc = subprocess.run([str(self.tc["java"]), *args], capture_output=True, text=True)
        warns = [ln for ln in (proc.stdout + proc.stderr).splitlines()
                 if ": warning:" not in ln and "WARNING:" not in ln and ln.strip()]
        if proc.returncode != 0 or any(": error:" in ln for ln in warns):
            for ln in warns[:80]:
                print(ln)
            sys.exit("kotlin compilation failed")
        for ln in warns[-5:]:
            print(f"    {ln}")
        print(f"    {len(list(out.rglob('*.class')))} classes emitted")
        return out

    # ----------------------------------------------------------------- 2. dex
    def dex(self, classes_dir: Path) -> Path:
        log("dexing with AOSP dx (min-api %d)" % MIN_SDK)
        staged = self.build / "dex-in"
        self.clean(staged)
        staged.mkdir(parents=True, exist_ok=True)

        # Kotlin stdlib ships a multi-release layout dx cannot read: keep classes only
        stdlib = self.tc["kotlin"]["stdlib_jar"]
        with zipfile.ZipFile(stdlib) as zf:
            for name in zf.namelist():
                if not name.endswith(".class") or name.startswith("META-INF/"):
                    continue
                target = staged / "stdlib" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zf.read(name))

        dex_out = self.build / "dex"
        self.clean(dex_out)
        dex_out.mkdir(parents=True, exist_ok=True)
        self.java("-cp", str(self.tc["dx"]), "com.android.dx.command.Main",
                  "--dex", "--min-sdk-version", str(MIN_SDK),
                  "--output", str(dex_out / "classes.dex"),
                  str(classes_dir), str(staged / "stdlib"))
        dex = dex_out / "classes.dex"
        log(f"classes.dex = {dex.stat().st_size / 1e6:.1f} MB")
        return dex

    # ------------------------------------------------------------ 3. resources
    def resources(self) -> Path:
        log("compiling + linking resources with aapt2")
        compiled = self.build / "compiled.zip"
        base = self.build / "base.apk"
        self.clean(compiled, base)
        res = self.app / "res"
        res_args = []
        if res.exists():
            res_args = ["--dir", str(res)]
        aapt2 = self.tc["aapt2"]
        if res.exists():
            run([aapt2, "compile", "--dir", str(res), "-o", str(compiled)])
        else:
            zipfile.ZipFile(compiled, "w").close()

        assets = self.app / "assets"
        link_args = [
            aapt2, "link", "-o", str(base),
            "-I", str(self.tc["android_jar"]),
            "--manifest", str(self.app / "AndroidManifest.xml"),
            "--min-sdk-version", str(MIN_SDK),
            "--target-sdk-version", str(TARGET_SDK),
            "--version-code", "2", "--version-name", "1.0.1",
            "--auto-add-overlay",
            str(compiled),
        ]
        if assets.exists():
            link_args += ["-A", str(assets)]
        run(link_args)
        return base

    # -------------------------------------------------------- 4. package + sign
    def package_apk(self, base: Path, dex_files: list[Path]) -> Path:
        log("packaging + aligning (resources.arsc stored & 4-byte aligned)")
        entries: list[Entry] = read_entries(base)
        have = {e.name for e in entries}
        for dex in dex_files:
            if dex.name in have:
                entries = [e for e in entries if e.name != dex.name]
            import datetime
            entries.append(Entry(dex.name, dex.read_bytes(), False, 0,
                                 datetime.datetime.now().timetuple()[:6], 8))
        # classes.dex must be first for older ART versions; keep a stable order
        entries.sort(key=lambda e: (e.name != "classes.dex", e.name))
        aligned = self.build / "aligned.apk"
        build_apk(entries, aligned)
        return aligned

    def keystore(self) -> Path:
        ks = self.project / "keystore" / "aivision-debug.jks"
        if ks.exists():
            return ks
        ks.parent.mkdir(parents=True, exist_ok=True)
        log("generating debug keystore (standard 'android' credentials)")
        run([self.tc["keytool"], "-genkeypair", "-v",
             "-keystore", str(ks), "-alias", DEBUG_KEYSTORE_ALIAS,
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10950",
             "-storepass", DEBUG_KEYSTORE_PASS, "-keypass", DEBUG_KEYSTORE_PASS,
             "-dname", "CN=AI Vision Camera, OU=Debug, O=AIVision, L=, S=, C="],
            stdout=subprocess.DEVNULL)
        return ks

    def sign(self, aligned: Path) -> Path:
        log("signing with APK Signature Scheme v2 + v3")
        out = self.project / "AI-Vision-Camera.apk"
        out.unlink(missing_ok=True)
        run([self.tc["java"], "-jar", str(self.tc["apksigner"]), "sign",
             "--ks", str(self.keystore()),
             "--ks-pass", f"pass:{DEBUG_KEYSTORE_PASS}",
             "--key-pass", f"pass:{DEBUG_KEYSTORE_PASS}",
             "--ks-key-alias", DEBUG_KEYSTORE_ALIAS,
             "--v1-signing-enabled", "false",
             "--v2-signing-enabled", "true",
             "--v3-signing-enabled", "true",
             "--out", str(out), str(aligned)])
        return out

    def verify(self, apk: Path) -> None:
        log("verifying signature + manifest")
        run([self.tc["java"], "-jar", str(self.tc["apksigner"]), "verify",
             "--verbose", "--print-certs", str(apk)])
        proc = subprocess.run([str(self.tc["aapt2"]), "dump", "badging", str(apk)],
                              capture_output=True, text=True)
        for line in proc.stdout.splitlines():
            if line.startswith(("package:", "launchable-activity:", "uses-permission",
                                "sdkVersion", "targetSdkVersion", "application-label",
                                "uses-feature")):
                print(f"    {line}")

    # ------------------------------------------------------------------ driver
    def run_all(self) -> Path:
        t0 = time.time()
        classes = self.compile_kotlin()
        dex = self.dex(classes)
        base = self.resources()
        aligned = self.package_apk(base, [dex])
        apk = self.sign(aligned)
        self.verify(apk)
        log(f"APK ready: {apk}  ({apk.stat().st_size / 1e6:.1f} MB, "
            f"{time.time() - t0:.1f}s)")
        return apk


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default="ai-vision-camera")
    ap.add_argument("--release", action="store_true",
                    help="build with release optimisations (same pipeline)")
    args = ap.parse_args()
    project = (ROOT / args.project).resolve()
    if not project.exists():
        sys.exit(f"project not found: {project}")
    Builder(project, args.release).run_all()


if __name__ == "__main__":
    main()
