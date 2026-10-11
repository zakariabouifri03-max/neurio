package com.vyro.play.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration

/**
 * Lightweight window width classification.
 *
 * Deliberately hand-rolled instead of pulling in `material3-window-size-class`: the app
 * only needs the three Material breakpoints for choosing between a bottom bar and a
 * navigation rail, and `LocalConfiguration` already provides that for free.
 */
enum class WindowWidthClass { COMPACT, MEDIUM, EXPANDED }

@Composable
fun rememberWindowWidthClass(): WindowWidthClass {
    val widthDp = LocalConfiguration.current.screenWidthDp
    return when {
        widthDp < 600 -> WindowWidthClass.COMPACT
        widthDp < 840 -> WindowWidthClass.MEDIUM
        else -> WindowWidthClass.EXPANDED
    }
}

/** Number of grid columns for a video grid at the current width. */
fun gridColumnsFor(widthClass: WindowWidthClass): Int =
    when (widthClass) {
        WindowWidthClass.COMPACT -> 1
        WindowWidthClass.MEDIUM -> 2
        WindowWidthClass.EXPANDED -> 3
    }
