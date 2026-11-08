"""Local, CPU-only composite try-on provider (development mode).

This is NOT a neural network. It performs real image processing with Pillow:
garment cutout (background removal), feathering, scaled alpha-compositing at
category-aware torso placement, plus a dev-mode label. It exists so the full
product can be developed, tested and demoed without GPU infrastructure, and it
is always labeled as ``dev-composite`` in the result metadata and on the image.
"""

from __future__ import annotations

from ..base import ProviderError, TryOnOptions, TryOnProvider, TryOnResult, now_ms
from ..categories import placement_for
from ..image_utils import (
    autocrop_opaque,
    constrain,
    encode,
    feather_alpha,
    load_image,
    remove_uniform_background,
)
from PIL import Image

DEV_LABEL = "DEV MODE · composite"


class DevCompositeProvider(TryOnProvider):
    name = "dev-composite"
    mode = "dev-composite"

    def generate(self, person_image: bytes, garment_image: bytes, options: TryOnOptions) -> TryOnResult:
        start = now_ms()
        try:
            person = constrain(load_image(person_image))
            garment = load_image(garment_image)
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"invalid input image: {exc}") from exc

        person_rgba = person.convert("RGBA")
        pw, ph = person_rgba.size

        # 1. Cut out the garment (remove solid studio backdrop if present).
        cut = remove_uniform_background(garment)
        cut = feather_alpha(autocrop_opaque(cut), radius=4)

        # 2. Category-aware placement.
        pl = placement_for(options.category)
        gw = int(pw * pl.width_ratio * max(0.8, options.strength))
        scale = gw / cut.width
        gh = max(1, int(cut.height * scale))
        garment_rs = cut.resize((gw, gh), Image.LANCZOS)

        cx = int(pw * pl.cx)
        top = int(ph * pl.top)
        x = cx - gw // 2
        y = top

        # 3. Alpha composite (downward blend to avoid double-exposure look).
        base = person_rgba
        overlay = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        overlay.paste(garment_rs, (x, y))
        base = Image.alpha_composite(base, overlay)

        strength = max(0.2, min(1.0, options.strength))
        if strength < 1.0:
            blend = Image.blend(person_rgba, base, strength)
            base = blend.convert("RGBA")

        # 4. Dev-mode label + final constraints.
        base = constrain(base, max_edge=options.max_size)
        from ..image_utils import draw_label

        base = draw_label(base, DEV_LABEL)

        mimetype = "image/jpeg"
        out = encode(base, mimetype)
        return TryOnResult(
            output_bytes=out,
            mimetype=mimetype,
            provider=self.name,
            mode=self.mode,
            elapsed_ms=now_ms() - start,
            meta={"category": options.category, "dev_mode": True, "note": "CPU composite, not neural"},
        )

    def health(self) -> dict:
        return {"provider": self.name, "mode": self.mode, "available": True, "gpu": False}
