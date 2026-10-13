class_name BuildingService
extends Node3D
## Voxel building: block placement, piece shapes, materials and the block budget.
##
## Modes come from the match settings (`MatchState`): LIMITED uses the player's
## block inventory and a per-player cap (Battle Royale), FREE is unlimited
## (Training Ground, custom rooms with building on) and DISABLED removes the
## ability entirely.  Pieces are placed as real world blocks, so they are solid
## immediately, get saved into the world override map, and can be shot through
## only where they actually have holes.

signal placed(coord: Vector3i, block: int)
signal removed(coord: Vector3i, block: int)
signal blocked(reason: String)
signal piece_changed(piece: int, block: int)

enum Mode { DISABLED, LIMITED, FREE }
enum Piece { SINGLE, WALL, FLOOR, STAIRS }

const REACH := 6.0
const MIN_PLACE_DISTANCE := 0.9

## Materials available to builders, cheapest first.
const MATERIALS: Array = [
	{"name": "Wood", "block": VoxelLibrary.Block.PLANKS},
	{"name": "Brick", "block": VoxelLibrary.Block.BRICK},
	{"name": "Concrete", "block": VoxelLibrary.Block.CONCRETE},
	{"name": "Metal", "block": VoxelLibrary.Block.METAL},
]

var world: VoxelWorld = null
var player: PlayerController = null
var mode: int = Mode.DISABLED
var piece: int = Piece.WALL
var material_index: int = 0
var placed_blocks: int = 0
var max_blocks: int = 0            ## 0 = unlimited within the mode
var build_enabled: bool = true

var _cooldown: float = 0.0
var _hold_timer: float = 0.0
var _last_placed: Vector3i = Vector3i(0, 0, 0)
var _has_last: bool = false

func setup(voxel_world: VoxelWorld, owner_player: PlayerController) -> void:
	world = voxel_world
	player = owner_player

## Reads the match's building rules.  Call once per match (and on rule changes).
func apply_match_rules() -> void:
	var settings: Dictionary = MatchState.get_value("building", {})
	var allowed := bool(settings.get("allowed", false))
	var block_limit := int(settings.get("max_blocks_per_player", 0))
	var source := str(settings.get("mode", "limited"))
	build_enabled = allowed
	max_blocks = block_limit
	if not allowed or source == "disabled":
		mode = Mode.DISABLED
	elif source == "free" or block_limit <= 0:
		mode = Mode.FREE
	else:
		mode = Mode.LIMITED
	placed_blocks = 0
	piece_changed.emit(piece, current_block())

func is_enabled() -> bool:
	return mode != Mode.DISABLED and build_enabled

func current_material() -> Dictionary:
	return MATERIALS[clampi(material_index, 0, MATERIALS.size() - 1)]

func current_block() -> int:
	return int(current_material()["block"])

func current_material_name() -> String:
	return str(current_material()["name"])

func cycle_material() -> void:
	material_index = (material_index + 1) % MATERIALS.size()
	piece_changed.emit(piece, current_block())

func set_material(index: int) -> void:
	material_index = clampi(index, 0, MATERIALS.size() - 1)
	piece_changed.emit(piece, current_block())

func cycle_piece() -> void:
	piece = (piece + 1) % Piece.size()
	piece_changed.emit(piece, current_block())

func set_piece(value: int) -> void:
	piece = clampi(value, 0, Piece.size() - 1)
	piece_changed.emit(piece, current_block())

func blocks_available() -> int:
	if mode == Mode.FREE:
		return 999
	if player == null or player.inventory == null:
		return 0
	return player.inventory.build_blocks

func can_build_now() -> bool:
	if not is_enabled() or player == null or not player.alive or _cooldown > 0.0:
		return false
	if blocks_available() <= 0:
		return false
	if max_blocks > 0 and placed_blocks >= max_blocks:
		return false
	return true

## Attempts to place the current piece at the aimed face.  Returns the result.
func try_place() -> GameResult:
	if not is_enabled():
		blocked.emit("Building is disabled in this mode")
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, "building is disabled")
	if player == null or not player.alive:
		return GameResult.fail(GameResult.Code.INVALID, "player cannot build")
	if _cooldown > 0.0:
		return GameResult.fail(GameResult.Code.NOT_READY, "cooling down")
	if mode == Mode.LIMITED and blocks_available() <= 0:
		blocked.emit("Out of building blocks")
		return GameResult.fail(GameResult.Code.NOT_ENOUGH_FUNDS, "no blocks left")
	if max_blocks > 0 and placed_blocks >= max_blocks:
		blocked.emit("Build limit reached (%d)" % max_blocks)
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, "build limit reached")
	var aim := player.aim_direction()
	var anchor := player.muzzle_origin()
	var target := world.placement_cell(anchor, aim, REACH)
	if target.is_empty():
		blocked.emit("Nothing to build against")
		return GameResult.fail(GameResult.Code.INVALID, "no target surface")
	var origin: Vector3i = target["coord"]
	if not _footprint_clear(origin):
		blocked.emit("Something is in the way")
		return GameResult.fail(GameResult.Code.INVALID, "space is occupied")
	var cells := _piece_cells(origin)
	var affordable := cells.size() if mode == Mode.FREE else mini(cells.size(), blocks_available())
	var placed := 0
	for i: int in affordable:
		var coord: Vector3i = cells[i]
		if not _footprint_clear(coord):
			continue
		if _overlaps_player(coord):
			continue
		if not world.set_block(coord.x, coord.y, coord.z, current_block(), true):
			continue
		placed += 1
		placed_blocks += 1
		_last_placed = coord
		_has_last = true
		_emit_placed(coord)
	if placed == 0:
		blocked.emit("Cannot place here")
		return GameResult.fail(GameResult.Code.INVALID, "nothing placed")
	if mode == Mode.LIMITED:
		player.inventory.remove("build_block", placed)
	_cooldown = 0.18
	AudioDirector.play_sfx("impact_wood", player.global_position, -8.0)
	return GameResult.ok({"placed": placed})

## Removes the aimed block, returning it to the builder when in LIMITED mode.
func try_remove() -> GameResult:
	if not is_enabled():
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, "building is disabled")
	if player == null or not player.alive:
		return GameResult.fail(GameResult.Code.INVALID, "player cannot build")
	var anchor := player.muzzle_origin()
	var hit := world.raycast_voxel(anchor, player.aim_direction(), REACH)
	if not bool(hit.get("hit", false)):
		return GameResult.fail(GameResult.Code.INVALID, "nothing to remove")
	var coord: Vector3i = hit.get("coord", Vector3i.ZERO)
	if _is_terrain_protected(coord):
		blocked.emit("This block cannot be removed")
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, "protected block")
	var block := world.get_block(coord.x, coord.y, coord.z)
	if block == VoxelLibrary.Block.AIR:
		return GameResult.fail(GameResult.Code.INVALID, "already empty")
	if not world.set_block(coord.x, coord.y, coord.z, VoxelLibrary.Block.AIR, true):
		return GameResult.fail(GameResult.Code.INVALID, "cannot remove")
	if mode == Mode.LIMITED:
		player.inventory.add("build_block", 1)
		placed_blocks = maxi(0, placed_blocks - 1)
	AudioDirector.play_sfx("impact_stone", player.global_position, -8.0)
	removed.emit(coord, block)
	return GameResult.ok({"coord": coord, "block": block})

## Hold-to-build: keeps placing pieces at a steady rhythm while the button is held.
func tick_hold(delta: float, held: bool) -> void:
	_cooldown = maxf(0.0, _cooldown - delta)
	if not held or not is_enabled():
		_hold_timer = 0.0
		return
	_hold_timer += delta
	if _hold_timer >= 0.22 and _cooldown <= 0.0:
		_hold_timer = 0.0
		try_place()

func _piece_cells(origin: Vector3i) -> Array:
	var cells: Array = []
	match piece:
		Piece.SINGLE:
			cells.append(origin)
		Piece.WALL:
			for i: int in 3:
				cells.append(origin + Vector3i(0, i, 0))
		Piece.FLOOR:
			for dx: int in 3:
				for dz: int in 3:
					cells.append(origin + Vector3i(dx - 1, 0, dz - 1))
		Piece.STAIRS:
			for i: int in 3:
				cells.append(origin + Vector3i(i, i, 0))
	return cells

func _footprint_clear(coord: Vector3i) -> bool:
	if coord.y < 0 or coord.y >= VoxelChunk.HEIGHT:
		return false
	var existing := world.get_block(coord.x, coord.y, coord.z)
	return existing == VoxelLibrary.Block.AIR or existing == VoxelLibrary.Block.WATER

## Keeps builders from sealing themselves inside a block.
func _overlaps_player(coord: Vector3i) -> bool:
	if player == null:
		return false
	var feet := player.global_position
	var head := feet + Vector3(0, 1.8, 0)
	var min_x := minf(feet.x, head.x) - 0.35
	var max_x := maxf(feet.x, head.x) + 0.35
	var min_z := feet.z - 0.35
	var max_z := feet.z + 0.35
	var min_y := feet.y
	var max_y := head.y
	return coord.x + 1.0 > min_x and float(coord.x) < max_x \
		and coord.z + 1.0 > min_z and float(coord.z) < max_z \
		and coord.y + 1.0 > min_y and float(coord.y) < max_y

## Terrain (the map's own blocks) is protected in limited modes: only player-placed
## blocks are removable there, which keeps maps intact.
func _is_terrain_protected(coord: Vector3i) -> bool:
	if mode == Mode.FREE:
		return false
	return not world.is_player_edit(coord)

func _emit_placed(coord: Vector3i) -> void:
	placed.emit(coord, current_block())

func stats() -> Dictionary:
	return {"mode": mode, "piece": piece, "material": current_material_name(),
			"available": blocks_available(), "placed": placed_blocks, "limit": max_blocks}
