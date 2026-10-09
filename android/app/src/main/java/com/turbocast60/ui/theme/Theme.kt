package com.turbocast60.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(
    primary = Mint,
    onPrimary = Ink,
    secondary = MintDeep,
    onSecondary = Ink,
    background = Ink,
    onBackground = TextPrimary,
    surface = Surface,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceRaised,
    onSurfaceVariant = TextSecondary,
    outline = Border,
    error = ErrorRed
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF086E55),
    onPrimary = Color.White,
    secondary = Color(0xFF1B8068),
    background = Color(0xFFF4F8F6),
    onBackground = Color(0xFF10211B),
    surface = Color.White,
    onSurface = Color(0xFF10211B),
    surfaceVariant = Color(0xFFE4EEE9),
    onSurfaceVariant = Color(0xFF475A52),
    outline = Color(0xFFC7D7D0),
    error = Color(0xFFB3261E)
)

@Composable
fun TurboCastTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
}
