# Gameplay Systems

## 1. Player

`ABCUPlayerCharacter` — third-person, voxel-built body, camera-relative movement.

| | |
|---|---|
| Walk / jog / sprint | 1.8 / 4.2 / 6.6 m·s⁻¹ (6.5 / 15 / 24 km/h) |
| Crouch | 1.1 m·s⁻¹ |
| Acceleration / deceleration | 2400 / 3200 cm·s⁻² |
| Jump | 5.2 m·s⁻¹ |
| Stamina | drains 0.16/s sprinting, regens 0.11/s, exhausted below 0.05, recovers at 0.45 |
| Health | 100, armour absorbs 65% first, regen after 8 s to a 40% ceiling |
| Fall damage | above 18 m/s of impact, 0.02 per cm/s over the threshold |

Locomotion states: Idle, Walking, Jogging, Sprinting, Jumping, Falling, Swimming,
InVehicle, Entering, Exiting, Downed. The state drives the animation blueprint and
`ApplySpeedForState`.

**Input lives only on `ABCUPlayerController`.** Four Enhanced Input mapping
contexts — Global (priority 100), UI (90), OnFoot (10), Driving (10) — and
`SetControlContext` swaps exactly one gameplay context at a time. That is what
makes "F enters the car" stop firing while driving it, and what makes entering a
car while a menu is open still produce the right controls when the menu closes.

**Camera** (`UBCUCameraSystem`): one component, two parameter sets. On foot it is
a lag-compensated spring arm with shoulder offset and a collision probe. Driving,
distance, FOV, lag and height all scale with velocity — 520→820 cm, 82°→104°, at a
220 km/h reference — plus a few degrees of roll from lateral acceleration. `bAutoManageActiveCameraTarget`
is false; the system owns the view target, which is what lets the camera move from
character to vehicle and back without a cut. Modes: Third, CloseThird, First,
Hood, Chase, Cinematic, TopDown.

## 2. Vehicles

`ABCUBaseVehicle` on Chaos WheeledVehicle. One class serves player, traffic and
police; AI is layered on with `UBCUTrafficComponent`, so a traffic car costs one
extra component rather than a separate blueprint hierarchy.

Eighteen original vehicles in `Tools/data/vehicles.csv` — Kestrel C1, Bramford
240, Ironside Hauler, Calder Shuttle, Vellum GT, Kestrel RS, Rowan Trailblazer,
Ashfall 1500, Marbella Lusso, Neon Courier, Vault City Cruiser / Interceptor /
Response Van, Calder Ambulance, Ironside Engine 7, Granite RR900, Ashfall Mule,
Marbella Cab.

Definition-driven: mass, torque curve, gear ratios, final drive, drive train
(FWD/RWD/AWD → Open/LimitedSlip/LimitedSlip_4W differential), brake and handbrake
torque, drag, rolling resistance, downforce, centre of mass, per-wheel suspension
(drop, compression, spring rate, damping) and tyre (friction scale, slip
threshold), voxel body dimensions and style, seats with entry offsets, materials,
light intensities and colours, five audio slots, and economy (price, resale,
repair cost, fuel, upgrade ceilings).

Player and AI intent merge into one smoothed actuator set
(`ThrottleSmoothing 9`, `BrakeSmoothing 14`, `SteerSmoothing 12`), and the player
always wins when both are set — which is what makes hijacking a traffic car work.
Steering is speed-sensitive: full lock at 10 km/h, 35% at top speed.

States: Parked, Idling, Driving, Braking, Drifting, Airborne, Flipped, Wrecked,
Siren. Drift detection is a smoothed signed slip angle above 14° at over 25 km/h.

Seats: `ResolveSeatForEntrant` prefers the driver seat, falls back to the first
free one, returns `INDEX_NONE` when full. `CanExitSafely` refuses above 6 km/h and
sweeps a capsule at the exit point so the player cannot step out into a wall;
`NotifyExitRefused` plays the refusal sound.

Fuel, odometer, damage and customisation are `SaveGame` properties, so a car left
in an alley is still there, still damaged, still out of fuel on reload.

## 3. Traffic

`UBCUTrafficSubsystem` builds a lane graph from the road segments the city
generator produced, registered per cell by the streamer.

Three tiers: **tier 0** (< 450 m) full physics and AI every frame; **tier 1**
(< 900 m) kinematic along the graph at 3 Hz; **tier 2** despawned or pooled.
Vehicles are pooled and spawned in a ring between 55% and 100% of the spawn
radius, so nothing materialises in front of the player. A car with a driver is
never despawned.

Behaviour: lane following with cornering slowdown, an obstacle sweep scaled to
braking distance, yielding to emergency vehicles with sirens on, and reacting to
danger (close → flee, far → pull over; aggressive drivers keep going). Routes use
A* over the lane graph with straight-line distance as the heuristic, which is also
what the GPS draws.

## 4. Pedestrians

`UBCUPedestrianSubsystem`, two tiers. **Near** (< 700 m scaled): a real
`ABCUNPCCharacter` with `ABCUPedestrianAIController` — sight (180 m, 100° cone)
and hearing (320 m), panic, calm-down. **Far**: kinematic positions in a plain
array, one HISM per outfit, updated at 1 Hz. Promotion and demotion cross the
tiers with hysteresis so nobody pops.

`ABCUNPCCharacter` is one class for every person; `Role` selects outfit, faction,
health and hostility: Civilian, Shopkeeper, MissionGiver, GangMember,
PoliceOfficer, Paramedic, Firefighter, Valet, Mechanic, Bouncer.

Original factions: Vault City Police Department, Ironside Crew, Marbella
Syndicate, Foundry Collective, Ashfall Rangers, Calder Port Authority
(`Tools/data/DT_Factions.csv`).

## 5. Wanted level and police

Heat accumulates per crime and decays **only when no unit has line of sight** —
the single rule that makes losing the cops a real loop rather than a timer.
Being inside a garage or safehouse accelerates decay 2.5×.

| Crime | Heat |
|---|---|
| Traffic violation | 8 |
| Reckless driving | 18 |
| Property damage | 22 |
| Vehicle theft | 34 |
| Pedestrian injury | 40 |
| Assault | 48 |
| Weapon discharge | 55 |
| Evading arrest | 60 |
| Assault on an officer | 72 |
| Explosion | 95 |
| Murder | 110 |
| Aircraft down | 130 |
| Heist in progress | 160 |

Wanted buckets: 0/25/70/150/280/460/700 heat → 0–6 stars.

Dispatch profiles scale with the level: response delay falls from 9 s to 2.8 s,
unit count rises 1 → 6 (capped at 8), and the vehicle pool shifts from cruisers to
interceptors and response vans. Units spawn in a ring 120–450 m out (closer at 4+
stars, since they are already hunting), preferring registered patrol points and
authored `EBCUSpawnKind::PolicePatrol` markers.

Tactics: Follow, Intercept (quadratic lead solve on the target's velocity), BoxIn
(get 90 m ahead, offset to one side), Ram (4+ stars, under 25 m, with a cooldown
so a unit cannot pinball the player forever), SearchGrid (an evenly spaced spiral
around the last known position — beatable by staying still inside an already
searched ring).

Line of sight is a real raycast, so breaking around a tower works. Once visual is
lost the unit searches the *predicted* position, extrapolated from the player's
velocity for up to 6 s. Arrest requires close, slow and seen; resisting adds
evasion heat and resumes the pursuit.

Difficulty multiplies aggression: `ABCUGameMode::DifficultyLevel` 0–3 → police
aggression 0.6 / 1.0 / 1.45 / 2.0 and mission rewards 1.35 / 1.0 / 0.8 / 0.65.

## 6. Missions

`UBCUMissionSubsystem` discovers the roster through the Asset Manager primary
asset type `BCUMission`, so **adding a mission is a data task**: drop a
`UBCUMissionDefinition` asset into `/Game/Data/Missions` and it appears in the
phone's list.

Objective types: GoToLocation, DriveRoute (checkpoints), DeliverItem,
CollectItems, EliminateTarget, EvadePolice, SurviveTimed, ProtectTarget,
StealVehicle, ReachSpeed, PerformStunt, TalkToNPC, WaitForPlayer, Custom
(Blueprint).

A definition carries prerequisites (completed missions, reputation, time-of-day
window that wraps midnight, required weather), objectives, four dialogue banks,
rewards (cash, reputation, vehicle/property/cosmetic unlocks, par-time and
no-damage bonuses), world effects (forced wanted level, frozen clock, suppressed
traffic, suppressed random events) and **preload cells** — the most important
field, because a mission that preloads its chase route never streams mid-pursuit.

The slice's three missions (`Tools/data/missions.csv`):

| Mission | Giver | District | Type | Reward |
|---|---|---|---|---|
| Cold Chain Run | Mara Kessel | Ironside Docks | Delivery | $1,800 + 220 rep |
| Neon Mile Sprint | Dex Oyelaran | Neon Mile | Race | $2,400 + 300 rep |
| Vault of Foundry Heights | Silas Vane | Foundry Heights | Heist | $9,500 + 900 rep, unlocks the Vellum GT |

Random events fire every ~20 s when no mission is active and the wanted level is
zero, sampled 150–400 m **ahead** of the player's travel direction so the event is
something they drive into, not something that spawns behind them.

## 7. Economy

`UBCUEconomySubsystem` is the single source of truth for cash — every system that
spends or earns goes through it, so the HUD, the save file and the log can never
disagree. `EBCUCashReason` has 14 values (MissionReward, MedicalBill, ArrestFine,
HeistCut, Bribe, Purchase, PropertyIncome, Resale, Repair, Refuel, …).

Ranks by reputation: Street Nobody → Errand Runner → Wheelman → Crew Regular →
Made Name → District Boss → City Legend. Rank gates shop stock.

Shops are data (`DT_ShopItems.csv`): category, price, resale, reputation
requirement, district restriction, unlock id. Property pays passive income on an
interval scaled by fraction of an in-game day, and upgrades raise it 25% each.

Customisation costs rise geometrically (level 5 ≈ 8× level 1), which makes the
garage a long-term sink rather than a one-purchase upgrade.

Death costs $250 (medical bill), arrest costs $400 (fine).

## 8. Save and load

`UBCUSaveGameSystem`: 8 slots, async serialize on a worker thread with capture on
the game thread, autosave every 180 s and on mission complete / property purchase,
`FlushPendingSave` on shutdown so an in-flight save is never lost.

`UBCUSaveGame` is versioned (currently 7) with an additive migration path, so a
v1 save still loads. It stores the profile (cash, reputation, character, outfits,
garage with per-car paint/upgrades/odometer/fuel/parked transform, properties,
completed and failed missions, discovered districts, collected pickups,
inventory), the world (city seed, time of day, day number, weather, wetness,
player location/rotation/district, wanted level), video options and five audio
buses.

The city is **never** saved as geometry — only the seed. That is what determinism
buys: a save file is a few kilobytes no matter how much of the 605 km² region the
player has explored.

## 9. UI

`ABCUPlayerHUD` owns the data; every visual is a UMG Blueprint that binds to it.
The minimap is a canvas render target drawn at ~20 Hz (not every frame) showing
the actual generated street network from the lane graph, district-tinted building
footprints, police blips and the mission marker clamped to the rim. GPS routes
rebuild at ~4 Hz along the lane graph, with turn instructions suppressed on
straights so the HUD stays quiet on a highway run.

Panels: HUD, Minimap, MapScreen, Phone, Inventory, PauseMenu, LoadingScreen,
Toast, RespawnFade, Garage, Shop. `ToggleWidget` by id, so an input binding and a
Blueprint button reach the same code path.
