#!/usr/bin/env python3
"""
BLOCK CITY ULTRA — content scaffolder.

Unreal `.uasset` files are binary, so they cannot be authored by a script that
has no engine installed. What *can* be authored is everything the editor needs
to build them:

  * the folder layout under Content/
  * CSV data tables that the editor imports 1:1 into UDataTable assets
  * a Blueprint "recipe" per asset: the exact class, the exact property values,
    and the exact component graph, in a form a human (or a Python-in-editor
    script) can execute in five minutes
  * placeholder READMEs that explain what each folder is for

Run once after cloning, and again after editing any CSV in Tools/data/.
The script is idempotent and never overwrites a file that already exists unless
--force is passed.

Usage:
    python3 Tools/scaffold_content.py [--force] [--quiet]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import os
import sys
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
CONTENT_DIR = PROJECT_DIR / "Content"
DATA_DIR = SCRIPT_DIR / "data"

# UE imports a CSV as a UDataTable whose row struct must match. These are the
# struct names the C++ expects; the CSV header is the row layout.
TABLE_SPECS = {
    "vehicles": {
        "row_struct": "BCUVehicleDefinition",
        "target": "Data/Vehicles/DT_Vehicles",
        "note": "One row per drivable vehicle. Imported as a UDataTable with the "
                "row struct set to the CDO of UBCUVehicleDefinition. All names, "
                "manufacturers and silhouettes are original.",
    },
    "districts": {
        "row_struct": "BCUDistrictDataAsset",
        "target": "Data/Districts/DT_Districts",
        "note": "One row per district. Each row becomes a UBCUDistrictDataAsset "
                "primary asset (primary asset type 'BCUDistrict').",
    },
    "missions": {
        "row_struct": "BCUMissionDefinition",
        "target": "Data/Missions/DT_Missions",
        "note": "One row per mission. Each row becomes a UBCUMissionDefinition "
                "primary asset (primary asset type 'BCUMission'). All story, "
                "characters and objectives are original writing.",
    },
}

# Extra CSVs that are authored inline below (they are small and rarely change).
INLINE_TABLES = {
    "customisation_costs": {
        "target": "Data/Economy/DT_CustomisationCosts",
        "columns": ["CategoryId", "Level", "Cost", "UnlockRequirement"],
        "rows": [
            ["Paint", 0, 450, ""], ["Paint", 1, 850, ""], ["Paint", 2, 1600, ""],
            ["Paint", 3, 3000, "Rank:Wheelman"], ["Paint", 4, 5600, "Rank:Crew Regular"],
            ["Wheels", 0, 1200, ""], ["Wheels", 1, 2200, ""], ["Wheels", 2, 4100, ""],
            ["Engine", 0, 3800, ""], ["Engine", 1, 7000, ""], ["Engine", 2, 13000, "Rank:Wheelman"],
            ["Engine", 3, 24000, "Rank:Crew Regular"], ["Engine", 4, 44500, "Rank:Made Name"],
            ["Handling", 0, 2600, ""], ["Handling", 1, 4800, ""], ["Handling", 2, 8900, ""],
            ["Brakes", 0, 1800, ""], ["Brakes", 1, 3300, ""], ["Brakes", 2, 6100, ""],
            ["Decal", 0, 250, ""], ["BodyKit", 0, 5200, ""], ["Underglow", 0, 900, ""],
        ],
    },
    "property_catalog": {
        "target": "Data/Economy/DT_Properties",
        "columns": ["PropertyId", "DisplayName", "DistrictId", "Price", "DailyIncome",
                    "GarageSlots", "IsSafehouse", "Description"],
        "rows": [
            ["prop_rowan_flat", "Rowan Park Flat", "RowanPark", 48000, 220, 1, 1,
             "A one-bedroom over a launderette. Saves the game, stores one car."],
            ["prop_neon_loft", "Neon Mile Loft", "NeonMile", 186000, 640, 2, 1,
             "Eleven floors above the signage. Roof access, two parking bays."],
            ["prop_ironside_yard", "Ironside Yard", "IronsideDocks", 96000, 520, 6, 0,
             "A fenced container yard. Six vehicles, no neighbours asking questions."],
            ["prop_marbella_suite", "Marbella Row Suite", "MarbellaRow", 740000, 2400, 3, 1,
             "The whole top floor of the Lusso building. Valet, spa, helipad access."],
            ["prop_foundry_office", "Foundry Heights Office", "FoundryHeights", 1250000, 4100, 4, 0,
             "Forty-two storeys up. Legitimate income, questionable tenants."],
            ["prop_basin_cabin", "Ashfall Basin Cabin", "AshfallBasin", 26000, 90, 2, 1,
             "Off-grid, off the map, and the only place the police do not patrol."],
            ["prop_granite_hangar", "Granite Ridge Hangar", "GraniteRidge", 310000, 780, 8, 0,
             "A decommissioned forestry hangar. Eight bays and a fuel bowser."],
            ["prop_calder_hanger", "Calder Hangar 4", "CalderInternational", 890000, 2600, 10, 0,
             "Airside, fenced, and staffed by people who do not read manifests."],
        ],
    },
    "shop_catalog": {
        "target": "Data/Economy/DT_ShopItems",
        "columns": ["ItemId", "DisplayName", "Category", "Price", "ResaleValue",
                    "RequiredReputation", "DistrictRestriction", "UnlockId"],
        "rows": [
            ["food_coffee", "Black Coffee", "Food", 6, 0, 0, "", ""],
            ["food_noodles", "Neon Noodles", "Food", 14, 0, 0, "NeonMile", ""],
            ["food_burger", "Double Ashfall Burger", "Food", 22, 0, 0, "", ""],
            ["med_bandage", "Field Bandage", "Consumables", 180, 60, 0, "", ""],
            ["med_kit", "Trauma Kit", "Consumables", 640, 210, 60, "", ""],
            ["armour_vest", "Ballistic Vest", "Consumables", 1450, 480, 220, "", ""],
            ["clothes_workwear", "Ironside Workwear", "Clothing", 320, 90, 0, "IronsideDocks", "outfit_workwear"],
            ["clothes_suit", "Marbella Tailored Suit", "Clothing", 2400, 700, 150, "MarbellaRow", "outfit_suit"],
            ["clothes_leathers", "Granite Riding Leathers", "Clothing", 1800, 520, 90, "", "outfit_leathers"],
            ["fuel_petrol", "Petrol (per litre)", "Fuel", 3, 0, 0, "", ""],
            ["fuel_diesel", "Diesel (per litre)", "Fuel", 4, 0, 0, "", ""],
            ["repair_bodywork", "Bodywork Repair", "Repair", 900, 0, 0, "", ""],
            ["repair_full", "Full Restoration", "Repair", 4200, 0, 220, "", ""],
        ],
    },
    "dialogue": {
        "target": "Data/Dialogue/DT_Dialogue",
        "columns": ["LineId", "SpeakerId", "Text", "DurationSeconds", "OnlyWhenWanted"],
        "rows": [
            ["mara_intro_01", "mara_kessel",
             "Cold store, pier nine. The crate is already packed, so don't open it.", 4.5, 0],
            ["mara_intro_02", "mara_kessel",
             "Neon Mile garage, ask for Dex. He pays on delivery, not on promises.", 4.5, 0],
            ["mara_outro_01", "mara_kessel",
             "You drove that like it was nothing. It wasn't nothing.", 3.5, 0],
            ["dex_intro_01", "dex_oyelaran",
             "Three laps of the Mile. Six checkpoints. Try not to hit the tram lines.", 4.5, 0],
            ["dex_taunt_01", "dex_oyelaran",
             "That's the corner I told you about. The one with the tram lines.", 3.5, 0],
            ["silas_intro_01", "silas_vane",
             "The storm is the point. Nobody looks up when it's raining sideways.", 4.5, 0],
            ["silas_intro_02", "silas_vane",
             "Eleven floors down, four bonds, five minutes. Then we are all strangers.", 5.0, 0],
            ["dispatch_01", "dispatcher",
             "Four fares, one driver. Marbella Row first, and they're already late.", 4.5, 0],
            ["precinct_01", "precinct_desk",
             "Ironside crew on the north quay. Stolen containers. Off the books, on the record.", 5.5, 0],
            ["police_bark_01", "vault_pd", "Stop the vehicle. Now.", 2.5, 1],
            ["police_bark_02", "vault_pd", "Last warning. Get on the ground.", 3.0, 1],
            ["police_bark_03", "vault_pd", "We lost them. Hold the perimeter.", 3.0, 1],
            ["police_bark_04", "vault_pd", "Suspect in custody. Scene is clear.", 3.0, 1],
        ],
    },
    "factions": {
        "target": "Data/World/DT_Factions",
        "columns": ["FactionId", "DisplayName", "TerritoryDistrict", "HostileTo", "Description"],
        "rows": [
            ["vault_pd", "Vault City Police Department", "FoundryHeights", "criminal",
             "The city's police. Original force, original livery, original radio chatter."],
            ["ironside_crew", "Ironside Crew", "IronsideDocks", "vault_pd;marbella_syndicate",
             "Dock workers who found that containers are easier to steal than to unload."],
            ["marbella_syndicate", "Marbella Syndicate", "MarbellaRow", "ironside_crew",
             "Tailored, patient, and the reason the luxury district has private security."],
            ["foundry_collective", "Foundry Collective", "FoundryHeights", "ironside_crew",
             "White-collar fixers who move money rather than crates."],
            ["ashfall_rangers", "Ashfall Rangers", "AshfallBasin", "none",
             "Volunteer search-and-rescue for the basin. They help anyone, once."],
            ["calder_port_authority", "Calder Port Authority", "CalderInternational", "none",
             "Harbour masters, pilots and the people who decide what gets inspected."],
        ],
    },
    "pedestrian_outfits": {
        "target": "Data/Characters/DT_PedestrianOutfits",
        "columns": ["OutfitId", "DistrictBias", "SkinToneIndex", "ShirtPaletteIndex",
                    "TrouserPaletteIndex", "HasHat", "HasBag"],
        "rows": [[f"civilian_{i:02d}", "", i % 7, (i * 3) % 11, (i * 5) % 5,
                  1 if i % 4 == 0 else 0, 1 if i % 3 == 0 else 0] for i in range(1, 25)]
               + [["dock_worker_01", "IronsideDocks", 2, 4, 2, 1, 0],
                  ["dock_worker_02", "IronsideDocks", 4, 4, 2, 1, 0],
                  ["shopper_01", "MarbellaRow", 1, 7, 1, 0, 1],
                  ["shopper_02", "MarbellaRow", 3, 9, 3, 0, 1],
                  ["office_01", "FoundryHeights", 0, 2, 0, 0, 1],
                  ["office_02", "FoundryHeights", 5, 2, 0, 0, 1],
                  ["clubber_01", "NeonMile", 2, 10, 1, 0, 0],
                  ["clubber_02", "NeonMile", 6, 10, 1, 0, 0],
                  ["farmer_01", "AshfallBasin", 3, 5, 4, 1, 0],
                  ["hiker_01", "GraniteRidge", 1, 8, 2, 1, 1],
                  ["police_uniform", "FoundryHeights", 2, 3, 0, 1, 0],
                  ["paramedic_uniform", "NeonMile", 0, 6, 0, 0, 1],
                  ["firefighter_gear", "IronsideDocks", 4, 1, 0, 1, 0]],
    },
}

# Content folders plus what each is for. The editor creates the folder on first
# asset save; we pre-create it and drop a README so nobody has to guess.
CONTENT_FOLDERS = {
    "Maps": "Levels. L_VaultCity_Slice is the Phase 1 vertical slice; "
            "L_VaultCity_Region is the full World Partition map; L_Loading is the "
            "loading screen map referenced by DefaultEngine.ini.",
    "Blueprints/Core": "BP_BCUGameMode, BP_BCUGameInstance, BP_BCUGameState, "
                       "BP_BCUPlayerController, BP_BCUPlayerCharacter, BP_BCUWorldSettings.",
    "Blueprints/Vehicles": "BP_BCUBaseVehicle plus one Blueprint per vehicle class "
                           "that binds a UBCUVehicleDefinition from DT_Vehicles.",
    "Blueprints/AI": "BP_BCUNPCCharacter, BP_BCUPedestrianAIController, "
                     "BT_PedestrianWander, BB_PedestrianWander.",
    "Blueprints/Police": "BP_BCUPoliceUnit, BT_PolicePursuit, BB_PolicePursuit.",
    "Blueprints/City": "BP_BCUCityStreamer, BP_BCUCellActor.",
    "Blueprints/Weather": "BP_BCUTimeOfDaySystem, BP_BCUWeatherSystem, "
                          "BP_SkyLight, BP_SunLight, BP_VolumetricCloud.",
    "Blueprints/UI": "WBP_HUD, WBP_Minimap, WBP_MapScreen, WBP_Phone, "
                     "WBP_Inventory, WBP_PauseMenu, WBP_LoadingScreen, "
                     "WBP_Toast, WBP_RespawnFade, WBP_Garage, WBP_Shop.",
    "Data/Vehicles": "DT_Vehicles and per-vehicle definition assets.",
    "Data/Districts": "DT_Districts and one UBCUDistrictDataAsset per row.",
    "Data/Missions": "DT_Missions and one UBCUMissionDefinition per row.",
    "Data/Economy": "DT_CustomisationCosts, DT_Properties, DT_ShopItems.",
    "Data/Dialogue": "DT_Dialogue. All dialogue is original writing.",
    "Data/Characters": "DT_PedestrianOutfits and the wardrobe presets.",
    "Data/World": "DT_Factions and the region layout.",
    "Data/Input": "IA_* input actions and IMC_OnFoot / IMC_Driving / IMC_UI / "
                  "IMC_Global mapping contexts.",
    "Materials": "M_VoxelSurface (the single layered material every generated "
                 "voxel mesh uses), M_VoxelMasked, M_VoxelEmissive, M_VehiclePaint, "
                 "M_VehicleGlass, MPC_Weather.",
    "VFX": "NS_Rain, NS_Snow, NS_TyreSmoke, NS_VehicleSmoke, NS_VehicleFire, "
           "NS_PuddleSplash, NS_Exhaust, NS_Lightning, NS_ImpactDebris.",
    "Audio/Music": "Original score stems: exploration, driving, night, tension, "
                   "pursuit, mission, menu. Nothing licensed from a real artist.",
    "Audio/SFX": "Engines, tyres, impacts, sirens, horns, UI, footsteps, weather.",
    "Audio/Radio": "Original radio stations and tracks (see 08_LEGAL_AND_ORIGINALITY).",
    "Audio/Dialogue": "Original voice recordings, one folder per speaker.",
    "Animations": "ABP_BCUPlayerCharacter, ABP_BCUNPC, AM_EnterVehicle, "
                  "AM_ExitVehicle, AM_SitDriver, AM_SitPassenger.",
    "Textures": "T_VoxelTileset (the material's tileable layer atlas), "
                "T_RoadMarkings, T_Decals, T_Signage, T_NoiseMasks.",
    "VoxelMaterialSet": "DA_VoxelMaterialSet: the 63-entry trait table plus the "
                        "FacadeAges and NeonSignage palettes.",
    "Cinematics": "LS_Slice_Intro, LS_Mission_Vault, LS_Arrest. All original.",
}

# Blueprint recipes: what to create, from which C++ class, with which properties.
BLUEPRINT_RECIPES = [
    ("Blueprints/Core/BP_BCUGameMode", "ABCUGameMode", {
        "DefaultPawnClass": "BP_BCUPlayerCharacter",
        "PlayerControllerClass": "BP_BCUPlayerController",
        "GameStateClass": "ABCUGameState",
        "PlayerStateClass": "ABCUPlayerState",
        "HUDClass": "ABCUPlayerHUD",
        "CashLostOnDeath": 250, "CashLostOnArrest": 400, "RespawnFadeSeconds": 1.6,
        "DefaultSpawnTag": "BCU.Spawn.PlayerHome", "DifficultyLevel": 1,
    }, "Set as the default GameMode Override in World Settings for every BCU map, "
       "and as GlobalDefaultGameMode in DefaultEngine.ini."),

    ("Blueprints/Core/BP_BCUPlayerController", "ABCUPlayerController", {
        "GlobalMappingContext": "IMC_Global (priority 100)",
        "UIMappingContext": "IMC_UI (priority 90)",
        "OnFootMappingContext": "IMC_OnFoot (priority 10)",
        "DrivingMappingContext": "IMC_Driving (priority 10)",
        "IA_Move": "Axis2D (W/S/A/D + left stick)",
        "IA_Look": "Axis2D (mouse XY + right stick)",
        "IA_Jump": "Digital (Space / B)", "IA_Sprint": "Digital (LShift / L3)",
        "IA_EnterVehicle": "Digital (F / X)", "IA_Interact": "Digital (E / B)",
        "IA_Throttle": "Axis1D (W / right trigger)", "IA_Steer": "Axis1D (A-D / left stick X)",
        "IA_Brake": "Axis1D (S / left trigger)", "IA_Handbrake": "Digital (Space / B)",
        "IA_ExitVehicle": "Digital (F / X)", "IA_Horn": "Digital (H / dpad up)",
        "IA_CameraMode": "Digital (C / RB)", "IA_LookBack": "Digital (Q / R3)",
        "IA_Map": "Digital (M / Select)", "IA_Phone": "Digital (Tab / dpad down)",
        "IA_Inventory": "Digital (I / dpad left)", "IA_Pause": "Digital (Esc / Start)",
    }, "All input is bound here, never on the pawn, so the on-foot / driving / UI "
       "context swap happens in exactly one place."),

    ("Blueprints/Core/BP_BCUPlayerCharacter", "ABCUPlayerCharacter", {
        "Mesh": "SKM_BCUProtagonist (optional — the voxel body is generated)",
        "AnimClass": "ABP_BCUPlayerCharacter",
        "WalkSpeed": 180, "JogSpeed": 420, "SprintSpeed": 660, "CrouchSpeed": 110,
        "StaminaDrainPerSecond": 0.16, "StaminaRegenPerSecond": 0.11,
    }, "The VoxelBody component builds the blocky body at BeginPlay; the skeletal "
       "mesh is optional and only needed if you want cloth or facial animation."),

    ("Blueprints/Vehicles/BP_BCUBaseVehicle", "ABCUBaseVehicle", {
        "Definition": "Assign per-instance from DT_Vehicles",
        "ThrottleSmoothing": 9.0, "BrakeSmoothing": 14.0, "SteerSmoothing": 12.0,
        "SafeExitSpeedKmh": 6.0,
    }, "Create one child Blueprint per vehicle class and set Definition to the "
       "matching DT_Vehicles row. The voxel body mesh is generated at BeginPlay."),

    ("Blueprints/City/BP_BCUCityStreamer", "ABCUCityStreamer", {
        "CellSizeCm": 25600, "VoxelScaleCm": 25, "LoadRadiusCells": 5,
        "UnloadRadiusCells": 7, "MaxCellsLoadedPerFrame": 2, "MaxConcurrentAsyncBuilds": 4,
        "HLODMergeDistanceCm": 230400, "bUseNaniteForClusters": True,
        "CitySeed": "Seed=20260710 Density=0.62 Verticality=0.70 Nature=0.35",
        "MaterialSet": "DA_VoxelMaterialSet",
        "Districts": "One DA per row of DT_Districts (10 districts)",
        "RegionExtentCells": "(96, 96)",
    }, "Place exactly one in each BCU map. It is bIsSpatiallyLoaded=false so World "
       "Partition never streams it out."),

    ("Blueprints/Police/BP_BCUPoliceUnit", "ABCUPoliceUnit", {},
     "Spawned by UBCUPoliceSubsystem; never place one by hand."),

    ("Blueprints/AI/BP_BCUNPCCharacter", "ABCUNPCCharacter", {
        "AIControllerClass": "BP_BCUPedestrianAIController",
        "AutoPossessAI": "Placed in World or Spawned",
    }, "Used for both the pedestrian crowd and named NPCs; the Role property "
       "selects the outfit, faction and interaction behaviour."),

    ("Blueprints/Weather/BP_BCUTimeOfDaySystem", "UBCUTimeOfDaySystem", {
        "DayLengthMinutes": 24.0, "StartHour": 8.5,
        "Latitude": 41.5, "Longitude": -87.9,
        "SunIntensityCurve": "CR_SunIntensity (optional)",
        "SunColorCurve": "CLC_SunColor (optional)",
    }, "A World Subsystem: it exists with no actor. Bind the sky actors with "
       "AutoBindSkyActors() or assign them explicitly."),

    ("Blueprints/UI/WBP_HUD", "UUserWidget", {
        "Bindings": "Health bar → ABCUPlayerHUD.GetHealthFraction, "
                    "Cash → GetCash, Wanted stars → GetWantedLevel, "
                    "Clock → GetClockText, District → GetDistrictText, "
                    "Objective → GetCurrentObjectiveText, "
                    "Speedo → GetSpeedKmh + GetCurrentGear, "
                    "Radio → GetRadioStationText, "
                    "Minimap → brush from ABCUPlayerHUD.MinimapTarget",
    }, "Every visual is UMG; every number comes from ABCUPlayerHUD. No game logic "
       "in the widget."),

    ("Blueprints/UI/WBP_LoadingScreen", "UUserWidget", {},
     "Path must be /Game/Blueprints/UI/WBP_LoadingScreen.WBP_LoadingScreen_C — "
     "that is the hard reference in UBCUGameInstance."),
]

# C++ console script the editor can run to create the input assets, which are
# the one thing that is genuinely tedious to click through by hand.
INPUT_SETUP_SCRIPT = '''"""
Run inside the Unreal editor: Tools > Execute Python Script.
Creates the Enhanced Input assets referenced by BP_BCUPlayerController.
"""
import unreal

ACTIONS = [
    ("IA_Move", "Axis2D (Vector2D)"), ("IA_Look", "Axis2D (Vector2D)"),
    ("IA_Jump", "Digital (bool)"), ("IA_Sprint", "Digital (bool)"),
    ("IA_EnterVehicle", "Digital (bool)"), ("IA_Interact", "Digital (bool)"),
    ("IA_Throttle", "Axis1D (float)"), ("IA_Steer", "Axis1D (float)"),
    ("IA_Brake", "Axis1D (float)"), ("IA_Handbrake", "Digital (bool)"),
    ("IA_ExitVehicle", "Digital (bool)"), ("IA_Horn", "Digital (bool)"),
    ("IA_CameraMode", "Digital (bool)"), ("IA_LookBack", "Digital (bool)"),
    ("IA_Map", "Digital (bool)"), ("IA_Phone", "Digital (bool)"),
    ("IA_Inventory", "Digital (bool)"), ("IA_Pause", "Digital (bool)"),
]

CONTEXTS = {
    "IMC_OnFoot": ["IA_Move", "IA_Look", "IA_Jump", "IA_Sprint", "IA_EnterVehicle", "IA_Interact"],
    "IMC_Driving": ["IA_Throttle", "IA_Steer", "IA_Brake", "IA_Handbrake",
                    "IA_ExitVehicle", "IA_Horn", "IA_CameraMode", "IA_LookBack"],
    "IMC_UI": ["IA_Map", "IA_Phone", "IA_Inventory", "IA_Pause"],
    "IMC_Global": ["IA_Pause", "IA_Interact"],
}

factory = unreal.AssetToolsHelpers.get_asset_tools()
for name, _ in ACTIONS:
    path = f"/Game/Data/Input/{name}"
    if not unreal.EditorAssetLibrary.does_asset_exist(path):
        factory.create_asset(name, "/Game/Data/Input",
                             unreal.InputAction, unreal.InputActionFactory())

for ctx, actions in CONTEXTS.items():
    path = f"/Game/Data/Input/{ctx}"
    if not unreal.EditorAssetLibrary.does_asset_exist(path):
        imc = factory.create_asset(ctx, "/Game/Data/Input",
                                   unreal.InputMappingContext,
                                   unreal.InputMappingContextFactory())
        for action in actions:
            mapping = unreal.EnhancedActionKeyMapping()
            mapping.action = unreal.EditorAssetLibrary.load_asset(f"/Game/Data/Input/{action}")
            imc.get_editor_property("mappings").append(mapping)

unreal.log("BLOCK CITY ULTRA: input assets created.")
'''


def sha1_of(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()[:12]


def write_if_missing(path: Path, content: str, force: bool, quiet: bool) -> bool:
    """Writes `content` unless the file exists and --force was not passed."""
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists() and not force:
        existing = path.read_text(encoding="utf-8", errors="replace")
        if existing.strip() == content.strip():
            return False
        if not quiet:
            print(f"  skip  {path.relative_to(PROJECT_DIR)} (exists; use --force to overwrite)")
        return False

    path.write_text(content, encoding="utf-8", newline="\n")
    if not quiet:
        print(f"  write {path.relative_to(PROJECT_DIR)}")
    return True


def write_csv(name: str, spec: dict, columns: list[str], rows: list[list], quiet: bool) -> int:
    """Writes a UE-importable CSV and the .json sidecar the importer needs."""
    target = CONTENT_DIR / f"{spec['target']}.csv"
    target.parent.mkdir(parents=True, exist_ok=True)

    lines = [",".join(columns)]
    for row in rows:
        lines.append(",".join(_csv_escape(str(cell)) for cell in row))
    content = "\n".join(lines) + "\n"

    wrote = write_if_missing(target, content, ARGS.force, quiet)

    # Sidecar telling the editor which row struct to use on import.
    sidecar = target.with_suffix(".import.json")
    sidecar_content = (
        "{\n"
        f'    "ImportType": "DataTable",\n'
        f'    "RowStruct": "/Script/BlockCityUltra.{spec["row_struct"]}",\n'
        f'    "TargetAsset": "/Game/{spec["target"]}",\n'
        f'    "Note": "{_json_escape(spec["note"])}"\n'
        "}\n"
    ) if "row_struct" in spec else (
        "{\n"
        f'    "ImportType": "DataTable",\n'
        f'    "TargetAsset": "/Game/{spec["target"]}",\n'
        f'    "Note": "Row struct is a Blueprint struct created from the CSV header."\n'
        "}\n"
    )
    wrote |= write_if_missing(sidecar, sidecar_content, ARGS.force, quiet)
    return 1 if wrote else 0


def _csv_escape(value: str) -> str:
    if any(ch in value for ch in (",", '"', "\n")):
        return '"' + value.replace('"', '""') + '"'
    return value


def _json_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def load_csv(name: str) -> tuple[list[str], list[list[str]]]:
    path = DATA_DIR / f"{name}.csv"
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        columns = next(reader)
        rows = [row for row in reader if any(cell.strip() for cell in row)]
    return columns, rows


def scaffold_folders(quiet: bool) -> int:
    written = 0
    for folder, description in CONTENT_FOLDERS.items():
        target = CONTENT_DIR / folder
        target.mkdir(parents=True, exist_ok=True)
        readme = target / "_README.md"
        content = (
            f"# Content/{folder}\n\n{description}\n\n"
            "Assets in this folder are generated or authored in the Unreal Editor.\n"
            "Nothing here is copied from any existing game; see "
            "Docs/08_LEGAL_AND_ORIGINALITY.md.\n"
        )
        written += 1 if write_if_missing(readme, content, ARGS.force, quiet) else 0
    return written


def scaffold_recipes(quiet: bool) -> int:
    written = 0
    lines = [
        "# Blueprint recipes",
        "",
        "Each entry below is one Blueprint to create in the editor: the asset path,",
        "the C++ parent class, and the property values to set. Nothing here needs",
        "guesswork — the values match the defaults the C++ expects.",
        "",
    ]

    for path, parent, properties, note in BLUEPRINT_RECIPES:
        lines += [f"## `/Game/{path}`", "", f"- **Parent class:** `{parent}`"]
        if properties:
            lines.append("- **Properties:**")
            for key, value in properties.items():
                lines.append(f"    - `{key}` = `{value}`")
        if note:
            lines += ["", f"> {note}"]
        lines.append("")

    content = "\n".join(lines)
    written += 1 if write_if_missing(
        CONTENT_DIR / "Blueprints" / "_RECIPES.md", content, ARGS.force, quiet) else 0

    # The editor-runnable input setup script.
    written += 1 if write_if_missing(
        SCRIPT_DIR / "setup_input_assets.py", INPUT_SETUP_SCRIPT, ARGS.force, quiet) else 0

    return written


def scaffold_voxel_material_set(quiet: bool) -> int:
    """Writes the 63-entry material trait table as a CSV the editor imports."""
    traits = [
        ("Concrete", "0.62;0.61;0.58", 0.86, 0.00, 0.0, 1.10, 1),
        ("ConcreteDirty", "0.47;0.45;0.41", 0.92, 0.00, 0.0, 1.20, 1),
        ("BrickRed", "0.46;0.21;0.17", 0.82, 0.00, 0.0, 1.00, 1),
        ("BrickBrown", "0.38;0.27;0.20", 0.84, 0.00, 0.0, 1.00, 1),
        ("Sandstone", "0.76;0.67;0.51", 0.80, 0.00, 0.0, 0.90, 1),
        ("Stone", "0.50;0.50;0.51", 0.85, 0.00, 0.0, 1.00, 1),
        ("Granite", "0.34;0.34;0.36", 0.55, 0.02, 0.0, 0.70, 1),
        ("Marble", "0.88;0.87;0.84", 0.22, 0.00, 0.0, 0.40, 1),
        ("Steel", "0.44;0.46;0.48", 0.38, 0.92, 0.0, 0.60, 1),
        ("SteelRusted", "0.36;0.22;0.14", 0.78, 0.62, 0.0, 1.10, 1),
        ("Aluminium", "0.72;0.73;0.74", 0.30, 0.95, 0.0, 0.50, 1),
        ("Chrome", "0.90;0.91;0.92", 0.08, 1.00, 0.0, 0.30, 1),
        ("Copper", "0.63;0.36;0.22", 0.34, 0.95, 0.0, 0.70, 1),
        ("Corrugated", "0.52;0.53;0.54", 0.55, 0.88, 0.0, 0.80, 1),
        ("GlassClear", "0.82;0.90;0.95", 0.05, 0.00, 0.0, 0.20, 0),
        ("GlassTinted", "0.20;0.26;0.30", 0.08, 0.10, 0.0, 0.20, 0),
        ("GlassReflective", "0.42;0.55;0.62", 0.04, 0.35, 0.0, 0.15, 0),
        ("WindowLit", "1.00;0.94;0.78", 0.20, 0.00, 8.0, 0.10, 0),
        ("WindowLitWarm", "1.00;0.82;0.55", 0.20, 0.00, 12.0, 0.10, 0),
        ("WindowLitCool", "0.72;0.86;1.00", 0.20, 0.00, 9.0, 0.10, 0),
        ("NeonPink", "1.00;0.20;0.62", 0.30, 0.00, 45.0, 0.10, 0),
        ("NeonCyan", "0.20;0.95;1.00", 0.30, 0.00, 45.0, 0.10, 0),
        ("NeonAmber", "1.00;0.68;0.18", 0.30, 0.00, 40.0, 0.10, 0),
        ("NeonWhite", "1.00;1.00;1.00", 0.30, 0.00, 38.0, 0.10, 0),
        ("LightFixture", "1.00;0.98;0.90", 0.25, 0.00, 60.0, 0.10, 1),
        ("Asphalt", "0.11;0.11;0.12", 0.90, 0.00, 0.0, 1.40, 1),
        ("AsphaltWorn", "0.18;0.17;0.17", 0.94, 0.00, 0.0, 1.30, 1),
        ("ConcretePaving", "0.56;0.55;0.53", 0.88, 0.00, 0.0, 1.10, 1),
        ("TactilePaving", "0.72;0.60;0.20", 0.80, 0.00, 0.0, 1.00, 1),
        ("RoadLineWhite", "0.86;0.86;0.84", 0.70, 0.00, 0.0, 0.90, 1),
        ("RoadLineYellow", "0.88;0.70;0.14", 0.70, 0.00, 0.0, 0.90, 1),
        ("Crosswalk", "0.84;0.84;0.82", 0.72, 0.00, 0.0, 0.90, 1),
        ("ManholeCover", "0.24;0.24;0.25", 0.55, 0.85, 0.0, 0.80, 1),
        ("KerbStone", "0.60;0.59;0.57", 0.86, 0.00, 0.0, 1.00, 1),
        ("Gravel", "0.42;0.40;0.38", 0.95, 0.00, 0.0, 0.60, 1),
        ("RailTrack", "0.40;0.38;0.35", 0.42, 0.90, 0.0, 0.70, 1),
        ("RubberMat", "0.08;0.08;0.09", 0.97, 0.00, 0.0, 0.50, 1),
        ("Grass", "0.22;0.42;0.18", 0.92, 0.00, 0.0, 0.90, 1),
        ("GrassDry", "0.52;0.46;0.24", 0.94, 0.00, 0.0, 0.80, 1),
        ("Dirt", "0.28;0.21;0.15", 0.95, 0.00, 0.0, 1.10, 1),
        ("Mud", "0.19;0.15;0.11", 0.70, 0.00, 0.0, 1.50, 1),
        ("Sand", "0.80;0.72;0.55", 0.96, 0.00, 0.0, 0.70, 1),
        ("Rock", "0.36;0.35;0.34", 0.90, 0.00, 0.0, 0.80, 1),
        ("Snow", "0.92;0.94;0.97", 0.60, 0.00, 0.0, 0.30, 1),
        ("Ice", "0.78;0.88;0.95", 0.10, 0.00, 0.0, 0.10, 0),
        ("Water", "0.06;0.22;0.32", 0.02, 0.00, 0.0, 0.00, 0),
        ("TreeTrunk", "0.26;0.18;0.12", 0.92, 0.00, 0.0, 1.00, 1),
        ("LeavesGreen", "0.18;0.38;0.16", 0.88, 0.00, 0.0, 0.70, 0),
        ("LeavesAutumn", "0.66;0.36;0.12", 0.88, 0.00, 0.0, 0.70, 0),
        ("LeavesPine", "0.11;0.26;0.16", 0.90, 0.00, 0.0, 0.70, 0),
        ("Flowers", "0.78;0.32;0.48", 0.86, 0.00, 0.0, 0.80, 0),
        ("PlasterWhite", "0.86;0.85;0.82", 0.90, 0.00, 0.0, 0.90, 1),
        ("WoodOak", "0.52;0.36;0.21", 0.68, 0.00, 0.0, 1.00, 1),
        ("WoodDark", "0.24;0.16;0.10", 0.66, 0.00, 0.0, 1.00, 1),
        ("Tile", "0.82;0.84;0.85", 0.18, 0.00, 0.0, 0.30, 1),
        ("Carpet", "0.34;0.20;0.22", 0.98, 0.00, 0.0, 1.20, 1),
        ("Fabric", "0.40;0.42;0.48", 0.94, 0.00, 0.0, 1.10, 1),
        ("PaintedRed", "0.62;0.12;0.12", 0.62, 0.00, 0.0, 1.00, 1),
        ("PaintedBlue", "0.12;0.26;0.58", 0.62, 0.00, 0.0, 1.00, 1),
        ("PaintedYellow", "0.86;0.72;0.16", 0.62, 0.00, 0.0, 1.00, 1),
        ("PaintedGreen", "0.14;0.44;0.22", 0.62, 0.00, 0.0, 1.00, 1),
        ("PaintedGrey", "0.40;0.40;0.41", 0.66, 0.00, 0.0, 1.00, 1),
        ("PaintedWhite", "0.88;0.88;0.87", 0.60, 0.00, 0.0, 1.00, 1),
    ]

    columns = ["Material", "BaseColor", "Roughness", "Metallic",
               "EmissiveIntensity", "WetnessResponse", "bNaniteCompatible"]
    rows = [[t[0], t[1], f"{t[2]:.2f}", f"{t[3]:.2f}", f"{t[4]:.1f}",
             f"{t[5]:.2f}", t[6]] for t in traits]

    spec = {
        "target": "VoxelMaterialSet/DT_VoxelMaterialTraits",
        "note": "The 63-entry trait table used by UBCUVoxelMaterialSet. Matches the "
                "built-in fallback in BCUVoxelTypes.cpp exactly, so the project runs "
                "with or without the imported asset. NaniteCompatible=0 means the "
                "material goes to the masked or translucent mesh section instead of "
                "the Nanite cluster.",
    }
    return write_csv("voxel_traits", spec, columns, rows, quiet)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true",
                        help="overwrite existing generated files")
    parser.add_argument("--quiet", action="store_true", help="only print a summary")
    global ARGS
    ARGS = parser.parse_args()

    print("BLOCK CITY ULTRA — content scaffolder")
    print(f"  project: {PROJECT_DIR}")
    print(f"  content: {CONTENT_DIR}")
    print()

    written = 0

    # 1. Folder layout + per-folder READMEs.
    print("[1/5] Content folders")
    written += scaffold_folders(ARGS.quiet)

    # 2. Data tables from Tools/data/*.csv.
    print("[2/5] Data tables (from Tools/data)")
    for name, spec in TABLE_SPECS.items():
        columns, rows = load_csv(name)
        written += write_csv(name, spec, columns, rows, ARGS.quiet)

    # 3. Inline data tables.
    print("[3/5] Data tables (inline)")
    for name, spec in INLINE_TABLES.items():
        written += write_csv(name, spec, spec["columns"], spec["rows"], ARGS.quiet)

    # 4. Voxel material traits.
    print("[4/5] Voxel material set")
    written += scaffold_voxel_material_set(ARGS.quiet)

    # 5. Blueprint recipes + input setup script.
    print("[5/5] Blueprint recipes")
    written += scaffold_recipes(ARGS.quiet)

    # Manifest so the editor (or CI) can tell whether content is stale.
    manifest = {
        "generated_by": "Tools/scaffold_content.py",
        "source_hashes": {
            p.name: sha1_of(p) for p in sorted(DATA_DIR.glob("*.csv"))
        },
    }
    manifest_lines = ["# Content manifest — do not edit by hand.",
                      "#",
                      "# Generated by Tools/scaffold_content.py. The hashes below let CI",
                      "# detect a stale Content/ folder after a data-table edit.", ""]
    manifest_lines += [f"{k}={v}" for k, v in manifest["source_hashes"].items()]
    write_if_missing(CONTENT_DIR / "_MANIFEST.txt", "\n".join(manifest_lines) + "\n",
                     ARGS.force, ARGS.quiet)

    print()
    print(f"Done. {written} file(s) written or updated.")
    print("Next: open BlockCityUltra.uproject, then import each Content/**/*.csv")
    print("      as a DataTable using its matching .import.json sidecar.")
    return 0


ARGS = None

if __name__ == "__main__":
    sys.exit(main())
