package com.vyro.play.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.vyro.play.model.ThemeMode

val LocalLowEndMode = compositionLocalOf { false }

private val VyroDarkColorScheme = darkColorScheme(
    primary = VyroPurplePrimary,
    onPrimary = Color.White,
    primaryContainer = VyroPurpleContainer,
    onPrimaryContainer = Color(0xFFEDE9FE),
    secondary = VyroCyanAccent,
    onSecondary = VyroObsidianBlack,
    secondaryContainer = VyroCyanContainer,
    onSecondaryContainer = VyroCyanBright,
    tertiary = VyroPurpleBright,
    onTertiary = Color.White,
    background = VyroObsidianBlack,
    onBackground = VyroTextPrimaryDark,
    surface = VyroSurfaceDark,
    onSurface = VyroTextPrimaryDark,
    surfaceVariant = VyroSurfaceElevated,
    onSurfaceVariant = VyroTextSecondaryDark,
    outline = VyroCardBorderDark,
    error = VyroErrorCoral,
    onError = Color.White
)

private val VyroLightColorScheme = lightColorScheme(
    primary = VyroPurplePrimaryLight,
    onPrimary = Color.White,
    primaryContainer = VyroLightSurfaceVariant,
    onPrimaryContainer = VyroPurpleDeep,
    secondary = VyroCyanAccentLight,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFCFFAFE),
    onSecondaryContainer = Color(0xFF0E7490),
    tertiary = VyroPurplePrimary,
    onTertiary = Color.White,
    background = VyroLightBackground,
    onBackground = VyroTextPrimaryLight,
    surface = VyroLightSurface,
    onSurface = VyroTextPrimaryLight,
    surfaceVariant = VyroLightSurfaceVariant,
    onSurfaceVariant = VyroTextSecondaryLight,
    outline = VyroLightBorder,
    error = VyroErrorCoral,
    onError = Color.White
)

@Composable
fun VyroPlayTheme(
    themeMode: ThemeMode = ThemeMode.DARK,
    lowEndMode: Boolean = false,
    content: @Composable () -> Unit
) {
    val useDarkTheme = when (themeMode) {
        ThemeMode.DARK -> true
        ThemeMode.LIGHT -> false
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }

    val colorScheme = if (useDarkTheme) VyroDarkColorScheme else VyroLightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            val barColor = if (useDarkTheme) VyroObsidianBlack.toArgb() else VyroLightBackground.toArgb()
            window.statusBarColor = barColor
            window.navigationBarColor = barColor
            val insetsController = WindowCompat.getInsetsController(window, view)
            insetsController.isAppearanceLightStatusBars = !useDarkTheme
            insetsController.isAppearanceLightNavigationBars = !useDarkTheme
        }
    }

    CompositionLocalProvider(LocalLowEndMode provides lowEndMode) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = VyroTypography,
            content = content
        )
    }
}
