"""External AI provider clients.

Only the user's own credentials are used; there are no hardcoded keys and no
"demo" mode that pretends to call a service.  Clients use urllib (no extra
dependencies) and speak the OpenAI-compatible HTTP API, which works with
OpenAI, OpenRouter, LM Studio, Ollama (``/v1``), text-generation-webui etc.

Every method either returns parsed data or raises :class:`ProviderError` with
a human-readable reason — the UI surfaces those messages directly.
"""

from __future__ import annotations

import base64
import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass

from .keystorage import KeyStore


class ProviderError(RuntimeError):
    pass


@dataclass
class ProviderConfig:
    provider: str = "openai"
    base_url: str = "https://api.openai.com/v1"
    chat_model: str = "gpt-4o-mini"
    image_model: str = ""


def _request(url: str, payload: dict | None, headers: dict,
             timeout: float = 120.0) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json", **headers},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="ignore")[:400]
        except Exception:
            body = ""
        raise ProviderError(
            f"{e.code} {e.reason} from provider. {body}".strip()) from e
    except (urllib.error.URLError, socket.timeout, ConnectionError) as e:
        raise ProviderError(f"Network error contacting provider: {e}") from e


class ChatProvider:
    """OpenAI-compatible /chat/completions client."""

    def __init__(self, config: ProviderConfig, key_store: KeyStore | None = None):
        self.config = config
        self.keys = key_store or KeyStore()

    def available(self) -> tuple[bool, str]:
        key = self.keys.get_key(self.config.provider)
        if not key:
            return False, (f"No API key stored for '{self.config.provider}'. "
                           "Add one in Settings → AI Providers.")
        if not self.config.base_url:
            return False, "Base URL is empty in provider settings."
        return True, ""

    def complete(self, system: str, user: str, max_tokens: int = 700,
                 temperature: float = 0.7) -> str:
        ok, why = self.available()
        if not ok:
            raise ProviderError(why)
        key = self.keys.get_key(self.config.provider) or ""
        data = _request(
            self.config.base_url.rstrip("/") + "/chat/completions",
            {
                "model": self.config.chat_model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
            {"Authorization": f"Bearer {key}"},
            timeout=120,
        )
        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError) as e:
            raise ProviderError(f"Unexpected provider response: {str(data)[:200]}") from e


class ImageProvider:
    """OpenAI-compatible /images/generations client."""

    def __init__(self, config: ProviderConfig, key_store: KeyStore | None = None):
        self.config = config
        self.keys = key_store or KeyStore()

    def available(self) -> tuple[bool, str]:
        key = self.keys.get_key(self.config.provider)
        if not key:
            return False, (f"No API key stored for '{self.config.provider}'. "
                           "Image generation needs a provider and key in Settings.")
        if not self.config.image_model:
            return False, "No image model configured for this provider."
        return True, ""

    def generate(self, prompt: str, negative: str = "", size: str = "1024x1024",
                 n: int = 1, out_paths: list[str] | None = None) -> list[bytes]:
        """Generate images; returns raw PNG/JPEG bytes for each result.

        Raises ProviderError with an honest message on any failure — callers
        must not write anything to disk unless this succeeds.
        """
        ok, why = self.available()
        if not ok:
            raise ProviderError(why)
        key = self.keys.get_key(self.config.provider) or ""
        payload: dict = {
            "model": self.config.image_model,
            "prompt": prompt + (f" --no {negative}" if negative else ""),
            "n": n,
            "size": size,
        }
        data = _request(
            self.config.base_url.rstrip("/") + "/images/generations",
            payload, {"Authorization": f"Bearer {key}"}, timeout=300)
        images: list[bytes] = []
        for item in data.get("data", []):
            if item.get("b64_json"):
                images.append(base64.b64decode(item["b64_json"]))
            elif item.get("url"):
                with urllib.request.urlopen(item["url"], timeout=120) as r:
                    images.append(r.read())
        if not images:
            raise ProviderError("Provider returned no image data.")
        return images


PRESET_PROVIDERS: dict[str, ProviderConfig] = {
    "openai": ProviderConfig("openai", "https://api.openai.com/v1",
                             "gpt-4o-mini", "gpt-image-1"),
    "openrouter": ProviderConfig("openrouter", "https://openrouter.ai/api/v1",
                                 "openai/gpt-4o-mini", ""),
    "ollama": ProviderConfig("ollama", "http://localhost:11434/v1",
                             "llama3.2", ""),
    "lmstudio": ProviderConfig("lmstudio", "http://localhost:1234/v1",
                               "local-model", ""),
    "custom": ProviderConfig("custom", "", "", ""),
}
