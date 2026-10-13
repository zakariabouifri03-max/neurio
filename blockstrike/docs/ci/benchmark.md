# CI benchmark (automated)

Battle Royale Solo, 31 bots, Cubic Isle. Measured on a GitHub Actions VM with **Mesa llvmpipe software rendering (no GPU)**.
FPS here is CPU-rasterised and NOT representative of phones; draw calls, triangles and memory are the comparable numbers.

| Preset | FPS on ground (avg) | 1% low | FPS skydiving | Draw calls | Triangles | Static mem (MB) | Video mem (MB) |
|---|---|---|---|---|---|---|---|
| Low | 40.5 | 28.3 | 60.8 | 70 | 20120 | 79 | 53 |
| Medium | 26.9 | 15.5 | 43.5 | 90 | 48758 | 79 | 55 |
| High | 6.9 | 4.9 | 15.2 | 197 | 154128 | 80 | 72 |

Generated 2026-10-13T10:23:31 with Godot 4.7.2-stable (official).
