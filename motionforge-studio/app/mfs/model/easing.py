"""Easing / interpolation maths.

Everything here is pure python and dependency free so it can be unit tested
and reused by the AI motion planner without a running Qt application.
"""
from __future__ import annotations

import math


# --------------------------------------------------------------------------
# cubic bezier easing (CSS style: cubic-bezier(x1, y1, x2, y2))
# --------------------------------------------------------------------------
def _bezier_axis(t: float, a1: float, a2: float) -> float:
    """Evaluate one axis of a cubic bezier with p0=0, p3=1."""
    mt = 1.0 - t
    return 3.0 * mt * mt * t * a1 + 3.0 * mt * t * t * a2 + t * t * t


def _bezier_derivative(t: float, a1: float, a2: float) -> float:
    mt = 1.0 - t
    return 3.0 * mt * mt * a1 + 6.0 * mt * t * (a2 - a1) + 3.0 * t * t * (1.0 - a2)


def cubic_bezier(x1: float, y1: float, x2: float, y2: float, x: float) -> float:
    """Solve y for a given x on the curve (Newton + bisection fallback)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    t = x
    for _ in range(8):
        err = _bezier_axis(t, x1, x2) - x
        if abs(err) < 1e-6:
            return _bezier_axis(t, y1, y2)
        d = _bezier_derivative(t, x1, x2)
        if abs(d) < 1e-6:
            break
        t -= err / d
    lo, hi = 0.0, 1.0
    t = x
    for _ in range(30):
        cur = _bezier_axis(t, x1, x2)
        if abs(cur - x) < 1e-6:
            break
        if cur < x:
            lo = t
        else:
            hi = t
        t = 0.5 * (lo + hi)
    return _bezier_axis(t, y1, y2)


# --------------------------------------------------------------------------
# named easings
# --------------------------------------------------------------------------
def linear(t: float) -> float:
    return t


def ease_in(t: float) -> float:
    return t * t * t


def ease_out(t: float) -> float:
    return 1.0 - pow(1.0 - t, 3)


def ease_in_out(t: float) -> float:
    return 4.0 * t * t * t if t < 0.5 else 1.0 - pow(-2.0 * t + 2.0, 3) / 2.0


def ease(t: float) -> float:
    # classic Disney "slow in / slow out"
    return t * t * (3.0 - 2.0 * t)


def bounce_out(t: float) -> float:
    n1, d1 = 7.5625, 2.75
    if t < 1.0 / d1:
        return n1 * t * t
    if t < 2.0 / d1:
        t -= 1.5 / d1
        return n1 * t * t + 0.75
    if t < 2.5 / d1:
        t -= 2.25 / d1
        return n1 * t * t + 0.9375
    t -= 2.625 / d1
    return n1 * t * t + 0.984375


def bounce_in(t: float) -> float:
    return 1.0 - bounce_out(1.0 - t)


def elastic_out(t: float) -> float:
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    c4 = (2.0 * math.pi) / 3.0
    return pow(2.0, -10.0 * t) * math.sin((t * 10.0 - 0.75) * c4) + 1.0


def elastic_in(t: float) -> float:
    return 1.0 - elastic_out(1.0 - t)


def back_out(t: float, overshoot: float = 1.70158) -> float:
    return 1.0 + (overshoot + 1.0) * pow(t - 1.0, 3) + overshoot * pow(t - 1.0, 2)


def back_in(t: float, overshoot: float = 1.70158) -> float:
    return (overshoot + 1.0) * t * t * t - overshoot * t * t


def hold(t: float) -> float:
    """Stepped animation - value only changes on the next keyframe."""
    return 0.0 if t < 1.0 else 1.0


def expo_out(t: float) -> float:
    return 1.0 if t >= 1.0 else 1.0 - pow(2.0, -10.0 * t)


def expo_in(t: float) -> float:
    return 0.0 if t <= 0.0 else pow(2.0, 10.0 * t - 10.0)


EASING_FUNCS = {
    "linear": linear,
    "ease": ease,
    "ease_in": ease_in,
    "ease_out": ease_out,
    "ease_in_out": ease_in_out,
    "bounce": bounce_out,
    "bounce_in": bounce_in,
    "bounce_out": bounce_out,
    "elastic": elastic_out,
    "elastic_in": elastic_in,
    "elastic_out": elastic_out,
    "back": back_out,
    "back_in": back_in,
    "back_out": back_out,
    "expo_in": expo_in,
    "expo_out": expo_out,
    "hold": hold,
    "step": hold,
}

EASING_LABELS = [
    ("linear", "Linear"),
    ("ease_in", "Ease In"),
    ("ease_out", "Ease Out"),
    ("ease_in_out", "Ease In Out"),
    ("ease", "Smooth"),
    ("bounce_out", "Bounce Out"),
    ("bounce_in", "Bounce In"),
    ("elastic_out", "Elastic Out"),
    ("elastic_in", "Elastic In"),
    ("back_out", "Back Out (overshoot)"),
    ("back_in", "Back In"),
    ("expo_out", "Expo Out"),
    ("expo_in", "Expo In"),
    ("hold", "Hold / Step"),
    ("custom", "Custom Bezier"),
]


def apply_easing(name: str, t: float, bezier: tuple[float, float, float, float] | None = None) -> float:
    """Map normalised time ``t`` in [0, 1] through the named easing."""
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    if name == "custom":
        bx = bezier or (0.42, 0.0, 0.58, 1.0)
        return cubic_bezier(bx[0], bx[1], bx[2], bx[3], t)
    if name == "hold":
        return hold(t)
    fn = EASING_FUNCS.get(name)
    if fn is None:
        return t
    if name.startswith("back_"):
        return fn(t)  # type: ignore[call-arg]
    return fn(t)


# --------------------------------------------------------------------------
# generic helpers
# --------------------------------------------------------------------------
def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_angle(a: float, b: float, t: float) -> float:
    """Interpolate degrees taking the shortest path around the circle."""
    d = (b - a) % 360.0
    if d > 180.0:
        d -= 360.0
    return a + d * t


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else (hi if v > hi else v)


def smoothstep(t: float) -> float:
    t = clamp(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)
