"""Translate a :class:`Project` timeline into an FFmpeg filter_complex graph.

The graph is fully non-destructive: every clip, keyframe, effect and
transition is compiled into filter expressions; source files are only read,
never modified.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..core.ffmpeg import ffmpeg_supports_filter
from ..core.logging_setup import get_logger
from ..models.enums import ClipKind, TrackKind, TransitionType, EffectType
from ..models.timeline import Clip, Track

log = get_logger("filtergraph")


def esc_drawtext(text: str) -> str:
    """Escape a string for ffmpeg drawtext."""
    return (text.replace("\\", "\\\\").replace(":", "\\:")
            .replace("'", "\\'").replace("%", "\\%").replace("\n", "\\n"))


def find_font() -> Optional[str]:
    candidates = [
        Path(__file__).resolve().parent.parent / "resources" / "fonts" / "DejaVuSans.ttf",
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return None


def _num(x: float) -> str:
    return f"{float(x):.5f}".rstrip("0").rstrip(".") or "0"


def kf_expression(clip: Clip, prop: str, const_value: float,
                  dialect: str = "full") -> str:
    """ffmpeg eval expression for a keyframed property (clip-relative time).

    ``dialect='full'`` uses the standard eval engine (between/lerp), used by
    overlay/rotate/scale/volume. ``dialect='simple'`` only uses if/gte and
    arithmetic, which is the restricted engine of the ``geq`` filter.
    """
    keys = sorted((k for k in clip.keyframes if k.property == prop),
                  key=lambda k: k.time)
    if not keys:
        return _num(const_value)
    pts = [(max(0.0, k.time - clip.start), k.value) for k in keys]
    if dialect == "simple":
        # geq's restricted engine exposes time as capital T.
        expr = _num(pts[-1][1])
        for (a, va), (b, vb) in reversed(list(zip(pts, pts[1:]))):
            span = _num(max(1e-6, b - a))
            linear = f"({_num(va)}+({_num(vb - va)})*(T-{_num(a)})/{span})"
            expr = (f"if(gte(T,{_num(a)}),if(gte(T,{_num(b)}),{_num(vb)},"
                    f"{linear}),{expr})")
        return expr
    expr = _num(pts[-1][1])
    for (a, va), (b, vb) in reversed(list(zip(pts, pts[1:]))):
        expr = (f"if(between(t,{_num(a)},{_num(b)}),"
                f"lerp({_num(va)},{_num(vb)},(t-{_num(a)})/{_num(max(1e-6, b-a))}),{expr})")
    return expr


def atempo_chain(speed: float) -> str:
    """atempo accepts 0.5..2.0 per instance; chain factors for other speeds."""
    factors: list[float] = []
    s = speed
    while s > 2.0:
        factors.append(2.0)
        s /= 2.0
    while s < 0.5:
        factors.append(0.5)
        s /= 0.5
    factors.append(s)
    return ",".join(f"atempo={_num(f)}" for f in factors)


@dataclass
class _Piece:
    label: str
    duration: float
    clip: Optional[Clip] = None
    transition_in: object = None


class FilterGraphBuilder:
    def __init__(self, project, use_proxies: bool = False,
                 burn_subtitles: Optional[str] = None,
                 terminate_audio_sink: bool = False):
        self.p = project
        self.use_proxies = use_proxies
        self.burn_subtitles = burn_subtitles
        # When only video is consumed (preview), terminate the audio chain
        # with anullsink so the graph has no unconnected outputs.
        self.terminate_audio_sink = terminate_audio_sink
        self.input_args: list[str] = []
        self.filters: list[str] = []
        self._inputs: dict[str, int] = {}
        self._src_meta: dict[str, dict] = {}
        self._title_labels: dict[str, str] = {}
        self.W = project.settings.width
        self.H = project.settings.height
        self.fps = project.settings.fps
        self.sr = project.settings.sample_rate
        self.ch = project.settings.audio_channels
        self.font = find_font()
        self._has_drawtext = ffmpeg_supports_filter("drawtext")
        self._title_image_inputs: dict[str, int] = {}

    def _drawtext_available(self) -> bool:
        return self._has_drawtext

    def _ensure_title_image(self, clip: Clip) -> int:
        # Register through the same index map as media inputs to keep every
        # ``-i`` index and every ``[N:v]`` reference aligned.
        key = f"__title__{clip.id}"
        if key in self._inputs:
            return self._inputs[key]
        from ..media.titles import render_title_png
        png = render_title_png(clip, self.W, self.H)
        idx = len(self._inputs)
        self.input_args += ["-loop", "1", "-framerate", _num(self.fps), "-i", png]
        self._inputs[key] = idx
        self._title_image_inputs[clip.id] = idx
        return idx

    # ------------------------------------------------------------- inputs
    def _source_path(self, media_id: str) -> tuple[str, bool]:
        item = self.p.get_media(media_id)
        if item is None:
            raise KeyError(f"Media {media_id} missing from project library")
        if self.use_proxies and item.proxy_path and Path(item.proxy_path).exists():
            return item.proxy_path, item.kind == "image"
        return item.path, item.kind == "image"

    def _ensure_input(self, clip: Clip) -> int:
        if clip.media_id is None:
            raise KeyError(f"Clip {clip.id} has no media")
        if clip.media_id in self._inputs:
            return self._inputs[clip.media_id]
        path, is_image = self._source_path(clip.media_id)
        if not Path(path).exists():
            item = self.p.get_media(clip.media_id)
            name = item.name if item else path
            raise FileNotFoundError(
                f"Media file is missing: {name} ({path}). Relink it in the "
                "media bin before exporting.")
        idx = len(self._inputs)
        if is_image:
            self.input_args += ["-loop", "1", "-framerate", _num(self.fps), "-i", path]
        else:
            self.input_args += ["-i", path]
        self._inputs[clip.media_id] = idx
        item = self.p.get_media(clip.media_id)
        self._src_meta[clip.media_id] = {
            "has_audio": bool(item and item.has_audio),
            "is_image": is_image,
        }
        return idx

    def _add_lavfi(self, lavfi: str) -> int:
        idx = len(self._inputs)
        self.input_args += ["-f", "lavfi", "-i", lavfi]
        return idx

    # ------------------------------------------------------------- build
    def build(self) -> tuple[list[str], str, list[str], float]:
        total = self.p.timeline.duration()
        if total <= 0:
            raise ValueError("The timeline is empty; nothing to export.")
        video_labels: list[str] = []
        audio_labels: list[str] = []
        for track in self.p.timeline.tracks:
            if track.kind == TrackKind.VIDEO.value:
                label = self._build_video_track(track)
                if label:
                    video_labels.append(label)
            else:
                label = self._build_audio_track(track)
                if label:
                    audio_labels.append(label)
        vout = self._compose_video(video_labels, total)
        aout = self._compose_audio(audio_labels, total)
        if self.terminate_audio_sink:
            self.filters.append("[" + aout + "]anullsink")
            maps = ["-map", "[" + vout + "]"]
        else:
            maps = ["-map", "[" + vout + "]", "-map", "[" + aout + "]"]
        return self.input_args, ";\n".join(self.filters), maps, total

    # --------------------------------------------------------- video track
    def _build_video_track(self, track: Track) -> Optional[str]:
        clips = [c for c in track.sorted_clips()
                 if c.enabled and c.kind in (ClipKind.VIDEO.value, ClipKind.IMAGE.value,
                                             ClipKind.TITLE.value, ClipKind.COLOR.value)]
        if not clips:
            return None
        pieces: list[_Piece] = []
        cursor = 0.0
        for clip in clips:
            if clip.start > cursor + 1e-6:
                gap_dur = clip.start - cursor
                pieces.append(_Piece(self._transparent_gap(gap_dur), gap_dur))
                cursor = clip.start
            pieces.append(_Piece(self._build_video_clip(clip), clip.duration, clip,
                                 clip.transition_in))
            cursor = clip.end
        out, stream_len = pieces[0].label, pieces[0].duration
        for piece in pieces[1:]:
            if piece.transition_in and piece.clip is not None:
                d = min(piece.transition_in.duration, piece.duration * 0.9,
                        stream_len * 0.9, 10.0)
                if d > 0.05:
                    out = self._xfade(out, piece.label, piece.transition_in,
                                      d, stream_len)
                    stream_len = stream_len + piece.duration - d
                    continue
            out = self._concat_two(out, piece.label, video=True)
            stream_len += piece.duration
        return out

    def _build_video_clip(self, clip: Clip) -> str:
        tag = f"vc_{clip.id.replace('-', '_')}"
        title_as_image = (clip.kind == ClipKind.TITLE.value
                          and not self._drawtext_available())
        if clip.kind in (ClipKind.TITLE.value, ClipKind.COLOR.value) \
                and not title_as_image:
            idx = self._generator_input(clip)
            label_in = (self._title_labels.get(clip.id) or f"{idx}:v")
        elif title_as_image:
            idx = self._ensure_title_image(clip)
            label_in = f"{idx}:v"
        else:
            idx = self._ensure_input(clip)
            label_in = f"{idx}:v"
        speed = max(clip.speed, 0.1)
        chains: list[str] = []
        if clip.kind in (ClipKind.VIDEO.value, ClipKind.IMAGE.value) \
                or title_as_image:
            chains.append(f"trim=start={_num(clip.source_in)}:end={_num(clip.source_out)}")
            chains.append("setpts=PTS-STARTPTS")
            if abs(speed - 1.0) > 1e-3:
                chains.append(f"setpts=(PTS-STARTPTS)/{_num(speed)}")
        if title_as_image and clip.text_params.get("animation") in ("fade", "pop"):
            chains.append("fade=t=in:st=0:d=0.4")
        chains.append(f"fps={_num(self.fps)}")
        crop = self._crop_filter(clip)
        if crop:
            chains.append(crop)
        chains.append(
            f"scale={self.W}:{self.H}:force_original_aspect_ratio=decrease:flags=bilinear")
        chains.append(
            f"pad={self.W}:{self.H}:(ow-iw)/2:(oh-ih)/2:color=black@0")
        chains.append("setsar=1,format=rgba")
        self.filters.append(f"[{label_in}]{','.join(chains)}[{tag}_base]")
        current = self._apply_video_effects(clip, f"{tag}_base", tag)
        current = self._apply_transform(clip, current, tag)
        current = self._apply_opacity(clip, current, tag)
        return current

    def _generator_input(self, clip: Clip) -> int:
        if clip.kind == ClipKind.COLOR.value:
            return self._add_lavfi(
                f"color=c={clip.color}:s={self.W}x{self.H}:r={_num(self.fps)}"
                f":d={_num(clip.duration)}")
        bg = clip.text_params.get("background") or "black@0"
        idx = self._add_lavfi(
            f"color=c={bg}:s={self.W}x{self.H}:r={_num(self.fps)}"
            f":d={_num(clip.duration)}")
        self._build_title(clip, idx)
        return idx

    def _build_title(self, clip: Clip, idx: int) -> None:
        tp = clip.text_params
        tag = f"tt_{clip.id.replace('-', '_')}"
        font = self.font
        if font:
            escaped_font = font.replace(":", "\\:")
            font_part = "fontfile='" + escaped_font + "'"
        else:
            font_part = ""
        size = int(tp.get("font_size", 72))
        color = str(tp.get("color", "#ffffff")).lstrip("#")
        stroke = int(tp.get("stroke_width", 0))
        stroke_color = str(tp.get("stroke_color", "#000000")).lstrip("#")
        bold = ":fontweight=bold" if tp.get("bold") else ""
        italic = ":fontstyle=italic" if tp.get("italic") else ""
        px, py = float(tp.get("position_x", 0.5)), float(tp.get("position_y", 0.5))
        anim = tp.get("animation", "none")
        text = str(tp.get("text", ""))
        d = clip.duration
        base_xy = (f"x=(w-text_w)/2+(w*({_num(px - 0.5)})):"
                   f"y=(h-text_h)/2+(h*({_num(py - 0.5)}))")

        def draw(sub: str, extra: str, in_label: str, out_label: str) -> None:
            self.filters.append(
                f"[{in_label}]drawtext={font_part}{bold}{italic}:fontsize={size}"
                f":fontcolor=0x{color}:borderw={stroke}:bordercolor=0x{stroke_color}"
                f":text='{esc_drawtext(sub)}':{extra}[{out_label}]")

        if anim == "typewriter":
            in_label = f"{idx}:v"
            step = max(0.03, d / max(1, min(len(text), 100)))
            for i in range(1, min(len(text), 100) + 1):
                out_label = f"{tag}_{i}"
                draw(text[:i], f"{base_xy}:enable='gte(t,{_num((i - 1) * step)})'",
                     in_label, out_label)
                in_label = out_label
            self.filters.append(f"[{in_label}]copy[{tag}_done]")
        else:
            alpha_expr, xy_extra = "1", base_xy
            if anim == "fade":
                alpha_expr = "if(lt(t,0.4),t/0.4,1)"
            elif anim == "slide_up":
                xy_extra = (f"x=(w-text_w)/2+(w*({_num(px - 0.5)})):"
                            f"y=(h-text_h)/2+(h*({_num(py - 0.5)}))"
                            f"+(h*0.08)*(1-min(1,t/0.4))")
            elif anim == "pop":
                alpha_expr = "min(1,t/0.25)"
            draw(text, f"{xy_extra}:alpha='{alpha_expr}'",
                 f"{idx}:v", f"{tag}_done")
        self._title_labels[clip.id] = f"{tag}_done"

    # ------------------------------------------------------------- effects
    def _apply_video_effects(self, clip: Clip, in_label: str, tag: str) -> str:
        current = in_label
        for i, fx in enumerate(clip.effects):
            if not fx.enabled:
                continue
            out = f"{tag}_fx{i}"
            if fx.type == EffectType.MASK.value:
                current = self._apply_mask(fx, current, out)
                continue
            if fx.type == EffectType.LUT.value and float(fx.get("intensity", 1.0)) < 0.999:
                current = self._blend_lut(fx, current, out)
                continue
            f = self._effect_filter(fx)
            if f:
                self.filters.append(f"[{current}]{f}[{out}]")
                current = out
        return current

    def _effect_filter(self, fx) -> str:
        p = fx.params
        if fx.type == EffectType.COLOR.value:
            exposure = float(p.get("exposure", 0.0))
            brightness = max(-1.0, min(1.0, exposure * 0.06))
            gamma = 2.0 ** (-exposure * 0.5)
            contrast = 1.0 + float(p.get("contrast", 0.0))
            sat = 1.0 + float(p.get("saturation", 0.0))
            temp = float(p.get("temperature", 0.0))
            tint = float(p.get("tint", 0.0))
            hi, sh = float(p.get("highlights", 0.0)), float(p.get("shadows", 0.0))
            eq = (f"eq=brightness={_num(brightness)}:contrast={_num(contrast)}"
                  f":saturation={_num(sat)}:gamma={_num(gamma)}")
            # colorbalance exposes shadows/midtones/highlights per channel
            # (rs/rm/rh ...), there are no generic hl/sh options.
            cb = (f"colorbalance=rs={_num(temp * 0.4 + sh * 0.3)}"
                  f":bs={_num(-temp * 0.4 + sh * 0.3)}"
                  f":gs={_num(sh * 0.3)}"
                  f":rm={_num(-tint * 0.3)}:gm={_num(tint * 0.4)}:bm={_num(-tint * 0.3)}"
                  f":rh={_num(hi * 0.3)}:gh={_num(hi * 0.3)}:bh={_num(hi * 0.3)}")
            return f"{eq},{cb}"
        if fx.type == EffectType.LUT.value:
            lut = str(p.get("lut_path", ""))
            if not lut or not Path(lut).exists():
                return ""
            return "lut3d=file='" + lut.replace(":", "\\:") + "'"
        if fx.type == EffectType.CHROMA_KEY.value:
            color = str(p.get("color", "#00ff00")).lstrip("#")
            sim, blend = float(p.get("similarity", 0.18)), float(p.get("blend", 0.1))
            return (f"format=rgba,chromakey=0x{color}:similarity={_num(sim)}"
                    f":blend={_num(blend)}")
        if fx.type == EffectType.BLUR.value:
            return f"gblur=sigma={_num(float(p.get('radius', 8.0)))}"
        if fx.type == EffectType.SHARPEN.value:
            return f"unsharp=5:5:{_num(float(p.get('amount', 0.5)))}"
        if fx.type == EffectType.VIGNETTE.value:
            return f"vignette=angle={_num(float(p.get('angle', 0.0)) + math.pi / 5)}"
        if fx.type == EffectType.DENOISE.value:
            return f"hqdn3d={_num(float(p.get('strength', 4.0)))}"
        return ""

    def _apply_mask(self, fx, in_label: str, out_label: str) -> str:
        p = fx.params
        shape = p.get("shape", "rectangle")
        x, y = float(p.get("x", 0.5)), float(p.get("y", 0.5))
        w, h = float(p.get("width", 1.0)), float(p.get("height", 1.0))
        feather = max(0.1, float(p.get("feather", 0.05)) * 20.0)
        invert = bool(int(float(p.get("invert", 0.0))))
        mask_label = f"{out_label}_mask"
        if shape == "ellipse":
            sign = "1-" if not invert else ""
            lum = (f"255*clip({sign}(pow((X-{_num(x)}*W)/({_num(w / 2)}*W),2)"
                   f"+pow((Y-{_num(y)}*H)/({_num(h / 2)}*H),2)),0,1)")
            self.filters.append(
                f"color=c=black:s={self.W}x{self.H}:r={_num(self.fps)},"
                f"format=gray,geq=lum='{lum}',boxblur={_num(feather)}:1[{mask_label}]")
        else:
            x0, y0 = x - w / 2, y - h / 2
            base, box_color = ("white", "black") if invert else ("black", "white")
            self.filters.append(
                f"color=c={base}:s={self.W}x{self.H}:r={_num(self.fps)},"
                f"format=gray,drawbox=x=iw*{_num(x0)}:y=ih*{_num(y0)}"
                f":w=iw*{_num(w)}:h=ih*{_num(h)}:color={box_color}:t=fill,"
                f"boxblur={_num(feather)}:1[{mask_label}]")
        self.filters.append(f"[{in_label}][{mask_label}]alphamerge[{out_label}]")
        return out_label

    def _blend_lut(self, fx, in_label: str, out_label: str) -> str:
        lut = str(fx.get("lut_path", ""))
        intensity = float(fx.get("intensity", 1.0))
        split_a, split_b = f"{out_label}_a", f"{out_label}_b"
        self.filters.append(f"[{in_label}]split=2[{split_a}][{split_b}]")
        graded = f"{out_label}_g"
        lut_arg = lut.replace(":", "\\:")
        self.filters.append(
            f"[{split_b}]lut3d=file='{lut_arg}'[{graded}]")
        self.filters.append(
            f"[{split_a}][{graded}]blend=all_mode=normal:all_opacity="
            f"{_num(intensity)}[{out_label}]")
        return out_label

    # --------------------------------------------------------- transform
    def _apply_transform(self, clip: Clip, in_label: str, tag: str) -> str:
        scale_expr = kf_expression(clip, "scale", clip.scale)
        scaled = f"{tag}_scaled"
        self.filters.append(
            f"[{in_label}]scale=w='{self.W}*({scale_expr})'"
            f":h='{self.H}*({scale_expr})':eval=frame:flags=bilinear[{scaled}]")
        rot_expr = "(" + kf_expression(clip, "rotation", clip.rotation) + ")*PI/180"
        rotated = f"{tag}_rot"
        self.filters.append(
            f"[{scaled}]rotate=a='{rot_expr}':fillcolor=none"
            f":out_w=rotw('{rot_expr}'):out_h=roth('{rot_expr}')[{rotated}]")
        canvas = f"{tag}_canvas"
        self.filters.append(
            f"color=c=black@0:s={self.W}x{self.H}:r={_num(self.fps)}"
            f":d={_num(clip.duration)}[{canvas}]")
        x_expr = (f"(W-w)/2+({kf_expression(clip, 'pos_x', clip.pos_x)})"
                  f"+(0.5-{_num(clip.anchor_x)})*w")
        y_expr = (f"(H-h)/2+({kf_expression(clip, 'pos_y', clip.pos_y)})"
                  f"+(0.5-{_num(clip.anchor_y)})*h")
        placed = f"{tag}_placed"
        self.filters.append(
            f"[{canvas}][{rotated}]overlay=x='{x_expr}':y='{y_expr}'"
            f":eof_action=pass:shortest=1[{placed}]")
        return placed

    def _apply_opacity(self, clip: Clip, in_label: str, tag: str) -> str:
        out = f"{tag}_op"
        has_kf = any(k.property == "opacity" for k in clip.keyframes)
        if has_kf:
            expr = kf_expression(clip, "opacity", clip.opacity, dialect="simple")
            self.filters.append(
                f"[{in_label}]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)'"
                f":a='alpha(X,Y)*({expr})'[{out}]")
            return out
        parts = [f"colorchannelmixer=aa={_num(max(0.0, min(1.0, clip.opacity)))}"]
        if clip.fade_in > 0:
            parts.append(f"fade=t=in:st=0:d={_num(clip.fade_in)}")
        if clip.fade_out > 0:
            parts.append(
                f"fade=t=out:st={_num(max(0.0, clip.duration - clip.fade_out))}"
                f":d={_num(clip.fade_out)}")
        self.filters.append(f"[{in_label}]{','.join(parts)}[{out}]")
        return out

    def _crop_filter(self, clip: Clip) -> str:
        vals = (clip.crop_left, clip.crop_top, clip.crop_right, clip.crop_bottom)
        if max(vals) <= 0.0:
            return ""
        # Crop is expressed relative to the source frame before scaling.
        w = f"iw*(1-{_num(clip.crop_left + clip.crop_right)})"
        h = f"ih*(1-{_num(clip.crop_top + clip.crop_bottom)})"
        x = f"iw*{_num(clip.crop_left)}"
        y = f"ih*{_num(clip.crop_top)}"
        return f"crop=w='{w}':h='{h}':x='{x}':y='{y}'"

    # ------------------------------------------------------------- gaps
    def _transparent_gap(self, duration: float) -> str:
        tag = f"gap_{len(self.filters)}_{abs(hash(duration)) % 100000}"
        self.filters.append(
            f"color=c=black@0:s={self.W}x{self.H}:r={_num(self.fps)}"
            f":d={_num(duration)}[{tag}]")
        return tag

    def _xfade(self, a: str, b: str, trans, duration: float,
               stream_len: float) -> str:
        tag = f"xf_{len(self.filters)}"
        mapping = {
            TransitionType.FADE.value: "fade",
            TransitionType.DISSOLVE.value: "dissolve",
            TransitionType.WIPE_LEFT.value: "wipeleft",
            TransitionType.WIPE_RIGHT.value: "wiperight",
            TransitionType.SLIDE_LEFT.value: "slideleft",
            TransitionType.SLIDE_RIGHT.value: "slideright",
            TransitionType.ZOOM.value: "zoomin",
        }
        ttype = mapping.get(trans.type, "dissolve")
        offset = max(0.0, stream_len - duration)
        self.filters.append(
            f"[{a}][{b}]xfade=transition={ttype}:duration={_num(duration)}"
            f":offset={_num(offset)}[{tag}]")
        return tag

    def _concat_two(self, a: str, b: str, video: bool) -> str:
        tag = f"cc_{'v' if video else 'a'}_{len(self.filters)}"
        if video:
            self.filters.append(f"[{a}][{b}]concat=n=2:v=1:a=0[{tag}]")
        else:
            self.filters.append(f"[{a}][{b}]concat=n=2:v=0:a=1[{tag}]")
        return tag

    # --------------------------------------------------------- audio track
    def _build_audio_track(self, track: Track) -> Optional[str]:
        clips = [c for c in track.sorted_clips()
                 if c.enabled and c.kind in (ClipKind.AUDIO.value, ClipKind.VIDEO.value)]
        if not clips:
            return None
        pieces: list[tuple[str, float]] = []
        cursor = 0.0
        for clip in clips:
            if clip.start > cursor + 1e-6:
                gap_dur = clip.start - cursor
                pieces.append((self._silent_gap(gap_dur), gap_dur))
                cursor = clip.start
            label = self._build_audio_clip(clip)
            if label:
                pieces.append((label, clip.duration))
            cursor = clip.end
        if not pieces:
            return None
        out = pieces[0][0]
        for label, _d in pieces[1:]:
            out = self._concat_two(out, label, video=False)
        return out

    def _build_audio_clip(self, clip: Clip) -> Optional[str]:
        if not (clip.kind == ClipKind.AUDIO.value or
                (clip.kind == ClipKind.VIDEO.value and
                 self._src_meta.get(clip.media_id, {}).get("has_audio", False))):
            return None
        idx = self._ensure_input(clip)
        tag = f"ac_{clip.id.replace('-', '_')}"
        speed = max(clip.speed, 0.1)
        layout = "stereo" if self.ch >= 2 else "mono"
        chains = [
            f"atrim=start={_num(clip.source_in)}:end={_num(clip.source_out)}",
            "asetpts=PTS-STARTPTS",
        ]
        if abs(speed - 1.0) > 1e-3:
            chains.append(atempo_chain(speed))
        chains.append(f"volume=volume='{kf_expression(clip, 'gain', clip.gain)}':eval=frame")
        if clip.fade_in > 0:
            chains.append(f"afade=t=in:st=0:d={_num(clip.fade_in)}")
        if clip.fade_out > 0:
            chains.append(
                f"afade=t=out:st={_num(max(0, clip.duration - clip.fade_out))}"
                f":d={_num(clip.fade_out)}")
        if clip.muted:
            chains.append("volume=0")
        for fx in clip.effects:
            af = self._audio_effect_filter(fx)
            if af:
                chains.append(af)
        chains.append(f"aformat=sample_rates={self.sr}:channel_layouts={layout}")
        self.filters.append(f"[{idx}:a]{','.join(chains)}[{tag}]")
        return tag

    def _audio_effect_filter(self, fx) -> str:
        if not fx.enabled:
            return ""
        p = fx.params
        if fx.type == EffectType.AUDIO_EQ.value:
            return (f"equalizer=f=150:t=q:w=1:g={_num(float(p.get('bass', 0)))},"
                    f"equalizer=f=1000:t=q:w=1:g={_num(float(p.get('mid', 0)))},"
                    f"equalizer=f=4000:t=q:w=1:g={_num(float(p.get('treble', 0)))}")
        if fx.type == EffectType.AUDIO_NOISE_REDUCTION.value:
            return f"afftdn=nr={_num(float(p.get('intensity', 0.5)) * 30)}:nf=-25"
        if fx.type == EffectType.VOICE_ENHANCE.value:
            strength = float(p.get("intensity", 0.5))
            return (f"highpass=f=80,afftdn=nr={_num(strength * 15)},"
                    f"acompressor=threshold=-20dB:ratio=3:makeup=2")
        return ""

    def _silent_gap(self, duration: float) -> str:
        tag = f"sil_{len(self.filters)}_{abs(hash(duration)) % 100000}"
        layout = "stereo" if self.ch >= 2 else "mono"
        idx = self._add_lavfi(f"anullsrc=r={self.sr}:cl={layout}:d={_num(duration)}")
        self.filters.append(
            f"[{idx}:a]aformat=sample_rates={self.sr}:channel_layouts={layout}[{tag}]")
        return tag

    # ----------------------------------------------------------- composition
    def _compose_video(self, labels: list[str], total: float) -> str:
        base = f"vbase_{len(self.filters)}"
        bg = self.p.settings.background.lstrip("#")
        self.filters.append(
            f"color=c=0x{bg}:s={self.W}x{self.H}:r={_num(self.fps)}"
            f":d={_num(total + 0.1)}[{base}]")
        out = base
        for label in labels:
            nxt = f"vov_{len(self.filters)}"
            self.filters.append(
                f"[{out}][{label}]overlay=eof_action=pass:format=auto[{nxt}]")
            out = nxt
        if self.burn_subtitles:
            sub = str(self.burn_subtitles).replace("\\", "/").replace(":", "\\:")
            nxt = f"vsub_{len(self.filters)}"
            self.filters.append("[" + out + "]subtitles='" + sub + "'[" + nxt + "]")
            out = nxt
        nxt = f"vfmt_{len(self.filters)}"
        pix_fmt = "rgba" if self.p.settings.render_background_alpha else "yuv420p"
        self.filters.append(f"[{out}]format={pix_fmt}[{nxt}]")
        return nxt

    def _compose_audio(self, labels: list[str], total: float) -> str:
        layout = "stereo" if self.ch >= 2 else "mono"
        if not labels:
            idx = self._add_lavfi(
                f"anullsrc=r={self.sr}:cl={layout}:d={_num(total + 0.1)}")
            out = f"asil_{len(self.filters)}"
            self.filters.append(f"[{idx}:a]anull[{out}]")
        elif len(labels) == 1:
            out = labels[0]
        else:
            out = f"amix_{len(self.filters)}"
            inputs = "".join(f"[{l}]" for l in labels)
            self.filters.append(
                f"{inputs}amix=inputs={len(labels)}:normalize=0"
                f":dropout_transition=0[{out}]")
        final = f"aout_{len(self.filters)}"
        self.filters.append(
            f"[{out}]aformat=sample_rates={self.sr}:channel_layouts={layout}[{final}]")
        return final
