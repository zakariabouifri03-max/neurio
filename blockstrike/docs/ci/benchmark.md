# CI benchmark (automated)

Battle Royale Solo, 31 bots, Cubic Isle. Measured on a GitHub Actions VM with **Mesa llvmpipe software rendering (no GPU)**.
FPS here is CPU-rasterised and NOT representative of phones; draw calls, triangles and memory are the comparable numbers.

| Preset | FPS on ground (avg) | 1% low | FPS skydiving | Draw calls | Triangles | Static mem (MB) | Video mem (MB) |
|---|---|---|---|---|---|---|---|
| Low | 28.5 | 20.3 | 45.8 | 138 | 37298 | 80 | 54 |
| Medium | 11.0 | 9.0 | 17.7 | 291 | 167529 | 80 | 56 |
| High | 7.4 | 4.7 | 7.3 | 169 | 81851 | 81 | 65 |

Generated 2026-10-13T10:50:21 with Godot 4.7.2-stable (official).
