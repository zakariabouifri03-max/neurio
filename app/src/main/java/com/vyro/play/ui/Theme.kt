package com.vyro.play.ui

import android.app.Activity
import android.content.res.Configuration
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

val Violet = Color(0xFFAC78FF)
val Cyan = Color(0xFF58E2E7)
val Night = Color(0xFF090916)
private val dark = darkColorScheme(primary = Violet, secondary = Cyan, background = Night, surface = Color(0xFF161627), surfaceVariant = Color(0xFF222238), onBackground = Color(0xFFF7F4FF), onSurface = Color(0xFFF7F4FF))
private val light = lightColorScheme(primary = Color(0xFF673BB6), secondary = Color(0xFF007D85), background = Color(0xFFF8F6FF), surface = Color.White, surfaceVariant = Color(0xFFEDE8F6))
@Composable fun VyroTheme(choice: String, content: @Composable () -> Unit) {
    val isDark = choice == "Dark" || (choice == "System" && isSystemInDarkTheme())
    val view = LocalView.current
    SideEffect { (view.context as? Activity)?.window?.let { WindowCompat.getInsetsController(it, view).isAppearanceLightStatusBars = !isDark } }
    MaterialTheme(colorScheme = if (isDark) dark else light, content = content)
}
