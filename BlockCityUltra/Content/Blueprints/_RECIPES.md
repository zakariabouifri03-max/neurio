# Blueprint recipes

Each entry below is one Blueprint to create in the editor: the asset path,
the C++ parent class, and the property values to set. Nothing here needs
guesswork — the values match the defaults the C++ expects.

## `/Game/Blueprints/Core/BP_BCUGameMode`

- **Parent class:** `ABCUGameMode`
- **Properties:**
    - `DefaultPawnClass` = `BP_BCUPlayerCharacter`
    - `PlayerControllerClass` = `BP_BCUPlayerController`
    - `GameStateClass` = `ABCUGameState`
    - `PlayerStateClass` = `ABCUPlayerState`
    - `HUDClass` = `ABCUPlayerHUD`
    - `CashLostOnDeath` = `250`
    - `CashLostOnArrest` = `400`
    - `RespawnFadeSeconds` = `1.6`
    - `DefaultSpawnTag` = `BCU.Spawn.PlayerHome`
    - `DifficultyLevel` = `1`

> Set as the default GameMode Override in World Settings for every BCU map, and as GlobalDefaultGameMode in DefaultEngine.ini.

## `/Game/Blueprints/Core/BP_BCUPlayerController`

- **Parent class:** `ABCUPlayerController`
- **Properties:**
    - `GlobalMappingContext` = `IMC_Global (priority 100)`
    - `UIMappingContext` = `IMC_UI (priority 90)`
    - `OnFootMappingContext` = `IMC_OnFoot (priority 10)`
    - `DrivingMappingContext` = `IMC_Driving (priority 10)`
    - `IA_Move` = `Axis2D (W/S/A/D + left stick)`
    - `IA_Look` = `Axis2D (mouse XY + right stick)`
    - `IA_Jump` = `Digital (Space / B)`
    - `IA_Sprint` = `Digital (LShift / L3)`
    - `IA_EnterVehicle` = `Digital (F / X)`
    - `IA_Interact` = `Digital (E / B)`
    - `IA_Throttle` = `Axis1D (W / right trigger)`
    - `IA_Steer` = `Axis1D (A-D / left stick X)`
    - `IA_Brake` = `Axis1D (S / left trigger)`
    - `IA_Handbrake` = `Digital (Space / B)`
    - `IA_ExitVehicle` = `Digital (F / X)`
    - `IA_Horn` = `Digital (H / dpad up)`
    - `IA_CameraMode` = `Digital (C / RB)`
    - `IA_LookBack` = `Digital (Q / R3)`
    - `IA_Map` = `Digital (M / Select)`
    - `IA_Phone` = `Digital (Tab / dpad down)`
    - `IA_Inventory` = `Digital (I / dpad left)`
    - `IA_Pause` = `Digital (Esc / Start)`

> All input is bound here, never on the pawn, so the on-foot / driving / UI context swap happens in exactly one place.

## `/Game/Blueprints/Core/BP_BCUPlayerCharacter`

- **Parent class:** `ABCUPlayerCharacter`
- **Properties:**
    - `Mesh` = `SKM_BCUProtagonist (optional — the voxel body is generated)`
    - `AnimClass` = `ABP_BCUPlayerCharacter`
    - `WalkSpeed` = `180`
    - `JogSpeed` = `420`
    - `SprintSpeed` = `660`
    - `CrouchSpeed` = `110`
    - `StaminaDrainPerSecond` = `0.16`
    - `StaminaRegenPerSecond` = `0.11`

> The VoxelBody component builds the blocky body at BeginPlay; the skeletal mesh is optional and only needed if you want cloth or facial animation.

## `/Game/Blueprints/Vehicles/BP_BCUBaseVehicle`

- **Parent class:** `ABCUBaseVehicle`
- **Properties:**
    - `Definition` = `Assign per-instance from DT_Vehicles`
    - `ThrottleSmoothing` = `9.0`
    - `BrakeSmoothing` = `14.0`
    - `SteerSmoothing` = `12.0`
    - `SafeExitSpeedKmh` = `6.0`

> Create one child Blueprint per vehicle class and set Definition to the matching DT_Vehicles row. The voxel body mesh is generated at BeginPlay.

## `/Game/Blueprints/City/BP_BCUCityStreamer`

- **Parent class:** `ABCUCityStreamer`
- **Properties:**
    - `CellSizeCm` = `25600`
    - `VoxelScaleCm` = `25`
    - `LoadRadiusCells` = `5`
    - `UnloadRadiusCells` = `7`
    - `MaxCellsLoadedPerFrame` = `2`
    - `MaxConcurrentAsyncBuilds` = `4`
    - `HLODMergeDistanceCm` = `230400`
    - `bUseNaniteForClusters` = `True`
    - `CitySeed` = `Seed=20260710 Density=0.62 Verticality=0.70 Nature=0.35`
    - `MaterialSet` = `DA_VoxelMaterialSet`
    - `Districts` = `One DA per row of DT_Districts (10 districts)`
    - `RegionExtentCells` = `(96, 96)`

> Place exactly one in each BCU map. It is bIsSpatiallyLoaded=false so World Partition never streams it out.

## `/Game/Blueprints/Police/BP_BCUPoliceUnit`

- **Parent class:** `ABCUPoliceUnit`

> Spawned by UBCUPoliceSubsystem; never place one by hand.

## `/Game/Blueprints/AI/BP_BCUNPCCharacter`

- **Parent class:** `ABCUNPCCharacter`
- **Properties:**
    - `AIControllerClass` = `BP_BCUPedestrianAIController`
    - `AutoPossessAI` = `Placed in World or Spawned`

> Used for both the pedestrian crowd and named NPCs; the Role property selects the outfit, faction and interaction behaviour.

## `/Game/Blueprints/Weather/BP_BCUTimeOfDaySystem`

- **Parent class:** `UBCUTimeOfDaySystem`
- **Properties:**
    - `DayLengthMinutes` = `24.0`
    - `StartHour` = `8.5`
    - `Latitude` = `41.5`
    - `Longitude` = `-87.9`
    - `SunIntensityCurve` = `CR_SunIntensity (optional)`
    - `SunColorCurve` = `CLC_SunColor (optional)`

> A World Subsystem: it exists with no actor. Bind the sky actors with AutoBindSkyActors() or assign them explicitly.

## `/Game/Blueprints/UI/WBP_HUD`

- **Parent class:** `UUserWidget`
- **Properties:**
    - `Bindings` = `Health bar → ABCUPlayerHUD.GetHealthFraction, Cash → GetCash, Wanted stars → GetWantedLevel, Clock → GetClockText, District → GetDistrictText, Objective → GetCurrentObjectiveText, Speedo → GetSpeedKmh + GetCurrentGear, Radio → GetRadioStationText, Minimap → brush from ABCUPlayerHUD.MinimapTarget`

> Every visual is UMG; every number comes from ABCUPlayerHUD. No game logic in the widget.

## `/Game/Blueprints/UI/WBP_LoadingScreen`

- **Parent class:** `UUserWidget`

> Path must be /Game/Blueprints/UI/WBP_LoadingScreen.WBP_LoadingScreen_C — that is the hard reference in UBCUGameInstance.
