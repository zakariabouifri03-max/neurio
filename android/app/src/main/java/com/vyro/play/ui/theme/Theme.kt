package com.vyro.play.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.vyro.core.model.ThemeMode

private val DarkColorScheme =
    darkColorScheme(
        primary = Color(0xFFD0A6FF),
        onPrimary = Color(0xFF2B0A4A),
        primaryContainer = Color(0xFF4A148C),
        onPrimaryContainer = Color(0xFFF0D6FF),
        secondary = VyroCyan,
        onSecondary = Color(0xFF00363D),
        secondaryContainer = Color(0xFF004F58),
        onSecondaryContainer = Color(0xFFB8EDFF),
        tertiary = Color(0xFF9EF7FF),
        onTertiary = Color(0xFF00363D),
        background = VyroBlack,
        onBackground = Color(0xFFF4F1FA),
        surface = VyroSurface,
        onSurface = Color(0xFFF4F1FA),
        surfaceVariant = VyroSurfaceVariant,
        onSurfaceVariant = Color(0xFFC9C3DC),
        surfaceContainerHighest = VyroSurfaceHigh,
        outline = VyroOutline,
        outlineVariant = Color(0xFF2A2540),
        error = Color(0xFFFF6B6B),
        onError = Color(0xFF3A0007),
        scrim = Color(0xFF000000),
    )

/** OLED-friendly variant: true black backgrounds to cut power draw. */
private val PureBlackColorScheme =
    DarkColorScheme.copy(
        background = Color(0xFF000000),
        surface = Color(0xFF000000),
        surfaceVariant = Color(0xFF0E0E14),
        surfaceContainerHighest = Color(0xFF16161C),
        outline = Color(0xFF2C2C36),
        outlineVariant = Color(0xFF1C1C22),
    )

private val LightColorScheme =
    lightColorScheme(
        primary = Color(0xFF7A1FE0),
        onPrimary = Color(0xFFFFFFFF),
        primaryContainer = Color(0xFFF0DBFF),
        onPrimaryContainer = Color(0xFF2B004F),
        secondary = Color(0xFF007A8C),
        onSecondary = Color(0xFFFFFFFF),
        secondaryContainer = Color(0xFFCDEFF7),
        onSecondaryContainer = Color(0xFF001F26),
        tertiary = Color(0xFF00A8B5),
        onTertiary = Color(0xFFFFFFFF),
        background = VyroLightBackground,
        onBackground = Color(0xFF130B1F),
        surface = VyroLightSurface,
        onSurface = Color(0xFF130B1F),
        surfaceVariant = VyroLightSurfaceVariant,
        onSurfaceVariant = Color(0xFF4A4458),
        surfaceContainerHighest = Color(0xFFE6DCF5),
        outline = VyroLightOutline,
        outlineVariant = Color(0xFFDCD3EA),
        error = Color(0xFFB3261E),
        onError = Color(0xFFFFFFFF),
        scrim = Color(0xFF000000),
    )

val VyroShapes =
    Shapes(
        extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
        small = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
        medium = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
        large = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
        extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(28.dp),
    )

/**
 * Extra values that are not part of [androidx.compose.material3.ColorScheme] but are
 * used across the app for the brand look (gradient scrims, live badges, progress).
 */
data class VyroExtendedColors(
    val brand: Color,
    val accent: Color,
    val gradientStart: Color,
    val gradientEnd: Color,
    val live: Color,
    val success: Color,
    val shimmer: Color,
)

private val DarkExtended =
    VyroExtendedColors(
        brand = VyroPurple,
        accent = VyroCyan,
        gradientStart = VyroGradientStart,
        gradientEnd = VyroGradientEnd,
        live = VyroLiveRed,
        success = VyroSuccess,
        shimmer = Color(0xFF1F1B2E),
    )

private val LightExtended =
    VyroExtendedColors(
        brand = VyroPurpleDeep,
        accent = VyroCyanDeep,
        gradientStart = VyroGradientStart,
        gradientEnd = VyroCyanDeep,
        live = VyroLiveRed,
        success = Color(0xFF0F9D58),
        shimmer = Color(0xFFE9E1F5),
    )

val LocalVyroExtendedColors =
    staticCompositionLocalOf { DarkExtended }

val MaterialTheme.vyroColors: VyroExtendedColors
    @Composable
    @ReadOnlyComposable
    get() = LocalVyroExtendedColors.current

@Composable
fun VyroTheme(
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    dynamicColor: Boolean = true,
    pureBlack: Boolean = false,
    content: @Composable () -> Unit,
) {
    val darkTheme =
        when (themeMode) {
            ThemeMode.SYSTEM -> isSystemInDarkTheme()
            ThemeMode.LIGHT -> false
            ThemeMode.DARK -> true
        }

    val supportsDynamic = dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val context = LocalContext.current

    val colorScheme =
        when {
            supportsDynamic && darkTheme -> dynamicDarkColorScheme(context)
            supportsDynamic -> dynamicLightColorScheme(context)
            darkTheme && pureBlack -> PureBlackColorScheme
            darkTheme -> DarkColorScheme
            else -> LightColorScheme
        }

    val extended = if (darkTheme) DarkExtended else LightExtended

    CompositionLocalProvider(LocalVyroExtendedColors provides extended) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = VyroTypography,
            shapes = VyroShapes,
            content = content,
        )
    }
}
