class_name TestCase
extends RefCounted
## Minimal assertion helper for the headless test suite.
##
## Deliberately tiny: no engine plugin, no dependency to fetch, just counters and
## readable failures, so `godot --headless tests/tests.tscn` gives a real exit code
## that a CI job or a human can trust.

var suite: String = ""
var passed: int = 0
var failed: int = 0
var failures: Array = []

func _init(suite_name: String = "") -> void:
	suite = suite_name

func ok(condition: bool, what: String) -> bool:
	if condition:
		passed += 1
		return true
	failed += 1
	failures.append("%s: expected true - %s" % [suite, what])
	return false

func equal(actual: Variant, expected: Variant, what: String) -> bool:
	if actual == expected:
		passed += 1
		return true
	failed += 1
	failures.append("%s: %s - expected %s, got %s" % [suite, what, str(expected), str(actual)])
	return false

func not_equal(actual: Variant, unexpected: Variant, what: String) -> bool:
	if actual != unexpected:
		passed += 1
		return true
	failed += 1
	failures.append("%s: %s - value should not have been %s" % [suite, what, str(unexpected)])
	return false

func greater(actual: float, threshold: float, what: String) -> bool:
	if actual > threshold:
		passed += 1
		return true
	failed += 1
	failures.append("%s: %s - expected > %s, got %s" % [suite, what, str(threshold), str(actual)])
	return false

func less(actual: float, threshold: float, what: String) -> bool:
	if actual < threshold:
		passed += 1
		return true
	failed += 1
	failures.append("%s: %s - expected < %s, got %s" % [suite, what, str(threshold), str(actual)])
	return false

func between(actual: float, minimum: float, maximum: float, what: String) -> bool:
	if actual >= minimum and actual <= maximum:
		passed += 1
		return true
	failed += 1
	failures.append("%s: %s - expected %s..%s, got %s" % [suite, what, str(minimum),
		str(maximum), str(actual)])
	return false

func contains(haystack: Variant, needle: Variant, what: String) -> bool:
	var found := false
	if haystack is Dictionary:
		found = (haystack as Dictionary).has(needle)
	elif haystack is Array:
		found = (haystack as Array).has(needle)
	elif haystack is String:
		found = str(haystack).contains(str(needle))
	return ok(found, "%s (looking for %s)" % [what, str(needle)])

func summary() -> String:
	return "%s: %d passed, %d failed" % [suite, passed, failed]
