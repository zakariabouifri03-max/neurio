class_name Players
extends RefCounted
## Factory that assembles a fully wired PlayerController.
##
## Building a player means body + collider + camera rig + animation rig + weapons
## + inventory + interaction + building, in that exact order.  Keeping it in one
## place means humans, bots and (later) remote proxies are constructed the same
## way - nothing behaves differently just because a bot owns it.

## Creates a player wired into `world`.  `is_local_player` must be set before the
## node enters the tree because the camera rig is only built for the local player.
static func spawn_player(parent: Node3D, world: VoxelWorld, player_id: String,
						 display_name: String, team: int, spawn_point: Vector3,
						 is_local_player: bool) -> PlayerController:
	var player := PlayerController.new()
	player.name = "Player_" + (player_id if not player_id.is_empty() else "unknown")
	player.player_id = player_id
	player.display_name = display_name
	player.team = team
	player.is_local = is_local_player
	parent.add_child(player)
	player.setup(world, is_local_player, Inventory.loadout())
	player.animator.set_display_name(display_name)
	player.attach_weapons(ContentDB.section("weapons").get("default_loadout", {}),
		GameConfig.team_color(team))
	player.spawn_at(spawn_point)
	ensure_components(player)
	return player

## Guarantees the standard helper components exist on a player (idempotent).
static func ensure_components(player: PlayerController) -> void:
	if player == null:
		return
	if player.interaction == null:
		var interaction := InteractionComponent.new()
		interaction.name = "Interaction"
		player.add_child(interaction)
		player.interaction = interaction
	if player.building == null:
		var building := BuildingService.new()
		building.name = "BuildingService"
		player.add_child(building)
		building.setup(player.world(), player)
		player.building = building
		building.apply_match_rules()

## Applies the account's equipped cosmetics to a player's character rig.
static func apply_equipped_cosmetics(player: PlayerController) -> void:
	if player == null or player.animator == null:
		return
	player.animator.apply_cosmetics(Inventory.loadout())

## A cheap random-but-stable cosmetic set for bots so they do not all look alike.
static func bot_cosmetics(bot_index: int) -> Dictionary:
	var owned: Array = Inventory.owned_items()
	var palette := {}
	var slots: Array = ["skin", "headwear", "mask", "backpack"]
	for slot: String in slots:
		var options: Array = []
		for item_id: String in owned:
			var item := ContentDB.shop_item(item_id)
			if str(item.get("slot", "")) == slot:
				options.append(item_id)
		if options.is_empty():
			continue
		palette[slot] = options[bot_index % options.size()]
	return palette
