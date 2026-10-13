# CI benchmark (automated)

Battle Royale Solo, 31 bots, Cubic Isle. Measured on a GitHub Actions VM with **Mesa llvmpipe software rendering (no GPU)**.
FPS here is CPU-rasterised and NOT representative of phones; draw calls, triangles and memory are the comparable numbers.

| Preset | FPS on ground (avg) | 1% low | FPS skydiving | Draw calls | Triangles | Static mem (MB) | Video mem (MB) |
|---|---|---|---|---|---|---|---|
| Low | 30.8 | 24.1 | 60.9 | 211 | 58497 | 80 | 54 |
| Medium | 13.9 | 11.0 | 26.3 | 346 | 190161 | 81 | 56 |
| High | 6.1 | 4.8 | 9.9 | 295 | 156116 | 81 | 65 |

Generated 2026-10-13T11:12:19 with Godot 4.7.2-stable (official).
