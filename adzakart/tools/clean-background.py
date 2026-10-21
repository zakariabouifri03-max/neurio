#!/usr/bin/env python3
"""Remove the backdrop from finished artwork -> sell-ready transparent PNG.

    python3 tools/clean-background.py --in raw/ --out clean/
    python3 tools/clean-background.py --in raw/ --out clean/ --preview
    python3 tools/clean-background.py --in one-file.jpg --out clean/

What it does, per file:
  1. reads the real backdrop colour from the border (white, cream, grey, paper),
  2. flood-fills only the border-connected area, so whites *inside* the art
     (eyes, highlights, counters of letters) survive,
  3. feathers the cut edge and un-multiplies the backdrop out of it — this is
     what kills the "white cast" buyers complain about,
  4. trims to the artwork and saves a real RGBA PNG,
  5. re-checks the result and prints PASS/FAIL.

Run check-transparency.py afterwards (or on any folder) as the final gate.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image  # noqa: E402

from lib_bg import (  # noqa: E402
    human_bytes, list_images, cut_backdrop, trim, summarise, verdict,
    preview_on_checker, white_halo_score, bg_lum, upscale, save_png,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Cut the backdrop out of artwork and save transparent PNGs.")
    p.add_argument("--in", dest="src", required=True, help="image file or folder to clean")
    p.add_argument("--out", dest="dst", required=True, help="folder for the transparent PNGs")
    p.add_argument("--tolerance", type=int, default=14,
                   help="%% colour distance treated as backdrop (default 14, raise for noisy JPEGs)")
    p.add_argument("--feather", type=float, default=0.8, help="edge softness in px (default 0.8)")
    p.add_argument("--choke", type=int, default=0, help="shrink the edge by N px to kill a halo")
    p.add_argument("--pad", type=int, default=6, help="transparent padding kept around the art")
    p.add_argument("--no-despill", action="store_true", help="skip backdrop un-multiply")
    p.add_argument("--keep-size", action="store_true", help="do not trim the canvas")
    p.add_argument("--preview", action="store_true", help="also write a checkerboard JPG preview")
    p.add_argument("--target", type=int, default=3000,
                   help="upscale so the long edge is at least this many px (default 3000 = print ready, 0 = off)")
    p.add_argument("--dpi", type=int, default=300, help="DPI written into the PNG (default 300)")
    p.add_argument("--force", action="store_true", help="re-clean files that already have alpha")
    p.add_argument("--report", default="", help="write deliverables.csv (listing id, file, Etsy URL) here")
    return p.parse_args()


CATALOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "catalog.json")


def listing_id(name: str) -> str:
    """Pull the Etsy listing id out of a filename.

    Accepts '4523481819.jpg', '4523481819-funny-whiskey.jpg' and
    '4523481819 Funny Whiskey Cigar.png'. Returns '' when there is no id.
    """
    match = re.match(r"^\s*(\d{8,12})", name)
    return match.group(1) if match else ""


def load_catalog() -> dict:
    try:
        with open(CATALOG, encoding="utf-8") as fh:
            data = json.load(fh)
        return {d["id"]: d for d in data.get("designs", [])}
    except Exception:
        return {}


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

    rows, failures, warnings_out, light_sources, outputs = [], [], [], set(), []
    for path in files:
        name = os.path.splitext(os.path.basename(path))[0]
        # A file named after the listing id is what the site and Etsy expect.
        lid = listing_id(name)
        out_name = lid if lid else name
        target = os.path.join(args.dst, out_name + ".png")
        try:
            with Image.open(path) as im:
                im.load()
                had_alpha = im.mode in ("RGBA", "LA") and summarise(im.convert("RGBA"))["transparent"] > 0.02
                if had_alpha and not args.force:
                    out = im.convert("RGBA")
                    bg = (0, 0, 0)
                    note = "already cut out"
                else:
                    out, bg, _ = cut_backdrop(
                        im, tolerance=args.tolerance, feather=args.feather,
                        despill=not args.no_despill, choke=args.choke,
                    )
                    note = "cleaned"
                    if not args.keep_size:
                        out = trim(out, pad=args.pad)
                if note == "cleaned" and args.target:
                    before = out.size
                    out = upscale(out, min_long_edge=args.target)
                    if out.size != before:
                        note = "cleaned + upscaled"
                save_png(out, target, dpi=args.dpi)

            stats = summarise(out)
            ok, problems = verdict(stats)
            halo = white_halo_score(out)

            warnings = []
            if halo > 0.55:
                problems.append(f"white fringe on {halo*100:.0f}% of edge pixels — retry with --choke 1")
                ok = False
            if note == "cleaned" and bg_lum(bg) > 235:
                light_sources.add(name)
            if not ok:
                failures.append((name, problems))

            if args.preview:
                preview_on_checker(out).save(os.path.join(preview_dir, name + ".jpg"), quality=82)

            rows.append((
                name[:34],
                f"{stats['size'][0]}x{stats['size'][1]}",
                f"{stats['transparent']*100:4.0f}%",
                f"{halo*100:3.0f}%",
                note,
                "PASS" if ok else "FAIL",
            ))
            warnings_out.extend((name, w) for w in warnings)
            outputs.append(target)
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
            failures.append((name, [str(exc)]))
            rows.append((name[:34], "-", "-", "-", "error", "FAIL"))

    # deliverables.csv — one line per listing, ready to work through on Etsy
    report_path = args.report or os.path.join(args.dst, "deliverables.csv")
    catalog = load_catalog()
    with open(report_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["listing_id", "design", "file", "bytes", "etsy_url", "status"])
        for row, path in zip(rows, files):
            base = os.path.splitext(os.path.basename(path))[0]
            lid = listing_id(base)
            design = catalog.get(lid, {})
            out_file = os.path.join(args.dst, (lid or base) + ".png")
            writer.writerow([
                lid or "(no id in filename)",
                design.get("short", base),
                os.path.relpath(out_file, os.path.dirname(report_path)),
                os.path.getsize(out_file) if os.path.exists(out_file) else 0,
                design.get("etsy", ""),
                row[5],
            ])

    width = max(len(r[0]) for r in rows) + 2
    print(f"\n  {'file'.ljust(width)}{'size'.rjust(12)}{'clear'.rjust(8)}{'fringe'.rjust(9)}  result")
    print("  " + "-" * (width + 40))
    for r in rows:
        print(f"  {r[0].ljust(width)}{r[1].rjust(12)}{r[2].rjust(8)}{r[3].rjust(9)}  {r[4]} -> {r[5]}")

    total = sum(os.path.getsize(f) for f in outputs if os.path.exists(f))
    print(f"\n  {len(rows) - len(failures)}/{len(rows)} files passed  ·  output {args.dst}"
          f"  ·  {human_bytes(total)}")
    if args.preview:
        print(f"  checkerboard previews: {preview_dir}")
    unnamed = sum(1 for path in files if not listing_id(os.path.splitext(os.path.basename(path))[0]))
    print(f"  deliverables list: {report_path}")
    if unnamed:
        print(f"  {unnamed} file(s) have no listing id in the name — prefix them with the Etsy "
              "listing id so the report can match them, e.g. 4523481819-funny-whiskey.jpg")
    if light_sources:
        print("\n  Note: " + ", ".join(sorted(light_sources)) + " came from a near-white canvas.")
        print("  Anything in that artwork which was also near-white is gone — that cannot be")
        print("  recovered from a flattened file. Open the checkerboard preview: if a detail is")
        print("  missing, re-export the design on a mid-tone or dark backdrop and run it again.")
    if warnings_out:
        print("\n  Check these by eye (may need a different source file):")
        for name, w in warnings_out:
            print(f"   ! {name}: {w}")
    if failures:
        print("\n  Fix these before uploading:")
        for name, problems in failures:
            for problem in problems:
                print(f"   - {name}: {problem}")
        return 1
    print("  Every file is a real cut-out: transparent corners, clean edge, no white box.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
