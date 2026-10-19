"""Local audio cleanup: FFmpeg afftdn/anlmdn filtering with previews.

No model download is required - these are classic DSP filters shipped with
FFmpeg. Intensity maps to filter strength; before/after preview is produced
by rendering short processed excerpts to the cache.
"""
from __future__ import annotations

from pathlib import Path

from ..core import paths
from ..core.ffmpeg import CancellableProcess, find_ffmpeg
from .base import AITool, ToolStatus


class AudioCleanup(AITool):
    id = "audio_cleanup"
    name = "Audio cleanup"
    description = "Noise reduction and voice enhancement with adjustable strength."

    def check(self) -> ToolStatus:
        if not self.ffmpeg_available():
            return self.unavailable("FFmpeg was not found.")
        return self.available()

    def _filter_chain(self, intensity: float, voice: bool) -> str:
        strength = max(0.0, min(1.0, intensity))
        nr = 8.0 + strength * 22.0          # afftdn noise reduction dB
        chain = [f"highpass=f={70 if voice else 50}",
                 f"afftdn=nr={nr:.1f}:nf=-25",
                 f"anlmdn=s={0.0002 + strength * 0.006}:r=0.02"]
        if voice:
            chain += ["acompressor=threshold=-20dB:ratio=2.5:makeup=2",
                      "equalizer=f=3000:t=q:w=1.2:g=3"]
        return ",".join(chain)

    def process(self, input_path: str, output_path: str | None = None,
                intensity: float = 0.5, voice_enhance: bool = False,
                preview_seconds: float = 0.0,
                progress=None, should_cancel=None) -> str:
        """Render a cleaned copy. *preview_seconds*>0 limits output length."""
        self.ensure_ready()
        ffmpeg = find_ffmpeg()
        if output_path is None:
            paths.ensure_dirs()
            suffix = "_preview.wav" if preview_seconds else "_cleaned.wav"
            output_path = str(paths.CACHE_DIR /
                              (Path(input_path).stem + suffix))
        cmd = [str(ffmpeg), "-y", "-hide_banner", "-nostdin", "-i", input_path]
        if preview_seconds > 0:
            cmd += ["-t", f"{preview_seconds:.2f}"]
        cmd += ["-af", self._filter_chain(intensity, voice_enhance),
                "-ar", "48000", "-progress", "pipe:1", output_path]
        runner = CancellableProcess()

        def _on_progress(fraction: float, _s: float) -> None:
            if progress:
                progress(fraction, "Cleaning audio")
            if should_cancel and should_cancel():
                runner.cancel()

        result = runner.run(cmd, on_progress=_on_progress)
        if runner.cancelled:
            Path(output_path).unlink(missing_ok=True)
            raise RuntimeError("Audio cleanup cancelled")
        if not result.ok:
            raise RuntimeError(f"Audio cleanup failed: {result.stderr[-300:]}")
        return output_path

    def preview_pair(self, input_path: str, intensity: float = 0.5,
                     voice_enhance: bool = False,
                     seconds: float = 5.0) -> tuple[str, str]:
        """Return (original_excerpt, processed_excerpt) for A/B comparison."""
        ffmpeg = find_ffmpeg()
        original = str(paths.CACHE_DIR / (Path(input_path).stem + "_orig_preview.wav"))
        runner = CancellableProcess()
        res = runner.run([str(ffmpeg), "-y", "-hide_banner", "-i", input_path,
                          "-t", f"{seconds:.2f}", "-ar", "48000", original])
        if not res.ok:
            raise RuntimeError(res.stderr[-300:])
        processed = self.process(input_path, intensity=intensity,
                                 voice_enhance=voice_enhance,
                                 preview_seconds=seconds)
        return original, processed
