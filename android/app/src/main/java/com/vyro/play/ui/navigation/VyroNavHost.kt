package com.vyro.play.ui.navigation

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.vyro.core.model.Video
import com.vyro.play.feature.home.HomeScreen
import com.vyro.play.feature.library.LibraryScreen
import com.vyro.play.feature.library.LibraryTab
import com.vyro.play.feature.localplayer.LocalPlayerScreen
import com.vyro.play.feature.offline.OfflineGuideScreen
import com.vyro.play.feature.player.PlayerScreen
import com.vyro.play.feature.search.SearchScreen
import com.vyro.play.feature.settings.SettingsScreen

/** Routes that keep the navigation chrome visible. */
private val CHROME_ROUTES =
    setOf(Routes.HOME, Routes.SEARCH, Routes.LIBRARY, Routes.SETTINGS, Routes.OFFLINE)

@Composable
fun VyroApp(
    deepLink: DeepLink? = null,
    modifier: Modifier = Modifier,
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showChrome = currentRoute in CHROME_ROUTES
    val widthClass = rememberWindowWidthClass()

    var deepLinkConsumed by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(deepLink) {
        if (deepLink == null || deepLinkConsumed) return@LaunchedEffect
        deepLinkConsumed = true
        when (deepLink) {
            is DeepLink.YouTube -> navController.navigate(Routes.player(deepLink.videoId))
            is DeepLink.LocalFile ->
                navController.navigate(
                    Routes.localPlayer(uri = deepLink.uri, title = "Local video"),
                )
        }
    }

    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.background,
    ) {
        Row {
            if (showChrome && widthClass != WindowWidthClass.COMPACT) {
                VyroNavigationRail(
                    currentRoute = currentRoute,
                    onNavigate = { destination -> navigateToTopLevel(navController, destination) },
                )
            }

            Scaffold(
                modifier = Modifier.weight(1f),
                containerColor = MaterialTheme.colorScheme.background,
                bottomBar = {
                    if (showChrome && widthClass == WindowWidthClass.COMPACT) {
                        VyroNavigationBar(
                            currentRoute = currentRoute,
                            onNavigate = { destination -> navigateToTopLevel(navController, destination) },
                        )
                    }
                },
            ) { padding ->
                VyroNavHost(
                    navController = navController,
                    modifier = Modifier.padding(padding),
                )
            }
        }
    }
}

private fun navigateToTopLevel(
    navController: NavHostController,
    destination: TopDestination,
) {
    navController.navigate(destination.route) {
        // Pop up to the start destination so the back stack does not grow forever.
        popUpTo(navController.graph.findStartDestination().id) {
            saveState = true
        }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun VyroNavHost(
    navController: NavHostController,
    modifier: Modifier = Modifier,
) {
    NavHost(
        navController = navController,
        startDestination = Routes.HOME,
        modifier = modifier,
    ) {
        composable(route = Routes.HOME) {
            HomeScreen(
                onVideoClick = { video -> navController.navigate(Routes.player(video.id)) },
                onOpenLocalVideos = {
                    navController.navigate(Routes.LIBRARY)
                    // LibraryScreen exposes LOCAL through its own tab state; navigating
                    // with the argument keeps deep links and UI taps consistent.
                    navController.currentBackStackEntry
                        ?.savedStateHandle
                        ?.set(Args.TAB, LibraryTab.LOCAL.name)
                },
                onOpenOfflineGuide = { navController.navigate(Routes.OFFLINE) },
                onOpenSettings = {
                    navigateToTopLevel(navController, TopDestination.SETTINGS)
                },
            )
        }

        composable(route = Routes.SEARCH) {
            SearchScreen(
                onVideoClick = { video -> navController.navigate(Routes.player(video.id)) },
            )
        }

        composable(route = Routes.LIBRARY) {
            val handle = navController.currentBackStackEntry?.savedStateHandle
            val initialTab =
                remember(handle) {
                    handle
                        ?.get<String>(Args.TAB)
                        ?.let { name -> runCatching { LibraryTab.valueOf(name) }.getOrNull() }
                        ?: LibraryTab.FAVORITES
                }

            LibraryScreen(
                initialTab = initialTab,
                onVideoClick = { video -> navController.navigate(Routes.player(video.id)) },
                onLocalVideoClick = { local ->
                    navController.navigate(Routes.localPlayer(uri = local.uri, title = local.displayName))
                },
            )
        }

        composable(route = Routes.OFFLINE) {
            OfflineGuideScreen(
                onOpenLocalVideos = {
                    navController.navigate(Routes.LIBRARY)
                    navController.currentBackStackEntry
                        ?.savedStateHandle
                        ?.set(Args.TAB, LibraryTab.LOCAL.name)
                },
            )
        }

        composable(route = Routes.SETTINGS) {
            SettingsScreen(
                onOpenOfflineGuide = { navController.navigate(Routes.OFFLINE) },
            )
        }

        composable(
            route = Routes.PLAYER,
            arguments =
                listOf(
                    navArgument(Args.VIDEO_ID) { type = NavType.StringType },
                ),
        ) {
            PlayerScreen(
                onBack = { navController.popBackStack() },
                onVideoClick = { video ->
                    navController.navigate(Routes.player(video.id)) {
                        popUpTo(Routes.PLAYER) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }

        composable(
            route = Routes.LOCAL_PLAYER,
            arguments =
                listOf(
                    navArgument(Args.URI) {
                        type = NavType.StringType
                        defaultValue = ""
                    },
                    navArgument(Args.TITLE) {
                        type = NavType.StringType
                        defaultValue = "Local video"
                    },
                ),
        ) { backStackEntry ->
            val uri = backStackEntry.arguments?.getString(Args.URI).orEmpty()
            val title = backStackEntry.arguments?.getString(Args.TITLE).orEmpty()
            LocalPlayerScreen(
                uri = uri,
                title = title,
                onBack = { navController.popBackStack() },
            )
        }
    }
}
