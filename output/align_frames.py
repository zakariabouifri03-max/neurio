"""Register every keyframe against frame 1 (background lock) so the AI re-framing
drift between story beats disappears and the shot reads as one continuous take.

Computes per-keyframe (scale, dx, dy) via multi-scale phase correlation with
parabolic sub-pixel refinement, and writes frames/alignment.json.
"""
import json, os
import numpy as np
from PIL import Image

D = "/home/user/neurio/output/frames"
W, H = 1080, 1920
SCAN_W = 540
FILES = {"f1": "f1_typing.png", "f2": "f2_noticed.png", "f3": "f3_manager_passes.png",
         "f4": "f4_exhausted.png", "f5": "f5_caught.png", "f6": "f6_deadpan.png"}


def crop916(im):
    w, h = im.size
    tw, th = w, int(round(w * 16 / 9))
    if th > h:
        th, tw = h, int(round(h * 9 / 16))
    x0, y0 = (w - tw) // 2, (h - th) // 2
    return im.crop((x0, y0, x0 + tw, y0 + th))


def gray_small(path, scale=1.0):
    im = crop916(Image.open(os.path.join(D, path)).convert("L"))
    if scale != 1.0:
        im = im.resize((max(8, int(im.width * scale)), max(8, int(im.height * scale))), Image.LANCZOS)
    return np.asarray(im.resize((SCAN_W, int(round(SCAN_W * 16 / 9))), Image.LANCZOS), dtype=np.float32)


def phase_shift(a, b):
    """shift that maps b onto a (sub-pixel), with a window to reduce wrap-around."""
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    A = np.fft.rfft2((a - a.mean()) * win)
    B = np.fft.rfft2((b - b.mean()) * win)
    R = A * np.conj(B)
    R /= (np.abs(R) + 1e-9)
    r = np.fft.irfft2(R, s=(h, w))
    idx = int(np.argmax(r))
    py, px = divmod(idx, w)
    def refine(delta, axis_len, get):
        m, p, n = get((py + delta) % h, (px + delta) % w) if axis_len == h else get(py, (px + delta) % w)
        return 0.0
    # parabolic sub-pixel on the correlation peak
    def par(v_m, v_0, v_p):
        d = (v_m - v_p) / (2 * (v_m - 2 * v_0 + v_p) + 1e-9)
        return float(np.clip(d, -0.6, 0.6))
    ym, y0, yp = r[(py - 1) % h, px], r[py, px], r[(py + 1) % h, px]
    xm, x0, xp = r[py, (px - 1) % w], r[py, px], r[py, (px + 1) % w]
    dy = par(ym, y0, yp)
    dx = par(xm, x0, xp)
    sy = py + dy
    sx = px + dx
    if sy > h / 2:
        sy -= h
    if sx > w / 2:
        sx -= w
    return sx, sy


def apply_shift(img, dx, dy):
    Hh, Ww = img.shape[:2]
    ys, xs = np.mgrid[0:Hh, 0:Ww]
    sy = np.clip(np.round(ys - dy).astype(np.int32), 0, Hh - 1)
    sx = np.clip(np.round(xs - dx).astype(np.int32), 0, Ww - 1)
    return img[sy, sx] if img.ndim == 2 else img[sy, sx]


base = gray_small(FILES["f1"])
ref_full = crop916(Image.open(os.path.join(D, FILES["f1"])).convert("RGB")).resize((W, H), Image.LANCZOS)
ref = np.asarray(ref_full.convert("L").resize((SCAN_W, int(round(SCAN_W * 16 / 9))), Image.LANCZOS), dtype=np.float32)

result = {}
for key, fn in FILES.items():
    im = crop916(Image.open(os.path.join(D, fn)).convert("RGB"))
    if key == "f1":
        result[key] = {"scale": 1.0, "dx": 0.0, "dy": 0.0, "resid": 0.0}
        continue
    best = None
    for s in [0.93 + 0.01 * i for i in range(15)]:
        g = gray_small(fn, scale=s)
        dx, dy = phase_shift(ref, g)
        # residual after alignment (coarse integer shift is enough for model selection)
        sh = apply_shift(g, dx, dy)
        resid = float(np.mean((sh - ref) ** 2))
        if best is None or resid < best[0]:
            best = (resid, s, dx, dy)
    resid, s, dx, dy = best
    # convert scan-space shift to full-res shift for the renderer
    k = W / SCAN_W
    result[key] = {"scale": float(s), "dx": float(dx * k), "dy": float(dy * k), "resid": resid}
    print(f"  {key}: scale={s:.3f} shift=({dx * k:+.1f},{dy * k:+.1f})px resid={resid:.1f}")

json.dump(result, open(os.path.join(D, "alignment.json"), "w"), indent=1)
print("wrote alignment.json")

# visual sanity sheet: reference vs each aligned frame, edges highlighted
th, tw = 480, 270
sheet = Image.new("RGB", (tw * 6, th), (0, 0, 0))
for i, key in enumerate(FILES):
    im = crop916(Image.open(os.path.join(D, FILES[key])).convert("RGB"))
    r = result[key]
    if r["scale"] != 1.0 or r["dx"] or r["dy"]:
        im = im.resize((int(im.width * r["scale"]), int(im.height * r["scale"])), Image.LANCZOS)
        tmp = Image.new("RGB", (im.width, im.height), (0, 0, 0))
        tmp.paste(im, (0, 0))
        im = tmp  # scale only; shifts are applied numerically in the sheet below
        a = np.asarray(im.resize((tw, th), Image.LANCZOS), dtype=np.float32)
        a = apply_shift(a, r["dx"] * tw / W, r["dy"] * th / H)
        sheet.paste(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), (i * tw, 0))
    else:
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (i * tw, 0))
sheet.save("/tmp/align_sheet.jpg", quality=90)
print("sheet -> /tmp/align_sheet.jpg")
