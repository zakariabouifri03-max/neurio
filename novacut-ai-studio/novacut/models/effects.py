"""Effect and transition catalog plus serializable parameter containers."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from typing import Any

from .enums import EffectType, TransitionType


# Catalog: type -> {label, category, params: {name: (default, min, max, step)}}
EFFECT_CATALOG: dict[str, dict[str, Any]] = {
    EffectType.COLOR.value: {
        "label": "Color correction",
        "category": "Color",
        "params": {
            "exposure": (0.0, -2.0, 2.0, 0.05),       # stops -> eq brightness/gamma
            "contrast": (0.0, -1.0, 1.0, 0.05),
            "saturation": (0.0, -1.0, 1.0, 0.05),
            "temperature": (0.0, -1.0, 1.0, 0.05),    # warm <-> cool
            "tint": (0.0, -1.0, 1.0, 0.05),           # green <-> magenta
            "highlights": (0.0, -1.0, 1.0, 0.05),
            "shadows": (0.0, -1.0, 1.0, 0.05),
        },
    },
    EffectType.LUT.value: {
        "label": "LUT (3D lookup table)",
        "category": "Color",
        "params": {"lut_path": ("", None, None, None), "intensity": (1.0, 0.0, 1.0, 0.05)},
    },
    EffectType.CHROMA_KEY.value: {
        "label": "Chroma key",
        "category": "Keying",
        "params": {
            "color": ("#00ff00", None, None, None),
            "similarity": (0.18, 0.01, 1.0, 0.01),
            "blend": (0.10, 0.0, 1.0, 0.01),
            "spill": (0.0, 0.0, 1.0, 0.05),
        },
    },
    EffectType.MASK.value: {
        "label": "Mask",
        "category": "Transform",
        "params": {
            "shape": ("rectangle", None, None, None),  # rectangle | ellipse
            "x": (0.5, 0.0, 1.0, 0.01), "y": (0.5, 0.0, 1.0, 0.01),
            "width": (1.0, 0.0, 1.0, 0.01), "height": (1.0, 0.0, 1.0, 0.01),
            "feather": (0.05, 0.0, 0.5, 0.01), "invert": (0.0, 0.0, 1.0, 1.0),
        },
    },
    EffectType.BLUR.value: {
        "label": "Gaussian blur",
        "category": "Blur",
        "params": {"radius": (8.0, 0.0, 100.0, 1.0)},
    },
    EffectType.SHARPEN.value: {
        "label": "Sharpen",
        "category": "Detail",
        "params": {"amount": (0.5, 0.0, 2.0, 0.05)},
    },
    EffectType.VIGNETTE.value: {
        "label": "Vignette",
        "category": "Style",
        "params": {"angle": (0.0, 0.0, 3.14159, 0.01), "strength": (0.5, 0.0, 1.0, 0.05)},
    },
    EffectType.DENOISE.value: {
        "label": "Denoise (video)",
        "category": "Repair",
        "params": {"strength": (4.0, 1.0, 10.0, 0.5)},
    },
    EffectType.AUDIO_EQ.value: {
        "label": "Equalizer",
        "category": "Audio",
        "params": {
            "bass": (0.0, -12.0, 12.0, 0.5),
            "mid": (0.0, -12.0, 12.0, 0.5),
            "treble": (0.0, -12.0, 12.0, 0.5),
        },
    },
    EffectType.AUDIO_NOISE_REDUCTION.value: {
        "label": "Noise reduction",
        "category": "Audio",
        "params": {"intensity": (0.5, 0.0, 1.0, 0.05)},
    },
    EffectType.VOICE_ENHANCE.value: {
        "label": "Voice enhance",
        "category": "Audio",
        "params": {"intensity": (0.5, 0.0, 1.0, 0.05)},
    },
}


def default_params(effect_type: str) -> dict[str, Any]:
    spec = EFFECT_CATALOG.get(effect_type)
    if not spec:
        return {}
    return {name: meta[0] for name, meta in spec["params"].items()}


@dataclass
class Effect:
    type: str
    params: dict[str, Any] = field(default_factory=dict)
    enabled: bool = True
    id: str = field(default_factory=lambda: f"fx_{uuid.uuid4().hex[:10]}")

    def __post_init__(self) -> None:
        if not self.params:
            self.params = default_params(self.type)

    @property
    def label(self) -> str:
        return EFFECT_CATALOG.get(self.type, {}).get("label", self.type)

    def get(self, name: str, default: Any = None) -> Any:
        return self.params.get(name, default)

    def set(self, name: str, value: Any) -> None:
        self.params[name] = value

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Effect":
        return cls(type=d["type"], params=dict(d.get("params", {})),
                   enabled=d.get("enabled", True), id=d.get("id", f"fx_{uuid.uuid4().hex[:10]}"))


@dataclass
class Transition:
    type: str = TransitionType.DISSOLVE.value
    duration: float = 0.5
    direction: str = "in"                     # in | out
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Transition":
        return cls(type=d.get("type", TransitionType.DISSOLVE.value),
                   duration=float(d.get("duration", 0.5)),
                   direction=d.get("direction", "in"),
                   params=dict(d.get("params", {})))


@dataclass
class Keyframe:
    property: str                             # opacity | scale | pos_x | pos_y | rotation | gain
    time: float                               # timeline seconds
    value: float
    easing: str = "linear"                    # linear | ease_in | ease_out | smooth

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Keyframe":
        return cls(property=d["property"], time=float(d["time"]),
                   value=float(d["value"]), easing=d.get("easing", "linear"))
