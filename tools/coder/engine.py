"""Prompt -> complete single-file HTML game/app.

Order of work (backend="auto"):
  1. Offline templates (always available, no network, no model).
  2. Optional local model through Ollama on this PC (http://127.0.0.1:11434),
     used only when no template matches and Ollama is running.

Nothing here calls a cloud API.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import List, Optional

import templates as T

MAX_PROMPT_CHARS = 2000
DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b"

_DIACRITICS = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")


def normalize(text: str) -> str:
    """Lowercase, strip Arabic diacritics/tatweel and unify common letter forms."""
    t = text.lower()
    t = _DIACRITICS.sub("", t)
    t = re.sub("[إأآ]", "ا", t)
    t = t.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return re.sub(r"\s+", " ", t).strip()


def _has_keyword(text: str, keyword: str) -> bool:
    kw = normalize(keyword)
    if not kw:
        return False
    if kw.isascii():
        # whole-word match so "xo" does not fire inside other words
        return re.search(r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])", text) is not None
    return kw in text


def match_template(prompt: str) -> Optional[T.Template]:
    """Return the best template for a prompt, or None.

    Specific keywords win over generic ones. Among specific matches the one with
    the longest matching keyword wins (so "ping pong" beats a generic "pong"-less
    match and "mot de passe" beats a stray word).
    """
    text = normalize(prompt)
    best, best_score = None, 0
    for tpl in T.TEMPLATES.values():
        for kw in tpl.keywords:
            if _has_keyword(text, kw):
                score = len(normalize(kw))
                if score > best_score:
                    best, best_score = tpl, score
    if best:
        return best
    if any(_has_keyword(text, w) for w in T.GENERIC_GAME_WORDS):
        return T.TEMPLATES[T.DEFAULT_GAME]
    if any(_has_keyword(text, w) for w in T.GENERIC_APP_WORDS):
        return T.TEMPLATES[T.DEFAULT_APP]
    return None


def slugify(prompt: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", normalize(prompt)).strip("-")[:40].strip("-")
    return slug or "app"


# ----------------------------------------------------------- optional Ollama

class OllamaError(RuntimeError):
    pass


def ollama_host() -> str:
    host = os.environ.get("OLLAMA_HOST", "").strip() or DEFAULT_OLLAMA_HOST
    if not host.startswith("http"):
        host = "http://" + host
    # OLLAMA_HOST=0.0.0.0:11434 is a *bind* address; we still connect locally.
    host = host.replace("0.0.0.0", "127.0.0.1")
    # Only ever talk to this PC: refuse remote hosts so prompts never leave the machine.
    if not re.match(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?/?$", host):
        raise OllamaError("OLLAMA_HOST must point to this PC (127.0.0.1 or localhost).")
    return host.rstrip("/")


def ollama_models(host: Optional[str] = None, timeout: float = 1.0) -> Optional[List[str]]:
    """Return installed Ollama model names, or None when Ollama is not running."""
    try:
        with urllib.request.urlopen((host or ollama_host()) + "/api/tags", timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
        return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
    except (OSError, ValueError, OllamaError):
        return None


SYSTEM_PROMPT = (
    "You are an expert front-end developer. Write ONE complete, self-contained HTML file "
    "(inline <style> and <script>, no external URLs, no CDN, no API calls) that does what the "
    "user asks. Put the code in a single ```html fenced block and nothing else of substance."
)


def ollama_generate(prompt: str, model: str, host: Optional[str] = None, timeout: float = 240) -> str:
    body = json.dumps({
        "model": model,
        "prompt": SYSTEM_PROMPT + "\n\nUser request: " + prompt,
        "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(
        (host or ollama_host()) + "/api/generate",
        data=body, headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except (OSError, ValueError) as exc:
        raise OllamaError(f"Ollama request failed: {exc}") from exc
    text = data.get("response", "")
    html = extract_html(text)
    if not html:
        raise OllamaError("The local model did not return a complete HTML page. Try a more detailed prompt.")
    return html


def extract_html(text: str) -> Optional[str]:
    """Pull an HTML document out of a model reply. Returns None if it does not look valid."""
    m = re.search(r"```(?:html)?\s*\n(.*?)```", text, re.S | re.I)
    candidate = m.group(1) if m else text
    start = candidate.lower().find("<!doctype html")
    if start < 0:
        start = candidate.lower().find("<html")
    if start < 0:
        return None
    candidate = candidate[start:]
    if "</html>" not in candidate.lower():
        candidate += "\n</html>\n"
    if "<script" not in candidate.lower() and "<body" not in candidate.lower():
        return None
    return candidate.strip() + "\n"


# ----------------------------------------------------------------- results

@dataclass
class Result:
    ok: bool
    message: str
    name: str = ""
    html: str = ""
    backend: str = ""

    def to_dict(self) -> dict:
        return {
            "ok": self.ok, "message": self.message, "name": self.name,
            "html": self.html, "backend": self.backend,
        }


def available_templates() -> List[dict]:
    return [{"key": t.key, "title": t.title, "kind": t.kind} for t in T.TEMPLATES.values()]


def generate(prompt: str, backend: str = "auto", model: Optional[str] = None) -> Result:
    prompt = (prompt or "").strip()
    if not prompt:
        return Result(False, "Write what you want to build first. مثال: snake game · app dyal to-do")
    if len(prompt) > MAX_PROMPT_CHARS:
        return Result(False, f"Prompt too long (max {MAX_PROMPT_CHARS} characters).")
    if backend not in ("auto", "template", "ollama"):
        return Result(False, f"Unknown backend: {backend}")

    if backend in ("auto", "template"):
        tpl = match_template(prompt)
        if tpl:
            return Result(
                True,
                f"Built “{tpl.title}” ({tpl.kind}) offline from a template.",
                name=tpl.key, html=tpl.build(), backend="template",
            )
        if backend == "template":
            return _no_match()

    # No template matched (or Ollama was requested explicitly).
    models = ollama_models()
    if models is None:
        if backend == "ollama":
            return Result(False, "Ollama is not running on this PC. Start it, then try again.")
        return _no_match()
    if not models:
        return Result(False, "Ollama is running but has no models. Run: ollama pull qwen2.5-coder:7b")
    chosen = model or os.environ.get("CODER_MODEL") or (
        DEFAULT_OLLAMA_MODEL if DEFAULT_OLLAMA_MODEL in models else models[0])
    try:
        html = ollama_generate(prompt, chosen)
    except OllamaError as exc:
        return Result(False, str(exc))
    return Result(True, f"Generated by local model “{chosen}”.", name=slugify(prompt),
                  html=html, backend="ollama:" + chosen)


def _no_match() -> Result:
    names = ", ".join(t.title for t in T.TEMPLATES.values())
    return Result(
        False,
        "No offline template matched. Try one of: " + names +
        ". (Or run Ollama locally for free-form ideas.)",
    )
