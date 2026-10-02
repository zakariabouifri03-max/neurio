# Creator Life — Tidebound Island

A playable browser prototype of a **3D creator-life simulator**. Start in a tiny beach house with a weak PC, slow internet and $120. Explore a compact living island, build a channel, and grow the home and studio over time.

## Play locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The project is static and offline-friendly. Three.js is vendored in `vendor/`; no runtime CDN or build step is required.

## What is implemented

- Intro cinematic showing Tidebound Island, the beach and starter house, then a third-person playable island
- Single-player mode plus a 2-player online-room flow with room codes and same-origin `BroadcastChannel` position sync when two tabs share a room
- Compact 3D island with beach, ocean, forest, hills, village, shops, ferry dock, viewpoint, roads, house interior, water/wind animation, animals, NPCs, boats and a day/night cycle
- Physical movement, interaction prompts, NPC conversations, delivery beach and carry-home loop
- Starter house with worn bed, cheap desk, old chair, weak PC, old monitor, keyboard, mouse, microphone and slow router
- Tide OS desktop that starts with only Browser, File Manager, Basic Settings and Game Store; other creator applications are downloaded individually
- Stream Desk, Cutroom Editor, Pulse Analytics, Tip Jar, Creator Studio, Harbor Bank, Messenger, Cloud Locker, Sound Library, Camera Manager, Task Monitor and Calendar apps
- A real component lab showing the PC case and installed CPU, GPU, RAM, storage, motherboard, PSU, cooler and case; upgrades are ordered, delivered by boat, carried home and installed
- Download speed, upload speed, ping, stability, Wi-Fi coverage and monthly cost simulation
- 25 original games with price, genre, popularity, graphics requirement, trend and viewer potential
- Creator gear with webcams, outdoor cameras, microphones, lights, monitors, keyboards, mice and routers; webcams switch streams from avatar mode to face-camera mode
- A generated catalog of **1,000 furniture items** with product cards, specifications, prices and delivery orders
- Streaming, audience growth, comments, donations, returning viewers and dynamically simulated country RPM shown per 100 and 1,000 views
- Outdoor clips, camera stats, editing/render time tied to PC performance, uploads and analytics history
- Save, load, settings, graphics presets, audio, controls, network settings, pause and exit-to-menu flows

## Controls

| Action | Keys |
| --- | --- |
| Move | `W A S D` / arrow keys |
| Run | `SHIFT` |
| Interact / pick up / place | `E` |
| Pause | `ESC` |
| Save | `F2` |
| Open Messenger | `M` |
| Skip intro | `SPACE` |

All money, RPM and audience numbers are **game simulation values**, not real-world creator payment claims.
