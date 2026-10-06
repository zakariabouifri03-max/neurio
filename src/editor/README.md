# Editor core

The editor model is deliberately non-destructive. Clips point to source assets with `sourceIn`/`sourceOut`, timeline position, effects, keyframes, and volume. Files are never modified by timeline operations. Browser imports are cached in IndexedDB; desktop projects retain source paths and reference those files instead of embedding them.

Natural-language requests pass through `LocalAIEngine` and the registered operation validator. Simple, fully specified edits use local deterministic parsing. Semantic requests may use a configured local GGUF model through the Tauri backend. The model can only return allowlisted structured actions; it has no shell or filesystem tool. Speech and silence analysis are performed by local Whisper/FFmpeg executables.
