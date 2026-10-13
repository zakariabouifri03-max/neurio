# CI benchmark (automated)

Battle Royale Solo, 31 bots, Cubic Isle. Measured on a GitHub Actions VM with **Mesa llvmpipe software rendering (no GPU)**.
FPS here is CPU-rasterised and NOT representative of phones; draw calls, triangles and memory are the comparable numbers.

| Preset | FPS on ground (avg) | 1% low | FPS skydiving | Draw calls | Triangles | Static mem (MB) | Video mem (MB) |
|---|---|---|---|---|---|---|---|
| Low | 31.0 | 24.3 | 61.5 | 210 | 58177 | 80 | 54 |
| Medium | 13.6 | 10.7 | 27.1 | 344 | 189663 | 80 | 56 |
| High | 6.0 | 4.7 | 10.4 | 293 | 158013 | 80 | 65 |

Generated 2026-10-13T11:03:43 with Godot 4.7.2-stable (official).
