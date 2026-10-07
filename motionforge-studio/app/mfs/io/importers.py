"""Asset importers: images, SVG, audio, video frames, sprite sheets,
layered files (PSD / ORA) and automatic character part splitting."""
from __future__ import annotations

import os
import struct
import zipfile
from dataclasses import dataclass

from PySide6.QtCore import QBuffer, QByteArray, QRect, QSize, Qt
from PySide6.QtGui import QColor, QImage, QPainter

from ..engine.media import extract_video_frame, probe_duration
from ..model.document import AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, VECTOR_EXT, Asset, Project
from ..model.layer import Layer

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None  # type: ignore


# --------------------------------------------------------------------------
# basic importers
# --------------------------------------------------------------------------
def load_image(path: str) -> QImage:
    img = QImage(path)
    if img.isNull():
        img = QImage()
        img.loadFromData(open(path, "rb").read())
    return img


def import_image(project: Project, path: str, name: str | None = None,
                 folder: str = "Imported") -> Asset:
    ext = os.path.splitext(path)[1].lower()
    if ext in VECTOR_EXT:
        return import_svg(project, path, name, folder)
    with open(path, "rb") as fh:
        data = fh.read()
    img = QImage.fromData(data)
    asset = project.add_asset(name or os.path.basename(path), "image", data,
                              source_path=path, folder=folder,
                              meta={"width": img.width(), "height": img.height()})
    return asset


def import_svg(project: Project, path: str, name: str | None = None,
               folder: str = "Imported", render_size: tuple[int, int] | None = None,
               document_number: int | None = None) -> Asset:
    """SVG files are stored as-is *and* rasterised so they can be animated."""
    from PySide6.QtSvg import QSvgRenderer
    with open(path, "rb") as fh:
        raw = fh.read()
    renderer = QSvgRenderer(QByteArray(raw))
    if document_number is not None:
        renderer.render(QPainter())  # no-op guard, kept for API stability
    default = renderer.defaultSize()
    size = render_size or (max(32, default.width()), max(32, default.height()))
    img = QImage(QSize(size[0], size[1]), QImage.Format_ARGB32_Premultiplied)
    img.fill(Qt.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing, True)
    renderer.render(p)
    p.end()
    buf = QBuffer()
    buf.open(QBuffer.WriteOnly)
    img.save(buf, "PNG")
    asset = project.add_asset(name or os.path.basename(path), "svg", bytes(buf.data()),
                              source_path=path, folder=folder,
                              meta={"width": img.width(), "height": img.height(),
                                    "vector": raw.hex()[:0] or True})
    return asset


def import_audio(project: Project, path: str, name: str | None = None,
                 folder: str = "Audio") -> Asset:
    with open(path, "rb") as fh:
        data = fh.read()
    duration = probe_duration(path)
    asset = project.add_asset(name or os.path.basename(path), "audio", data,
                              source_path=path, folder=folder,
                              meta={"duration": duration})
    return asset


def import_video(project: Project, path: str, name: str | None = None,
                 folder: str = "Video", at_sec: float = 0.0) -> Asset:
    img = extract_video_frame(path, at_sec)
    if img.isNull():
        raise ValueError("Could not read a frame from this video (ffmpeg required).")
    buf = QBuffer()
    buf.open(QBuffer.WriteOnly)
    img.save(buf, "PNG")
    duration = probe_duration(path)
    return project.add_asset(name or os.path.basename(path), "video", bytes(buf.data()),
                             source_path=path, folder=folder,
                             meta={"width": img.width(), "height": img.height(),
                                   "duration": duration, "frame_sec": at_sec})


def import_any(project: Project, path: str, folder: str = "Imported") -> Asset | None:
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext in IMAGE_EXT:
            return import_image(project, path, folder=folder)
        if ext in VECTOR_EXT:
            return import_svg(project, path, folder=folder)
        if ext in AUDIO_EXT:
            return import_audio(project, path, folder=folder)
        if ext in VIDEO_EXT:
            return import_video(project, path, folder=folder)
        if ext == ".psd":
            parts = import_psd(project, path)
            return parts[0] if parts else None
        if ext == ".ora":
            parts = import_ora(project, path)
            return parts[0] if parts else None
    except Exception as exc:
        print(f"[mfs] import failed for {path}: {exc}")
        return None
    return None


# --------------------------------------------------------------------------
# sprite sheets
# --------------------------------------------------------------------------
def import_sprite_sheet(project: Project, path: str, rows: int = 1, cols: int = 1,
                        folder: str = "Sheets") -> list[Asset]:
    """Slice an image into a grid; every cell becomes its own asset."""
    img = load_image(path)
    if img.isNull() or rows < 1 or cols < 1:
        return []
    base = os.path.splitext(os.path.basename(path))[0]
    cw = img.width() // cols
    ch = img.height() // rows
    out: list[Asset] = []
    for r in range(rows):
        for c in range(cols):
            part = img.copy(QRect(c * cw, r * ch, cw, ch))
            buf = QBuffer()
            buf.open(QBuffer.WriteOnly)
            part.save(buf, "PNG")
            asset = project.add_asset(f"{base}_{r}_{c}", "image", bytes(buf.data()),
                                      folder=folder,
                                      meta={"width": cw, "height": ch, "sheet": path,
                                            "row": r, "col": c})
            out.append(asset)
    return out


def slice_animation_strip(project: Project, path: str, frames: int,
                          folder: str = "Sheets") -> list[Asset]:
    return import_sprite_sheet(project, path, rows=1, cols=max(1, frames), folder=folder)


# --------------------------------------------------------------------------
# PSD / OpenRaster (separated assets)
# --------------------------------------------------------------------------
def import_ora(project: Project, path: str, folder: str = "Layers") -> list[Asset]:
    """OpenRaster (.ora) files are ZIPs with a stack.xml + PNG layers."""
    import xml.etree.ElementTree as ET
    out: list[Asset] = []
    with zipfile.ZipFile(path, "r") as zf:
        names = zf.namelist()
        if "stack.xml" not in names:
            return []
        root = ET.fromstring(zf.read("stack.xml"))
        base = os.path.splitext(os.path.basename(path))[0]

        def walk(node, prefix: str = "") -> None:
            for child in node:
                tag = child.tag.split("}")[-1]
                name = child.get("name") or tag
                src = child.get("src")
                if tag == "layer" and src and src in names:
                    data = zf.read(src)
                    img = QImage.fromData(data)
                    buf = QBuffer()
                    buf.open(QBuffer.WriteOnly)
                    if not img.isNull():
                        img.save(buf, "PNG")
                        out.append(project.add_asset(
                            f"{prefix}{name}", "image", bytes(buf.data()), folder=folder,
                            meta={"width": img.width(), "height": img.height(), "source": "ora"}))
                walk(child, prefix)
        walk(root)
    _ = base
    return out


def import_psd(project: Project, path: str, folder: str = "Layers") -> list[Asset]:
    """Minimal PSD reader: 8 bit RGB / grayscale, raw or RLE compressed layers."""
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:4] != b"8BPS":
        raise ValueError("Not a Photoshop file")
    version, _reserved = struct.unpack(">HH", data[4:8])
    if version != 1:
        raise ValueError("Only PSD (not PSB) files are supported")
    channels, height, width, depth, mode = struct.unpack(">HIIHH", data[12:26])
    if depth != 8:
        raise ValueError("Only 8 bit/channel PSD files are supported")
    offset = 26
    # colour mode data
    cm_len = struct.unpack(">I", data[offset:offset + 4])[0]
    offset += 4 + cm_len
    # image resources
    res_len = struct.unpack(">I", data[offset:offset + 4])[0]
    offset += 4 + res_len
    # layer and mask information
    layer_info_len = struct.unpack(">I", data[offset:offset + 4])[0]
    offset += 4
    layer_info_end = offset + layer_info_len
    layer_count = struct.unpack(">h", data[offset:offset + 2])[0]
    offset += 2
    records = []
    for _ in range(abs(layer_count)):
        top, left, bottom, right = struct.unpack(">iiii", data[offset:offset + 16])
        offset += 16
        nch = struct.unpack(">H", data[offset:offset + 2])[0]
        offset += 2
        ch_info = []
        for _c in range(nch):
            cid, clen = struct.unpack(">hI", data[offset:offset + 6])
            offset += 6
            ch_info.append((cid, clen))
        sig = data[offset:offset + 4]
        if sig != b"8BIM":
            raise ValueError("Corrupted PSD layer record")
        offset += 4
        blend = data[offset:offset + 4]
        offset += 4
        opacity, clipping, flags, _filler = struct.unpack(">BBBB", data[offset:offset + 4])
        offset += 4
        extra_len = struct.unpack(">I", data[offset:offset + 4])[0]
        extra_start = offset + 4
        mask_len = struct.unpack(">I", data[extra_start:extra_start + 4])[0]
        p = extra_start + 4 + mask_len
        blend_len = struct.unpack(">I", data[p:p + 4])[0]
        p += 4 + blend_len
        name_len = data[p]
        name = data[p + 1:p + 1 + name_len].decode("utf8", "ignore").strip("\x00")
        offset = extra_start + extra_len
        records.append({
            "rect": (left, top, right, bottom), "channels": ch_info, "name": name,
            "blend": blend.decode("latin1"), "opacity": opacity,
        })
    # channel image data
    layers = []
    for rec in records:
        left, top, right, bottom = rec["rect"]
        w, h = max(0, right - left), max(0, bottom - top)
        img = QImage(w, h, QImage.Format_ARGB32_Premultiplied)
        img.fill(Qt.transparent)
        chans: dict[int, object] = {}
        for cid, clen in rec["channels"]:
            section_end = offset + clen
            compression = struct.unpack(">H", data[offset:offset + 2])[0]
            body = data[offset + 2:section_end]
            if compression == 0:
                raw = body[: w * h]
            elif compression == 1:
                raw = _rle_decode(body, w, h)
            else:
                raw = bytes(w * h)
            chans[cid] = raw
            offset = section_end
        if np is not None and w and h:
            arr = np.zeros((h, w, 4), dtype=np.uint8)
            for cid, raw in chans.items():
                plane = np.frombuffer(raw, dtype=np.uint8)[: w * h].reshape(h, w)
                if cid == 0:
                    arr[:, :, 2] = plane if mode == 3 else plane
                elif cid == 1:
                    arr[:, :, 1] = plane
                elif cid == 2:
                    arr[:, :, 0] = plane
                elif cid == -1:
                    arr[:, :, 3] = plane
            if mode == 1:  # grayscale
                arr[:, :, 0] = arr[:, :, 1] = arr[:, :, 2] = chans.get(0, bytes(w * h))
            if -1 not in chans:
                arr[:, :, 3] = 255
            buf = QImage(arr.data, w, h, w * 4, QImage.Format_ARGB32).copy()
        else:
            buf = img
        qb = QBuffer()
        qb.open(QBuffer.WriteOnly)
        buf.save(qb, "PNG")
        layers.append(project.add_asset(rec["name"] or "Layer", "image", bytes(qb.data()),
                                        folder=folder,
                                        meta={"width": w, "height": h, "offset": [left, top],
                                              "opacity": rec["opacity"] / 255.0,
                                              "blend": rec["blend"], "source": "psd"}))
    _ = (layer_info_end, channels)
    return layers


def _rle_decode(body: bytes, w: int, h: int) -> bytes:
    counts = []
    p = 0
    for _ in range(h):
        counts.append(struct.unpack(">H", body[p:p + 2])[0])
        p += 2
    out = bytearray()
    for count in counts:
        chunk = body[p:p + count]
        p += count
        i = 0
        target = w
        line = bytearray()
        while i < len(chunk) and len(line) < target:
            n = struct.unpack("b", chunk[i:i + 1])[0]
            i += 1
            if n >= 0:
                line += chunk[i:i + n + 1]
                i += n + 1
            elif n != -128:
                line += chunk[i:i + 1] * (1 - n)
                i += 1
        out += line[:target].ljust(target, b"\x00")
    return bytes(out)


# --------------------------------------------------------------------------
# automatic character part detection ("Auto Rig Character")
# --------------------------------------------------------------------------
PART_ORDER = ["Head", "Hair", "Torso", "L Arm", "R Arm", "L Hand", "R Hand",
              "L Leg", "R Leg", "L Foot", "R Foot"]


@dataclass
class DetectedPart:
    name: str
    rect: QRect
    asset: Asset | None = None
    confidence: float = 0.5

    def center(self) -> tuple[float, float]:
        return (self.rect.center().x(), self.rect.center().y())


def _label_regions(mask) -> list[tuple[int, int, int, int, int]]:
    """Connected components via iterative scanline labelling (numpy, fast)."""
    if np is None:
        return []
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    regions: list[list[int]] = []
    for y in range(h):
        row = mask[y]
        if not row.any():
            continue
        xs = np.flatnonzero(row)
        splits = np.flatnonzero(np.diff(xs) > 1)
        starts = np.concatenate(([xs[0]], xs[splits + 1]))
        ends = np.concatenate((xs[splits], [xs[-1]]))
        for s, e in zip(starts, ends):
            above = labels[y - 1, s:e + 1] if y > 0 else np.zeros(0, dtype=np.int32)
            found = np.unique(above[above > 0])
            if found.size == 0:
                current += 1
                labels[y, s:e + 1] = current
                regions.append([current, current, s, e, y])   # minmax id, x0,x1,y0
            else:
                target = int(found.min())
                labels[y, s:e + 1] = target
                for f in found:
                    labels[labels == f] = target
    # bounding boxes
    boxes: dict[int, list[int]] = {}
    ys, xs = np.nonzero(labels)
    for y, x in zip(ys.tolist(), xs.tolist()):
        lid = int(labels[y, x])
        box = boxes.setdefault(lid, [x, y, x, y, 0])
        box[0] = min(box[0], x)
        box[1] = min(box[1], y)
        box[2] = max(box[2], x)
        box[3] = max(box[3], y)
        box[4] += 1
    return [(b[0], b[1], b[2] - b[0] + 1, b[3] - b[1] + 1, b[4]) for b in boxes.values()]


def detect_character_parts(image: QImage, min_area_ratio: float = 0.0015,
                           max_parts: int = 14) -> list[DetectedPart]:
    """Find the separate body part images inside a character sheet."""
    if image.isNull():
        return []
    scale = 1.0
    work = image
    if image.width() > 700:
        scale = 700.0 / image.width()
        work = image.scaled(int(image.width() * scale), int(image.height() * scale),
                            Qt.KeepAspectRatio, Qt.SmoothTransformation)
    boxes: list[tuple[int, int, int, int, int]] = []
    if np is not None:
        conv = work.convertToFormat(QImage.Format_ARGB32)
        h, w = conv.height(), conv.width()
        arr = np.frombuffer(bytes(conv.constBits()), dtype=np.uint8).reshape(h, conv.bytesPerLine() // 4, 4)[:, :w, :]
        mask = arr[:, :, 3] > 24
        boxes = _label_regions(mask)
    if not boxes:
        boxes = [(0, 0, work.width(), work.height(), work.width() * work.height())]
    total = float(image.width() * image.height())
    parts: list[DetectedPart] = []
    for x, y, bw, bh, area in sorted(boxes, key=lambda b: -b[4])[:max_parts]:
        if area / total < min_area_ratio:
            continue
        rect = QRect(int(x / scale), int(y / scale), max(1, int(bw / scale)),
                     max(1, int(bh / scale)))
        parts.append(DetectedPart("part", rect))
    parts.sort(key=lambda p: (p.rect.center().y(), p.rect.center().x()))
    _assign_part_names(parts, image.height())
    return parts


def _assign_part_names(parts: list[DetectedPart], image_height: int) -> None:
    """Heuristic naming: head at the top, torso in the middle, limbs at the sides."""
    if not parts:
        return
    if len(parts) == 1:
        parts[0].name = "Body"
        parts[0].confidence = 0.3
        return
    top = min(p.rect.top() for p in parts)
    bottom = max(p.rect.bottom() for p in parts)
    span = max(1, bottom - top)
    body = max(parts, key=lambda p: p.rect.width() * p.rect.height())
    used = {"Head", "Torso"}
    for p in parts:
        if p is body:
            p.name = "Torso"
            continue
        rel_y = (p.rect.center().y() - top) / span
        if rel_y < 0.28:
            p.name = "Head"
        elif rel_y > 0.72:
            p.name = "L Leg" if p.rect.center().x() >= body.rect.center().x() else "R Leg"
        else:
            p.name = "L Arm" if p.rect.center().x() >= body.rect.center().x() else "R Arm"
        if p.name in used:
            p.name = ("L " if p.rect.center().x() >= body.rect.center().x() else "R ") + p.name.split(" ", 1)[-1]
        used.add(p.name)
        p.confidence = 0.6


def split_character_assets(project: Project, image: QImage, parts: list[DetectedPart],
                           folder: str = "Character") -> list[DetectedPart]:
    """Cut the detected parts out of the sheet and store them as assets."""
    for i, part in enumerate(parts):
        if part.rect.isEmpty():
            continue
        piece = image.copy(part.rect)
        buf = QBuffer()
        buf.open(QBuffer.WriteOnly)
        piece.save(buf, "PNG")
        asset = project.add_asset(f"{part.name} {i + 1}", "image", bytes(buf.data()),
                                  folder=folder,
                                  meta={"width": piece.width(), "height": piece.height(),
                                        "part": part.name, "pivot": [0.5, 0.5]})
        part.asset = asset
    return parts


def make_part_layer(scene, project: Project, part: DetectedPart, image_size: tuple[int, int],
                    index: int | None = None) -> Layer:
    """Place a detected part on its own layer, keeping its canvas position."""
    from ..model.cel import ImageCel
    layer = scene.new_layer(part.name, "raster", index)
    cel = layer.new_cel(scene.frame_start, kind="bitmap")
    # store as an image cel so the asset stays editable/relinkable
    from ..model.cel import ImageCel as _IC
    ic = _IC((scene.width, scene.height), part.asset.uid if part.asset else "",
             fit="native", scale=1.0, offset=(part.rect.left(), part.rect.top()))
    ic.uid = cel.uid if cel is not None else ic.uid
    layer.set_cel(scene.frame_start, ic)
    return layer


def auto_split_layers(project: Project, path: str, sheet_size: tuple[int, int] | None = None,
                      folder: str = "Character") -> list[DetectedPart]:
    """Full 'auto rig' step 1: import a character image and split it into parts."""
    img = load_image(path)
    if img.isNull():
        return []
    parts = detect_character_parts(img)
    return split_character_assets(project, img, parts, folder)


def part_assets(project: Project, folder: str = "Character") -> list[Asset]:
    return [a for a in project.assets.values()
            if (a.folder or "").lower() == folder.lower() and a.kind in ("image", "svg")]


_ = (QColor, _label_regions)
