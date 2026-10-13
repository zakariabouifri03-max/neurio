extends Node
## Headless test entry point.
##
## Run with:  godot --headless --path . tests/tests.tscn
## Exit code 0 = all suites passed, 1 = at least one failure.  The suite is real
## engine execution: it loads the same autoloads, data files and assets the game
## uses, so a broken data table or a missing sound fails here first.

const SUITES := [
	"res://tests/test_content.gd",
	"res://tests/test_world.gd",
	"res://tests/test_combat.gd",
	"res://tests/test_progression.gd",
	"res://tests/test_controls.gd",
]

var total_passed: int = 0
var total_failed: int = 0
var failures: Array = []

func _ready() -> void:
	print("BlockStrike Royale - test run")
	print("engine %s (%s)" % [Engine.get_version_info().get("string", "?"), OS.get_name()])
	print("---------------------------------------------")
	for path: String in SUITES:
		_run_suite(path)
	print("---------------------------------------------")
	for failure: Variant in failures:
		print("FAIL  %s" % str(failure))
	print("TOTAL: %d passed, %d failed" % [total_passed, total_failed])
	get_tree().quit(0 if total_failed == 0 else 1)

func _run_suite(path: String) -> void:
	var script: Script = load(path)
	if script == null:
		total_failed += 1
		failures.append("%s could not be loaded" % path)
		return
	var suite: Object = script.new()
	var suite_name := path.get_file().replace(".gd", "")
	var test := TestCase.new(suite_name)
	var started := Time.get_ticks_usec()
	suite.call("run", test)
	var elapsed_ms := float(Time.get_ticks_usec() - started) / 1000.0
	total_passed += test.passed
	total_failed += test.failed
	for failure: Variant in test.failures:
		failures.append(failure)
	print("%-28s %3d passed %3d failed  (%.1f ms)" % [suite_name, test.passed, test.failed,
		elapsed_ms])
