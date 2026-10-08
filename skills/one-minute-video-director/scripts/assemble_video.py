#!/usr/bin/env python3
"""Normalize sequential clips and assemble one exact-duration MP4 with FFmpeg."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class MediaInfo:
    duration: float
    has_audio: bool


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, text=True, capture_output=True)


def probe(path: Path, ffprobe: str) -> MediaInfo:
    result = run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
            str(path),
        ]
    )
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    if not any(stream.get("codec_type") == "video" for stream in streams):
        raise ValueError(f"No video stream found in {path}")
    try:
        duration = float(data["format"]["duration"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Could not determine duration of {path}") from exc
    if duration <= 0:
        raise ValueError(f"Invalid duration for {path}: {duration}")
    return MediaInfo(
        duration=duration,
        has_audio=any(stream.get("codec_type") == "audio" for stream in streams),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Assemble video segments into a normalized, exact-duration MP4."
    )
    parser.add_argument("segments", nargs="+", type=Path, help="Segments in timeline order")
    parser.add_argument("--output", "-o", required=True, type=Path)
    parser.add_argument("--duration", type=float, default=60.0)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=float, default=24.0)
    parser.add_argument("--crf", type=int, default=18)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.duration <= 0 or args.width <= 0 or args.height <= 0 or args.fps <= 0:
        raise SystemExit("Duration, dimensions, and FPS must be positive.")
    if args.width % 2 or args.height % 2:
        raise SystemExit("Width and height must be even for H.264 yuv420p output.")
    if not 0 <= args.crf <= 51:
        raise SystemExit("CRF must be between 0 and 51.")

    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise SystemExit("FFmpeg and ffprobe must be installed and available on PATH.")

    segments = [segment.resolve() for segment in args.segments]
    missing = [str(segment) for segment in segments if not segment.is_file()]
    if missing:
        raise SystemExit("Missing segment(s): " + ", ".join(missing))

    try:
        info = [probe(segment, ffprobe) for segment in segments]
    except (subprocess.CalledProcessError, json.JSONDecodeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc

    total_duration = sum(item.duration for item in info)
    if total_duration + 0.05 < args.duration:
        raise SystemExit(
            f"Segments total {total_duration:.3f}s, shorter than requested "
            f"{args.duration:.3f}s. Generate more footage before assembly."
        )

    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output in segments:
        raise SystemExit("Output path must not overwrite an input segment.")

    command = [ffmpeg, "-hide_banner", "-y"]
    for segment in segments:
        command.extend(["-i", str(segment)])

    filters: list[str] = []
    concat_inputs: list[str] = []
    for index, item in enumerate(info):
        duration = item.duration
        filters.append(
            f"[{index}:v:0]"
            f"scale={args.width}:{args.height}:force_original_aspect_ratio=decrease,"
            f"pad={args.width}:{args.height}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"fps={args.fps},setsar=1,format=yuv420p,"
            f"trim=duration={duration:.6f},setpts=PTS-STARTPTS[v{index}]"
        )
        if item.has_audio:
            filters.append(
                f"[{index}:a:0]aresample=48000,"
                f"aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"apad,atrim=duration={duration:.6f},asetpts=PTS-STARTPTS[a{index}]"
            )
        else:
            filters.append(
                f"anullsrc=r=48000:cl=stereo,"
                f"atrim=duration={duration:.6f},asetpts=PTS-STARTPTS[a{index}]"
            )
        concat_inputs.append(f"[v{index}][a{index}]")

    filters.append(
        "".join(concat_inputs)
        + f"concat=n={len(segments)}:v=1:a=1[concatv][concata]"
    )
    filters.append(
        f"[concatv]trim=duration={args.duration:.6f},setpts=PTS-STARTPTS[outv]"
    )
    filters.append(
        f"[concata]atrim=duration={args.duration:.6f},asetpts=PTS-STARTPTS[outa]"
    )

    command.extend(
        [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[outv]",
            "-map",
            "[outa]",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            str(args.crf),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            "-t",
            f"{args.duration:.6f}",
            str(output),
        ]
    )

    try:
        subprocess.run(command, check=True)
        output_info = probe(output, ffprobe)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"FFmpeg assembly failed with exit code {exc.returncode}.") from exc

    tolerance = max(0.1, 1.5 / args.fps)
    if abs(output_info.duration - args.duration) > tolerance:
        raise SystemExit(
            f"Output duration check failed: expected {args.duration:.3f}s, "
            f"got {output_info.duration:.3f}s."
        )

    print(
        f"Created {output} ({output_info.duration:.3f}s, "
        f"{args.width}x{args.height}, {args.fps:g} fps)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
