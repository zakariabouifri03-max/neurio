# 🎙️ STREAMER LIFE: ZERO TO FAMOUS

A complete, playable 3D first-person life simulator about building a streaming career from zero.

---

## 🎮 Game Overview

You begin as an unknown creator with **$15 cash**, **$73 in your bank account**, **12 followers**, **1 subscriber**, an old weak PC, a tiny starter apartment in Metro City, and cheap peripherals.

Through physical interactions, smart time management, hardware upgrades, live streaming, audience engagement, and side jobs, you climb the ranks to become a major streaming celebrity!

---

## 🕹️ Controls

| Key | Action |
|---|---|
| **W, A, S, D** | Move Forward / Left / Backward / Right |
| **Shift** | Sprint (Uses stamina) |
| **Space** | Jump |
| **C / Ctrl** | Crouch |
| **E** | Context-Sensitive Physical Interaction |
| **Tab** | Bring Up Smartphone |
| **Esc** | Stand up from desk / Close current overlay |
| **F1 / ~** | Developer Studio Debug Console |

---

## 🌟 Core Gameplay Systems

### 1. Physical World & Apartment
- **Full-Body 3D Character**: Look down to see your torso, legs, shoes, and hands holding items.
- **Detailed Starter Apartment**:
  - Bedroom & streaming corner with gaming desk, dual monitors, PC tower, mic on boom arm, chair, cozy bed, wardrobe.
  - Kitchen with interactive refrigerator, microwave oven, sink with tap water, and trash bin.
  - Bathroom with functional walk-in shower, vanity, and mirror.
  - Front door opening to outdoor hallway and Metro City street.
  - Doorstep mat where physical delivery packages arrive from NovaMarket!
- **City Street (Open-World Lite)**:
  - Paved sidewalk with streetlamps, trees, and moving ambient traffic.
  - Walking pedestrians with dialogues.
  - **FreshMart Supermarket**: Buy fresh groceries and drinks.
  - **SiliconTech Electronics**: In-person PC hardware store.
  - **Pulse Cafe**: Buy espresso or work barista shifts for quick cash.
  - **MetroVault ATM**: Deposit and withdraw physical cash.

### 2. Daily Life & Needs System
- **Hunger, Thirst, Energy, Hygiene, Stress & Mood**:
  - Eat food from the fridge (Instant Noodles, Pizza, Bread, Deli Sandwiches).
  - Use microwave to heat uncooked meals.
  - Drink tap water or energy drinks (Volt Surge, Spark Cola).
  - Sleep in bed (4h nap, 6h, 8h full rest, 10h deep sleep) with time acceleration and stamina restoration.
  - Take warm showers to wash up and de-stress.

### 3. Nova OS & PC System
- Sit in the gaming chair and turn on the PC to enter Nova OS:
  - **StreamForge**: Streaming software suite (Configure title, game, category, resolution, bitrate, mic/cam).
  - **GameHub**: Playable games including **Velocity Rush** (neon arcade racer with steering, boosts, and crashes that trigger viewer hype and donations).
  - **NovaMarket**: Order PC parts with priority delivery.
  - **Benchmark 3D Studio**: Run stress tests to benchmark CPU, GPU, and cooling performance.
  - **MetroVault**: Online banking with live transaction ledger.

### 4. Physical PC Building & Hardware Upgrades
- Buy components on NovaMarket or SiliconTech (RTX Nova 3060, RTX Nova 4080 Extreme, DDR5 RAM, Liquid Cooling, Studio Mic, 4K Cam).
- Packages arrive at your apartment door.
- Pick up the box, carry it to the desk, and unbox the hardware.
- Open the PC case side panel, install components into the motherboard, and watch your benchmark score leap from 850 to 4,000+ points!
- Upgraded hardware unlocks 1080p 60fps and 4K broadcasts without dropped frames.

### 5. Live Streaming & Audience Simulation
- Over 40 persistent viewer personas with unique badges (VIP, SUB, MOD), colors, and memories.
- Real-time contextual chat reactions to minigame clutches, fails, crashes, and new hardware.
- Follower alerts and spontaneous donation fanfare with custom TTS messages.
- Comprehensive post-stream analytics report with viewer averages, peak counts, follower growth, ad revenue, tips, and AI coaching insights.

### 6. Smartphone System (TAB)
- **Pulse**: Social feed with posting, likes, and viral engine chance.
- **Messages**: Threads with Mom, Dave (PC Tech), and Sponsor representatives.
- **MetroVault**: Balance, rent countdown, and transactions.
- **NovaMarket**: Mobile hardware and food ordering.
- **GigWork**: Immediate side jobs (Warehouse sorting, Barista shift, PC repair).
- **Weather & Settings**: 24h forecast, save game, and cheats.

---

## 🛠️ Tech Architecture

- **Engine**: Three.js r170 (ES Module, WebGL2, PBR Standard Materials, Soft Shadows).
- **Audio**: Procedural Web Audio API sound synthesizer (Footsteps, PC fan hum, keyboard typing, donation chimes, rain ambience).
- **Zero External Asset Dependencies**: All textures (wood planks, ceramic tiles, motherboard circuits, GPU shrouds, cardboard packages, neon signs, asphalt roads) are generated via procedural HTML5 Canvas PBR textures.
- **Persistence**: Robust auto-saving to `localStorage` with deep state merging.

---

## 🚀 Running the Game

```bash
node server.js
# Open http://localhost:8080 in your browser
```
