"""Local AI assistant backed by an Ollama-compatible local inference server.

The assistant never reaches a remote API: only loopback hosts are allowed,
and it never edits the timeline. It returns text suggestions that the user
must apply manually.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlparse

from ..core.config import Config
from ..core.logging_setup import get_logger
from .base import AITool, ToolStatus

log = get_logger("ai-assistant")
ALLOWED_SCHEMES = ("http", "https")


@dataclass
class AssistantMessage:
    role: str       # system | user | assistant
    content: str

    def as_dict(self) -> dict:
        return {"role": self.role, "content": self.content}


def _is_loopback(host: str) -> bool:
    host = (host or "").lower()
    return host in ("127.0.0.1", "localhost", "::1", "[::1]")


class LocalAssistant(AITool):
    id = "assistant"
    name = "Local AI assistant"
    description = "Natural-language workflow help via a local Ollama server."

    def __init__(self, host: str | None = None, model: str | None = None):
        super().__init__()
        cfg = Config()
        self.host = (host or cfg.get("ollama_host", "http://127.0.0.1:11434")).rstrip("/")
        self.model = model or cfg.get("ollama_model", "llama3.2:3b")

    def check(self) -> ToolStatus:
        parsed = urlparse(self.host)
        if parsed.scheme not in ALLOWED_SCHEMES or not _is_loopback(parsed.hostname or ""):
            return self.unavailable("Only local loopback Ollama hosts are allowed.")
        try:
            models = self.list_models(timeout=2.0)
        except Exception as exc:  # noqa: BLE001
            return self.unavailable(
                f"Ollama is not reachable at {self.host}. Install/start Ollama "
                f"and pull a model (e.g. `ollama pull {self.model}`). Details: {exc}")
        if self.model not in models:
            return self.unavailable(
                f"Model '{self.model}' not found in Ollama. Pull it first.",
                requirements=f"available: {', '.join(models[:8])}")
        return self.available(requirements=f"model={self.model}")

    def _request(self, path: str, payload: dict, timeout: float = 60.0) -> dict:
        parsed = urlparse(self.host)
        if not _is_loopback(parsed.hostname or ""):
            raise PermissionError("Refusing to call a non-local inference host.")
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.host + path, data=data,
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))

    def list_models(self, timeout: float = 5.0) -> list[str]:
        parsed = urlparse(self.host)
        if not _is_loopback(parsed.hostname or ""):
            return []
        with urllib.request.urlopen(self.host + "/api/tags", timeout=timeout) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8"))
        return [m.get("name", "") for m in data.get("models", [])]

    def chat(self, messages: list[AssistantMessage], timeout: float = 120.0) -> str:
        payload = {"model": self.model, "stream": False,
                   "messages": [m.as_dict() for m in messages]}
        result = self._request("/api/chat", payload, timeout=timeout)
        return result.get("message", {}).get("content", "")

    # --------------------------------------------------------- project help
    def project_summary_prompt(self, project) -> str:
        tl = project.timeline
        lines = [
            "You are the offline assistant inside NovaCut AI Studio, a desktop "
            "video editor. You can explain and suggest only; you cannot edit.",
            f"Project: {project.settings.name} "
            f"({project.settings.width}x{project.settings.height} @ {project.settings.fps} fps).",
            f"Tracks: {len(tl.video_tracks())} video, {len(tl.audio_tracks())} audio; "
            f"{len(tl.all_clips())} clips; duration {tl.duration():.1f}s.",
        ]
        for clip in tl.all_clips():
            lines.append(f"- {clip.kind} clip '{clip.name}' "
                         f"[{clip.start:.2f}-{clip.end:.2f}] on {clip.track_id}")
        return "\n".join(lines)

    def suggest_workflow(self, project, question: str) -> str:
        system = AssistantMessage("system", self.project_summary_prompt(project))
        guard = ("Remember: explain steps the user can perform themselves. "
                 "Do not output instructions that imply automatic edits.")
        user = AssistantMessage("user", question + "\n" + guard)
        return self.chat([system, user])
