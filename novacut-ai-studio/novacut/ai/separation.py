"""Vocal / accompaniment separation via an optional local Demucs model."""
from __future__ import annotations

from pathlib import Path

from ..core import paths
from ..core.logging_setup import get_logger
from .base import AITool, ToolStatus

log = get_logger("ai-separation")


class AudioSeparator(AITool):
    id = "separation"
    name = "Audio separation"
    description = "Split a track into vocals and accompaniment with Demucs."
    needs_model = True
    model_kind = "demucs"

    def check(self) -> ToolStatus:
        if not self.module_available("demucs") or not self.module_available("torch"):
            return self.unavailable(
                "Demucs is not installed. Install 'demucs' (pulls PyTorch, "
                "~2 GB). The first run downloads the htdemucs weights (~80 MB).")
        return self.available(
            requirements="demucs + torch; htdemucs weights fetched on first run",
            resource_note="CPU separation of a 4-minute song takes several minutes.")

    def separate(self, input_path: str, output_dir: str | None = None,
                 two_stems: bool = True,
                 progress=None, should_cancel=None) -> dict[str, str]:
        """Run Demucs locally. Returns stem name -> WAV path."""
        self.ensure_ready()
        import torch
        from demucs.separate import main as demucs_main
        output_dir = output_dir or str(paths.CACHE_DIR / "separated")
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        argv = ["-n", "htdemucs", "-o", output_dir]
        if two_stems:
            argv += ["--two-stems", "vocals"]
        argv += [str(input_path)]
        log.info("Running demucs: %s", argv)
        # Demucs prints its own progress to stderr; run in a worker thread so
        # the UI stays responsive. Indeterminate progress is reported while
        # the model runs because Demucs offers no machine-readable progress.
        if progress:
            progress(0.05, "Demucs is processing (indeterminate)...")
        demucs_main(argv)
        stem_dir = Path(output_dir) / "htdemucs" / Path(input_path).stem
        stems = {p.stem: str(p) for p in stem_dir.glob("*.wav")}
        if not stems:
            raise RuntimeError("Demucs produced no output files.")
        if progress:
            progress(1.0, f"{len(stems)} stems written")
        return stems
