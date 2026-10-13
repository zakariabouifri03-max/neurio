# CI benchmark (automated)

Battle Royale Solo, 31 bots, Cubic Isle. Measured on a GitHub Actions VM with **Mesa llvmpipe software rendering (no GPU)**.
FPS here is CPU-rasterised and NOT representative of phones; draw calls, triangles and memory are the comparable numbers.

| Preset | FPS on ground (avg) | 1% low | FPS skydiving | Draw calls | Triangles | Static mem (MB) | Video mem (MB) |
|---|---|---|---|---|---|---|---|
| Low | 35.5 | 19.6 | 65.4 | 158 | 47666 | 80 | 54 |
| Medium | 19.5 | 11.1 | 35.3 | 241 | 110962 | 80 | 56 |
| High | 8.3 | 5.1 | 10.6 | 228 | 130290 | 80 | 65 |

Generated 2026-10-13T10:37:35 with Godot 4.7.2-stable (official).
