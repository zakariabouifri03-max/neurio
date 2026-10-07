"""Scene compositing: layers, cels, rigs, blend modes, camera, onion skin."""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import (QColor, QImage, QPainter, QTransform)

from ..model.cel import BitmapCel, Cel, ImageCel, TextCel, VectorCel
from ..model.layer import Layer
from ..model.scene import Scene
from . import vector as vec

# --------------------------------------------------------------------------
# blend modes
# --------------------------------------------------------------------------
_CM = QPainter.CompositionMode
BLEND_MAP = {
    "normal": _CM.CompositionMode_SourceOver,
    "multiply": _CM.CompositionMode_Multiply,
    "screen": _CM.CompositionMode_Screen,
    "overlay": _CM.CompositionMode_Overlay,
    "darken": _CM.CompositionMode_Darken,
    "lighten": _CM.CompositionMode_Lighten,
    "color_dodge": _CM.CompositionMode_ColorDodge,
    "color_burn": _CM.CompositionMode_ColorBurn,
    "hard_light": _CM.CompositionMode_HardLight,
    "soft_light": _CM.CompositionMode_SoftLight,
    "difference": _CM.CompositionMode_Difference,
    "exclusion": _CM.CompositionMode_Exclusion,
    "add": _CM.CompositionMode_Plus,
}


def blend_mode(name: str):
    return BLEND_MAP.get(name, _CM.CompositionMode_SourceOver)


QUALITY_SCALE = {"draft": 0.5, "normal": 1.0, "high": 1.0, "final": 1.0}


@dataclass
class RenderOptions:
    frame: float = 1.0
    size: tuple[int, int] | None = None          # output pixel size
    background: bool = True
    camera: bool = True
    quality: str = "normal"
    check_background_color: str | None = None
    only_layer: str | None = None
    skip_hidden: bool = True
    for_export: bool = False

    def out_size(self, scene: Scene) -> tuple[int, int]:
        return self.size or (scene.width, scene.height)

    def scale(self) -> float:
        return QUALITY_SCALE.get(self.quality, 1.0)


# --------------------------------------------------------------------------
# transforms
# --------------------------------------------------------------------------
def layer_transform(layer: Layer, frame: float) -> QTransform:
    t = layer.transform.value_at(frame)
    tr = QTransform()
    ax, ay = t.anchor_x, t.anchor_y
    tr.translate(t.x + ax, t.y + ay)
    if t.rotation:
        tr.rotate(t.rotation)
    if t.scale_x != 100.0 or t.scale_y != 100.0:
        tr.scale(t.scale_x / 100.0, t.scale_y / 100.0)
    if t.skew_x or t.skew_y:
        tr.shear(t.skew_x / 100.0, t.skew_y / 100.0)
    tr.translate(-ax, -ay)
    return tr


def camera_transform(scene: Scene, frame: float, out_size: tuple[int, int]) -> QTransform:
    cam = scene.camera_at(int(frame))
    v = cam.value_at(frame)
    sx, sy, sr = cam.shake_at(frame)
    base = min(out_size[0] / max(1, scene.width), out_size[1] / max(1, scene.height))
    tr = QTransform()
    tr.translate(out_size[0] / 2.0, out_size[1] / 2.0)
    tr.rotate(v["rotation"] + sr)
    tr.scale(base * v["zoom"] / 100.0, base * v["zoom"] / 100.0)
    tr.translate(-(v["x"] + sx), -(v["y"] + sy))
    return tr


def scene_to_output(scene: Scene, frame: float, out_size: tuple[int, int]) -> QTransform:
    base = min(out_size[0] / max(1, scene.width), out_size[1] / max(1, scene.height))
    tr = QTransform()
    tr.scale(base, base)
    return tr


def fit_transform(source: QImage, cel: ImageCel, scene_size: tuple[int, int]) -> QTransform:
    tr = QTransform()
    if source.isNull():
        return tr
    sw, sh = source.width(), source.height()
    cw, ch = scene_size
    s = cel.scale
    if cel.fit == "fit":
        s *= min(cw / max(1, sw), ch / max(1, sh))
    elif cel.fit == "fill":
        s *= max(cw / max(1, sw), ch / max(1, sh))
    elif cel.fit == "stretch":
        tr.scale(cw / max(1, sw) * cel.scale, ch / max(1, sh) * cel.scale)
        tr.translate(cel.offset[0], cel.offset[1])
        return tr
    if abs(s - 1.0) > 1e-9:
        tr.scale(s, s)
    tr.translate(cel.offset[0], cel.offset[1])
    return tr


# --------------------------------------------------------------------------
# cel painting
# --------------------------------------------------------------------------
def paint_cel(painter: QPainter, cel: Cel, scene: Scene, project, extra_transform: QTransform | None = None,
              opacity: float = 1.0) -> None:
    """Draw a single cel with the given painter (already in cel space)."""
    if cel is None:
        return
    painter.save()
    if extra_transform is not None:
        painter.setTransform(extra_transform, True)
    if opacity < 1.0:
        painter.setOpacity(painter.opacity() * opacity)
    if isinstance(cel, BitmapCel):
        painter.setRenderHint(QPainter.SmoothPixmapTransform, True)
        painter.drawImage(0, 0, cel.image)
    elif isinstance(cel, VectorCel):
        vec.paint_vector_cel(painter, cel)
    elif isinstance(cel, TextCel):
        vec.paint_text_cel(painter, cel)
    elif isinstance(cel, ImageCel):
        img = load_asset_image(project, cel.asset_id)
        if img is not None and not img.isNull():
            painter.setRenderHint(QPainter.SmoothPixmapTransform, True)
            painter.setTransform(fit_transform(img, cel, (scene.width, scene.height)), True)
            painter.drawImage(0, 0, img)
    painter.restore()


@lru_cache(maxsize=96)
def _cached_image(asset_id: str, data: bytes) -> QImage:
    img = QImage()
    img.loadFromData(data)
    return img


def load_asset_image(project, asset_id: str | None) -> QImage | None:
    asset = project.asset(asset_id) if project else None
    if asset is None or not asset.data:
        return None
    try:
        return _cached_image(asset.uid, bytes(asset.data))
    except Exception:
        img = QImage()
        img.loadFromData(bytes(asset.data))
        return img


def clear_asset_cache() -> None:
    _cached_image.cache_clear()


# --------------------------------------------------------------------------
# rig painting
# --------------------------------------------------------------------------
def paint_rig(painter: QPainter, rig, project, frame: float, worlds=None,
              gizmos: bool = False, gizmo_style: str = "bones") -> dict:
    """Draw bone attached artwork and return the solved world transforms."""
    worlds = worlds if worlds is not None else rig.solve(frame)
    if not rig.visible:
        return worlds
    painter.save()
    painter.setRenderHint(QPainter.SmoothPixmapTransform, True)
    items = []
    for bone in rig.bones.values():
        if not bone.visible or not bone.asset_id:
            continue
        w = worlds.get(bone.uid)
        if w is None:
            continue
        items.append((bone.z_order, bone, w))
    for _, bone, w in sorted(items, key=lambda x: x[0]):
        img = load_asset_image(project, bone.asset_id)
        if img is None or img.isNull():
            continue
        painter.save()
        painter.translate(w.head[0], w.head[1])
        painter.rotate(w.world_angle)
        painter.scale(bone.asset_scale, bone.asset_scale)
        painter.translate(bone.asset_offset[0], bone.asset_offset[1])
        if bone.asset_angle:
            painter.rotate(bone.asset_angle)
        painter.drawImage(0, 0, img)
        painter.restore()
    painter.restore()
    return worlds


def paint_rig_overlay(painter: QPainter, rig, worlds: dict, frame: float,
                      selected_bone: str | None = None, scale: float = 1.0,
                      show_labels: bool = False, hovered: str | None = None) -> None:
    """Bone gizmos - editor only (never part of the export)."""
    from PySide6.QtGui import QBrush, QPen, QPolygonF
    painter.save()
    painter.setRenderHint(QPainter.Antialiasing, True)
    for uid, w in worlds.items():
        bone = rig.bones.get(uid)
        if bone is None or not bone.visible:
            continue
        selected = uid == selected_bone
        hover = uid == hovered
        col = QColor("#ffd166" if selected else ("#ffffff" if hover else bone.color))
        width = max(1.0, (3.2 if selected else 2.0) / max(0.2, scale))
        pen = QPen(col, width)
        pen.setCosmetic(False)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)
        painter.drawLine(QPointF(*w.head), QPointF(*w.tail))
        # bone shape
        import math
        ang = math.radians(w.world_angle)
        nx, ny = -math.sin(ang), math.cos(ang)
        bw = max(3.0, min(12.0, w.length * 0.14)) / max(0.4, scale)
        hs, ts = 0.22, 0.86
        hx, hy = w.head
        tx, ty = w.head[0] + math.cos(ang) * w.length * hs, w.head[1] + math.sin(ang) * w.length * hs
        mx = w.head[0] + (w.tail[0] - w.head[0]) * ts
        my = w.head[1] + (w.tail[1] - w.head[1]) * ts
        poly = QPolygonF([
            QPointF(hx + nx * 1.5 / max(0.4, scale), hy + ny * 1.5 / max(0.4, scale)),
            QPointF(tx + nx * bw, ty + ny * bw),
            QPointF(mx, my),
            QPointF(tx - nx * bw, ty - ny * bw),
            QPointF(hx - nx * 1.5 / max(0.4, scale), hy - ny * 1.5 / max(0.4, scale)),
        ])
        fill = QColor(col)
        fill.setAlpha(70 if selected else 38)
        painter.setBrush(QBrush(fill))
        painter.drawPolygon(poly)
        # joints
        painter.setBrush(QBrush(QColor("#101018")))
        painter.setPen(QPen(col, width))
        r = max(2.5, (4.5 if selected else 3.4) / max(0.4, scale))
        painter.drawEllipse(QPointF(*w.head), r, r)
        painter.setBrush(QBrush(col))
        painter.drawEllipse(QPointF(*w.tail), r * 0.8, r * 0.8)
        if show_labels:
            painter.setPen(QPen(QColor("#ffffff")))
            f = painter.font()
            f.setPointSizeF(max(6.0, 9.0 / max(0.4, scale)))
            painter.setFont(f)
            painter.drawText(QPointF(w.mid[0], w.mid[1] - 6 / max(0.4, scale)), bone.name)
    # IK targets
    painter.setPen(QPen(QColor("#ff6b6b"), max(1.5, 2.0 / max(0.2, scale))))
    for chain in rig.ik_chains:
        if not chain.enabled or not chain.bones:
            continue
        tip = worlds.get(chain.bones[-1])
        if tip is None:
            continue
        tx = chain.target_x.value_at(frame)
        ty = chain.target_y.value_at(frame)
        painter.setBrush(Qt.NoBrush)
        painter.drawLine(QPointF(*tip.tail), QPointF(tx, ty))
        painter.setBrush(QBrush(QColor(255, 107, 107, 60)))
        painter.drawEllipse(QPointF(tx, ty), 7.0 / max(0.4, scale), 7.0 / max(0.4, scale))
        inner = QColor("#ff6b6b")
        painter.setBrush(QBrush(inner))
        painter.drawEllipse(QPointF(tx, ty), 3.0 / max(0.4, scale), 3.0 / max(0.4, scale))
    painter.restore()


# --------------------------------------------------------------------------
# layer tree rendering
# --------------------------------------------------------------------------
def _new_buffer(size: tuple[int, int]) -> QImage:
    img = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
    img.fill(Qt.transparent)
    return img


def render_layers(painter: QPainter, scene: Scene, project, opts: RenderOptions,
                  layers: list[Layer] | None = None, parent_transform: QTransform | None = None,
                  clip_base: QImage | None = None) -> None:
    """Composite a list of layers (bottom first) into ``painter``."""
    frame = opts.frame
    layers = scene.layers if layers is None else layers
    for layer in layers:
        if opts.only_layer and layer.uid != opts.only_layer:
            continue
        if opts.skip_hidden and not layer.visible:
            continue
        if layer.kind == "audio":
            continue
        tr = layer_transform(layer, frame)
        if parent_transform is not None:
            tr = tr * parent_transform
        opacity = max(0.0, min(1.0, layer.opacity / 100.0))
        if layer.kind == "group":
            buf = _new_buffer((painter.device().width(), painter.device().height()))
            bp = QPainter(buf)
            bp.setRenderHint(QPainter.Antialiasing, True)
            bp.setRenderHint(QPainter.SmoothPixmapTransform, True)
            bp.setTransform(painter.transform(), True)
            render_layers(bp, scene, project, opts, scene.children_of(layer.uid), tr)
            bp.end()
            painter.save()
            painter.setOpacity(opacity)
            painter.setCompositionMode(blend_mode(layer.blend_mode))
            painter.drawImage(0, 0, buf)
            painter.restore()
            continue

        # regular leaf layer
        target = painter
        buf = None
        if layer.blend_mode != "normal" or opacity < 0.999 or layer.clipping:
            buf = _new_buffer((painter.device().width(), painter.device().height()))
            target = QPainter(buf)
            target.setRenderHint(QPainter.Antialiasing, True)
            target.setRenderHint(QPainter.SmoothPixmapTransform, True)
            target.setTransform(painter.transform(), True)

        target.save()
        target.setTransform(tr, True)
        _paint_layer_content(target, layer, scene, project, opts)
        target.restore()

        if buf is not None:
            target.end()
            img = buf
            if layer.clipping:
                base = clip_base if clip_base is not None else _new_buffer((img.width(), img.height()))
                if not base.isNull():
                    masked = img.copy()
                    mp = QPainter(masked)
                    mp.setCompositionMode(QPainter.CompositionMode_DestinationIn)
                    mp.drawImage(0, 0, base)
                    mp.end()
                    img = masked
            painter.save()
            if opacity < 0.999:
                painter.setOpacity(opacity)
            painter.setCompositionMode(blend_mode(layer.blend_mode))
            painter.drawImage(0, 0, img)
            painter.restore()


def _paint_layer_content(painter: QPainter, layer: Layer, scene: Scene, project,
                         opts: RenderOptions) -> None:
    frame = opts.frame
    if layer.kind == "rig":
        rig = scene.rigs.get(layer.rig_id or "")
        if rig is not None:
            paint_rig(painter, rig, project, frame)
        return
    hit = layer.cel_at(int(frame))
    if hit is None:
        return
    _, ref = hit
    paint_cel(painter, ref.cel, scene, project)


# --------------------------------------------------------------------------
# public entry points
# --------------------------------------------------------------------------
def render_scene(scene: Scene, project, opts: RenderOptions | None = None,
                 with_camera: bool = True) -> QImage:
    opts = opts or RenderOptions()
    out_w, out_h = opts.out_size(scene)
    img = _new_buffer((out_w, out_h))
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing, True)
    p.setRenderHint(QPainter.SmoothPixmapTransform, True)
    if opts.background:
        if opts.check_background_color:
            p.fillRect(0, 0, out_w, out_h, QColor(opts.check_background_color))
        else:
            p.fillRect(0, 0, out_w, out_h, QColor(scene.background_color))
    if with_camera and opts.camera:
        p.setTransform(camera_transform(scene, opts.frame, (out_w, out_h)), True)
    else:
        p.setTransform(scene_to_output(scene, opts.frame, (out_w, out_h)), True)
    render_layers(p, scene, project, opts)
    p.end()
    return img


def render_layer_frame(scene: Scene, project, layer: Layer, frame: float,
                       size: tuple[int, int], background: bool = False,
                       camera: bool = False) -> QImage:
    opts = RenderOptions(frame=frame, size=size, background=background, camera=camera,
                         only_layer=layer.uid)
    return render_scene(scene, project, opts, with_camera=camera)


def onion_image(scene: Scene, project, layer: Layer, frame: int, delta: int,
                tint: QColor, strength: float, editor_scale: float = 1.0,
                camera: bool = False, size: tuple[int, int] | None = None) -> QImage | None:
    """Render one onion-skin frame of ``layer`` (``delta`` frames away)."""
    target = frame + delta
    if target < 0:
        return None
    hit = layer.cel_at(target)
    if hit is None:
        return None
    key, ref = hit
    if key == frame:
        return None
    out_w, out_h = size or (scene.width, scene.height)
    img = _new_buffer((out_w, out_h))
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing, True)
    p.setRenderHint(QPainter.SmoothPixmapTransform, True)
    if camera:
        p.setTransform(camera_transform(scene, target, (out_w, out_h)), True)
    else:
        p.setTransform(scene_to_output(scene, target, (out_w, out_h)), True)
    p.setTransform(layer_transform(layer, frame), True)
    paint_cel(p, ref.cel, scene, project)
    p.end()
    if strength < 1.0:
        faded = _new_buffer((out_w, out_h))
        fp = QPainter(faded)
        fp.setOpacity(max(0.0, min(1.0, strength)))
        fp.drawImage(0, 0, img)
        fp.end()
        img = faded
    tinted = _tint_image(img, tint)
    return tinted


def _tint_image(img: QImage, tint: QColor) -> QImage:
    """Colourise the alpha of an image keeping its shape (onion skin look)."""
    out = _new_buffer((img.width(), img.height()))
    p = QPainter(out)
    p.drawImage(0, 0, img)
    p.setCompositionMode(QPainter.CompositionMode_SourceIn)
    p.fillRect(out.rect(), tint)
    p.end()
    return out


def render_thumbnail(scene: Scene, project, frame: int, size: tuple[int, int] = (160, 90),
                     camera: bool = True) -> QImage:
    opts = RenderOptions(frame=frame, size=size, quality="draft", camera=camera)
    return render_scene(scene, project, opts)


def composite_onion(base: QImage, layers_onion: list[tuple[QImage, float]]) -> QImage:
    p = QPainter(base)
    for img, opacity in layers_onion:
        p.setOpacity(max(0.0, min(1.0, opacity)))
        p.drawImage(0, 0, img)
    p.end()
    return base


def checkerboard(size: tuple[int, int], cell: int = 8,
                 c1: str = "#2a2c36", c2: str = "#23252e") -> QImage:
    img = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
    p = QPainter(img)
    p.fillRect(img.rect(), QColor(c1))
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if ((x // cell) + (y // cell)) % 2 == 0:
                p.fillRect(x, y, cell, cell, QColor(c2))
    p.end()
    return img
