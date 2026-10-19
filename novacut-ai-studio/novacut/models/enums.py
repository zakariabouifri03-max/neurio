"""Enumerations shared by the domain model."""
from __future__ import annotations

from enum import Enum


class ClipKind(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"
    IMAGE = "image"
    TITLE = "title"
    COLOR = "color"


class TrackKind(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"


class EffectType(str, Enum):
    COLOR = "color"            # exposure/contrast/saturation/temperature/tint
    LUT = "lut"                # 3D LUT file
    CHROMA_KEY = "chroma_key"
    MASK = "mask"
    BLUR = "blur"
    SHARPEN = "sharpen"
    VIGNETTE = "vignette"
    DENOISE = "denoise"
    OPACITY = "opacity"        # handled separately but kept for effect-stack UX
    AUDIO_EQ = "audio_eq"
    AUDIO_NOISE_REDUCTION = "audio_noise_reduction"
    VOICE_ENHANCE = "voice_enhance"


class TransitionType(str, Enum):
    FADE = "fade"
    DISSOLVE = "dissolve"
    WIPE_LEFT = "wipe_left"
    WIPE_RIGHT = "wipe_right"
    SLIDE_LEFT = "slide_left"
    SLIDE_RIGHT = "slide_right"
    ZOOM = "zoom"


class TitleAnimation(str, Enum):
    NONE = "none"
    FADE = "fade"
    TYPEWRITER = "typewriter"
    SLIDE_UP = "slide_up"
    POP = "pop"


class MarkerColor(str, Enum):
    YELLOW = "#f5c542"
    RED = "#e5484d"
    GREEN = "#3cb371"
    BLUE = "#4a90e2"
    PURPLE = "#9b59b6"
    WHITE = "#e8e8e8"
