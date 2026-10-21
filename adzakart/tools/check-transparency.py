#!/usr/bin/env python3
"""Quality gate: is this PNG really a cut-out, or does it still have a box?

    python3 tools/check-transparency.py --in clean/
    python3 tools/check-transparency.py --in clean/ --json report.json

Checks every file for:
  - a real alpha channel,
  - transparent corners and a clear border (no "white box"),
  - meaningful transparent area,
  - white fringing on the cut edge (the thing that makes buyers say
    "there's a white cast around the design").

Exit code 0 = every file is sell-ready, 1 = at least one is not.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image  # noqa: E402

from lib_bg import (  # noqa: E402
    human_bytes, list_images, summarise, verdict, white_halo_score, preview_on_checker,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Verify that PNGs are genuinely transparent.")
    p.add_argument("--in", dest="src", required=True, help="PNG file or folder to check")
    p.add_argument("--preview", dest="preview", default="", help="folder for checkerboard previews of failures")
    p.add_argument("--json", dest="json_out", default="", help="write a machine-readable report here")
    p.add_argument("--allow-fringe", type=float, default=0.55,
                   help="max share of edge pixels allowed to be near-white (default 0.55)")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    files = list_images(args.src)
    if not files:
        print(f"No images found in {args.src}")
        return 2

    report, rows, failed = [], [], 0
    for path in files:
        name = os.path.basename(path)
        entry = {"file": name}
        try:
            with Image.open(path) as im:
                im.load()
                entry["mode"] = im.mode
                entry["has_alpha"] = im.mode in ("RGBA", "LA") or "transparency" in im.info
                if not entry["has_alpha"]:
                    entry.update(passed=False, problems=["no alpha channel — it is a flat image"])
                else:
                    rgba = im.convert("RGBA")
                    stats = summarise(rgba)
                    halo = white_halo_score(rgba)
                    ok, problems = verdict(stats)
                    if halo > args.allow_fringe:
                        ok = False
                        problems.append(
                            f"white fringe on {halo*100:.0f}% of the cut edge — run "
                            "clean-background.py with --choke 1"
                        )
                    entry.update(
                        passed=ok, problems=problems, width=stats["size"][0], height=stats["size"][1],
                        transparent=round(stats["transparent"], 4),
                        opaque=round(stats["opaque"], 4),
                        edge_clear=round(stats["edge_clear"], 4),
                        white_fringe=round(halo, 4),
                        bytes=os.path.getsize(path),
                    )
                    if not ok and args.preview:
                        os.makedirs(args.preview, exist_ok=True)
                        preview_on_checker(rgba).save(
                            os.path.join(args.preview, os.path.splitext(name)[0] + ".jpg"), quality=82
                        )
        except Exception as exc:  # noqa: BLE001
            entry.update(passed=False, problems=[str(exc)])

        if not entry.get("passed"):
            failed += 1
        report.append(entry)
        tag = "PASS" if entry.get("passed") else "FAIL"
        size = f"{entry.get('width', '-')}x{entry.get('height', '-')}"
        clear = f"{entry.get('transparent', 0)*100:.0f}%"
        fringe = f"{entry.get('white_fringe', 0)*100:.0f}%"
        rows.append((name[:36], size, clear, fringe, tag, entry.get("problems", [])))

    width = max(len(r[0]) for r in rows) + 2
    print(f"\n  {'file'.ljust(width)}{'size'.rjust(12)}{'clear'.rjust(8)}{'fringe'.rjust(9)}  result")
    print("  " + "-" * (width + 42))
    for name, size, clear, fringe, tag, _ in rows:
        print(f"  {name.ljust(width)}{size.rjust(12)}{clear.rjust(8)}{fringe.rjust(9)}  {tag}")

    total = sum(e.get("bytes", 0) for e in report)
    print(f"\n  {len(report) - failed}/{len(report)} sell-ready  ·  {human_bytes(total)}  ·  {args.src}")
    if failed:
        print("\n  Not sell-ready:")
        for name, _, _, _, tag, problems in rows:
            if tag == "FAIL":
                for problem in problems:
                    print(f"   - {name}: {problem}")
        if args.preview:
            print(f"\n  Previews of the failures: {args.preview}")
        print()
    else:
        print("  Transparent corners, clean edges, no white box. Safe to upload.\n")

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump({"source": args.src, "total": len(report), "failed": failed, "files": report},
                      fh, indent=2)
        print(f"  report: {args.json_out}\n")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
