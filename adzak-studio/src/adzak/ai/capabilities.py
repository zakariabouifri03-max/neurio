"""Honest capability registry for every AI-adjacent feature.

The UI renders these statuses verbatim — a feature marked UNAVAILABLE is
shown greyed out with an explanation, never as a button that pretends to
work.  Statuses:

- ``local``    — implemented in ADZAK itself, runs offline, free.
- ``free``     — implemented, free, may need FFmpeg etc. (all installed deps).
- ``api``      — implemented but requires a user-supplied API key/provider.
- ``unavailable`` — not implemented in this release; shown but disabled.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class FeatureStatus(str, Enum):
    LOCAL = "local"
    FREE = "free"
    API = "api"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class Feature:
    key: str
    studio: str            # image | video | audio | assistant | design
    label: str
    status: FeatureStatus
    detail: str


FEATURES: dict[str, Feature] = {f.key: f for f in [
    # --- AI image studio -------------------------------------------------
    Feature("img.txt2img", "image", "Text-to-image generation", FeatureStatus.API,
            "Requires an image-generation API endpoint and key (OpenAI-compatible /images API or Stable Diffusion WebUI API)."),
    Feature("img.img2img", "image", "Image-to-image transformation", FeatureStatus.API,
            "Supported through the same image provider when its API accepts an input image."),
    Feature("img.inpaint", "image", "Inpainting / object removal", FeatureStatus.UNAVAILABLE,
            "Not implemented in this release."),
    Feature("img.outpaint", "image", "Outpainting", FeatureStatus.UNAVAILABLE,
            "Not implemented in this release."),
    Feature("img.bg_replace", "image", "Background replacement", FeatureStatus.LOCAL,
            "Local chroma/flood-fill removal works offline; swap the background in the photo editor afterwards."),
    Feature("img.upscale", "image", "Enlarge / restore", FeatureStatus.LOCAL,
            "Local high-quality Lanczos/xBR-style upscale via Pillow (not AI super-resolution)."),
    Feature("img.enhance_prompt", "image", "Prompt enhancement", FeatureStatus.API,
            "Uses the configured text/chat provider; works offline as a local template when no key is set."),
    Feature("img.negative", "image", "Negative prompts", FeatureStatus.API,
            "Passed to providers that support them."),
    Feature("img.variations", "image", "Variations & batch generation", FeatureStatus.API,
            "Number of images depends on provider limits."),
    # --- AI video studio -------------------------------------------------
    Feature("vid.txt2vid", "video", "Text-to-video generation", FeatureStatus.API,
            "Connect Runway/Kling-style providers via their official APIs when you have credentials; ADZAK ships the job-queue UI."),
    Feature("vid.img2vid", "video", "Image-to-video generation", FeatureStatus.API,
            "Requires a connected provider."),
    Feature("vid.extend", "video", "AI video extension", FeatureStatus.UNAVAILABLE,
            "Not implemented in this release."),
    Feature("vid.autosub", "video", "Automatic subtitles (speech-to-text)", FeatureStatus.UNAVAILABLE,
            "Needs a speech-to-text engine; whisper.cpp / faster-whisper integration is on the roadmap. Manual SRT editing is available now."),
    Feature("vid.transcribe", "video", "Speech-to-text transcription", FeatureStatus.UNAVAILABLE,
            "Same as above — planned with local Whisper."),
    Feature("vid.translate_subs", "video", "Subtitle translation", FeatureStatus.API,
            "Uses the configured chat provider to translate existing subtitle text."),
    Feature("vid.bg_remove", "video", "Video background removal", FeatureStatus.UNAVAILABLE,
            "Requires per-frame segmentation; not implemented in this release."),
    Feature("vid.silence", "video", "Silence detection & removal", FeatureStatus.FREE,
            "Local FFmpeg silencedetect pipeline — works offline."),
    Feature("vid.highlights", "video", "Automatic highlight extraction", FeatureStatus.UNAVAILABLE,
            "Planned with scene/audio analysis; manual clip extraction is available now."),
    Feature("vid.shorts", "video", "Long-video → shorts workflow", FeatureStatus.LOCAL,
            "Mark ranges and export 9:16 cuts with the built-in exporter."),
    Feature("vid.scenes", "video", "AI-assisted scene detection", FeatureStatus.FREE,
            "Local FFmpeg scene-change detection (threshold based, not ML)."),
    # --- audio ------------------------------------------------------------
    Feature("aud.denoise", "audio", "Noise reduction", FeatureStatus.FREE,
            "Local ffmpeg afftdn filter — offline spectral denoise."),
    Feature("aud.stt", "audio", "Speech-to-text", FeatureStatus.UNAVAILABLE,
            "Planned with local Whisper."),
    Feature("aud.tts", "audio", "Text-to-speech", FeatureStatus.API,
            "Uses a TTS API when configured; Windows also has system voices usable by other apps."),
    Feature("aud.normalize", "audio", "Loudness normalisation", FeatureStatus.FREE,
            "Local ffmpeg volumedetect + volume pipeline."),
    # --- assistant ---------------------------------------------------------
    Feature("asst.chat", "assistant", "Creative assistant chat", FeatureStatus.LOCAL,
            "Offline knowledge base works without any key; connecting a chat provider adds live answers."),
    Feature("asst.titles", "assistant", "Titles / captions / hashtags", FeatureStatus.LOCAL,
            "Offline generator with category templates."),
    Feature("asst.script", "assistant", "Video script writer", FeatureStatus.LOCAL,
            "Offline structured script templates."),
    Feature("asst.prompts", "assistant", "Image prompt builder", FeatureStatus.LOCAL,
            "Offline prompt composition helpers."),
    Feature("asst.exports", "assistant", "Export settings advisor", FeatureStatus.LOCAL,
            "Rules-based recommendations from the preset table."),
    # --- design --------------------------------------------------------------
    Feature("design.templates", "design", "Templates & brand kits", FeatureStatus.LOCAL,
            "Ships with original ADZAK templates."),
]}


def by_studio(studio: str) -> list[Feature]:
    return [f for f in FEATURES.values() if f.studio == studio]


def status_counts() -> dict[str, int]:
    counts = {s.value: 0 for s in FeatureStatus}
    for f in FEATURES.values():
        counts[f.status.value] += 1
    return counts
