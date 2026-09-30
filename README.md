# 🛣️ The Long Drive 3D

A full 3D post-apocalyptic desert road-trip & car-maintenance survival game in the browser, inspired by **The Long Drive** — built with Three.js r170, bloom post-processing, procedural 3D articulated vehicles, and Web Audio synthesis.

## ▶ Run & Play

```bash
python3 -m http.server 8000 --bind 0.0.0.0
# → http://localhost:8000
```

## 🎮 Core Features

- **Seamless First-Person Walking & Driving**:
  - Walk around your starting desert compound (`0.0 KM`), read **Mom's Letter** on the kitchen table, pick up supplies, open/close **car doors, hood (bonnet), and trunk**, and sit in the **driver's seat** (`[E]`).
  - Toggle between **1st-Person Cockpit View** (with live 3D rotating steering wheel, working analog Speedometer, Engine Temp °C, and Fuel needles) and **3rd-Person Chase Camera** (`[V]`).
- **Authentic 3-Fluid Car Simulation**:
  - **⛽ Gasoline (Fuel Tank)**: Pour from 20L Jerrycans or vintage gas station pumps, or siphon from abandoned cars with a rubber hose.
  - **🛢️ Motor Oil (Engine Block)**: Open the hood and top up oil so your engine doesn't knock or seize.
  - **💧 Coolant Water (Radiator)**: Keep the radiator filled with water so your engine doesn't overheat and billow steam in the desert sun!
- **Swappable 3D Car Parts & Rust Restoration**:
  - Swap **Engines** (1.2L Inline-4, 1.8L Twin-Cam, 5.0L Fury V8), **Radiators** (Standard, Heavy-Duty Copper), and **4 Independently Detachable Wheels**.
  - Scrub rust off any car or part with the **Steel Wire Brush** (`100% Mint Shine`) or respray with **Aerosol Spray Paint Cans**!
- **Physical 3D Trunk Cargo Storage**:
  - Open the rear trunk (`[E]`) and stow jerrycans, oil cans, water jugs, food, and spare parts (`[F]`) so they ride with you down the highway.
- **Endless Procedural Desert Highway (`5,000 KM`)**:
  - Guided by **Telephone Poles** and **KM Milepost Signs**.
  - Procedural **Roadside POIs** every ~320m: **Abandoned Gas Stations**, **Oasis Diners & Water Towers**, **Roadside Mechanics & Wreck Yards** (with abandoned Muscle Cars, Pickups, Camper Vans & Buggies to strip or drive!), **Radio Relay Towers**, and **Bus Stops**.
  - **24-Hour Day/Night Cycle** with working **Car Headlights (`[L]`)**, **Handheld Flashlight**, and a **4-Station Procedural FM Car Radio (`[R]` / `[F]`)**.
  - **Survival Needs** (Health, Thirst, Hunger) & hostile **Mutant Desert Hares** (fend them off with your `.357 Revolver` or bumper!).
