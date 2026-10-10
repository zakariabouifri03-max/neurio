package com.neurio.aivibes.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import com.neurio.aivibes.AppViewModel
import com.neurio.aivibes.ui.screens.AiScreen
import com.neurio.aivibes.ui.screens.HeadphonesScreen
import com.neurio.aivibes.ui.screens.HomeScreen
import com.neurio.aivibes.ui.screens.LibraryScreen
import com.neurio.aivibes.ui.screens.PlayerScreen
import com.neurio.aivibes.ui.screens.SettingsScreen
import com.neurio.aivibes.ui.screens.StudioScreen
import com.neurio.aivibes.ui.screens.VisualizerScreen
import com.neurio.aivibes.ui.theme.VibeColors

object Routes {
    const val HOME = "home"
    const val STUDIO = "studio"
    const val LIBRARY = "library"
    const val VISUALIZER = "visualizer"
    const val SETTINGS = "settings"
    const val PLAYER = "player"
    const val HEADPHONES = "headphones"
    const val AI = "ai"

    val bottomBar = listOf(HOME, LIBRARY, STUDIO, VISUALIZER, SETTINGS)
}

private data class BarItem(val route: String, val label: String, val icon: ImageVector)

private val barItems = listOf(
    BarItem(Routes.HOME, "Home", Icons.Filled.Home),
    BarItem(Routes.LIBRARY, "Library", Icons.Filled.LibraryMusic),
    BarItem(Routes.STUDIO, "Studio", Icons.Filled.AutoAwesome),
    BarItem(Routes.VISUALIZER, "Vibe", Icons.Filled.GraphicEq),
    BarItem(Routes.SETTINGS, "Settings", Icons.Filled.Settings)
)

@Composable
fun AiVibesNav(
    nav: NavHostController,
    vm: AppViewModel,
    initialRoute: String,
    onPermissionRequest: () -> Unit
) {
    val backStack by nav.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route ?: initialRoute

    androidx.compose.foundation.layout.Column(modifier = Modifier) {
        NavHost(
            navController = nav,
            startDestination = initialRoute,
            modifier = Modifier.weight(1f)
        ) {
            composable(Routes.HOME) {
                HomeScreen(
                    vm = vm,
                    onOpenStudio = { nav.go(Routes.STUDIO) },
                    onOpenVisualizer = { nav.go(Routes.VISUALIZER) },
                    onOpenHeadphones = { nav.go(Routes.HEADPHONES) },
                    onOpenPlayer = { nav.go(Routes.PLAYER) }
                )
            }
            composable(Routes.STUDIO) { StudioScreen(vm) }
            composable(Routes.LIBRARY) { LibraryScreen(vm) }
            composable(Routes.VISUALIZER) { VisualizerScreen(vm) }
            composable(Routes.SETTINGS) { SettingsScreen(vm) }
            composable(Routes.PLAYER) { PlayerScreen(vm) }
            composable(Routes.HEADPHONES) { HeadphonesScreen(vm) }
            composable(Routes.AI) { AiScreen(vm) }
        }

        if (currentRoute in Routes.bottomBar) {
            NavigationBar(containerColor = VibeColors.Deep) {
                barItems.forEach { item ->
                    NavigationBarItem(
                        selected = currentRoute == item.route,
                        onClick = {
                            nav.navigate(item.route) {
                                popUpTo(nav.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = VibeColors.Cyan,
                            selectedTextColor = VibeColors.Cyan,
                            unselectedIconColor = VibeColors.Muted,
                            unselectedTextColor = VibeColors.Muted,
                            indicatorColor = VibeColors.Purple.copy(alpha = 0.18f)
                        )
                    )
                }
            }
        }
    }
}

private fun NavHostController.go(route: String) {
    navigate(route) {
        launchSingleTop = true
    }
}
