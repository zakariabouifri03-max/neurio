"""Download a Windows FFmpeg build for packaging into packaging/ffmpeg/.

Usage:  python scripts/fetch_ffmpeg.py [--url URL] [--sha256 HEX]
The default build is the BtbN GPL build (includes libx264/libx265 for H.264/H.265 export).
GPL builds carry GPL obligations when redistributed: see THIRD_PARTY_LICENSES.md.
Set --sha256 (or FFMPEG_SHA256) to verify the archive; the script prints the hash otherwise.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

DEFAULT_URL = ("https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"
               "ffmpeg-master-latest-win64-gpl.zip")
ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("FFMPEG_URL", DEFAULT_URL))
    ap.add_argument("--sha256", default=os.environ.get("FFMPEG_SHA256", ""))
    ap.add_argument("--out", default=str(ROOT / "packaging" / "ffmpeg"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    archive = ROOT / "packaging" / "ffmpeg-download.zip"
    print(f"Downloading {args.url}")
    with urllib.request.urlopen(args.url, timeout=300) as resp, open(archive, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    print(f"SHA256 {digest}")
    if args.sha256 and args.sha256.lower() != digest:
        print("Checksum mismatch: refusing to use this download.", file=sys.stderr)
        return 1
    with zipfile.ZipFile(archive) as z:
        for member in z.namelist():
            name = Path(member).name
            if name in ("ffmpeg.exe", "ffprobe.exe"):
                with z.open(member) as src, open(out / name, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                print(f"Extracted {name}")
    archive.unlink(missing_ok=True)
    if not (out / "ffmpeg.exe").is_file():
        print("ffmpeg.exe was not found in the archive.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
