package com.aivision4k.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/*
 * The AI Vision 4K palette.
 *
 * One dark scheme only: the app is a gaming utility that runs next to a game,
 * a light theme would be a maintenance cost with no benefit. Every colour is a
 * token so the screens never hard-code hex values.
 */

/** Window background — nearly black so nothing flares behind a game. */
val VoidBlack = Color(0xFF05070E)

/** Card background. */
val SurfaceNavy = Color(0xFF0B1020)

/** Raised / selected surfaces (chips, list rows). */
val SurfaceRaised = Color(0xFF131A30)

/** Hairline borders. */
val StrokeSoft = Color(0xFF1E2742)

/** Primary accent: the cyan used for AI-processed values. */
val AccentCyan = Color(0xFF35E0FF)

/** Secondary accent: violet, used for the "AI engine" surfaces. */
val AccentViolet = Color(0xFF7C6BFF)

/** Healthy / nominal readings. */
val GoodGreen = Color(0xFF35E08A)

/** Warm readings and warnings. */
val WarnAmber = Color(0xFFFFB020)

/** Blocking conditions, thermal critical, errors. */
val DangerRed = Color(0xFFFF4D6D)

val TextPrimary = Color(0xFFE8EDF7)
val TextMuted = Color(0xFF8A94AD)

private val V4kColorScheme = darkColorScheme(
    primary = AccentCyan,
    onPrimary = Color(0xFF001318),
    primaryContainer = Color(0xFF0C3040),
    onPrimaryContainer = AccentCyan,
    secondary = AccentViolet,
    onSecondary = Color(0xFF0B0421),
    secondaryContainer = Color(0xFF201A45),
    onSecondaryContainer = Color(0xFFCFC7FF),
    tertiary = GoodGreen,
    background = VoidBlack,
    onBackground = TextPrimary,
    surface = SurfaceNavy,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceRaised,
    onSurfaceVariant = TextMuted,
    outline = StrokeSoft,
    error = DangerRed,
    onError = Color(0xFF2A0009),
)

@Composable
fun AiVision4KTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = V4kColorScheme, content = content)
}

/** Colour for a value between `0..1` where higher is worse (load, temperature). */
fun loadColor(fraction: Double?): Color = when {
    fraction == null || fraction < 0.0 -> TextMuted
    fraction < 0.6 -> GoodGreen
    fraction < 0.85 -> WarnAmber
    else -> DangerRed
}
