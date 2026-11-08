"""IDM-VTON (Integrated Denoising Diffusion Model for Virtual Try-On) HTTP provider.

Production-grade provider for a self-hosted GPU inference server. It expects a
server exposing:

    POST /tryon
        multipart: person=<file>, garment=<file>, category=<str>, options=<json>
        -> { "image": "<base64 PNG/JPEG>", "provider": "idmvton", ... }

    GET /health -> { "status": "ok", "gpu": true, ... }

Deployment (Docker, needs >=16GB VRAM for fp16, less with quantization):

    # inference server (example)
    docker run --gpus all -p 8001:8001 \\
      -v $PWD/models:/models idmvton-server:latest

Then set AI_PROVIDER=idmvton and AI_ENGINE_URL=http://localhost:8001.
See docs/AI_ENGINE.md for model evaluation and license notes.
"""

from __future__ import annotations

import base64
import json
from typing import Optional

from ..base import ProviderError, ProviderNotAvailableError, TryOnOptions, TryOnProvider, TryOnResult, now_ms
from ..categories import normalize_category
from ..image_utils import constrain, encode, load_image


class IDMVTONHTTPProvider(TryOnProvider):
    name = "idmvton"
    mode = "idmvton"

    def __init__(self, base_url: str, api_key: Optional[str] = None, timeout: int = 120):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> dict:
        h = {"Accept": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def generate(self, person_image: bytes, garment_image: bytes, options: TryOnOptions) -> TryOnResult:
        import requests  # local import keeps the package light when unused

        start = now_ms()
        if not self.base_url:
            raise ProviderNotAvailableError("AI_ENGINE_URL is not configured for the idmvton provider")

        files = {
            "person": ("person.png", person_image, "image/png"),
            "garment": ("garment.png", garment_image, "image/png"),
        }
        data = {
            "category": normalize_category(options.category),
            "options": json.dumps(
                {
                    "strength": options.strength,
                    "preserve_identity": options.preserve_identity,
                    "max_size": options.max_size,
                    "seed": options.seed,
                }
            ),
        }
        try:
            resp = requests.post(
                f"{self.base_url}/tryon",
                files=files,
                data=data,
                headers=self._headers(),
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ProviderNotAvailableError(f"idmvton inference server unreachable: {exc}") from exc

        if resp.status_code != 200:
            raise ProviderError(f"idmvton server returned {resp.status_code}: {resp.text[:300]}")

        payload = resp.json()
        b64 = payload.get("image") or payload.get("output")
        if not b64:
            raise ProviderError("idmvton server response missing image field")
        raw = base64.b64decode(b64)

        # Re-encode/constrain so output size stays bounded.
        img = constrain(load_image(raw), max_edge=options.max_size)
        mimetype = "image/jpeg" if payload.get("format", "png").lower() in ("jpeg", "jpg") else "image/png"
        out = encode(img, mimetype)

        return TryOnResult(
            output_bytes=out,
            mimetype=mimetype,
            provider=self.name,
            mode=self.mode,
            elapsed_ms=now_ms() - start,
            meta={"gpu": True, "server": self.base_url, "seed": options.seed},
        )

    def health(self) -> dict:
        import requests

        if not self.base_url:
            return {"provider": self.name, "mode": self.mode, "available": False, "reason": "AI_ENGINE_URL not set"}
        try:
            r = requests.get(f"{self.base_url}/health", headers=self._headers(), timeout=5)
            ok = r.status_code == 200
            body = r.json() if ok else {}
            return {
                "provider": self.name,
                "mode": self.mode,
                "available": ok,
                "gpu": bool(body.get("gpu")),
            }
        except requests.RequestException:
            return {"provider": self.name, "mode": self.mode, "available": False, "reason": "unreachable"}
