# ⌬ Neurio AI Villagers — Minecraft Bedrock Mode
### قرويون كيهضرو معاك بالدارجة، كيجاوبوك بالذكاء الاصطناعي، وكيصوتو — بلا أنترنت وبلا API key

A **Minecraft Bedrock add-on** where every villager is a little AI person: he has a name,
an age, a job, a personality and a mood; he hears what you say (Darija in Arabizi or Arabic
script, English or French), answers with real sentences about the situation he can see
(night, rain, your health, the emeralds in your pocket...), remembers you, gets happy when
you give him gifts, gets angry when you hit him — and he **speaks out loud**.

> **Download:** `dist/Neurio-AI-Villagers.mcaddon` (at the root of this folder) —
> double-click it on Windows, or open/share it on Android/iOS. Minecraft imports both packs.

---

## ✨ شنو كيدير / What it does

| | |
|---|---|
| 💬 **كايهضر معاك** | Sneak + Use on any villager (or use the ⌬ amulet) → a conversation screen with a text box. Type in Darija/Arabic/English/French — he answers in the same language you used. |
| 🎙 **كايصوت** | Every answer is spoken: a procedural "villagerese" voice by default (4 voices: male / female / old / kid, pitch changes with the emotion), or a **real Moroccan Darija neural voice** if you run the voice-bank builder (`tools/build_voicebank.py --engine edge`, ar-MA-MounaNeural / ar-MA-JamalNeural). |
| 🗣 **نتا تهضر بصوتك** | Inside the text box: **Windows → `Win + H`** (dictation), **Android/iOS → the mic key on the keyboard**. What you say gets written, and the villager answers. (Want a full hands-free second screen? see "Companion" below.) |
| 🧠 **ذكاء بلا أنترنت** | The brain lives inside the pack: 187 dialogue lines, 36 intents, fuzzy Arabizi matching (`7`, `3`, `9`, `5`...), situation tags (night, rain, thunder, zombies near, your reputation...), persona-flavoured line picking and a "don't repeat yourself" memory. No server, no key, **no experimental toggles** (stable Script API). |
| 🎭 **شخصيات** | Each villager is generated deterministically: name (الحاج عبد الله، فاطمة، الجيلالي...), job from his real profession (farmer, librarian, blacksmith...), traits (بخيل، ضحّاك، حكواتي...), catchphrase, voice. Rename him or re-roll his personality with the amulet. |
| 🎁 **كيتفاعل** | Gifts (he remembers and likes you more), his own little shop with prices that follow your reputation, quests ("جيب لي 6 قمح ونعطيك زمردة"), blessings when you are hurt, panic + the whole village gets angry if you hit him, "follow me", gossip about his neighbours, proverbs, jokes, stories. |
| 🌦 **كيحس بالعالم** | It is raining? he talks about the crops. Night? he tells you to go home. Zombies close? he screams for the guards. You are low on health? he gives you bread. |

---

## 📥 التثبيت / Install

1. Get `dist/Neurio-AI-Villagers.mcaddon` (this repo, folder `minecraft/dist/`).
2. **Windows:** double-click it → Minecraft opens and imports both packs.
   **Android:** open it with Minecraft (or share → Minecraft). **iOS:** Files → share → Minecraft.
3. In Minecraft: create a world (or edit one) → **Behaviour Packs** → activate
   *Neurio AI Villagers (BP)* → the resource pack activates automatically.
4. In game: `/function neurio_setup` (gives you the ⌬ amulet) or `/function neurio_village`
   (summons 4 named AI villagers if your world has no village).
5. **Sneak + Use** on a villager and say `salam`. 🎉

> Console (Xbox/PS/Switch): works too — use the ⌬ amulet + the on-screen keyboard for talking.
> Realms: works. Dedicated server: works.

### 🔧 If the pack says "script module not found"
Your Minecraft is older than the Script API the pack asks for. Rebuild with the older preset:
```bash
python3 tools/build_addon.py --api 1.21      # for Minecraft 1.21.x
python3 tools/build_addon.py                # default = latest (1.26.x)
```
(or edit the two `"version"` strings in `addon/behavior_pack/manifest.json`).

---

## 🎙 الصوت الحقيقي بالدارجة / Real Darija voice (optional, 5 minutes)

The `.mcaddon` ships with the offline "villagerese" murmurs so it works everywhere.
For a **real voice** (Microsoft neural Moroccan Arabic), on a PC:

```bash
pip install numpy soundfile edge-tts
cd minecraft
python3 tools/build_voicebank.py --engine edge          # ~400 sentences, female + male voice
# python3 tools/build_voicebank.py --engine edge --words # + word-by-word speech (bigger)
python3 tools/build_addon.py                            # new .mcaddon with the voice inside
```
Other engines: `--engine piper` (offline neural), `espeak`, `say` (macOS), `sapi` (Windows).
Re-import the new `.mcaddon` in Minecraft (delete the old pack first). The villagers will now
speak the exact sentence they show on screen, in Darija. 🇲🇦

---

## 🕹 الأوامر / Commands

```
/scriptevent neurio:say <كلام>     talk to the closest villager
/scriptevent neurio:all <كلام>     everybody around answers
/scriptevent neurio:menu           open the conversation screen
/scriptevent neurio:lang dz|ar|en|fr|auto
/scriptevent neurio:voice on|off
/scriptevent neurio:barks on|off   (villagers talking by themselves)
/scriptevent neurio:bubbles on|off (speech bubble above the head)
/scriptevent neurio:channel chat|actionbar|title|all
/scriptevent neurio:name <سمية>    rename the closest villager
/scriptevent neurio:info           which voice engine is loaded
/scriptevent neurio:stats          how big the brain is
/scriptevent neurio:help
```

Settings are also available in-game: the **⚙ Settings** button in the conversation screen
(saves in the world).

---

## 🧠 How the "AI" works (short version)

1. **You say something** → `arabizi.js` normalizes it (Arabic script ⇄ Arabizi  Latin),
2. `brain.js` scores all 36 intents with keyword + fuzzy matching (`sme7` ≈ `smh`),
3. it picks a line that fits **the persona + the mood + your reputation + the situation**
   (night lines only at night, farmer lines more often from farmers...),
4. fills in what he sees (`{name}`, `{player}`, `{price}`, the direction he points at...),
5. sometimes adds a second sentence about the weather/gossip so it never sounds canned,
6. `voice.js` plays the matching audio (real clip → word-splicing → murmurs),
7. `actions.js` runs what he promised (gift, quest, blessing, running away...).

Everything is in `addon/behavior_pack/scripts/` — **the corpus is one file**
(`corpus.js`): add your own lines, rebuild, and your villagers learn them.

### Companion / hands-free voice (Windows)
`bridge/` contains a small local server + a web app (second screen): speak into the mic,
it transcribes (Web Speech API, `ar-MA`), and types it into Minecraft for you — full
voice-in / voice-out conversation. See `bridge/README.md`.

---

##  Tests

```bash
node tools/test-addon.mjs     # runs the REAL addon scripts against a mock Bedrock API
node tools/export_corpus.mjs  # dump the corpus as JSON (for the voice builder)
```

## 📁 Layout

```
minecraft/
  addon/behavior_pack/     scripts (brain, corpus, personas, voice, forms, actions), item, functions
  addon/resource_pack/     pack icon, button icons, amulet texture, sounds/neurio/*.ogg
  tools/                   build_voicebank.py, build_addon.py, make_pack_art.py, test-addon.mjs
  bridge/                  local server + companion web app (voice in/out)
  dist/                    Neurio-AI-Villagers.mcaddon   <-- the download
```

MIT licensed. Made with ♥ and a lot of أتاي.
