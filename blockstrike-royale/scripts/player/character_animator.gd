class_name CharacterAnimator
extends Node3D
## Procedural voxel character animation.
##
## The character is a rig of cubes (head, torso, two arms, two legs) with
## attachment points for backpack, weapon and hat.  Poses are driven from a state
## machine with damped blending, which gives readable silhouettes without any
## imported animation clips (keeping the build small and the style consistent).

enum State { IDLE, WALK, RUN, CROUCH_IDLE, CROUCH_WALK, JUMP, FALL, LAND, SHOOT, RELOAD,
				MELEE, DOWNED, EMOTE, VICTORY }

const STATE_BLEND := 10.0
const WALK_CYCLE := 2.2
const RUN_CYCLE := 3.0

var state: State = State.IDLE
var aim_pitch: float = 0.0
var move_speed_ratio: float = 0.0
var is_aiming: bool = false
var team_color: Color = Color(0.35, 0.72, 1.0)
var palette: Dictionary = {"head": "#c98f5f", "torso": "#4a7a4a", "arms": "#4a7a4a",
						   "legs": "#37506b", "boots": "#2b2f36"}

var _cycle: float = 0.0
var _blend: float = 0.0
var _land_timer: float = 0.0
var _reload_timer: float = 0.0
var _melee_timer: float = 0.0
var _shoot_kick: float = 0.0
var _emote_time: float = 0.0
var _emote_kind: String = ""

var head: Node3D
var torso: Node3D
var arm_left: Node3D
var arm_right: Node3D
var leg_left: Node3D
var leg_right: Node3D
var backpack: Node3D
var hat: Node3D
var weapon_mount: Node3D
var muzzle: Node3D
var impact_marker: Node3D
var name_tag: Label3D
var health_bar: Node3D

func _ready() -> void:
	_build()

static func color_from_hex(value: String, fallback: Color) -> Color:
	return Color(value) if Color.html_is_valid(value) else fallback

func _build() -> void:
	var head_color := color_from_hex(str(palette.get("head", "")), Color(0.79, 0.56, 0.37))
	var torso_color := color_from_hex(str(palette.get("torso", "")), Color(0.29, 0.48, 0.29))
	var arms_color := color_from_hex(str(palette.get("arms", "")), torso_color)
	var legs_color := color_from_hex(str(palette.get("legs", "")), Color(0.22, 0.31, 0.42))
	var boots_color := color_from_hex(str(palette.get("boots", "")), Color(0.17, 0.18, 0.21))

	head = _cuboid("Head", Vector3(0.62, 0.62, 0.62), head_color, Vector3(0, 1.42, 0), self)
	torso = _cuboid("Torso", Vector3(0.72, 0.78, 0.42), torso_color, Vector3(0, 0.82, 0), self)
	# Team stripe on the chest so teams stay readable at distance.
	_cuboid("TeamStripe", Vector3(0.70, 0.16, 0.06), team_color, Vector3(0, 1.02, 0.38), torso)

	arm_left = _cuboid("ArmLeft", Vector3(0.24, 0.72, 0.24), arms_color, Vector3(-0.48, 1.02, 0), self)
	arm_right = _cuboid("ArmRight", Vector3(0.24, 0.72, 0.24), arms_color, Vector3(0.48, 1.02, 0), self)
	leg_left = _cuboid("LegLeft", Vector3(0.28, 0.62, 0.28), legs_color, Vector3(-0.18, 0.30, 0), self)
	leg_right = _cuboid("LegRight", Vector3(0.28, 0.62, 0.28), legs_color, Vector3(0.18, 0.30, 0), self)
	_cuboid("BootLeft", Vector3(0.30, 0.14, 0.34), boots_color, Vector3(0, -0.28, 0.03), leg_left)
	_cuboid("BootRight", Vector3(0.30, 0.14, 0.34), boots_color, Vector3(0, -0.28, 0.03), leg_right)

	backpack = Node3D.new()
	backpack.name = "Backpack"
	backpack.position = Vector3(0, 0.88, -0.34)
	torso.add_child(backpack)
	hat = Node3D.new()
	hat.name = "Hat"
	hat.position = Vector3(0, 1.74, 0)
	head.add_child(hat)

	# Weapon mount sits in the right hand-ish position; the weapon points -Z.
	weapon_mount = Node3D.new()
	weapon_mount.name = "WeaponMount"
	weapon_mount.position = Vector3(0.34, 1.02, -0.36)
	add_child(weapon_mount)
	muzzle = Node3D.new()
	muzzle.name = "Muzzle"
	weapon_mount.add_child(muzzle)

	# Small marker used for hit flashes and damage numbers.
	impact_marker = Node3D.new()
	impact_marker.name = "ImpactMarker"
	impact_marker.position = Vector3(0, 1.05, 0)
	add_child(impact_marker)

	name_tag = Label3D.new()
	name_tag.name = "NameTag"
	name_tag.text = ""
	name_tag.font_size = 28
	name_tag.pixel_size = 0.006
	name_tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	name_tag.no_depth_test = false
	name_tag.modulate = Color(1, 1, 1, 0.92)
	name_tag.outline_size = 6
	name_tag.position = Vector3(0, 2.15, 0)
	add_child(name_tag)

	health_bar = _health_bar()
	health_bar.position = Vector3(0, 1.98, 0)
	add_child(health_bar)

## A colour block with an unshaded-ish material (keeps characters readable in shade).
func _cuboid(node_name: String, size: Vector3, color: Color, position: Vector3,
			 parent: Node3D) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	var instance := MeshInstance3D.new()
	instance.name = node_name
	instance.mesh = mesh
	instance.position = position
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.85
	material.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	instance.material_override = material
	parent.add_child(instance)
	return instance

func _health_bar() -> Node3D:
	var root := Node3D.new()
	root.name = "HealthBar"
	var back := _cuboid("BarBack", Vector3(0.86, 0.12, 0.03), Color(0.08, 0.09, 0.12, 0.85), Vector3.ZERO, root)
	back.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var fill := _cuboid("BarFill", Vector3(0.8, 0.08, 0.02), Color(0.4, 0.85, 0.45), Vector3(0, 0, 0.02), root)
	fill.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	fill.name = "BarFill"
	return root

## Applies cosmetic loadout (skin palette, hat, backpack, mask) to the rig.
func apply_cosmetics(loadout: Dictionary) -> void:
	var skin := ContentDB.shop_item(str(loadout.get("skin", "skin_recruit")))
	if not skin.is_empty():
		palette = skin.get("palette", palette)
		_recolor()
	for child: Node in hat.get_children():
		child.queue_free()
	var headwear := ContentDB.shop_item(str(loadout.get("headwear", "")))
	if not headwear.is_empty():
		var color := Color(str(headwear.get("colorway", {}).get("color", "#5f8f4d")))
		match str(headwear.get("part", "cap")):
			"helm":
				_cuboid("Helm", Vector3(0.72, 0.30, 0.72), color, Vector3(0, 0.24, 0), hat)
				_cuboid("HelmVisor", Vector3(0.74, 0.10, 0.22), color.darkened(0.25),
					Vector3(0, 0.16, 0.36), hat)
			"crown":
				for i: int in 5:
					var angle := float(i) / 5.0 * TAU
					_cuboid("Crown%d" % i, Vector3(0.12, 0.22, 0.12), color,
						Vector3(cos(angle) * 0.26, 0.3, sin(angle) * 0.26), hat)
				_cuboid("CrownRing", Vector3(0.66, 0.08, 0.66), color.darkened(0.2),
					Vector3(0, 0.22, 0), hat)
			_:
				_cuboid("Cap", Vector3(0.66, 0.20, 0.66), color, Vector3(0, 0.24, 0), hat)
				_cuboid("CapBrim", Vector3(0.66, 0.06, 0.26), color.darkened(0.2),
					Vector3(0, 0.16, 0.38), hat)
	var mask := ContentDB.shop_item(str(loadout.get("mask", "")))
	if not mask.is_empty():
		var mask_color := Color(str(mask.get("colorway", {}).get("color", "#a08b5e")))
		_cuboid("Mask", Vector3(0.64, 0.18, 0.66), mask_color, Vector3(0, 1.36, 0.02), self)
	for child: Node in backpack.get_children():
		child.queue_free()
	var pack := ContentDB.shop_item(str(loadout.get("backpack", "")))
	if not pack.is_empty():
		var pack_color := Color(str(pack.get("colorway", {}).get("color", "#6b5a3f")))
		_cuboid("PackBox", Vector3(0.52, 0.52, 0.28), pack_color, Vector3.ZERO, backpack)
		_cuboid("PackStrapTop", Vector3(0.56, 0.08, 0.30), pack_color.lightened(0.15),
			Vector3(0, 0.28, 0), backpack)
		if str(pack.get("part", "")) == "pack_radio":
			_cuboid("Antenna", Vector3(0.05, 0.52, 0.05), Color(0.8, 0.85, 0.9),
				Vector3(0.2, 0.5, 0), backpack)

func _recolor() -> void:
	var mapping := {
		"Head": str(palette.get("head", "")),
		"Torso": str(palette.get("torso", "")),
		"ArmLeft": str(palette.get("arms", "")),
		"ArmRight": str(palette.get("arms", "")),
		"LegLeft": str(palette.get("legs", "")),
		"LegRight": str(palette.get("legs", "")),
	}
	for node_name: String in mapping.keys():
		var node := find_child(node_name, true, false) as MeshInstance3D
		if node == null:
			continue
		var color := color_from_hex(str(mapping[node_name]), Color.WHITE)
		var material := node.material_override as StandardMaterial3D
		if material != null:
			material.albedo_color = color
	for boot_name: String in ["BootLeft", "BootRight"]:
		var boot := find_child(boot_name, true, false) as MeshInstance3D
		if boot == null:
			continue
		var boot_material := boot.material_override as StandardMaterial3D
		if boot_material != null:
			boot_material.albedo_color = color_from_hex(str(palette.get("boots", "")), Color(0.15, 0.16, 0.2))

func set_team_color(color: Color) -> void:
	team_color = color
	var stripe := find_child("TeamStripe", true, false) as MeshInstance3D
	if stripe != null:
		var material := stripe.material_override as StandardMaterial3D
		if material != null:
			material.albedo_color = color

# ------------------------------------------------------------------- states
func set_state(new_state: State, force: bool = false) -> void:
	if new_state == state and not force:
		return
	state = new_state

func trigger_shoot() -> void:
	_shoot_kick = 1.0
	if state != State.RELOAD and state != State.MELEE:
		set_state(State.SHOOT)

func trigger_reload(duration: float) -> void:
	_reload_timer = maxf(0.2, duration)
	set_state(State.RELOAD)

func trigger_melee(duration: float = 0.4) -> void:
	_melee_timer = duration
	set_state(State.MELEE)

func trigger_land() -> void:
	_land_timer = 0.18
	set_state(State.LAND, true)

func play_emote(emote_kind: String, duration: float) -> void:
	_emote_kind = emote_kind
	_emote_time = duration
	set_state(State.EMOTE, true)

func set_downed(downed: bool) -> void:
	if downed:
		set_state(State.DOWNED, true)

func _process(delta: float) -> void:
	_cycle += delta * (WALK_CYCLE + move_speed_ratio * (RUN_CYCLE - WALK_CYCLE))
	_blend = minf(1.0, _blend + delta * STATE_BLEND)
	if _shoot_kick > 0.0:
		_shoot_kick = maxf(0.0, _shoot_kick - delta * 6.0)
	if _reload_timer > 0.0:
		_reload_timer = maxf(0.0, _reload_timer - delta)
		if _reload_timer <= 0.0:
			set_state(State.IDLE)
	if _melee_timer > 0.0:
		_melee_timer = maxf(0.0, _melee_timer - delta)
		if _melee_timer <= 0.0:
			set_state(State.IDLE)
	if _land_timer > 0.0:
		_land_timer = maxf(0.0, _land_timer - delta)
	if _emote_time > 0.0:
		_emote_time = maxf(0.0, _emote_time - delta)
		if _emote_time <= 0.0:
			set_state(State.IDLE)
	_pose(delta)

func _pose(delta: float) -> void:
	var swing := sin(_cycle) * 0.7 * move_speed_ratio
	var counter := -swing
	var bob := absf(sin(_cycle * 0.5)) * 0.03 * move_speed_ratio
	match state:
		State.WALK, State.RUN:
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, counter * 0.6, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, swing * 0.5 - 0.4, delta)
			leg_left.rotation.x = _lerp_angle(leg_left.rotation.x, swing, delta)
			leg_right.rotation.x = _lerp_angle(leg_right.rotation.x, counter, delta)
			torso.position.y = _lerp(torso.position.y, 0.82 + bob, delta)
			leg_left.position.y = 0.30 + swing * 0.04
			leg_right.position.y = 0.30 - swing * 0.04
			_crouch_amount(0.0, delta)
		State.CROUCH_IDLE, State.CROUCH_WALK:
			leg_left.rotation.x = _lerp_angle(leg_left.rotation.x, swing * 0.4, delta)
			leg_right.rotation.x = _lerp_angle(leg_right.rotation.x, counter * 0.4, delta)
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, -0.5, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -0.5, delta)
			_crouch_amount(1.0, delta)
		State.JUMP:
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, -1.4, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -1.1, delta)
			leg_left.rotation.x = _lerp_angle(leg_left.rotation.x, 0.5, delta)
			leg_right.rotation.x = _lerp_angle(leg_right.rotation.x, -0.4, delta)
			_crouch_amount(0.0, delta)
		State.FALL:
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, -2.0, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -1.8, delta)
			leg_left.rotation.x = _lerp_angle(leg_left.rotation.x, -0.3, delta)
			leg_right.rotation.x = _lerp_angle(leg_right.rotation.x, 0.2, delta)
			_crouch_amount(0.0, delta)
		State.LAND:
			var t := _land_timer / 0.18
			_crouch_amount(t, delta)
			leg_left.rotation.x = _lerp_angle(leg_left.rotation.x, 0.35 * t, delta)
			leg_right.rotation.x = _lerp_angle(leg_right.rotation.x, 0.35 * t, delta)
		State.DOWNED:
			rotation.x = _lerp_angle(rotation.x, -1.35, delta)
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, 0.6, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, 0.6, delta)
		State.EMOTE:
			_emote_pose(delta)
		State.VICTORY:
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -2.6, delta)
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, -0.4, delta)
			torso.position.y = _lerp(torso.position.y, 0.9 + sin(_cycle * 2.0) * 0.06, delta)
		State.RELOAD:
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, -1.2, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -0.6 + sin(_cycle * 6.0) * 0.25, delta)
			_crouch_amount(0.0, delta)
		State.SHOOT:
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, -1.3, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -0.5 - _shoot_kick * 0.3, delta)
			_crouch_amount(0.0, delta)
		_:
			var idle_sway := sin(_cycle * 0.5) * 0.03
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, idle_sway, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -0.35 + idle_sway, delta)
			leg_left.rotation.x = _lerp_angle(leg_left.rotation.x, 0.0, delta)
			leg_right.rotation.x = _lerp_angle(leg_right.rotation.x, 0.0, delta)
			torso.position.y = _lerp(torso.position.y, 0.82 + bob, delta)
			rotation.x = _lerp_angle(rotation.x, 0.0, delta)
			_crouch_amount(0.0, delta)
	head.rotation.x = clampf(-aim_pitch * 0.6, -0.6, 0.5)
	if state != State.RELOAD and state != State.MELEE:
		arm_right.rotation.x += clampf(aim_pitch * 0.5, -0.5, 0.5)
	weapon_mount.position.y = 1.02 - _crouch * 0.4
	weapon_mount.rotation.x = clampf(aim_pitch, -0.7, 0.7) * 0.5

var _crouch: float = 0.0

func _crouch_amount(target: float, delta: float) -> void:
	_crouch = _lerp(_crouch, target, delta)
	torso.position.y = _lerp(torso.position.y, 0.82 - _crouch * 0.34, delta)
	head.position.y = _lerp(head.position.y, 1.42 - _crouch * 0.42, delta)

func _emote_pose(delta: float) -> void:
	match _emote_kind:
		"wave":
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -2.7, delta)
			arm_right.rotation.z = sin(_cycle * 4.0) * 0.5
		"dance":
			torso.rotation.y = sin(_cycle * 3.0) * 0.7
			arm_left.rotation.x = _lerp_angle(arm_left.rotation.x, -2.4, delta)
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -2.4, delta)
			leg_left.rotation.x = sin(_cycle * 3.0) * 0.5
			leg_right.rotation.x = -sin(_cycle * 3.0) * 0.5
		"taunt":
			torso.rotation.y = sin(_cycle * 2.0) * 0.3
			arm_left.rotation.z = sin(_cycle * 2.0) * 0.6
		"sit":
			_crouch_amount(1.4, delta)
		_:
			arm_right.rotation.x = _lerp_angle(arm_right.rotation.x, -2.1, delta)

func _lerp(a: float, b: float, delta: float) -> float:
	return a + (b - a) * minf(1.0, delta * 12.0)

func _lerp_angle(a: float, b: float, delta: float) -> float:
	return _lerp(a, b, delta)

## Shows a floating name / health bar above the character.
func set_display_name(display: String, visible_tag: bool) -> void:
	if name_tag == null:
		return
	name_tag.text = display
	name_tag.visible = visible_tag and not display.is_empty()

func set_health_ratio(ratio: float) -> void:
	if health_bar == null:
		return
	var fill := health_bar.find_child("BarFill", true, false) as MeshInstance3D
	if fill == null:
		return
	var clamped := clampf(ratio, 0.0, 1.0)
	fill.scale.x = maxf(0.001, clamped)
	fill.position.x = (clamped - 1.0) * 0.4
	var material := fill.material_override as StandardMaterial3D
	if material != null:
		material.albedo_color = Color(0.9, 0.3, 0.28) if clamped < 0.34 \
			else (Color(0.95, 0.75, 0.3) if clamped < 0.66 else Color(0.4, 0.85, 0.45))

func set_name_tag_visible(value: bool) -> void:
	if name_tag != null:
		name_tag.visible = value
	if health_bar != null:
		health_bar.visible = value

func muzzle_position() -> Vector3:
	return muzzle.global_position if muzzle != null else global_position
