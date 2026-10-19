"""Background removal with a local U2Net (rembg/onnxruntime) model."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from ..core import paths
from ..core.ffmpeg import CancellableProcess, find_ffmpeg
from ..core.logging_setup import get_logger
from .base import AITool, ToolStatus
from . import model_manager

log = get_logger("ai-background")


class BackgroundRemover(AITool):
    id = "background"
    name = "Background removal"
    description = "Segment a subject with U2Net; transparent output or replacement."
    needs_model = True
    model_kind = "rembg"

    def check(self) -> ToolStatus:
        if not self.module_available("rembg") or not self.module_available("onnxruntime"):
            return self.unavailable(
                "Install the 'rembg' and 'onnxruntime' packages, then the "
                "U2Net model from the Model Manager.")
        spec = model_manager.spec("rembg-u2net")
        if spec is None or not model_manager.installed(spec):
            return self.unavailable("U2Net model not installed.",
                                    needs_model=True, model_installed=False,
                                    model_path=str(spec.target if spec else ""),
                                    requirements="onnxruntime + u2net.onnx (~176 MB)")
        return self.available(model_installed=True, model_path=str(spec.target),
                              requirements="onnxruntime + u2net.onnx")

    def _session(self):
        spec = model_manager.spec("rembg-u2net")
        os.environ.setdefault("U2NET_HOME", str(spec.target.parent))
        from rembg import new_session
        return new_session("u2net")

    def process_image(self, input_path: str, output_path: str | None = None) -> str:
        """Remove background on a single image (used for preview)."""
        self.ensure_ready()
        from rembg import remove
        output_path = output_path or str(paths.CACHE_DIR /
                                          (Path(input_path).stem + "_cutout.png"))
        data = Path(input_path).read_bytes()
        result = remove(data, session=self._session())
        Path(output_path).write_bytes(result)
        return output_path

    def process_clip(self, input_path: str, output_path: str,
                     replacement: str | None = None,
                     progress=None, should_cancel=None) -> str:
        """Render a clip with alpha background, optionally composited on a replacement.

        Frames are extracted with FFmpeg, segmented with rembg and re-encoded
        with alpha (QuickTime RLE). When *replacement* is given (an image or
        color spec), the cutout is composited onto it instead of transparency.
        """
        self.ensure_ready()
        ffmpeg = find_ffmpeg()
        work = paths.CACHE_DIR / "rembg_frames"
        work.mkdir(parents=True, exist_ok=True)
        for old in work.glob("*.png"):
            old.unlink()
        extract = [str(ffmpeg), "-y", "-hide_banner", "-i", input_path,
                   str(work / "f_%06d.png")]
        res = CancellableProcess().run(extract)
        if not res.ok:
            raise RuntimeError(f"Frame extraction failed: {res.stderr[-300:]}")
        from rembg import remove
        frames = sorted(work.glob("*.png"))
        session = self._session()
        for i, frame in enumerate(frames):
            if should_cancel and should_cancel():
                raise RuntimeError("Background removal cancelled")
            frame.write_bytes(remove(frame.read_bytes(), session=session))
            if progress:
                progress((i + 1) / max(1, len(frames)),
                         f"Segmenting frame {i + 1}/{len(frames)}")
        if replacement:
            rep = replacement if replacement.startswith("#") else None
            cmd = [str(ffmpeg), "-y", "-hide_banner", "-framerate", "30",
                   "-i", str(work / "f_%06d.png")]
            if rep is None:
                cmd += ["-i", replacement, "-filter_complex",
                        "[0:v][1:v]overlay=format=auto,format=yuv420p"]
            else:
                color = replacement.lstrip("#")
                cmd += ["-f", "lavfi", "-i",
                        f"color=0x{color}:s=1920x1080",
                        "-filter_complex", "[1:v][0:v]overlay=format=auto,format=yuv420p"]
            cmd += ["-c:v", "libx264", "-crf", "20", output_path]
        else:
            cmd = [str(ffmpeg), "-y", "-hide_banner", "-framerate", "30",
                   "-i", str(work / "f_%06d.png"),
                   "-c:v", "qtrle", "-pix_fmt", "argb", output_path]
        enc = CancellableProcess()
        enc_res = enc.run(cmd)
        if not enc_res.ok:
            raise RuntimeError(f"Encoding failed: {enc_res.stderr[-300:]}")
        return output_path
