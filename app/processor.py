"""
Neurio Processor — background removal + quality enhancement
Works offline with fallback when rembg model not available.
"""

import io
import os
from pathlib import Path
from typing import Optional

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

# rembg availability
try:
    from rembg import remove, new_session
    HAS_REMBG = True
except ImportError:
    HAS_REMBG = False
    remove = None
    new_session = None

# Cache session to avoid reloading model
_REMBG_SESSION = None

def get_rembg_session(model: str = "u2net"):
    global _REMBG_SESSION
    if not HAS_REMBG:
        return None
    if _REMBG_SESSION is None:
        try:
            # Try to create session; if no internet and model missing, will fallback
            _REMBG_SESSION = new_session(model)
        except Exception as e:
            print(f"[rembg] session init failed: {e}")
            _REMBG_SESSION = None
    return _REMBG_SESSION

def remove_background_pil(
    image: Image.Image,
    model: str = "u2net",
    alpha_matting: bool = False,
    alpha_matting_foreground_threshold: int = 240,
    alpha_matting_background_threshold: int = 10,
) -> Image.Image:
    """
    Remove background from PIL Image.
    Returns RGBA image with transparent background.
    Falls back to simple method if rembg unavailable.
    """
    if HAS_REMBG:
        try:
            session = get_rembg_session(model)
            # Convert to bytes
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            buf.seek(0)
            input_bytes = buf.read()

            if session is not None:
                output_bytes = remove(
                    input_bytes,
                    session=session,
                    alpha_matting=alpha_matting,
                    alpha_matting_foreground_threshold=alpha_matting_foreground_threshold,
                    alpha_matting_background_threshold=alpha_matting_background_threshold,
                )
            else:
                output_bytes = remove(input_bytes)

            result = Image.open(io.BytesIO(output_bytes)).convert("RGBA")
            return result
        except Exception as e:
            print(f"[rembg] remove failed, fallback: {e}")
            # fall through to fallback

    # Fallback: use OpenCV GrabCut-like simple or just return original with alpha
    # Simple fallback: if image has clear background via color threshold, attempt to key white
    # We'll just convert to RGBA and try to make near-white transparent if requested
    # For now, return image as RGBA (no removal) but apply edge-aware feathering
    print("[processor] Using fallback background removal (no rembg)")
    # Try simple luminance-based: detect mostly uniform background at corners
    # Heuristic: sample corners, if similar, flood fill transparency (very naive)
    try:
        return _fallback_remove_background(image)
    except Exception as e:
        print(f"Fallback also failed: {e}")
        return image.convert("RGBA")

def _fallback_remove_background(image: Image.Image) -> Image.Image:
    """
    Very naive fallback: if background is light, use color distance.
    Not as good as rembg but ensures something happens offline.
    """
    img = image.convert("RGBA")
    # If image already has alpha, keep it
    # Try to detect background color from top-left 5x5 region
    small = img.resize((20, 20), Image.BILINEAR)
    # Estimate background as most common corner color
    # Use top-left pixel
    bg_color = small.getpixel((0, 0))[:3]

    # If background is very light (close to white), make similar colors transparent
    # Threshold distance
    if sum(bg_color) < 600:  # not light enough, skip
        return img

    # Create mask based on color distance to bg_color
    # Use numpy if available
    if HAS_CV2:
        arr = np.array(img)
        # arr shape HxWx4
        rgb = arr[:, :, :3].astype(float)
        bg = np.array(bg_color, dtype=float)
        dist = np.sqrt(np.sum((rgb - bg) ** 2, axis=2))
        # Pixels close to bg become transparent (dist < 60)
        # Feather between 30-60
        mask = np.clip((dist - 30) / 30, 0, 1)  # 0=bg, 1=fg
        mask = (mask * 255).astype(np.uint8)
        # Slight blur for feather
        mask = cv2.GaussianBlur(mask, (5, 5), 1.0)
        arr[:, :, 3] = mask
        return Image.fromarray(arr, "RGBA")
    else:
        # PIL-only fallback: per-pixel loop (slower but okay for small images)
        data = img.load()
        w, h = img.size
        for y in range(h):
            for x in range(w):
                r, g, b, a = data[x, y]
                dist = ((r - bg_color[0]) ** 2 + (g - bg_color[1]) ** 2 + (b - bg_color[2]) ** 2) ** 0.5
                if dist < 30:
                    data[x, y] = (r, g, b, 0)
                elif dist < 60:
                    alpha = int(255 * (dist - 30) / 30)
                    data[x, y] = (r, g, b, alpha)
        return img

def upscale_image(image: Image.Image, scale: int = 2, method=Image.LANCZOS) -> Image.Image:
    """Upscale PIL image by integer scale."""
    if scale <= 1:
        return image
    w, h = image.size
    new_size = (w * scale, h * scale)
    # Preserve transparency
    return image.resize(new_size, method)

def enhance_quality(
    image: Image.Image,
    scale: int = 1,
    sharpen_factor: float = 1.3,
    color_factor: float = 1.15,
    contrast_factor: float = 1.12,
    brightness_factor: float = 1.02,
    denoise: bool = True,
    denoise_strength: int = 7,
    auto_color: bool = True,
) -> Image.Image:
    """
    Enhance image quality:
    - upscale (1x,2x,4x) with LANCZOS
    - denoise with OpenCV fastNlMeans if available
    - sharpen via UnsharpMask + Enhance.Sharpness
    - color/contrast/brightness boost
    - auto contrast via ImageOps.autocontrast for dull images

    image: PIL Image (RGBA or RGB)
    Returns enhanced PIL Image
    """
    # Work in RGBA, but process RGB channels
    has_alpha = image.mode == "RGBA"
    alpha = None
    if has_alpha:
        # Separate alpha
        alpha = image.split()[-1]
        # Work on RGB
        img_rgb = Image.new("RGB", image.size, (255, 255, 255))
        # Paste original with alpha as mask to handle transparency for enhancement
        # For upscaling with transparency, we need to keep alpha separate
        # Convert to RGBA for processing but handle properly
        # Instead, keep original RGB from image (ignore transparency for color enhance)
        # Extract RGB
        r, g, b, a = image.split()
        img_rgb = Image.merge("RGB", (r, g, b))
        work_img = img_rgb
    else:
        work_img = image.convert("RGB")

    # 1. Upscale first (better sharpen after)
    if scale > 1:
        work_img = upscale_image(work_img, scale, Image.LANCZOS)
        if has_alpha:
            alpha = alpha.resize((work_img.size[0], work_img.size[1]), Image.LANCZOS)

    # 2. Denoise with OpenCV if available
    if denoise and HAS_CV2:
        try:
            arr = np.array(work_img)
            # cv2 expects BGR
            bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
            # fastNlMeansDenoisingColored params: h=10, hColor=10, templateWindowSize=7, searchWindowSize=21
            denoised = cv2.fastNlMeansDenoisingColored(bgr, None, denoise_strength, denoise_strength, 7, 21)
            rgb = cv2.cvtColor(denoised, cv2.COLOR_BGR2RGB)
            work_img = Image.fromarray(rgb)
        except Exception as e:
            print(f"[enhance] denoise failed: {e}")

    # 3. Auto levels / contrast for dull images (optional)
    if auto_color:
        try:
            # Only apply if image is low contrast
            # autocontrast with cutoff helps
            work_img = ImageOps.autocontrast(work_img, cutoff=1.5)
            work_img = ImageOps.equalize(work_img) if _is_low_contrast(work_img) else work_img
        except Exception:
            pass

    # 4. Color / Contrast / Brightness
    try:
        if color_factor != 1.0:
            work_img = ImageEnhance.Color(work_img).enhance(color_factor)
        if contrast_factor != 1.0:
            work_img = ImageEnhance.Contrast(work_img).enhance(contrast_factor)
        if brightness_factor != 1.0:
            work_img = ImageEnhance.Brightness(work_img).enhance(brightness_factor)
    except Exception as e:
        print(f"[enhance] color adjust failed: {e}")

    # 5. Sharpen – two-stage: UnsharpMask + Enhance.Sharpness
    try:
        # UnsharpMask for detail (radius, percent, threshold)
        # Radius 1.5, percent 150% ~ factor
        if sharpen_factor > 1.0:
            # Map sharpen_factor 1.0-2.5 to percent 80-220
            percent = int((sharpen_factor - 1.0) * 120 + 80)
            work_img = work_img.filter(ImageFilter.UnsharpMask(radius=1.4, percent=percent, threshold=2))
            work_img = ImageEnhance.Sharpness(work_img).enhance(sharpen_factor)
        elif sharpen_factor < 1.0:
            work_img = ImageEnhance.Sharpness(work_img).enhance(sharpen_factor)
    except Exception as e:
        print(f"[enhance] sharpen failed: {e}")

    # 6. Reattach alpha if needed
    if has_alpha and alpha is not None:
        # Ensure alpha size matches
        if alpha.size != work_img.size:
            alpha = alpha.resize(work_img.size, Image.LANCZOS)
        # Merge back
        r, g, b = work_img.split()
        work_img = Image.merge("RGBA", (r, g, b, alpha))

    return work_img

def _is_low_contrast(img: Image.Image, threshold: int = 45) -> bool:
    """Quick check if image is low contrast (heuristic)."""
    try:
        # Convert to grayscale histogram
        gray = img.convert("L").resize((64, 64))
        hist = gray.histogram()
        # Calculate std dev of histogram? simpler: range of occupied bins
        # Find min/max where count > threshold
        min_bin = next((i for i, c in enumerate(hist) if c > 4), 0)
        max_bin = next((i for i, c in enumerate(reversed(hist)) if c > 4), 0)
        max_bin = 255 - max_bin
        return (max_bin - min_bin) < 90
    except Exception:
        return False

def process_image(
    input_path: str,
    remove_bg: bool = True,
    enhance: bool = True,
    scale: int = 2,
    sharpen: float = 1.35,
    denoise: bool = True,
    color_boost: bool = True,
    model: str = "u2net",
) -> Image.Image:
    """
    High-level: load image -> remove bg -> enhance -> return PIL
    """
    img = Image.open(input_path)
    # Keep EXIF orientation
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    # Convert to appropriate mode
    if remove_bg:
        # rembg expects RGB/RGBA; will output RGBA
        img = remove_background_pil(img, model=model)
    else:
        # Ensure at least RGBA if user wants transparency handling later?
        if enhance and scale > 1:
            # keep RGBA for proper upscaling
            if img.mode in ("P", "L"):
                img = img.convert("RGBA") if img.mode == "P" else img.convert("RGB")
        else:
            img = img.convert("RGBA") if img.mode == "P" else img

    if enhance:
        # Translate boolean params to factors
        color_f = 1.15 if color_boost else 1.0
        contrast_f = 1.12 if color_boost else 1.0
        brightness_f = 1.02 if color_boost else 1.0
        img = enhance_quality(
            img,
            scale=scale,
            sharpen_factor=sharpen,
            color_factor=color_f,
            contrast_factor=contrast_f,
            brightness_factor=brightness_f,
            denoise=denoise,
            auto_color=color_boost,
        )

    return img

def save_image_pil(image: Image.Image, output_path: str, quality: int = 95, optimize: bool = True):
    """Save PIL image smartly based on extension."""
    p = Path(output_path)
    ext = p.suffix.lower()
    p.parent.mkdir(parents=True, exist_ok=True)

    if ext in (".jpg", ".jpeg"):
        # JPG doesn't support alpha -> composite on white
        if image.mode == "RGBA":
            bg = Image.new("RGB", image.size, (255, 255, 255))
            bg.paste(image, mask=image.split()[-1])
            image = bg
        elif image.mode != "RGB":
            image = image.convert("RGB")
        image.save(output_path, "JPEG", quality=quality, optimize=optimize, progressive=True)
    elif ext == ".webp":
        # WebP supports alpha
        image.save(output_path, "WEBP", quality=quality, lossless=False, method=4)
    else:  # png default
        # PNG
        image.save(output_path, "PNG", optimize=optimize)

# --- CLI test helper ---
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Neurio processor CLI")
    parser.add_argument("input", help="input image path")
    parser.add_argument("-o", "--output", help="output path", default="output.png")
    parser.add_argument("--no-bg", action="store_true", help="skip background removal")
    parser.add_argument("--no-enhance", action="store_true", help="skip enhancement")
    parser.add_argument("--scale", type=int, choices=[1,2,4], default=2, help="upscale factor")
    parser.add_argument("--sharpen", type=float, default=1.35)
    args = parser.parse_args()

    out = process_image(
        args.input,
        remove_bg=not args.no_bg,
        enhance=not args.no_enhance,
        scale=args.scale,
        sharpen=args.sharpen,
    )
    save_image_pil(out, args.output)
    print(f"Saved to {args.output} size={out.size} mode={out.mode}")
