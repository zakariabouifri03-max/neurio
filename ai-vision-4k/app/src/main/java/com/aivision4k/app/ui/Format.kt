package com.aivision4k.app.ui

import java.util.Locale

/*
 * Formatting helpers.
 *
 * The one rule that matters: a measurement the platform did not report must
 * render as an em dash, never as `0`. The engine marks those values as negative
 * or omits them, and `null` here means "not reported".
 */

/** Shown wherever a real measurement is missing. */
const val DASH = "\u2014"

fun fmt(value: Double?, decimals: Int = 1, unit: String = ""): String {
    if (value == null || value < 0.0 || value.isNaN()) return DASH
    return String.format(Locale.US, "%.${decimals}f%s", value, unit)
}

fun fmtInt(value: Int?): String = value?.toString() ?: DASH

/** `fraction` is 0..1; the UI shows percentages. */
fun percent(fraction: Double?, decimals: Int = 0): String {
    if (fraction == null || fraction < 0.0 || fraction.isNaN()) return DASH
    return String.format(Locale.US, "%.${decimals}f%%", fraction * 100.0)
}

fun bytes(value: Long): String {
    if (value <= 0L) return DASH
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var size = value.toDouble()
    var index = 0
    while (size >= 1024.0 && index < units.lastIndex) {
        size /= 1024.0
        index++
    }
    return String.format(Locale.US, if (size >= 100) "%.0f %s" else "%.1f %s", size, units[index])
}

fun millis(value: Double?): String = fmt(value, 2, " ms")

/** `1920x1080` -> `1080p`, `3840x2160` -> `4K`; anything else stays pixel-exact. */
fun resolutionName(width: Int, height: Int): String = when {
    width <= 0 || height <= 0 -> DASH
    width == 3840 && height == 2160 -> "4K"
    width == 2560 && height == 1440 -> "1440p"
    width == 1920 && height == 1080 -> "1080p"
    width == 1600 && height == 900 -> "900p"
    width == 1280 && height == 720 -> "720p"
    else -> "${width}x$height"
}

/** The "1080p -> 4K" chip on the dashboard. */
fun resolutionArrow(inputWidth: Int, inputHeight: Int, outputWidth: Int, outputHeight: Int): String =
    "${resolutionName(inputWidth, inputHeight)} \u2192 ${resolutionName(outputWidth, outputHeight)}"

/** `--:--` style duration for the benchmark countdown. */
fun seconds(totalSeconds: Int): String =
    if (totalSeconds < 60) "${totalSeconds}s" else String.format(Locale.US, "%d:%02d", totalSeconds / 60, totalSeconds % 60)

fun thermalColor(level: com.aivision4k.sdk.ThermalLevel): androidx.compose.ui.graphics.Color =
    when (level) {
        com.aivision4k.sdk.ThermalLevel.Nominal -> GoodGreen
        com.aivision4k.sdk.ThermalLevel.Light,
        com.aivision4k.sdk.ThermalLevel.Moderate,
        -> WarnAmber
        com.aivision4k.sdk.ThermalLevel.Severe,
        com.aivision4k.sdk.ThermalLevel.Critical,
        com.aivision4k.sdk.ThermalLevel.Emergency,
        com.aivision4k.sdk.ThermalLevel.Shutdown,
        -> DangerRed
    }

fun compatColor(status: com.aivision4k.sdk.CompatStatus): androidx.compose.ui.graphics.Color =
    when (status) {
        com.aivision4k.sdk.CompatStatus.Supported -> GoodGreen
        com.aivision4k.sdk.CompatStatus.PartiallySupported -> AccentCyan
        com.aivision4k.sdk.CompatStatus.Experimental -> WarnAmber
        com.aivision4k.sdk.CompatStatus.Unsupported -> DangerRed
    }
