"""Creative assistant. Works fully offline; an optional OpenAI-compatible provider is used only
when the user configures one and supplies an API key. Keys are never logged or stored in plain text."""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Optional

from ..core.errors import AppError
from ..core.log import get_logger, redact
from ..core.secrets import get_api_key

log = get_logger("assistant")

HELP_TOPICS: dict[str, tuple[tuple[str, ...], str]] = {
    "split": (("split", "cut", "couper", "cortar", "قص"),
              "Select a clip on the timeline, move the playhead inside it and press Ctrl+B (Split at playhead)."),
    "export": (("export", "render", "exporter", "exportar", "تصدير"),
               "Use File › Export. For YouTube pick the 16:9 1080p preset, for TikTok or Reels the 9:16 preset. "
               "H.264 plays everywhere; H.265 is smaller but slower to encode."),
    "chroma": (("chroma", "green", "screen", "fond vert", "pantalla verde", "أخضر"),
               "Select a video clip and set Chroma key to the background colour (usually #00FF00). Adjust "
               "similarity until the background disappears."),
    "speed": (("speed", "slow", "reverse", "vitesse", "velocidad", "سرعة"),
              "Set Speed below 1× for slow motion or above 1× for fast motion. Tick Reverse to play a clip backwards."),
    "photo": (("photo", "layer", "crop", "rotate", "image", "photo", "imagen", "صورة"),
              "Open Photo & Design, import an image as a layer, then use Crop, Rotate, Adjustments or Filters. "
              "Every change can be undone with Ctrl+Z."),
    "bg": (("background", "remove", "fond", "fondo", "خلفية"),
           "In Photo & Design, select a box around the subject and press Remove background. Results depend on "
           "contrast between subject and background; review the edge."),
    "convert": (("convert", "compress", "converter", "convertir", "تحويل", "size"),
                "Use Media Converter. Choose a tool (video, audio, image, compressor, GIF) and an output file."),
    "subtitle": (("subtitle", "caption", "srt", "vtt", "sous-titre", "subtítulo", "ترجمة"),
                 "Use Media Converter › Subtitles to convert SRT ↔ VTT and shift timing. Automatic transcription "
                 "is not available in this build."),
    "audio": (("audio", "volume", "noise", "normalize", "son", "sonido", "صوت"),
              "Use Audio Studio to trim, merge, normalise loudness (-16 LUFS is a common target), reduce noise or "
              "extract audio from video."),
    "ai": (("ai", "generate", "image generation", "runway", "kling", "ia"),
           "AI image and AI video generation are not available in this build. The assistant can still write "
           "prompts and scripts offline."),
}

PLATFORM_EXPORT = {
    "youtube": "YouTube: 16:9, 1080p, H.264, 8–12 Mbps (CRF 20–23).",
    "tiktok": "TikTok: 9:16, 1080×1920, H.264, CRF 23, keep under 60 MB for fast upload.",
    "instagram": "Instagram Reels: 9:16 1080×1920; feed posts: 1:1 or 4:5 (1080×1350).",
    "shorts": "YouTube Shorts: 9:16 1080×1920, H.264.",
}


class OfflineAssistant:
    def answer(self, question: str) -> str:
        q = question.lower()
        words = set(re.findall(r"\w+", q))
        hits = [text for keys, text in HELP_TOPICS.values()
                if any(k in words or (len(k) > 3 and k in q) for k in keys)]
        if not hits:
            return ("I can help with splitting clips, exporting, chroma key, speed, photo editing, background "
                    "removal, converting media, subtitles and audio. Try asking about one of these.")
        return "\n\n".join(dict.fromkeys(hits))

    def titles(self, topic: str, n: int = 5) -> list[str]:
        topic = topic.strip()
        if not topic:
            raise AppError("Describe your video topic first.")
        templates = [
            "{t}: What Nobody Tells You",
            "How to Master {t} in 60 Seconds",
            "{t} — Beginner Guide (Step by Step)",
            "5 Mistakes Everyone Makes With {t}",
            "The Truth About {t}",
            "{t} in One Take",
        ]
        return [t.format(t=topic.title()) for t in templates[:max(1, min(n, len(templates)))]]

    def hashtags(self, topic: str, platform: str = "general") -> list[str]:
        base = [w.lower() for w in topic.replace("#", " ").split() if w.isalnum()][:5]
        tags = ["#" + w for w in base]
        extra = {"tiktok": ["#fyp", "#viral"], "instagram": ["#reels", "#explore"],
                 "youtube": ["#shorts", "#youtube"]}.get(platform.lower(), ["#creator"])
        return list(dict.fromkeys(tags + extra))

    def script_outline(self, topic: str, seconds: int = 45) -> str:
        if seconds < 10 or seconds > 600:
            raise AppError("Script length must be between 10 and 600 seconds.")
        return (f"Hook (0–3 s): a question or bold claim about {topic}.\n"
                f"Problem (3–{int(seconds*0.25)} s): why it matters.\n"
                f"Solution ({int(seconds*0.25)}–{int(seconds*0.8)} s): three quick steps or tips.\n"
                f"Proof / example ({int(seconds*0.8)}–{seconds-5} s): show the result on screen.\n"
                f"Call to action ({seconds-5}–{seconds} s): ask viewers to follow or comment.")

    def image_prompt(self, subject: str, style: str = "photorealistic", aspect: str = "16:9") -> str:
        return (f"{subject}, {style}, cinematic lighting, sharp focus, clean composition, "
                f"aspect ratio {aspect}. Avoid: text, watermark, blurry details.")

    def export_advice(self, platform: str) -> str:
        return PLATFORM_EXPORT.get(platform.lower(), "Use 1080p, H.264, CRF 23, AAC audio at 192 kb/s.")


class OpenAICompatibleProvider:
    """Calls a chat-completions endpoint. Only used when the user configured it and supplied a key."""

    def __init__(self, base_url: str, model: str, api_key: str, timeout: float = 30.0):
        if not base_url.startswith("https://"):
            raise AppError("The AI provider URL must start with https://")
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._key = api_key
        self.timeout = timeout

    def chat(self, messages: list[dict[str, str]]) -> str:
        body = json.dumps({"model": self.model, "messages": messages, "max_tokens": 600}).encode()
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions", data=body, method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._key}"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
        except urllib.error.HTTPError as exc:
            log.warning("AI provider HTTP %s", exc.code)
            if exc.code in (401, 403):
                raise AppError("The AI provider rejected the API key. Check it in Settings.") from exc
            raise AppError(f"The AI provider returned an error (HTTP {exc.code}).") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            log.warning("AI provider unreachable: %s", redact(str(exc)))
            raise AppError("The AI provider could not be reached. Check your internet connection.") from exc
        except (KeyError, IndexError, ValueError) as exc:
            raise AppError("The AI provider sent an unexpected response.") from exc


def build_assistant(settings: dict) -> tuple[OfflineAssistant, Optional[OpenAICompatibleProvider]]:
    offline = OfflineAssistant()
    cfg = settings.get("ai_provider", {})
    if cfg.get("kind") != "openai_compatible":
        return offline, None
    key = get_api_key()
    if not key:
        return offline, None
    return offline, OpenAICompatibleProvider(cfg.get("base_url", ""), cfg.get("model", ""), key)
