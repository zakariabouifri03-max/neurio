"""Server-side image validation helpers (Pillow-based)."""

from __future__ import annotations

from io import BytesIO

from PIL import Image

from .config import settings


class ImageValidationError(Exception):
    pass


def validate_image_bytes(data: bytes, max_bytes: int | None = None) -> Image.Image:
    """Validate magic bytes + Pillow parse + size limits. Returns PIL image."""
    limit = max_bytes or settings.max_upload_bytes
    if len(data) > limit:
        raise ImageValidationError(f"image exceeds size limit ({limit} bytes)")
    if not data:
        raise ImageValidationError("empty file")

    try:
        img = Image.open(BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise ImageValidationError("unsupported or corrupted image") from exc

    fmt = (img.format or "").lower()
    if fmt not in ("jpeg", "png", "webp"):
        raise ImageValidationError(f"unsupported format: {fmt or 'unknown'}")

    if img.width < 64 or img.height < 64:
        raise ImageValidationError("image too small (min 64px)")
    if img.width > 8000 or img.height > 8000:
        raise ImageValidationError("image too large (max 8000px)")
    return img
