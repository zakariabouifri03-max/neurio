package com.neurio.aivibes.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * AI VIBES palette: deep black surfaces with neon purple / electric blue /
 * cyan accents. Dark theme is the primary (and default) experience.
 */
object VibeColors {
    val Black = Color(0xFF07070B)
    val Deep = Color(0xFF0B0B14)
    val Panel = Color(0xFF12121F)
    val PanelHi = Color(0xFF1A1A2C)
    val Purple = Color(0xFFB24BF3)
    val Blue = Color(0xFF3B82F6)
    val Cyan = Color(0xFF22D3EE)
    val White = Color(0xFFF4F2FF)
    val Muted = Color(0xFF9A96B8)
    val Danger = Color(0xFFF43F5E)

    val NeonGradient = Brush.linearGradient(listOf(Purple, Blue, Cyan))
    val PanelGradient = Brush.linearGradient(
        listOf(Color(0xFF16162A), Color(0xFF0C0C16))
    )
}

private val VibeTypography = Typography(
    displayLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Black,
        fontSize = 44.sp,
        letterSpacing = (-1).sp
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 26.sp,
        letterSpacing = (-0.5).sp
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 19.sp
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        letterSpacing = 0.4.sp
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        letterSpacing = 0.5.sp
    )
)

private val VibeColorScheme = darkColorScheme(
    primary = VibeColors.Purple,
    onPrimary = VibeColors.White,
    secondary = VibeColors.Cyan,
    onSecondary = VibeColors.Black,
    tertiary = VibeColors.Blue,
    background = VibeColors.Black,
    onBackground = VibeColors.White,
    surface = VibeColors.Deep,
    onSurface = VibeColors.White,
    surfaceVariant = VibeColors.Panel,
    onSurfaceVariant = VibeColors.Muted,
    outline = Color(0xFF2A2A40),
    error = VibeColors.Danger
)

@Composable
fun AiVibesTheme(content: @Composable () -> Unit) {
    // Dark mode is the primary experience; we keep the system setting as a
    // sanity anchor but always use the dark neon scheme.
    isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = VibeColorScheme,
        typography = VibeTypography,
        content = content
    )
}
