package com.neurio.lanstream.input

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.hypot

/** One on-screen control. Positions are fractions (0..1) of the stream area. */
data class ControlSpec(
    val id: String,
    val label: String,
    val x: Float,
    val y: Float,
    val size: Float,
    val enabled: Boolean = true
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("label", label)
        put("x", x.toDouble())
        put("y", y.toDouble())
        put("size", size.toDouble())
        put("enabled", enabled)
    }

    /** Coordinate of a direction inside this control (used by the D-pad). */
    fun pointAt(dx: Float, dy: Float): Pair<Float, Float> =
        (x + dx * size * 0.42f) to (y + dy * size * 0.42f)

    companion object {
        fun fromJson(json: JSONObject): ControlSpec = ControlSpec(
            id = json.optString("id"),
            label = json.optString("label", json.optString("id")),
            x = json.optDouble("x", 0.5).toFloat().coerceIn(0f, 1f),
            y = json.optDouble("y", 0.5).toFloat().coerceIn(0f, 1f),
            size = json.optDouble("size", 0.15).toFloat().coerceIn(0.04f, 0.6f),
            enabled = json.optBoolean("enabled", true)
        )
    }
}

/**
 * The configurable virtual gamepad layout.
 *
 * The client renders it and turns presses into *normalised* touch coordinates,
 * which is why the host never needs to know anything about the game's UI: a
 * button press is just "touch at 0.86 / 0.74 of the picture". The same layout is
 * shipped to the host during the handshake so physical gamepads can be mapped
 * onto it as well.
 */
data class PadLayout(val controls: Map<String, ControlSpec>) {

    fun get(id: String): ControlSpec? = controls[id]?.takeIf { it.enabled }

    fun with(id: String, spec: ControlSpec): PadLayout =
        copy(controls = controls + (id to spec))

    fun toJson(): String {
        val array = JSONArray()
        controls.values.forEach { array.put(it.toJson()) }
        return JSONObject().put("controls", array).toString()
    }

    companion object {
        const val JOYSTICK = "joystick"
        const val DPAD = "dpad"
        const val A = "a"
        const val B = "b"
        const val X = "x"
        const val Y = "y"
        const val L1 = "l1"
        const val L2 = "l2"
        const val R1 = "r1"
        const val R2 = "r2"
        const val START = "start"
        const val SELECT = "select"

        val ORDER: List<String> = listOf(JOYSTICK, DPAD, A, B, X, Y, L1, L2, R1, R2, START, SELECT)

        fun default(): PadLayout = PadLayout(
            mapOf(
                JOYSTICK to ControlSpec(JOYSTICK, "Stick", 0.16f, 0.70f, 0.30f, true),
                DPAD to ControlSpec(DPAD, "D-pad", 0.16f, 0.70f, 0.26f, false),
                A to ControlSpec(A, "A", 0.86f, 0.74f, 0.16f, true),
                B to ControlSpec(B, "B", 0.95f, 0.60f, 0.14f, true),
                X to ControlSpec(X, "X", 0.76f, 0.60f, 0.14f, true),
                Y to ControlSpec(Y, "Y", 0.86f, 0.47f, 0.14f, true),
                L1 to ControlSpec(L1, "L1", 0.13f, 0.28f, 0.13f, true),
                L2 to ControlSpec(L2, "L2", 0.07f, 0.13f, 0.12f, true),
                R1 to ControlSpec(R1, "R1", 0.87f, 0.28f, 0.13f, true),
                R2 to ControlSpec(R2, "R2", 0.93f, 0.13f, 0.12f, true),
                START to ControlSpec(START, "Start", 0.63f, 0.86f, 0.10f, true),
                SELECT to ControlSpec(SELECT, "Select", 0.37f, 0.86f, 0.10f, true)
            )
        )

        fun fromJson(text: String?): PadLayout {
            if (text.isNullOrBlank()) return default()
            return runCatching {
                val json = JSONObject(text)
                val array = json.optJSONArray("controls") ?: return default()
                val map = LinkedHashMap<String, ControlSpec>()
                for (i in 0 until array.length()) {
                    val spec = ControlSpec.fromJson(array.getJSONObject(i))
                    if (spec.id.isNotBlank()) map[spec.id] = spec
                }
                // Guarantee that every known control exists (old saved layouts).
                default().controls.forEach { (id, spec) -> map.putIfAbsent(id, spec) }
                PadLayout(map)
            }.getOrDefault(default())
        }
    }
}

/** Convenience helpers used by the on-screen controls. */
object PadMath {
    fun stickVector(dx: Float, dy: Float, radius: Float): Pair<Float, Float> {
        val distance = hypot(dx, dy)
        return if (distance <= radius) {
            dx to dy
        } else {
            (dx / distance * radius) to (dy / distance * radius)
        }
    }
}
