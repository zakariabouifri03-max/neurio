"""
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
