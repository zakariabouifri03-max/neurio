"""Pluggable AI provider layer.

The whole assistant talks to providers through :class:`AIProvider`.  Three
implementations ship with the app:

* ``OpenAICompatibleProvider`` - any OpenAI style ``/chat/completions`` endpoint
  (OpenAI, OpenRouter, Groq, Azure-style gateways, LM Studio, Ollama, ...).
* ``LocalProvider`` - a preset pointed at localhost (Ollama / LM Studio /
  llama.cpp / text-generation-webui).
* ``OfflineProvider`` - no network at all: the built-in motion director, which
  is *always* available.  The AI features therefore work out of the box and get
  smarter as soon as the user adds a key.

API keys are never shipped with the application: they are entered by the user
and stored in the per-user settings folder (or read from environment
variables), never in the repository.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field


class AIError(Exception):
    pass


class AINotConfigured(AIError):
    pass


@dataclass
class AIMessage:
    role: str
    content: str


@dataclass
class AIProviderInfo:
    id: str
    name: str
    kind: str = "openai"          # openai | local | offline | custom
    base_url: str = ""
    models: list[str] = field(default_factory=list)
    needs_key: bool = True
    docs: str = ""
    description: str = ""


class AIProvider:
    info = AIProviderInfo("base", "Provider")

    def __init__(self, api_key: str = "", base_url: str = "", model: str = "",
                 timeout: float = 60.0, options: dict | None = None):
        self.api_key = api_key or ""
        self.base_url = (base_url or self.info.base_url).rstrip("/")
        self.model = model or (self.info.models[0] if self.info.models else "")
        self.timeout = timeout
        self.options = options or {}

    # ------------------------------------------------------------------ api
    @property
    def id(self) -> str:
        return self.info.id

    @property
    def name(self) -> str:
        return self.info.name

    @property
    def configured(self) -> bool:
        return True

    def status(self) -> str:
        return "Ready" if self.configured else "Not configured"

    def list_models(self) -> list[str]:
        return list(self.info.models)

    def complete(self, system: str, user: str, json_mode: bool = False,
                 temperature: float = 0.4, max_tokens: int = 2048) -> str:
        raise NotImplementedError

    # -------------------------------------------------------------- helpers
    def _post_json(self, url: str, payload: dict, headers: dict) -> dict:
        data = json.dumps(payload).encode("utf8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode("utf8", "ignore")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf8", "ignore")[:600]
            raise AIError(f"{exc.code} {exc.reason}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise AIError(f"Cannot reach {url}: {exc.reason}") from exc
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise AIError(f"Invalid JSON from provider: {body[:300]}") from exc


# --------------------------------------------------------------------------
class OfflineProvider(AIProvider):
    """The built-in director: no key, no network, always available."""

    info = AIProviderInfo(
        id="offline", name="Built-in Motion Director (offline)",
        kind="offline", base_url="", models=["motion-director-v1"], needs_key=False,
        description="Rule based animation planner. Works without internet and "
                    "generates fully editable keyframes.")

    @property
    def configured(self) -> bool:
        return True

    def complete(self, system: str, user: str, json_mode: bool = False,
                 temperature: float = 0.4, max_tokens: int = 2048) -> str:
        raise AINotConfigured("The built-in director is applied directly by the app.")


class OpenAICompatibleProvider(AIProvider):
    """Works with OpenAI, OpenRouter, Groq, Together, DeepSeek, vLLM..."""

    info = AIProviderInfo(
        id="openai", name="OpenAI compatible API",
        kind="openai", base_url="https://api.openai.com/v1",
        models=["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o4-mini"],
        needs_key=True, docs="https://platform.openai.com/api-keys",
        description="Any endpoint implementing POST /chat/completions.")

    def __init__(self, api_key: str = "", base_url: str = "", model: str = "",
                 timeout: float = 90.0, options: dict | None = None):
        super().__init__(api_key, base_url, model, timeout, options)

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)

    def status(self) -> str:
        if not self.api_key:
            return "Add an API key in AI ▸ Settings"
        if not self.model:
            return "Choose a model"
        return f"Ready · {self.model}"

    def list_models(self) -> list[str]:
        if not self.api_key:
            return list(self.info.models)
        try:
            req = urllib.request.Request(f"{self.base_url}/models")
            req.add_header("Authorization", f"Bearer {self.api_key}")
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf8", "ignore"))
            models = [m.get("id", "") for m in data.get("data", []) if m.get("id")]
            return sorted(models) or list(self.info.models)
        except Exception:
            return list(self.info.models)

    def complete(self, system: str, user: str, json_mode: bool = False,
                 temperature: float = 0.4, max_tokens: int = 2048) -> str:
        if not self.configured:
            raise AINotConfigured(f"{self.name} is not configured yet.")
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {self.api_key}"}
        data = self._post_json(f"{self.base_url}/chat/completions", payload, headers)
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as exc:
            raise AIError(f"Unexpected response shape: {str(data)[:300]}") from exc


class LocalProvider(OpenAICompatibleProvider):
    """Ollama / LM Studio / llama.cpp server running on this machine."""

    info = AIProviderInfo(
        id="local", name="Local AI (Ollama / LM Studio)",
        kind="local", base_url="http://127.0.0.1:11434/v1",
        models=["llama3.1", "qwen2.5", "mistral", "phi3", "gemma2"],
        needs_key=False, docs="https://ollama.com",
        description="Runs offline on your own machine. No API key needed.")

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.model)

    def status(self) -> str:
        return f"{self.base_url} · {self.model}"


class CustomProvider(OpenAICompatibleProvider):
    info = AIProviderInfo(
        id="custom", name="Custom endpoint", kind="custom", base_url="",
        models=[], needs_key=False,
        description="Point MotionForge at any OpenAI compatible server.")


# --------------------------------------------------------------------------
class ProviderRegistry:
    """Holds the provider classes and instantiates them from saved settings."""

    def __init__(self):
        self._classes: dict[str, type[AIProvider]] = {}

    def register(self, cls: type[AIProvider]) -> None:
        self._classes[cls.info.id] = cls

    def ids(self) -> list[str]:
        return list(self._classes.keys())

    def infos(self) -> list[AIProviderInfo]:
        return [c.info for c in self._classes.values()]

    def info(self, provider_id: str) -> AIProviderInfo | None:
        cls = self._classes.get(provider_id)
        return cls.info if cls else None

    def create(self, provider_id: str, api_key: str = "", base_url: str = "",
               model: str = "", timeout: float = 90.0) -> AIProvider:
        cls = self._classes.get(provider_id) or OfflineProvider
        return cls(api_key=api_key, base_url=base_url, model=model, timeout=timeout)


def default_registry() -> ProviderRegistry:
    reg = ProviderRegistry()
    reg.register(OfflineProvider)
    reg.register(OpenAICompatibleProvider)
    reg.register(LocalProvider)
    reg.register(CustomProvider)
    return reg


# --------------------------------------------------------------------------
# settings persistence (never inside the project file)
# --------------------------------------------------------------------------
DEFAULT_AI_SETTINGS = {
    "provider": "offline",
    "model": "",
    "base_url": "",
    "temperature": 0.4,
    "enabled": True,
    "auto_apply": False,
    "creativity": 0.5,
    "providers": {},
    "history": [],
}


def ai_settings_path(config_dir: str | None = None) -> str:
    from ..io.project_file import default_app_dir
    folder = config_dir or default_app_dir()
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, "ai_settings.json")


def load_ai_settings(config_dir: str | None = None) -> dict:
    path = ai_settings_path(config_dir)
    data = dict(DEFAULT_AI_SETTINGS)
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf8") as fh:
                saved = json.load(fh)
            if isinstance(saved, dict):
                data.update(saved)
        except Exception:
            pass
    # environment overrides (handy for studios / CI)
    env_key = os.environ.get("MFS_AI_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    env_url = os.environ.get("MFS_AI_BASE_URL", "")
    env_model = os.environ.get("MFS_AI_MODEL", "")
    if env_key:
        providers = data.setdefault("providers", {})
        entry = providers.setdefault("openai", {})
        entry["api_key"] = env_key
        if env_url:
            entry["base_url"] = env_url
        if env_model:
            entry["model"] = env_model
        if data.get("provider") == "offline":
            data["provider"] = "openai"
    return data


def save_ai_settings(settings: dict, config_dir: str | None = None) -> str:
    path = ai_settings_path(config_dir)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf8") as fh:
        json.dump(settings, fh, indent=2)
    os.replace(tmp, path)
    return path


def provider_settings(settings: dict, provider_id: str) -> dict:
    return dict((settings.get("providers") or {}).get(provider_id, {}))


def build_provider(settings: dict, registry: ProviderRegistry | None = None) -> AIProvider:
    reg = registry or default_registry()
    pid = settings.get("provider", "offline")
    entry = provider_settings(settings, pid)
    info = reg.info(pid)
    return reg.create(
        pid,
        api_key=entry.get("api_key", ""),
        base_url=entry.get("base_url") or settings.get("base_url") or (info.base_url if info else ""),
        model=entry.get("model") or settings.get("model") or (info.models[0] if info and info.models else ""),
    )


def mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "•" * len(key)
    return f"{key[:4]}{'•' * 8}{key[-4:]}"
