package com.neurio.lanstream.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val NeurioColorScheme = darkColorScheme(
    primary = NeonPurple,
    onPrimary = Color(0xFF0B0B14),
    primaryContainer = Color(0xFF2A1B4D),
    onPrimaryContainer = Color(0xFFE9DDFF),
    secondary = NeonCyan,
    onSecondary = Color(0xFF04222B),
    secondaryContainer = Color(0xFF0E3B45),
    onSecondaryContainer = Color(0xFFCFF7FF),
    tertiary = NeonLime,
    background = Background,
    onBackground = TextPrimary,
    surface = SurfaceElevated,
    onSurface = TextPrimary,
    surfaceVariant = Color(0xFF1F1F2E),
    onSurfaceVariant = TextSecondary,
    outline = SurfaceOutline,
    error = HotRed
)

@Composable
fun NeurioTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    // The stream lives in a SurfaceView, so the app keeps one dark palette and
    // never flips to light in the middle of a game.
    MaterialTheme(
        colorScheme = NeurioColorScheme,
        typography = NeurioTypography,
        content = content
    )
}
