#!/usr/bin/env python3
"""
Batch processing — hayed background + zid quality for folder
Usage:
  python app/batch.py input_folder -o output_folder --scale 2
  python app/batch.py photo.jpg -o out.png --no-bg --scale 4
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from processor import process_image, save_image_pil
import argparse

parser = argparse.ArgumentParser(description="Neurio Batch — folder processing")
parser.add_argument("input", help="input file or folder")
parser.add_argument("-o", "--output", help="output file or folder", default=None)
parser.add_argument("--scale", type=int, choices=[1,2,4], default=2)
parser.add_argument("--sharpen", type=float, default=1.35)
parser.add_argument("--no-bg", action="store_true", help="skip bg removal")
parser.add_argument("--no-enhance", action="store_true")
parser.add_argument("--no-denoise", action="store_true")
parser.add_argument("--model", default="u2net")
args = parser.parse_args()

inp = Path(args.input)
if not inp.exists():
    print(f"❌ Not found: {inp}")
    sys.exit(1)

# Collect inputs
if inp.is_dir():
    files = [p for p in inp.iterdir() if p.suffix.lower() in (".png",".jpg",".jpeg",".webp",".bmp",".tiff")]
    if not files:
        print(f"❌ No images in {inp}")
        sys.exit(1)
    out_dir = Path(args.output) if args.output else inp / "neurio_output"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"▶ Found {len(files)} images → {out_dir}")
else:
    files = [inp]
    out_dir = None
    if args.output:
        out_path_global = Path(args.output)
    else:
        out_path_global = inp.with_name(f"{inp.stem}_neurio_{args.scale}x.png")

for f in files:
    print(f"\n▶ {f.name} ...", end=" ", flush=True)
    try:
        img = process_image(
            str(f),
            remove_bg=not args.no_bg,
            enhance=not args.no_enhance,
            scale=args.scale,
            sharpen=args.sharpen,
            denoise=not args.no_denoise,
            color_boost=True,
            model=args.model,
        )
        if inp.is_dir():
            out_path = out_dir / f"{f.stem}_neurio_{args.scale}x.png"
        else:
            out_path = out_path_global
        save_image_pil(img, str(out_path))
        print(f"✅ {out_path.name} {img.width}×{img.height}")
    except Exception as e:
        print(f"❌ {e}")
        import traceback; traceback.print_exc()

print(f"\n✅ Done! — Check output.")
