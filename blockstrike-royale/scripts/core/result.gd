class_name GameResult
extends RefCounted
## Small result type used by economy, inventory and network operations so that
## failures carry a reason instead of silently returning null/false.

enum Code { OK, INVALID, NOT_ENOUGH_FUNDS, ALREADY_OWNED, NOT_OWNED, NOT_READY, DUPLICATE,
			UNAUTHORIZED, OFFLINE, TIMEOUT, FULL, WRONG_PASSWORD, VERSION_MISMATCH }

var code: Code = Code.OK
var message: String = ""
var data: Variant = null

static func ok(payload: Variant = null) -> GameResult:
	var result := GameResult.new()
	result.code = Code.OK
	result.data = payload
	return result

static func fail(failure: Code, why: String) -> GameResult:
	var result := GameResult.new()
	result.code = failure
	result.message = why
	return result

func succeeded() -> bool:
	return code == Code.OK

func error_text() -> String:
	if succeeded():
		return ""
	return "Unexpected error" if message.is_empty() else message

func code_name() -> String:
	return Code.keys()[code]
