"""Brush presets and pressure/tablet helpers."""
from __future__ import annotations

from ..model.cel import BrushSettings

# --------------------------------------------------------------------------
# built in presets (the brush library also stores user presets as assets)
# --------------------------------------------------------------------------
def default_brushes() -> list[BrushSettings]:
    return [
        BrushSettings(name="Pencil", kind="pencil", size=6, hardness=1.0,
                      smoothing=0.25, stabilize=0.15, pressure_size=True),
        BrushSettings(name="Ink Pen", kind="ink", size=10, hardness=1.0,
                      smoothing=0.35, stabilize=0.35, pressure_size=True,
                      taper_in=0.15, taper_out=0.25),
        BrushSettings(name="Inker (thick/thin)", kind="ink", size=16, hardness=1.0,
                      smoothing=0.4, stabilize=0.45, pressure_size=True,
                      taper_in=0.25, taper_out=0.35),
        BrushSettings(name="Marker", kind="marker", size=28, opacity=0.75,
                      hardness=0.9, smoothing=0.2, stabilize=0.1),
        BrushSettings(name="Soft Brush", kind="soft", size=44, opacity=0.55,
                      hardness=0.2, smoothing=0.3, stabilize=0.15, spacing=0.12),
        BrushSettings(name="Airbrush", kind="airbrush", size=80, opacity=0.25,
                      hardness=0.05, smoothing=0.3, stabilize=0.2, spacing=0.08),
        BrushSettings(name="Charcoal", kind="charcoal", size=36, opacity=0.65,
                      hardness=0.45, smoothing=0.25, texture=0.7, spacing=0.1),
        BrushSettings(name="Eraser Soft", kind="eraser", size=40, opacity=1.0,
                      hardness=0.35, smoothing=0.3, stabilize=0.2),
        BrushSettings(name="Eraser Hard", kind="eraser", size=18, opacity=1.0,
                      hardness=1.0, smoothing=0.25, stabilize=0.15),
        BrushSettings(name="Calligraphy", kind="ink", size=14, hardness=1.0,
                      smoothing=0.45, stabilize=0.55, pressure_size=True, taper_out=0.4),
    ]


def brush_by_name(name: str) -> BrushSettings | None:
    for b in default_brushes():
        if b.name.lower() == name.lower():
            return b.copy()
    return None


# --------------------------------------------------------------------------
# pressure / stroke dynamics
# --------------------------------------------------------------------------
def pressure_curve(p: float, curve: float = 1.0) -> float:
    """Map raw tablet pressure (0..1) through a response curve."""
    p = 0.0 if p < 0.0 else (1.0 if p > 1.0 else p)
    if curve == 1.0:
        return p
    return p ** curve


def width_for(brush: BrushSettings, pressure: float, speed: float = 0.0) -> float:
    """Stroke width in pixels for the current pressure/speed."""
    p = pressure_curve(pressure, 1.0) if brush.pressure_size else 1.0
    # a light speed modulation keeps fast strokes from looking wobbling-fat
    speed_factor = 1.0
    if speed > 0.0:
        speed_factor = max(0.55, 1.0 - min(speed, 4000.0) / 8000.0)
    w = brush.size * (0.15 + 0.85 * p) * speed_factor
    return max(0.6, w)


def opacity_for(brush: BrushSettings, pressure: float) -> float:
    if not brush.pressure_opacity:
        return brush.opacity
    return max(0.02, brush.opacity * (0.25 + 0.75 * pressure))


class Stabilizer:
    """Position smoothing / stabilisation used while drawing.

    ``smoothing`` blends the raw mouse position with the previous point, while
    ``stabilize`` pulls the cursor behind on a spring - the classic "lazy"
    stabiliser animators use for clean line art.
    """

    def __init__(self, smoothing: float = 0.35, stabilize: float = 0.25):
        self.smoothing = smoothing
        self.stabilize = stabilize
        self._pos: tuple[float, float] | None = None
        self._vel = (0.0, 0.0)

    def reset(self) -> None:
        self._pos = None
        self._vel = (0.0, 0.0)

    def update(self, x: float, y: float) -> tuple[float, float]:
        if self._pos is None:
            self._pos = (x, y)
            self._vel = (0.0, 0.0)
            return self._pos
        px, py = self._pos
        s = max(0.0, min(0.95, self.smoothing))
        sx = px + (x - px) * (1.0 - s)
        sy = py + (y - py) * (1.0 - s)
        st = max(0.0, min(0.95, self.stabilize))
        if st > 0.0:
            vx = sx - px
            vy = sy - py
            self._vel = (self._vel[0] * st + vx * (1.0 - st),
                         self._vel[1] * st + vy * (1.0 - st))
            sx = px + self._vel[0]
            sy = py + self._vel[1]
        self._pos = (sx, sy)
        return self._pos

    def flush(self, x: float, y: float) -> list[tuple[float, float]]:
        """Catch-up points so the stroke reaches the cursor."""
        if self._pos is None:
            return [(x, y)]
        out = []
        px, py = self._pos
        for i in range(1, 4):
            t = i / 3.0
            out.append((px + (x - px) * t, py + (y - py) * t))
        self._pos = (x, y)
        return out
