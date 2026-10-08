# One-Minute Video Director for Dola AI

A Dola workflow skill that turns a concept, script, image, or reference video into one coherent 60-second MP4. It plans the full minute, generates reliable sequential segments, preserves continuity, adds appropriate audio, assembles the segments, and checks the finished file.

## Install in Dola

1. Open **Skills**.
2. Click **Install** and select the local skill upload option.
3. Upload `one-minute-video-director-dola.zip` or select this folder.
4. Wait for Dola's security review, then enable the skill in a new chat.

## Example requests

- `Create a one-minute cinematic video about a lost robot finding a glowing forest. 16:9, no narration.`
- `Turn this product photo into a 60-second vertical ad with an energetic English voiceover.`
- `Make a one-minute continuation of this video. Preserve the character and visual style.`

## Optional assembly dependency

The included `scripts/assemble_video.py` uses FFmpeg when Dola has no built-in media assembly tool. It requires `ffmpeg` and `ffprobe` on PATH. The generation workflow can use Dola's own editor instead when available.
