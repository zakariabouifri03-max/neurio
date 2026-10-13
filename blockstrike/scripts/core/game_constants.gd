class_name GameConstants
extends RefCounted
## Shared constants used across gameplay systems.

const APP_VERSION := "0.1.0"
## Network/protocol version. Bumped whenever packet formats or rules change.
const PROTOCOL_VERSION := 1

const LAYER_WORLD := 1
const LAYER_ACTORS := 2
const LAYER_PROJECTILES := 4

const SCENE_MAIN_MENU := "res://scenes/menus/main_menu.tscn"
const SCENE_TRAINING := "res://scenes/match/training_ground.tscn"

const GRAVITY := 22.0
const MAX_FALL_SPEED := 42.0
