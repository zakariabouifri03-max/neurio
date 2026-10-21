#!/usr/bin/env python3
"""One command: your artwork in, a working store out.

    python3 tools/prepare-store.py                 # reads raw/, writes the store
    python3 tools/prepare-store.py --in my-designs
    python3 tools/prepare-store.py --in raw --target 4000 --dpi 300

For every file in the input folder (named after the design id, e.g.
`4523481819-funny-whiskey.jpg`) it:

  1. removes the backdrop  -> a real transparent PNG
  2. trims and upscales    -> print resolution (3000 px long edge, 300 DPI)
  3. verifies the result   -> refuses to ship a file with a background left in
  4. writes the deliverable to assets/designs/clean/<id>.png
  5. writes a web preview   to assets/designs/<id>.jpg (so the store no longer
                            depends on any outside image host)
  6. rebuilds the catalog   -> the "Get this design" button is live for that id

Run it again whenever you add designs. Files that fail verification are left
out of the store instead of being handed to a customer.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from PIL import Image  # noqa: E402

from lib_bg import (  # noqa: E402
    human_bytes, list_images, cut_backdrop, trim, summarise, verdict,
    white_halo_score, upscale, save_png, preview_on_checker,
)

CLEAN_DIR = os.path.join(ROOT, "assets", "designs", "clean")
PREVIEW_DIR = os.path.join(ROOT, "assets", "designs")
LOCAL_MAP = os.path.join(ROOT, "data", "local-images.json")
CATALOG = os.path.join(ROOT, "data", "catalog.json")


def design_id(name: str) -> str:
    """4523481819-funny-whiskey.jpg -> 4523481819"""
    match = re.match(r"^\s*(\d{8,12})", name)
    return match.group(1) if match else ""


def web_preview(img: Image.Image, path: str, max_side: int = 1100) -> None:
    """A sane JPG for the cards and product page.

    Transparent pixels are composited onto the store's paper tone, so a
    preview never comes out with a black background.
    """
    paper = Image.new("RGBA", img.size, (239, 232, 220, 255))
    paper.alpha_composite(img.convert("RGBA"))
    flat = paper.convert("RGB")
    scale = min(1.0, max_side / max(flat.size))
    if scale < 1.0:
        flat = flat.resize((max(1, int(flat.width * scale)), max(1, int(flat.height * scale))), Image.LANCZOS)
    flat.save(path, "JPEG", quality=84, optimize=True, progressive=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Turn a folder of artwork into a working store.")
    p.add_argument("--in", dest="src", default=os.path.join(ROOT, "raw"),
                   help="folder of source images named <design-id>-something.jpg (default: raw/)")
    p.add_argument("--target", type=int, default=3000,
                   help="upscale so the long edge is at least this many px (default 3000)")
    p.add_argument("--dpi", type=int, default=300, help="DPI recorded in the PNG (default 300)")
    p.add_argument("--tolerance", type=int, default=14, help="backdrop colour tolerance (default 14)")
    p.add_argument("--choke", type=int, default=0, help="shrink the cut edge by N px if a halo survives")
    p.add_argument("--feather", type=float, default=0.8, help="edge softness in px (default 0.8)")
    p.add_argument("--force", action="store_true", help="re-clean files that already have alpha")
    p.add_argument("--no-verify", action="store_true", help="skip the quality gate (not recommended)")
    p.add_argument("--no-build", action="store_true", help="write files but do not rebuild the catalog")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not os.path.isdir(args.src):
        print(f"\n  No folder at {args.src}")
        print("  Create it and drop your design files in, named after the design id:")
        print("     raw/4523481819-funny-whiskey.jpg")
        print("  Then run this command again.\n")
        return 2

    files = list_images(args.src)
    if not files:
        print(f"\n  {args.src} has no images yet.")
        print("  Add files named  <design-id>-anything.jpg  and run this again.\n")
        return 2

    os.makedirs(CLEAN_DIR, exist_ok=True)
    local_map = {}
    if os.path.exists(LOCAL_MAP):
        try:
            with open(LOCAL_MAP, encoding="utf-8") as fh:
                local_map = json.load(fh)
        except Exception:
            local_map = {}

    known = set()
    if os.path.exists(CATALOG):
        try:
            with open(CATALOG, encoding="utf-8") as fh:
                known = {d["id"] for d in json.load(fh)["designs"]}
        except Exception:
            known = set()

    rows, skipped, shipped = [], [], 0
    for path in files:
        base = os.path.splitext(os.path.basename(path))[0]
        did = design_id(base)
        if not did:
            skipped.append((base, "no design id in the filename"))
            continue
        if did not in known:
            skipped.append((base, f"design {did} is not in the catalog"))
            continue

        try:
            with Image.open(path) as im:
                im.load()
                already = im.mode in ("RGBA", "LA") and summarise(im.convert("RGBA"))["transparent"] > 0.02
                if already and not args.force:
                    art = trim(im.convert("RGBA"), pad=6)
                else:
                    art, bg, _ = cut_backdrop(
                        im, tolerance=args.tolerance, feather=args.feather, choke=args.choke
                    )
                    art = trim(art, pad=6)

            if args.target:
                art = upscale(art, min_long_edge=args.target)
            art = art.convert("RGBA")

            stats = summarise(art)
            ok, problems = verdict(stats)
            halo = white_halo_score(art)
            if halo > 0.55:
                problems.append(f"white fringe on {halo*100:.0f}% of the cut edge (try --choke 1)")
                ok = False
            if not ok and not args.no_verify:
                skipped.append((base, "; ".join(problems)))
                continue

            out_png = os.path.join(CLEAN_DIR, did + ".png")
            save_png(art, out_png, dpi=args.dpi)

            preview_path = os.path.join(PREVIEW_DIR, did + ".jpg")
            web_preview(art, preview_path)
            local_map[did] = "assets/designs/" + did + ".jpg"

            preview_on_checker(art, max_side=520).save(
                os.path.join(CLEAN_DIR, did + "-check.jpg"), quality=80
            )

            shipped += 1
            rows.append((did, f"{art.size[0]}x{art.size[1]}",
                         f"{stats['transparent']*100:.0f}%", f"{halo*100:.0f}%",
                         human_bytes(os.path.getsize(out_png))))
        except Exception as exc:  # noqa: BLE001
            skipped.append((base, str(exc)))

    with open(LOCAL_MAP, "w", encoding="utf-8") as fh:
        json.dump(local_map, fh, indent=1, sort_keys=True)

    if rows:
        print(f"\n  {'design'.ljust(14)}{'px'.rjust(12)}{'clear'.rjust(8)}{'fringe'.rjust(9)}{'file'.rjust(11)}")
        print("  " + "-" * 54)
        for r in rows:
            print(f"  {r[0].ljust(14)}{r[1].rjust(12)}{r[2].rjust(8)}{r[3].rjust(9)}{r[4].rjust(11)}")

    print(f"\n  {shipped} design(s) ready to download  ·  {len(skipped)} skipped")
    if skipped:
        print("\n  Skipped:")
        for name, why in skipped:
            print(f"   - {name}: {why}")

    if shipped and not args.no_build:
        print("\n  Rebuilding the catalog …")
        result = subprocess.run(
            [sys.executable, os.path.join(HERE, "build_catalog.py"), "--local"],
            cwd=ROOT, capture_output=True, text=True,
        )
        print("  " + (result.stdout.strip().splitlines() or ["(no output)"])[0])
        if result.returncode != 0:
            print(result.stderr[-500:])
            return result.returncode

        with open(CATALOG, encoding="utf-8") as fh:
            data = json.load(fh)
        total = data["shop"]["totalDesigns"]
        ready = data["shop"]["cleanDesigns"]
        print(f"\n  Store status: {ready}/{total} designs can be downloaded right now.")
        if ready < total:
            print(f"  The other {total - ready} show “print file being prepared” until you add them.")
        print("  Reload the storefront — “Get this design” now hands over the file directly.\n")
    elif shipped:
        print("\n  Files written. Run: python3 tools/build_catalog.py --local\n")

    return 0 if shipped or not skipped else 1


if __name__ == "__main__":
    raise SystemExit(main())
