"""Built-in creative assistant.

Works fully offline with a curated knowledge base and generators; when a chat
provider is configured, questions are forwarded to it (clearly labelled in
the UI).  No feature here silently pretends to be AI when it is not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .capabilities import FEATURES, FeatureStatus


@dataclass
class AssistantReply:
    text: str
    source: str            # "local-kb" | "provider" | "generator"
    follow_up: str = ""


_KB: list[tuple[list[str], str]] = [
    (["export", "youtube"],
     "For YouTube: export with the 'YouTube 1080p' preset (H.264, AAC). "
     "Use 4K only if your footage is 4K — upscaling rarely helps and is slow "
     "on low-end PCs. Keep audio at 192–256 kbps AAC."),
    (["export", "tiktok", "shorts", "reel"],
     "For TikTok / Reels / Shorts: use the 9:16 preset (1080×1920, 30 fps). "
     "Keep the first 2 seconds visually strong and total length under 60 s "
     "for best completion rates."),
    (["split", "cut"],
     "To split a clip: move the playhead to the cut point and press S (or the "
     "Split button). In the timeline you can then delete or trim either half."),
    (["green screen", "chroma"],
     "Green screen: add your clip, then add a 'Chroma Key' effect, pick the "
     "green colour, and raise similarity until the background disappears. "
     "Put the background clip on the track below."),
    (["speed", "slow motion"],
     "Speed: select a clip and set its speed (0.25×–4×). Negative values play "
     "in reverse. Very slow motion from 30 fps footage will look stepped — "
     "for smooth results shoot at 60 fps or higher."),
    (["low end", "slow", "lag", "performance"],
     "On low-end PCs: enable Low-Memory Mode in Settings, set preview quality "
     "to 'quarter', export with 'veryfast' presets, and avoid 4K timelines. "
     "Close other applications during rendering."),
    (["subtitle", "caption", "srt"],
     "Subtitles: create or import an .srt file in the Video Editor, then tick "
     "'Burn subtitles' on export to hardcode them, or export them alongside "
     "for platforms that accept separate caption files."),
    (["record", "voice"],
     "Voice-over: in the Audio Studio press Record — on Windows ADZAK captures "
     "your default microphone via FFmpeg DirectShow. Normalise afterwards for "
     "consistent loudness."),
    (["background", "remove"],
     "Background removal: the Photo Editor has 'Remove background' which works "
     "best on flat, uniform backgrounds (flood-fill from the edges). Complex "
     "subjects need an AI segmentation model, which is on the roadmap."),
    (["template", "thumbnail"],
     "The Design Studio ships original templates for thumbnails, banners, and "
     "social posts. Save your logo and colours as a brand kit to reuse them."),
]


def answer(question: str) -> AssistantReply:
    q = question.lower()
    best, score = None, 0
    for keywords, text in _KB:
        s = sum(1 for k in keywords if k in q)
        if s > score:
            best, score = text, s
    if best:
        return AssistantReply(best, "local-kb")
    return AssistantReply(
        "I have offline guidance for: exporting (YouTube/TikTok/Instagram), "
        "cutting clips, green screen, speed changes, subtitles, recording, "
        "background removal, templates, and low-end PC performance. Ask about "
        "one of those — or connect a chat provider in Settings for free-form "
        "questions.",
        "local-kb")


# ---------------------------------------------------------------------------
# Generators (offline, deterministic)
# ---------------------------------------------------------------------------

def suggest_titles(topic: str, n: int = 5) -> list[str]:
    t = topic.strip() or "My Video"
    return [
        f"{t}: The Complete Guide",
        f"I Tried {t} for 30 Days — Here's What Happened",
        f"7 {t} Tips Nobody Tells You",
        f"The Truth About {t}",
        f"{t} Explained in 5 Minutes",
    ][:n]


def suggest_hashtags(topic: str, n: int = 10) -> list[str]:
    words = re.findall(r"\w+", topic.lower())
    tags = set()
    for w in words:
        tags.add(f"#{w}")
        if len(w) > 4:
            tags.add(f"#{w}ing")
    tags |= {"#contentcreator", "#viral", "#trending", "#fyp", "#tutorial",
             "#howto", "#creative"}
    return sorted(tags)[:n]


def video_script(title: str, points: list[str], outro: str = "") -> str:
    lines = [f"TITLE: {title}", "", "HOOK (0:00–0:10):"]
    lines.append(f'  "{title} — and the result surprised me. Here is everything I learned."')
    lines.append("")
    for i, p in enumerate(points, 1):
        lines.append(f"SECTION {i}: {p}")
        lines.append(f"  - Explain {p} with one concrete example.")
        lines.append("  - Show a visual / b-roll while speaking.")
        lines.append("")
    lines.append("OUTRO:")
    lines.append(f"  {outro or 'Recap the 3 key takeaways and ask viewers to subscribe.'}")
    return "\n".join(lines)


def image_prompt(subject: str, style: str = "photorealistic",
                 lighting: str = "soft studio light", detail: bool = True) -> str:
    p = f"{subject}, {style}, {lighting}"
    if detail:
        p += ", high detail, sharp focus, balanced composition, 4k"
    return p


def recommend_export(platform: str, duration_s: float, low_end: bool) -> dict:
    from ..services.presets import PRESETS

    platform = platform.lower()
    if platform in {"tiktok", "shorts", "reel", "reels"}:
        pid = "tiktok-1080"
    elif platform == "instagram":
        pid = "instagram-square"
    elif low_end:
        pid = "web-720"
    else:
        pid = "youtube-1080"
    preset = PRESETS[pid]
    return {
        "preset_id": pid,
        "label": preset.label,
        "estimated_size_mb": preset.estimated_size_mb(duration_s),
        "note": "Lower the CRF in advanced settings for higher quality."
        if not low_end else "Chosen for low-end hardware: fast encode, small file.",
    }
