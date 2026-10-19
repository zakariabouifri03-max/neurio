#!/usr/bin/env python3
"""
build.py — one-click exe builder for Neurio
Usage:
  python app/build.py            # builds exe
  python app/build.py --onefile  # explicit onefile
  python app/build.py --onedir   # folder mode (faster startup)
"""

import sys, subprocess, shutil, platform
from pathlib import Path

ROOT = Path(__file__).parent
APP_PY = ROOT / "main.py"
ICON_ICO = ROOT / "icons" / "neurio.ico"
ICON_PNG = ROOT / "icons" / "neurio.png"

def run(cmd):
    print(f"▶ {' '.join(cmd)}")
    result = subprocess.run(cmd)
    return result.returncode == 0

def ensure_icon():
    """Create placeholder icon if missing, generate from PNG."""
    ICON_ICO.parent.mkdir(parents=True, exist_ok=True)
    if ICON_ICO.exists():
        return
    # Try to generate from existing repo icon or create simple
    try:
        from PIL import Image, ImageDraw, ImageFont
        # Create 256x256 icon with gradient-like neurio badge
        img = Image.new("RGBA", (256, 256), (15, 17, 26, 255))
        draw = ImageDraw.Draw(img)
        # Rounded rect
        draw.rounded_rectangle([16, 16, 240, 240], radius=32, fill=(59, 130, 246, 255))
        draw.rounded_rectangle([20, 20, 236, 236], radius=28, fill=(99, 102, 241, 0))
        # Diamond
        draw.text((78, 72), "◆", font=ImageFont.load_default(), fill=(255, 255, 255, 255))
        # Try bigger
        try:
            # Use default font larger via scaling
            pass
        except: pass
        draw.text((56, 150), "NEURIO", fill=(255,255,255,255), font=ImageFont.load_default())
        # Save png
        img.save(ICON_PNG)
        # Save ico (PyInstaller needs .ico on Windows)
        img.save(ICON_ICO, sizes=[(256,256),(128,128),(64,64),(32,32),(16,16)])
        print(f"✓ Icon created at {ICON_ICO}")
    except Exception as e:
        print(f"Icon gen failed: {e}")

def main():
    args = sys.argv[1:]
    mode = "onefile"
    if "--onedir" in args:
        mode = "onedir"
    elif "--onefile" in args:
        mode = "onefile"

    ensure_icon()

    # Check deps
    try:
        import PySide6, PIL, cv2, rembg, onnxruntime
        print(f"✓ Deps OK — PySide6 {PySide6.__version__} | rembg")
    except Exception as e:
        print(f"Missing deps: {e}")
        print("Install: pip install -r app/requirements.txt")
        sys.exit(1)

    # Use spec if exists and mode is onefile (spec is onefile)
    spec = ROOT / "Neurio.spec"
    if spec.exists() and mode == "onefile":
        print("Building via spec (onefile)...")
        ok = run([sys.executable, "-m", "PyInstaller", str(spec), "--noconfirm", "--clean"])
        if ok:
            print("\n✓ Build done — find exe in dist/")
            if platform.system() == "Windows":
                print("  dist/Neurio.exe")
            else:
                print("  dist/Neurio")
            return
        else:
            print("Spec build failed, trying CLI fallback...")

    # CLI fallback
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        "--name", "Neurio",
        "--windowed",  # no console
        "--collect-all", "rembg",
        "--collect-all", "onnxruntime",
        "--hidden-import=PIL",
        "--hidden-import=cv2",
    ]
    if ICON_ICO.exists():
        cmd += ["--icon", str(ICON_ICO)]
    if mode == "onefile":
        cmd.append("--onefile")
    else:
        cmd.append("--onedir")
    cmd.append(str(APP_PY))

    print(f"Building {mode} with PyInstaller...")
    ok = run(cmd)
    if ok:
        print("\n✓ Build done!")
        print("  → dist/Neurio" + (".exe" if platform.system() == "Windows" else ""))
        size = Path("dist/Neurio.exe" if platform.system()=="Windows" else "dist/Neurio").stat().st_size / 1024 / 1024 if (Path("dist/Neurio.exe").exists() or Path("dist/Neurio").exists()) else 0
        if size:
            print(f"  Size: {size:.1f} MB")
        print("\nTo share: zip dist/Neurio.exe + send to user — no Python needed!")
    else:
        print("\n✗ Build failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
