#!/usr/bin/env python3
"""Generate a short, original synthetic clip for local NovaCut workflow tests.

No stock footage, music, or external asset is used: FFmpeg's test pattern and a
sine wave are generated at the point of use. The generated file is disposable.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="novacut-synthetic-test.mp4")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="Path to the local FFmpeg executable")
    parser.add_argument("--seconds", type=float, default=8.0)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args()
    if args.seconds <= 0 or args.width < 16 or args.height < 16 or args.fps < 1:
        parser.error("Duration, resolution, and FPS must be positive")
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        args.ffmpeg, "-hide_banner", "-y", "-f", "lavfi", "-i",
        f"testsrc2=size={args.width}x{args.height}:rate={args.fps}",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", str(args.seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(output),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        print(result.stderr, file=sys.stderr)
        return result.returncode
    print(f"Created original synthetic test media: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
