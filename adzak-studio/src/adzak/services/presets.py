"""Export presets and aspect-ratio definitions.

These are honest presets: they only name codecs ADZAK's FFmpeg pipeline can
actually encode (libx264 / libx265 / aac / opus / mp3 / gif / png…).
Bit-rate estimates are used by the UI to show an estimated file size before
the user starts a render.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class AspectRatio:
    name: str
    w: int
    h: int

    @property
    def ratio(self) -> float:
        return self.w / self.h


ASPECT_RATIOS: dict[str, AspectRatio] = {
    "16:9": AspectRatio("16:9 (YouTube)", 1920, 1080),
    "9:16": AspectRatio("9:16 (TikTok / Reels / Shorts)", 1080, 1920),
    "1:1": AspectRatio("1:1 (Square)", 1080, 1080),
    "4:5": AspectRatio("4:5 (Instagram portrait)", 1080, 1350),
    "4:3": AspectRatio("4:3 (Classic)", 1440, 1080),
    "21:9": AspectRatio("21:9 (Cinematic)", 2560, 1080),
}


@dataclass(frozen=True)
class ExportPreset:
    id: str
    label: str
    container: str
    vcodec: str
    acodec: str
    width: int
    height: int
    fps: float
    crf: int                 # quality (lower = better) for x264/x265
    preset: str              # x264 speed preset
    audio_bitrate_k: int = 192
    category: str = "general"
    notes: str = ""

    def video_bitrate_estimate_kbps(self) -> int:
        """Rough x264 CRF→bitrate heuristic used for the size estimator."""
        pixels_per_frame = self.width * self.height
        # baseline at crf 23 ≈ 0.07 bits/pixel, scales with resolution demand
        bpp = 0.07 * (23.0 / max(self.crf, 1))
        return int(pixels_per_frame * self.fps * bpp / 1000)

    def estimated_size_mb(self, duration_s: float) -> float:
        vb = self.video_bitrate_estimate_kbps()
        total_kbps = vb + self.audio_bitrate_k
        return round(total_kbps * duration_s / 8 / 1000, 1)


PRESETS: dict[str, ExportPreset] = {
    p.id: p for p in [
        ExportPreset("youtube-1080", "YouTube 1080p (H.264)", "mp4", "libx264", "aac",
                     1920, 1080, 30, 18, "medium", 256, "youtube",
                     "Recommended quality for YouTube uploads."),
        ExportPreset("youtube-4k", "YouTube 4K (H.264)", "mp4", "libx264", "aac",
                     3840, 2160, 30, 18, "medium", 256, "youtube",
                     "Needs a decent CPU; slow on low-end PCs."),
        ExportPreset("youtube-hevc", "YouTube 4K (H.265, smaller files)", "mp4",
                     "libx265", "aac", 3840, 2160, 30, 22, "medium", 256, "youtube",
                     "Smaller files, slower encode. Some old players lack HEVC."),
        ExportPreset("tiktok-1080", "TikTok / Shorts 1080×1920", "mp4", "libx264", "aac",
                     1080, 1920, 30, 20, "medium", 160, "tiktok"),
        ExportPreset("instagram-reel", "Instagram Reel 1080×1920", "mp4", "libx264", "aac",
                     1080, 1920, 30, 20, "medium", 160, "instagram"),
        ExportPreset("instagram-square", "Instagram Square 1080×1080", "mp4",
                     "libx264", "aac", 1080, 1080, 30, 20, "medium", 160, "instagram"),
        ExportPreset("instagram-45", "Instagram 4:5 1080×1350", "mp4", "libx264",
                     "aac", 1080, 1350, 30, 20, "medium", 160, "instagram"),
        ExportPreset("web-720", "Web 720p (small file)", "mp4", "libx264", "aac",
                     1280, 720, 30, 23, "veryfast", 128, "web",
                     "Fast encode, good for previews and low-end machines."),
        ExportPreset("archive-1080", "Archive 1080p (high quality)", "mkv",
                     "libx264", "aac", 1920, 1080, 30, 16, "slow", 256, "archive"),
        ExportPreset("gif-web", "Animated GIF (web)", "gif", "gif", "none",
                     640, 360, 15, 0, "veryfast", 0, "web",
                     "GIF has no audio and a 256-colour palette."),
    ]
}


def presets_for(category: str) -> list[ExportPreset]:
    return [p for p in PRESETS.values() if p.category == category]


@dataclass
class AudioPreset:
    id: str
    label: str
    codec: str
    container: str
    bitrate_k: int
    sample_rate: int


AUDIO_PRESETS: dict[str, AudioPreset] = {
    a.id: a for a in [
        AudioPreset("mp3-192", "MP3 192 kbps", "libmp3lame", "mp3", 192, 44100),
        AudioPreset("mp3-320", "MP3 320 kbps", "libmp3lame", "mp3", 320, 44100),
        AudioPreset("aac-192", "AAC 192 kbps (m4a)", "aac", "m4a", 192, 48000),
        AudioPreset("opus-128", "Opus 128 kbps (ogg)", "libopus", "ogg", 128, 48000),
        AudioPreset("wav", "WAV (lossless)", "pcm_s16le", "wav", 0, 44100),
        AudioPreset("flac", "FLAC (lossless)", "flac", "flac", 0, 44100),
    ]
}


IMAGE_FORMATS = {
    "png": {"label": "PNG (lossless, transparency)", "supports_alpha": True},
    "jpg": {"label": "JPEG (small, no transparency)", "supports_alpha": False},
    "webp": {"label": "WebP (modern, transparency)", "supports_alpha": True},
    "bmp": {"label": "BMP (uncompressed)", "supports_alpha": False},
    "tiff": {"label": "TIFF (lossless)", "supports_alpha": True},
}
