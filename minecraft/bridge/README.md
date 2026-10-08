# ⌬ bridge — voice in / voice out (second screen)

A tiny **local** server + web app so you can talk to your villagers with your real voice,
hands-free, while you play. Nothing leaves your machine except the optional edge-tts call.

```bash
cd minecraft
python3 bridge/server.py            # http://localhost:8787
```

Open the link in your browser (or on your phone on the same Wi-Fi: `http://<pc-ip>:8787`).

## What you get
- 🎙 **Mic button** — Web Speech API, Moroccan Arabic (`ar-MA`), Arabic, French, English.
- 🧠 **The same brain as the game** — the page imports `addon/behavior_pack/scripts/brain.js`
  directly, so the companion villager has the same personality, corpus and memory logic.
- 🔊 **His voice** — real Moroccan neural voice (`ar-MA-MounaNeural` / `ar-MA-JamalNeural`)
  if you `pip install edge-tts`, otherwise your browser's built-in voice.
- 🎮 **"Send to Minecraft"** — on Windows it TYPES `/scriptevent neurio:say …` into the game
  for you (ctypes SendInput), so the **in-game** villager hears you and answers with his own
  voice bank. Full loop: you speak → he speaks.
- 🤖 **Optional LLM upgrade** — point it at any OpenAI-compatible server
  (`NEURIO_LLM_BASE`, `NEURIO_LLM_KEY`, `NEURIO_LLM_MODEL`; defaults to local Ollama).

## Windows quick start
1. Open Minecraft, keep the chat ready.
2. Run `python3 bridge/server.py`.
3. Open `http://localhost:8787`, press 🎙, speak Darija.
4. Press **🎮 صيفطها ل Minecraft** → the nearest villager answers in game, out loud.

> Typing into the game is Windows-only (SendInput). On other systems the button copies the
> command to your clipboard instead.

No dependencies at all for the basic loop (`pip install edge-tts` only for the neural voice).
