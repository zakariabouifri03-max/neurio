"""Application-wide constants and supported format tables."""
from __future__ import annotations

VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".wmv", ".flv",
    ".mpg", ".mpeg", ".ts", ".m2ts", ".3gp", ".ogv",
}
AUDIO_EXTENSIONS = {
    ".wav", ".mp3", ".aac", ".m4a", ".flac", ".ogg", ".oga", ".wma", ".opus",
}
IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp",
}
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | AUDIO_EXTENSIONS | IMAGE_EXTENSIONS

# Project presets: id -> (label, width, height, fps)
PROJECT_PRESETS = {
    "landscape_1080": ("Landscape 1080p", 1920, 1080, 30.0),
    "landscape_720": ("Landscape 720p", 1280, 720, 30.0),
    "landscape_4k": ("Landscape 4K UHD", 3840, 2160, 30.0),
    "vertical_1080": ("Vertical 1080x1920", 1080, 1920, 30.0),
    "vertical_720": ("Vertical 720x1280", 720, 1280, 30.0),
    "square_1080": ("Square 1080x1080", 1080, 1080, 30.0),
    "square_720": ("Square 720x720", 720, 720, 30.0),
}

EXPORT_RESOLUTIONS = {
    "480p": (854, 480),
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "1440p": (2560, 1440),
    "4K": (3840, 2160),
    "Source": None,  # use project resolution
}
EXPORT_FPS = [24.0, 25.0, 30.0, 50.0, 60.0]

VIDEO_CODECS = {
    # id -> (ffmpeg encoder, label, hardware?)
    "h264_cpu": ("libx264", "H.264 / AVC (CPU, x264)", False),
    "h265_cpu": ("libx265", "H.265 / HEVC (CPU, x265)", False),
    "h264_nvenc": ("h264_nvenc", "H.264 NVIDIA NVENC", True),
    "h265_nvenc": ("hevc_nvenc", "H.265 NVIDIA NVENC", True),
    "h264_qsv": ("h264_qsv", "H.264 Intel Quick Sync", True),
    "h265_qsv": ("hevc_qsv", "H.265 Intel Quick Sync", True),
    "h264_amf": ("h264_amf", "H.264 AMD AMF", True),
    "h265_amf": ("hevc_amf", "H.265 AMD AMF", True),
}
AUDIO_CODECS = {
    "aac": ("aac", "AAC"),
    "libmp3lame": ("libmp3lame", "MP3"),
    "libopus": ("libopus", "Opus"),
    "pcm_s16le": ("pcm_s16le", "PCM 16-bit (WAV)"),
    "libvorbis": ("libvorbis", "Vorbis"),
}
CONTAINER_FORMATS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".wav"}

# Thumbnail / waveform cache geometry
THUMB_WIDTH = 160
THUMB_HEIGHT = 90
WAVEFORM_BINS = 96

# Autosave
AUTOSAVE_INTERVAL_S = 60
KEEP_AUTOSAVES = 5
