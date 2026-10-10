"""Honest capability registry: every feature is labelled by where it runs and what it costs."""
from __future__ import annotations

from dataclasses import dataclass

LOCAL = "local"            # runs offline on this computer, free
FREE_ONLINE = "free_online"  # needs internet but no paid API
PAID_API = "paid_api"      # needs the user's own API key and is billed by the provider
UNAVAILABLE = "unavailable"  # not implemented in this build


@dataclass(frozen=True)
class Capability:
    key: str
    name: str
    status: str
    note: str


CAPABILITIES: list[Capability] = [
    Capability("video_edit", "Timeline editing, trim, split, speed, reverse", LOCAL, "FFmpeg, offline"),
    Capability("video_export", "Video export (H.264 / H.265 / VP9)", LOCAL, "CPU encode; slow on low-end PCs"),
    Capability("chroma", "Green-screen chroma key", LOCAL, "FFmpeg chromakey"),
    Capability("stabilize", "Video stabilisation", LOCAL, "FFmpeg deshake (basic)"),
    Capability("silence", "Silence detection and removal", LOCAL, "FFmpeg silencedetect"),
    Capability("scenes", "Scene-change detection", LOCAL, "FFmpeg scene score"),
    Capability("photo", "Photo editing, layers, adjustments, filters", LOCAL, "Pillow + OpenCV"),
    Capability("bg_remove", "Background removal", LOCAL, "OpenCV GrabCut (rectangle-guided, basic)"),
    Capability("inpaint", "Object removal (inpainting)", LOCAL, "OpenCV Telea"),
    Capability("convert", "Media converter / compressor / batch tools", LOCAL, "FFmpeg + Pillow"),
    Capability("audio_edit", "Audio trim, merge, normalise, denoise, EQ", LOCAL, "FFmpeg filters"),
    Capability("subtitles", "Subtitle conversion SRT ↔ VTT, timing shift", LOCAL, "Pure Python"),
    Capability("assistant_offline", "AI assistant: how-to help, titles, hashtags, scripts", LOCAL,
               "Built-in rules, no internet"),
    Capability("assistant_online", "AI assistant with a language model", PAID_API,
               "Needs your own API key (OpenAI-compatible endpoint); provider bills you"),
    Capability("transcribe", "Speech-to-text and automatic subtitles", UNAVAILABLE,
               "No local speech model is bundled in this build"),
    Capability("tts", "Text-to-speech voice-over", UNAVAILABLE, "Not implemented in this build"),
    Capability("voice_record", "Voice recording", UNAVAILABLE, "Not implemented in this build"),
    Capability("ai_image", "AI image generation / inpainting with AI models", UNAVAILABLE,
               "Requires a local model or a provider integration that is not configured in this build"),
    Capability("ai_video", "AI text-to-video / image-to-video (Runway, Kling, etc.)", UNAVAILABLE,
               "Requires provider API credentials and integration not included in this build"),
    Capability("keyframes", "Keyframe animation curves and transitions", UNAVAILABLE,
               "Not implemented yet (fade in/out only)"),
]

STATUS_LABELS = {
    LOCAL: "Local · free",
    FREE_ONLINE: "Online · free",
    PAID_API: "Paid API · needs your key",
    UNAVAILABLE: "Not available",
}
