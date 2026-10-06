"""Build blink composites: align each eyes-closed edit to its base keyframe,
isolate the eye region from the real pixel difference, feather it into a mask
and store base-resolution blink images + masks for the renderer.
"""
import os
import numpy as np
from PIL import Image, ImageFilter

D = "/home/user/neurio/output/frames"
W, H = 1080, 1920
PAIRS = {"f1": ("f1_typing.png", "f1_blink.png"),
         "f2": ("f2_noticed.png", "f2_blink.png"),
         "f3": ("f3_manager_passes.png", "f3_blink.png"),
         "f4": ("f4_exhausted.png", "f4_blink.png"),
         }

try:
    from scipy import ndimage
    HAVE_SCIPY = True
except Exception:
    HAVE_SCIPY = False


def prep(path):
    im = Image.open(os.path.join(D, path)).convert("RGB")
    w, h = im.size
    tw, th = w, int(round(w * 16 / 9))
    if th > h:
        th, tw = h, int(round(h * 9 / 16))
    box = ((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th)
    return im.crop(box).resize((W, H), Image.LANCZOS)


def best_shift(base, mov, rng=10):
    """integer shift of `mov` that best matches `base` (on a blurred grey version)"""
    bg = np.asarray(base.convert("L").filter(ImageFilter.GaussianBlur(2)), dtype=np.float32)
    mg = np.asarray(mov.convert("L").filter(ImageFilter.GaussianBlur(2)), dtype=np.float32)
    best, bs = None, (0, 0)
    Hh, Ww = bg.shape
    for dy in range(-rng, rng + 1, 1):
        for dx in range(-rng, rng + 1, 1):
            m = mg[max(0, dy):Hh + min(0, dy), max(0, dx):Ww + min(0, dx)]
            b = bg[max(0, -dy):Hh - max(0, dy), max(0, -dx):Ww - max(0, dx)]
            v = float(np.mean((m - b) ** 2))
            if best is None or v < best:
                best, bs = v, (dx, dy)
    return bs


out = {}
report = []
for key, (base_fn, blink_fn) in PAIRS.items():
    base = prep(base_fn)
    edit = prep(blink_fn)
    dx, dy = best_shift(base, edit)
    a = np.asarray(base, dtype=np.float32)
    e = np.asarray(edit, dtype=np.float32)
    # integral shift
    e_s = np.roll(np.roll(e, -dy, axis=0), -dx, axis=1)
    diff = np.abs(e_s - a).mean(axis=2)
    diff = np.asarray(Image.fromarray(np.clip(diff, 0, 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(1.2)), dtype=np.float32)

    # eye region = strongest differences in the upper part of the frame
    thr = max(14.0, np.percentile(diff, 99.2))
    hot = diff > thr
    hot[: int(0.22 * H), :] = False      # ignore ceiling / background clutter
    hot[int(0.72 * H):, :] = False       # ignore hands / desk
    if HAVE_SCIPY and hot.any():
        lab, n = ndimage.label(hot, structure=np.ones((3, 3)))
        if n:
            sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
            keep = [i + 1 for i, s in enumerate(sizes) if s > 12]
            if keep:
                m = np.isin(lab, keep)
                # the eyes are the strongest cluster -> keep only a padded box around it
                big = int(keep[int(np.argmax([sizes[i - 1] for i in keep]))])
                ys, xs = np.where(lab == big)
                y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
                py, px = int(0.075 * H), int(0.115 * W)
                box = np.zeros_like(m)
                box[max(0, y0 - py):min(H, y1 + py), max(0, x0 - px):min(W, x1 + px)] = True
                m = m & box
                # drop anything far below the eyes (nostrils/mouth can shift too)
                m[int(y0 + 0.055 * H):, :] = False
                if m.sum() >= 20:
                    hot = m
    mask = np.asarray(
        Image.fromarray((hot * 255).astype(np.uint8)).filter(
            ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(7)).filter(
            ImageFilter.GaussianBlur(5)), dtype=np.float32) / 255.0
    mask = np.clip((mask - 0.06) / 0.94, 0, 1) ** 0.9
    if mask.max() < 0.05:
        report.append((key, "SKIPPED - no usable eye diff"))
        continue
    blink_img = a * (1 - mask[:, :, None]) + e_s * mask[:, :, None]
    out[key + "_img"] = blink_img.astype(np.uint8)
    out[key + "_mask"] = mask.astype(np.float16)

    # diagnostics
    ys = np.where(mask > 0.25)[0]
    xs = np.where(mask > 0.25)[1]
    yy0, yy1 = (ys.min(), ys.max()) if len(ys) else (0, 0)
    xx0, xx1 = (xs.min(), xs.max()) if len(xs) else (0, 0)
    report.append((key, f"shift=({dx},{dy}) hotpx={int(hot.sum())} maskpx={int((mask>0.25).sum())} "
                        f"eye_box=({xx0},{yy0})-({xx1},{yy1}) cover={float(mask.max()):.2f}"))
    pad = int(0.06 * H)
    yA, yB = max(0, yy0 - pad), min(H, yy1 + pad)
    xA, xB = max(0, xx0 - int(0.12 * W)), min(W, xx1 + int(0.12 * W))
    strip = Image.new("RGB", ((xB - xA) * 3, yB - yA))
    strip.paste(Image.fromarray(a[yA:yB, xA:xB].astype(np.uint8)), (0, 0))
    strip.paste(Image.fromarray(blink_img[yA:yB, xA:xB].astype(np.uint8)), (xB - xA, 0))
    mv = (mask[yA:yB, xA:xB, None] * 255).repeat(3, axis=2)
    strip.paste(Image.fromarray(mv.astype(np.uint8)), ((xB - xA) * 2, 0))
    strip.save(os.path.join(D, f"diag_blink_{key}.png"))

np.savez_compressed(os.path.join(D, "blink_masks.npz"), **out)
print("scipy:", HAVE_SCIPY)
for k, v in report:
    print(f"  {k}: {v}")
print("wrote", os.path.join(D, "blink_masks.npz"), "keys:", list(out.keys()))
