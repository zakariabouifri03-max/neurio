#!/usr/bin/env python3
"""Extract just the printed design from a product mockup, cut it out, upscale it.

    python3 tools/extract-from-mockup.py --in mockups/ --out assets/designs/clean
    python3 tools/extract-from-mockup.py --in tee.jpg --box 210,180,520,540

How it works, per image:
  1. finds the garment: the large, bright, low-saturation area (a white or
     cream tee, sweatshirt, tote...),
  2. finds the print inside it: the pixels that differ from the garment,
  3. crops to the print and removes the garment colour as background, so the
     result is transparent where the fabric was,
  4. cleans stray specks, feathers the edge, trims, upscales to print size,
  5. verifies the result the same way the rest of the pipeline does.

Known limits (read these before trusting the output):
  * a light-coloured design on a light shirt cannot be recovered — the pixels
    are the same colour as the fabric;
  * a watermark stamped over the design stays unless you erase it with
    --erase x,y,w,h (repeatable), which fills the area from its surroundings;
  * the shirt's own folds and shadows can survive as faint smudges; raise
    --tolerance or pass a tighter --box.

For a sellable file, the master artwork from your design app is always better
than an extraction. Use this when the mockup is all you have.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from PIL import Image, ImageChops, ImageDraw, ImageFilter  # noqa: E402

from lib_bg import (  # noqa: E402
    SUPPORTED, list_images, cut_backdrop, trim, summarise, verdict,
    white_halo_score, upscale, save_png, preview_on_checker, human_bytes,
)


def design_id(name: str) -> str:
    match = re.match(r"^\s*(\d{8,12})", name)
    return match.group(1) if match else ""


def dominant_colour(img: Image.Image, box) -> tuple[int, int, int]:
    """Most common colour inside a region, quantised to shrug off JPEG noise."""
    region = img.crop(box).convert("RGB")
    small = region.resize((min(160, region.width) or 1, min(160, region.height) or 1), Image.NEAREST)
    counts: dict[tuple[int, int, int], int] = {}
    for colour in small.getdata():
        key = (colour[0] // 8 * 8, colour[1] // 8 * 8, colour[2] // 8 * 8)
        counts[key] = counts.get(key, 0) + 1
    return max(counts, key=counts.get)


def fabric_model(crop: Image.Image, fabric: tuple[int, int, int]) -> Image.Image:
    """A per-pixel guess at "what the shirt looks like here, without the print".

    A photographed garment is a gradient, not one colour, so a single value
    cannot describe it. We take the print out roughly, replace those pixels
    with the garment colour, blur heavily, and end up with a smooth background
    that follows the folds and shading but contains no artwork.
    """
    rgb = crop.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    rough = Image.new("L", (w, h), 0)
    rp = rough.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if max(abs(r - fabric[0]), abs(g - fabric[1]), abs(b - fabric[2])) > 26:
                rp[x, y] = 255
    # grow the mask so anti-aliased edges go too
    rough = rough.filter(ImageFilter.MaxFilter(5))

    patch = rgb.copy()
    pp, rpp = patch.load(), rough.load()
    for y in range(h):
        for x in range(w):
            if rpp[x, y]:
                pp[x, y] = fabric

    radius = max(8, int(max(w, h) * 0.08))
    return patch.filter(ImageFilter.GaussianBlur(radius))


def model_cut(crop: Image.Image, fabric: tuple[int, int, int], lo: int = 14, hi: int = 42) -> Image.Image:
    """Cut against a per-pixel garment model (works on shaded/photographed fabric)."""
    rgb = crop.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    bg = fabric_model(crop, fabric).load()

    alpha = Image.new("L", (w, h), 0)
    ap = alpha.load()
    span = max(1, hi - lo)
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            br, bgc, bb = bg[x, y]
            d = max(abs(r - br), abs(g - bgc), abs(b - bb))
            if d <= lo:
                ap[x, y] = 0
            elif d >= hi:
                ap[x, y] = 255
            else:
                ap[x, y] = int((d - lo) / span * 255)

    return _finish(rgb, alpha, bg, w, h)


def _finish(rgb, alpha, bg_loader, w: int, h: int):
    """Shared tail of both cutters: fill enclosed holes, clear the seam, and
    un-mix the fabric out of the soft edge."""
    # Enclosed holes are artwork (white counters in letters, highlights inside
    # a shape). Only holes reachable from the border are backdrop, so flood in
    # from every border pixel that is clear — and if the border is not clear at
    # all, skip the fill entirely (there is nothing to fill).
    clear = alpha.point(lambda v: 255 if v < 40 else 0)
    probe = clear.copy()
    seeded = 0
    for x in range(w):
        for y in (0, h - 1):
            if probe.getpixel((x, y)) == 255:
                try:
                    ImageDraw.floodfill(probe, (x, y), 128)
                    seeded += 1
                except Exception:
                    pass
    for y in range(h):
        for x in (0, w - 1):
            if probe.getpixel((x, y)) == 255:
                try:
                    ImageDraw.floodfill(probe, (x, y), 128)
                    seeded += 1
                except Exception:
                    pass

    if seeded:
        pp, ap2 = probe.load(), alpha.load()
        for y in range(h):
            for x in range(w):
                if pp[x, y] == 255:
                    ap2[x, y] = 255

    # the crop seam itself is never artwork
    ap3 = alpha.load()
    for x in range(w):
        ap3[x, 0] = 0
        ap3[x, h - 1] = 0
    for y in range(h):
        ap3[0, y] = 0
        ap3[w - 1, y] = 0

    # un-mix the fabric out of the soft edge so no pale rim survives
    px = rgb.load()
    out = rgb.convert("RGBA")
    op = out.load()
    for y in range(h):
        for x in range(w):
            a = ap3[x, y]
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
            elif a < 255:
                f = max(a / 255.0, 0.3)
                if bg_loader is not None:
                    br, bgc, bb = bg_loader[x, y]
                else:
                    br, bgc, bb = 0, 0, 0
                cr, cg, cb = px[x, y]
                cr = int(max(0, min(255, br + (cr - br) / f)))
                cg = int(max(0, min(255, bgc + (cg - bgc) / f)))
                cb = int(max(0, min(255, bb + (cb - bb) / f)))
                op[x, y] = (cr, cg, cb, a)
    return out


def flat_cut(
    crop: Image.Image,
    fabric: tuple[int, int, int],
    lo: int = 16,
    hi: int = 44,
) -> Image.Image:
    """Cut artwork out of fabric of a known colour.

    Every pixel is compared with the fabric's own colour:

        distance <= lo        -> transparent (it is shirt)
        distance >= hi        -> fully opaque (it is ink)
        in between            -> soft edge, colour un-mixed from the fabric

    A strict threshold is what keeps the edge clean. A looser "local
    background" model leaves a wide band of half-transparent pixels that still
    carry the fabric colour, and that band is exactly the pale rim that makes a
    cut-out look amateur.
    """
    rgb = crop.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    alpha = Image.new("L", (w, h), 0)
    ap = alpha.load()
    span = max(1, hi - lo)

    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            d = max(abs(r - fabric[0]), abs(g - fabric[1]), abs(b - fabric[2]))
            if d <= lo:
                ap[x, y] = 0
            elif d >= hi:
                ap[x, y] = 255
            else:
                ap[x, y] = int((d - lo) / span * 255)

    return _finish(rgb, alpha, None, w, h)


def drop_fabric_tint(img: Image.Image, fabric: tuple[int, int, int], strength: float = 3.6) -> Image.Image:
    """Kill the leftover fabric shading inside the cut-out.

    A photographed shirt is never one flat colour: sleeves and folds leave a
    soft gradient. After the cut-out, that gradient reads as a faint rectangle
    behind the design. Pixels that are still close to the fabric colour are
    made fully transparent; everything else keeps its alpha.
    """
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    px = rgba.load()
    apx = alpha.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            a = apx[x, y]
            if not a:
                continue
            r, g, b, _ = px[x, y]
            dist = abs(r - fabric[0]) + abs(g - fabric[1]) + abs(b - fabric[2])
            if dist < 90 * strength / 2.6:
                # very close to the fabric: vanish
                apx[x, y] = 0
            elif dist < 150 * strength / 2.6:
                # borderline: fade out proportionally
                fade = (dist - 90 * strength / 2.6) / (60 * strength / 2.6)
                apx[x, y] = int(a * max(0.0, min(1.0, fade)))
    rgba.putalpha(alpha)
    return rgba


def garment_and_print(img: Image.Image, tol: int) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int], tuple[int, int, int]]:
    """Return (garment_box, print_box, fabric_colour) in the original coordinates."""
    work = img.convert("RGB")
    scale = min(1.0, 900 / max(work.size))
    small = work.resize((max(1, int(work.width * scale)), max(1, int(work.height * scale))), Image.LANCZOS)

    # 1. garment = bright, low-saturation area
    _h, s, v = small.convert("HSV").split()
    garment_mask = ImageChops.multiply(
        v.point(lambda p: 255 if p > 168 else 0),
        s.point(lambda p: 255 if p < 58 else 0),
    ).filter(ImageFilter.MedianFilter(7))
    gbox = garment_mask.getbbox() or (0, 0, small.width, small.height)

    # 2. fabric colour, sampled from the garment's own border (sleeves/hem),
    #    which is far from the print
    fabric = dominant_colour(small, gbox)

    # 3. "ink" = the pixels that look like printed artwork: clearly darker
    #    than the fabric, or clearly more colourful than it. A pale collar seam
    #    or the shirt's own shading is neither, so it never widens the box.
    px = small.load()
    fabric_lum = 0.299 * fabric[0] + 0.587 * fabric[1] + 0.114 * fabric[2]
    dark_limit = fabric_lum - 55
    sat_limit = 45

    inset = max(2, int(min(gbox[2] - gbox[0], gbox[3] - gbox[1]) * 0.02))
    sx0, sy0 = gbox[0] + inset, gbox[1] + inset
    sx1, sy1 = gbox[2] - inset, gbox[3] - inset

    mask = Image.new("L", small.size, 0)
    mpx = mask.load()
    for y in range(sy0, sy1):
        for x in range(sx0, sx1):
            r, g, b = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            sat = max(r, g, b) - min(r, g, b)
            if lum < dark_limit or sat > sat_limit:
                mpx[x, y] = 255

    # 4. keep the dense core only: a stray dark speck (a shadow under a fold)
    #    must not stretch the box, and we want the longest contiguous run of
    #    rows/columns that actually contain artwork
    mask = mask.filter(ImageFilter.MedianFilter(3))
    mpx = mask.load()
    row_hits = [sum(1 for x in range(sx0, sx1) if mpx[x, y]) for y in range(sy0, sy1)]
    col_hits = [sum(1 for y in range(sy0, sy1) if mpx[x, y]) for x in range(sx0, sx1)]
    row_min = max(2, int((sx1 - sx0) * 0.0025))
    col_min = max(2, int((sy1 - sy0) * 0.0025))

    # a multi-line design has real gaps between its lines, so allow a generous
    # jump — but far less than the empty space between the collar and the print
    gap_rows = max(10, int((sy1 - sy0) * 0.12))
    gap_cols = max(10, int((sx1 - sx0) * 0.12))

    def longest_run(start: int, hits: list[int], floor: int, gap: int) -> tuple[int, int] | None:
        active = [start + i for i, v in enumerate(hits) if v >= floor]
        if not active:
            return None
        best = cur = (active[0], active[0])
        for v in active[1:]:
            if v - cur[1] <= gap:
                cur = (cur[0], v)
                if (cur[1] - cur[0]) > (best[1] - best[0]):
                    best = cur
            else:
                cur = (v, v)
        return best

    run_rows = longest_run(sy0, row_hits, row_min, gap_rows)
    run_cols = longest_run(sx0, col_hits, col_min, gap_cols)
    if run_rows and run_cols:
        pbox = (run_cols[0], run_rows[0], run_cols[1] + 1, run_rows[1] + 1)
        # tighten to where the ink actually is inside that run, so the crop
        # never carries a strip of empty (shaded) fabric
        tight = mask.getbbox()
        if tight:
            pbox = (max(pbox[0], tight[0]), max(pbox[1], tight[1]),
                    min(pbox[2], tight[2]), min(pbox[3], tight[3]))
    else:
        pbox = gbox

    inv = 1.0 / scale
    garment = tuple(int(round(c * inv)) for c in gbox)
    printed = tuple(int(round(c * inv)) for c in pbox)
    return garment, printed, fabric


def force_transparent(img: Image.Image, boxes: list[tuple[int, int, int, int]], feather: int = 2) -> Image.Image:
    """Make the given regions fully transparent.

    A stamp or watermark is not part of the design, so the honest thing is to
    delete that area rather than invent pixels to cover it. Feathering the
    boundary keeps the cut from looking like a hole was punched with a ruler.
    """
    out = img.convert("RGBA")
    if not boxes:
        return out
    keep = Image.new("L", out.size, 255)
    d = ImageDraw.Draw(keep)
    for (x, y, w, h) in boxes:
        d.rectangle([x, y, x + w, y + h], fill=0)
    if feather:
        keep = keep.filter(ImageFilter.GaussianBlur(feather))
    alpha = ImageChops.multiply(out.getchannel("A"), keep)
    out.putalpha(alpha)
    return out


def erase_areas(img: Image.Image, boxes: list[tuple[int, int, int, int]]) -> Image.Image:
    """Replace stamped areas with a blur of their surroundings.

    This is not magic: it is a local blur, so a watermark sitting on top of a
    detailed drawing leaves a soft patch. It is enough for a stamp on empty
    fabric, not for a stamp across the middle of the artwork.
    """
    out = img.convert("RGB").copy()
    for (x, y, w, h) in boxes:
        pad = 6
        region = (max(0, x - pad), max(0, y - pad), min(out.width, x + w + pad), min(out.height, y + h + pad))
        patch = out.crop(region)
        blurred = patch.filter(ImageFilter.GaussianBlur(radius=10))
        mask = Image.new("L", patch.size, 0)
        ImageDraw.Draw(mask).rectangle(
            [pad, pad, patch.width - pad - 1, patch.height - pad - 1], fill=255
        )
        mask = mask.filter(ImageFilter.GaussianBlur(radius=3))
        merged = Image.composite(blurred, patch, mask)
        out.paste(merged, (region[0], region[1]))
    return out


def parse_boxes(values: list[str]) -> list[tuple[int, int, int, int]]:
    boxes = []
    for raw in values:
        parts = [p for p in re.split(r"[,\s]+", raw.strip()) if p]
        if len(parts) != 4:
            raise SystemExit(f"--erase needs x,y,w,h — got {raw!r}")
        boxes.append(tuple(int(float(p)) for p in parts))
    return boxes


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pull the printed design out of a mockup.")
    p.add_argument("--in", dest="src", required=True, help="mockup image or folder")
    p.add_argument("--out", dest="dst", required=True, help="folder for the transparent PNGs")
    p.add_argument("--box", default="", help="force the print area: x,y,w,h (skips auto-detection)")
    p.add_argument("--erase", action="append", default=[],
                   help="delete a stamped/watermarked area x,y,w,h (repeatable); "
                        "must NOT overlap the design itself")
    p.add_argument("--tolerance", type=int, default=22,
                   help="how far from the fabric colour still counts as fabric (default 22)")
    p.add_argument("--feather", type=float, default=1.0, help="edge softness in px")
    p.add_argument("--choke", type=int, default=0, help="shrink the cut edge by N px")
    p.add_argument("--pad", type=int, default=3,
                   help="padding kept around the design (small on purpose: a big "
                        "pad pulls shirt edge into the crop)")
    p.add_argument("--target", type=int, default=3000, help="upscale long edge to this (0 = off)")
    p.add_argument("--dpi", type=int, default=300)
    p.add_argument("--keep-size", action="store_true", help="keep the original canvas")
    p.add_argument("--method", choices=("model", "flat", "colour"), default="model",
                   help="model = follow the garment's shading (default, best for photos); "
                        "flat = one garment colour; colour = plain backdrop removal")
    p.add_argument("--threshold", type=int, default=12,
                   help="sensitivity for --method local: lower picks up fainter ink (default 12)")
    p.add_argument("--keep-tint", action="store_true",
                   help="keep leftover fabric shading (leave off for a clean cut-out)")
    p.add_argument("--preview", action="store_true", help="write checkerboard previews")
    p.add_argument("--debug-boxes", action="store_true", help="draw the detected boxes on a copy")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    files = list_images(args.src)
    if not files:
        print(f"No images found in {args.src}")
        return 2

    os.makedirs(args.dst, exist_ok=True)
    preview_dir = os.path.join(args.dst, "preview")
    if args.preview:
        os.makedirs(preview_dir, exist_ok=True)
    forced = parse_boxes([args.box])[0] if args.box else None
    erases = parse_boxes(args.erase)

    rows, failed = [], []
    for path in files:
        base = os.path.splitext(os.path.basename(path))[0]
        did = design_id(base) or base
        try:
            with Image.open(path) as im:
                im.load()
                img = im.convert("RGB")
                garment, printed, fabric = garment_and_print(img, args.tolerance)
                box = forced or (printed[0], printed[1], printed[2] - printed[0], printed[3] - printed[1])

                if args.debug_boxes:
                    dbg = img.copy()
                    d = ImageDraw.Draw(dbg)
                    d.rectangle(garment, outline=(0, 160, 255), width=4)
                    d.rectangle([box[0], box[1], box[0] + box[2], box[1] + box[3]], outline=(255, 60, 0), width=4)
                    dbg.save(os.path.join(args.dst, f"{did}-boxes.jpg"), quality=85)

                # a small, deliberate margin: enough that descenders and edge
                # details are never clipped, small enough that the crop stays
                # inside the print area
                g = max(3, int(max(box[2], box[3]) * 0.012))
                pad = g
                crop_box = (
                    max(0, box[0] - pad), max(0, box[1] - pad),
                    min(img.width, box[0] + box[2] + pad), min(img.height, box[1] + box[3] + pad),
                )
                crop = img.crop(crop_box)
                erase_local = []
                for (ex, ey, ew, eh) in erases:
                    lx, ly = ex - crop_box[0], ey - crop_box[1]
                    lx2, ly2 = lx + ew, ly + eh
                    lx, ly = max(0, lx), max(0, ly)
                    lx2, ly2 = min(crop.width, lx2), min(crop.height, ly2)
                    if lx2 - lx > 2 and ly2 - ly > 2:
                        erase_local.append((lx, ly, lx2 - lx, ly2 - ly))

                if args.method == "model":
                    art = model_cut(crop, fabric, lo=args.threshold, hi=args.threshold * 3)
                elif args.method == "flat":
                    art = flat_cut(crop, fabric, lo=args.threshold, hi=args.threshold * 3)
                else:
                    art, _bg, _stats = cut_backdrop(
                        crop, tolerance=args.tolerance, feather=args.feather, choke=args.choke
                    )
                if erase_local:
                    # delete stamped/watermarked areas instead of guessing what
                    # was underneath them
                    art = force_transparent(art, erase_local, feather=3)
                if args.method == "colour" and not args.keep_tint:
                    art = drop_fabric_tint(art, fabric)
                if args.feather and args.method == "local":
                    art = art.convert("RGBA")
                if not args.keep_size:
                    art = trim(art, pad=args.pad)
                if args.target:
                    art = upscale(art, min_long_edge=args.target)
                art = art.convert("RGBA")

            stats = summarise(art)
            ok, problems = verdict(stats)
            halo = white_halo_score(art)
            if halo > 0.55:
                problems.append(f"white fringe on {halo*100:.0f}% of the edge — try --choke 1")
                ok = False
            if not ok:
                failed.append((base, problems))

            out_path = os.path.join(args.dst, did + ".png")
            save_png(art, out_path, dpi=args.dpi)
            if args.preview:
                preview_on_checker(art, max_side=520).save(
                    os.path.join(preview_dir, did + ".jpg"), quality=82
                )

            rows.append((base[:30], f"{stats['size'][0]}x{stats['size'][1]}",
                         f"{stats['transparent']*100:.0f}%", f"{halo*100:.0f}%",
                         human_bytes(os.path.getsize(out_path)), "PASS" if ok else "FAIL"))
        except Exception as exc:  # noqa: BLE001
            failed.append((base, [str(exc)]))
            rows.append((base[:30], "-", "-", "-", "-", "FAIL"))

    width = max(len(r[0]) for r in rows) + 2
    print(f"\n  {'file'.ljust(width)}{'px'.rjust(12)}{'clear'.rjust(8)}{'fringe'.rjust(8)}{'file'.rjust(11)}  result")
    print("  " + "-" * (width + 44))
    for r in rows:
        print(f"  {r[0].ljust(width)}{r[1].rjust(12)}{r[2].rjust(8)}{r[3].rjust(8)}{r[4].rjust(11)}  {r[5]}")

    print(f"\n  {len(rows)-len(failed)}/{len(rows)} extracted  ·  {args.dst}")
    if args.debug_boxes:
        print("  boxes drawn on: <id>-boxes.jpg (blue = garment, orange = print)")
    if args.preview:
        print(f"  previews: {preview_dir}")
    if failed:
        print("\n  Check these by eye before using them:")
        for name, problems in failed:
            for problem in problems:
                print(f"   - {name}: {problem}")
        return 1
    print("  Extracted, cut out and upscaled.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
