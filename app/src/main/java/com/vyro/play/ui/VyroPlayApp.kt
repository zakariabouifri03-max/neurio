package com.vyro.play.ui

import android.Manifest
import android.app.Activity
import android.content.pm.ActivityInfo
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vyro.play.model.NetworkState
import com.vyro.play.model.ThemeMode
import com.vyro.play.ui.components.VyroPlayerDock
import com.vyro.play.ui.screens.ExploreScreen
import com.vyro.play.ui.screens.FavoritesScreen
import com.vyro.play.ui.screens.HistoryScreen
import com.vyro.play.ui.screens.OfflineScreen
import com.vyro.play.ui.screens.SettingsScreen
import com.vyro.play.ui.theme.VyroCyanAccent
import com.vyro.play.ui.theme.VyroErrorCoral
import com.vyro.play.ui.theme.VyroObsidianBlack
import com.vyro.play.ui.theme.VyroPurpleDeep
import com.vyro.play.ui.theme.VyroPurplePrimary
import com.vyro.play.ui.theme.VyroSuccessGreen
import com.vyro.play.ui.viewmodel.VyroViewModel

enum class VyroTab(val label: String, val icon: ImageVector) {
    EXPLORE("Explore", Icons.Default.Explore),
    FAVORITES("Favorites", Icons.Default.Favorite),
    HISTORY("History", Icons.Default.History),
    OFFLINE("Offline", Icons.Default.VideoLibrary),
    SETTINGS("Settings", Icons.Default.Settings)
}

@Composable
fun VyroPlayApp(
    viewModel: VyroViewModel
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val settings by viewModel.settingsState.collectAsStateWithLifecycle()
    val favorites by viewModel.favoritesState.collectAsStateWithLifecycle()
    val favoriteIds by viewModel.favoriteIdsState.collectAsStateWithLifecycle()
    val watchHistory by viewModel.watchHistoryState.collectAsStateWithLifecycle()
    val searchHistory by viewModel.searchHistoryState.collectAsStateWithLifecycle()
    val savedLocalVideos by viewModel.savedLocalVideosState.collectAsStateWithLifecycle()
    val cachedQueryCount by viewModel.cachedQueryCountState.collectAsStateWithLifecycle()
    val networkState by viewModel.networkState.collectAsStateWithLifecycle()

    var currentTab by rememberSaveable { mutableStateOf(VyroTab.EXPLORE) }
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current

    // SAF Picker for user's own local video files
    val safVideoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isNotEmpty()) {
            viewModel.onLocalVideosPicked(uris)
        }
    }

    // Runtime permission launcher for scanning device MediaStore videos
    val mediaPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        viewModel.onMediaVideoPermissionResult(granted)
    }

    // Handle fullscreen orientation and immersive system bars
    LaunchedEffect(uiState.isFullscreen) {
        val activity = context as? Activity ?: return@LaunchedEffect
        val window = activity.window
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        if (uiState.isFullscreen) {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            insetsController.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            insetsController.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            insetsController.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    // Show status snackbar messages
    LaunchedEffect(uiState.statusBannerMessage) {
        val msg = uiState.statusBannerMessage
        if (!msg.isNullOrBlank()) {
            snackbarHostState.showSnackbar(msg)
            viewModel.dismissStatusBanner()
        }
    }

    if (uiState.isFullscreen && uiState.hasActivePlayer) {
        // Fullscreen Landscape Player View
        VyroPlayerDock(
            activeYouTubeVideo = uiState.activeYouTubeVideo,
            youTubeStartSeconds = uiState.activeYouTubeStartSeconds,
            activeLocalVideo = uiState.activeLocalVideo,
            isFavorite = uiState.activeYouTubeVideo?.let { favoriteIds.contains(it.id) } == true,
            preferredQuality = settings.preferredQuality,
            captionsDefaultEnabled = settings.captionsEnabledByDefault,
            captionsLanguage = settings.captionsLanguage,
            isFullscreen = true,
            onToggleFullscreen = { viewModel.setFullscreen(it) },
            onToggleFavorite = { viewModel.toggleFavorite(it) },
            onQualitySelected = { viewModel.setPreferredQuality(it) },
            onYouTubeProgress = { cur, dur -> viewModel.onYouTubePlaybackProgress(cur, dur) },
            onLocalProgress = { posMs, durMs -> viewModel.onLocalVideoProgress(posMs, durMs) },
            onClosePlayer = { viewModel.closePlayer() },
            modifier = Modifier.fillMaxSize()
        )
    } else {
        Scaffold(
            topBar = {
                VyroHeaderBar(
                    networkState = networkState,
                    themeMode = settings.themeMode,
                    lowEndMode = settings.lowEndPerformanceMode,
                    onToggleTheme = {
                        val next = when (settings.themeMode) {
                            ThemeMode.DARK -> ThemeMode.LIGHT
                            ThemeMode.LIGHT -> ThemeMode.DARK
                            ThemeMode.SYSTEM -> ThemeMode.DARK
                        }
                        viewModel.setThemeMode(next)
                    }
                )
            },
            bottomBar = {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 8.dp
                ) {
                    VyroTab.entries.forEach { tab ->
                        val selected = currentTab == tab
                        NavigationBarItem(
                            selected = selected,
                            onClick = { currentTab = tab },
                            icon = {
                                if (tab == VyroTab.FAVORITES && favorites.isNotEmpty()) {
                                    BadgedBox(
                                        badge = {
                                            Badge(
                                                containerColor = VyroCyanAccent,
                                                contentColor = VyroObsidianBlack
                                            ) {
                                                Text(favorites.size.toString())
                                            }
                                        }
                                    ) {
                                        Icon(tab.icon, contentDescription = tab.label)
                                    }
                                } else {
                                    Icon(tab.icon, contentDescription = tab.label)
                                }
                            },
                            label = {
                                Text(
                                    text = tab.label,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal
                                )
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = VyroCyanAccent,
                                selectedTextColor = VyroCyanAccent,
                                indicatorColor = VyroPurpleDeep,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        )
                    }
                }
            },
            snackbarHost = { SnackbarHost(snackbarHostState) },
            containerColor = MaterialTheme.colorScheme.background
        ) { innerPadding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            ) {
                // Offline Network Detection Banner
                AnimatedVisibility(
                    visible = !networkState.isOnline,
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut()
                ) {
                    Surface(
                        color = VyroErrorCoral.copy(alpha = 0.18f),
                        border = BorderStroke(1.dp, VyroErrorCoral.copy(alpha = 0.6f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.CloudOff,
                                    contentDescription = null,
                                    tint = VyroErrorCoral,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "Device is offline. Cached searches & local videos remain available.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }
                            TextButton(onClick = { currentTab = VyroTab.OFFLINE }) {
                                Text("Open Offline", color = VyroCyanAccent, style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                }

                // Active Docked Video Player (YouTube or Local Media3)
                AnimatedVisibility(
                    visible = uiState.hasActivePlayer,
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut()
                ) {
                    VyroPlayerDock(
                        activeYouTubeVideo = uiState.activeYouTubeVideo,
                        youTubeStartSeconds = uiState.activeYouTubeStartSeconds,
                        activeLocalVideo = uiState.activeLocalVideo,
                        isFavorite = uiState.activeYouTubeVideo?.let { favoriteIds.contains(it.id) } == true,
                        preferredQuality = settings.preferredQuality,
                        captionsDefaultEnabled = settings.captionsEnabledByDefault,
                        captionsLanguage = settings.captionsLanguage,
                        isFullscreen = false,
                        onToggleFullscreen = { viewModel.setFullscreen(it) },
                        onToggleFavorite = { viewModel.toggleFavorite(it) },
                        onQualitySelected = { viewModel.setPreferredQuality(it) },
                        onYouTubeProgress = { cur, dur -> viewModel.onYouTubePlaybackProgress(cur, dur) },
                        onLocalProgress = { posMs, durMs -> viewModel.onLocalVideoProgress(posMs, durMs) },
                        onClosePlayer = { viewModel.closePlayer() }
                    )
                }

                // Main Screen Content with Smooth Tab Transitions
                Box(modifier = Modifier.weight(1f)) {
                    AnimatedContent(
                        targetState = currentTab,
                        transitionSpec = { fadeIn() togetherWith fadeOut() },
                        label = "tabTransition"
                    ) { tab ->
                        when (tab) {
                            VyroTab.EXPLORE -> ExploreScreen(
                                searchQuery = uiState.searchQuery,
                                activeCategory = uiState.activeCategory,
                                videos = uiState.videos,
                                favoriteIds = favoriteIds,
                                searchHistory = searchHistory,
                                isLoading = uiState.isLoading,
                                isFromCache = uiState.isFromCache,
                                errorMessage = uiState.errorMessage,
                                errorCode = uiState.errorCode,
                                hasConfiguredApiKey = viewModel.hasConfiguredApiKey(settings.customApiKey),
                                onSearchQueryChange = { viewModel.updateSearchQuery(it) },
                                onExecuteSearch = { viewModel.executeSearch(it) },
                                onSelectCategory = { viewModel.selectCategory(it) },
                                onRefresh = { viewModel.refreshCurrentFeed() },
                                onPlayVideo = { viewModel.playYouTubeVideo(it) },
                                onPlayUrlOrId = { viewModel.playYouTubeByUrlOrId(it) },
                                onToggleFavorite = { viewModel.toggleFavorite(it) },
                                onDeleteSearchHistory = { viewModel.deleteSearchHistoryItem(it) },
                                onClearSearchHistory = { viewModel.clearSearchHistory() },
                                onSaveApiKey = { viewModel.saveAndValidateApiKey(it) },
                                onNavigateToSettings = { currentTab = VyroTab.SETTINGS }
                            )

                            VyroTab.FAVORITES -> FavoritesScreen(
                                favorites = favorites,
                                onPlayVideo = { viewModel.playYouTubeVideo(it) },
                                onToggleFavorite = { viewModel.toggleFavorite(it) },
                                onClearAllFavorites = { viewModel.clearAllFavorites() }
                            )

                            VyroTab.HISTORY -> HistoryScreen(
                                watchHistory = watchHistory,
                                pauseWatchHistory = settings.pauseWatchHistory,
                                onTogglePauseHistory = { viewModel.setPauseWatchHistory(it) },
                                onResumeItem = { viewModel.resumeFromWatchHistory(it) },
                                onDeleteItem = { viewModel.deleteWatchHistoryItem(it) },
                                onClearAllHistory = { viewModel.clearWatchHistory() }
                            )

                            VyroTab.OFFLINE -> OfflineScreen(
                                savedLocalVideos = savedLocalVideos,
                                deviceLocalVideos = uiState.deviceLocalVideos,
                                isScanningDeviceVideos = uiState.isScanningLocalVideos,
                                onPickVideoFilesClick = {
                                    safVideoPickerLauncher.launch(arrayOf("video/*"))
                                },
                                onScanDeviceVideosClick = {
                                    val perm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                        Manifest.permission.READ_MEDIA_VIDEO
                                    } else {
                                        Manifest.permission.READ_EXTERNAL_STORAGE
                                    }
                                    mediaPermissionLauncher.launch(perm)
                                },
                                onPlayLocalVideo = { viewModel.playLocalVideo(it) },
                                onRemoveSavedLocalVideo = { viewModel.removeSavedLocalVideo(it) }
                            )

                            VyroTab.SETTINGS -> SettingsScreen(
                                settings = settings,
                                networkState = networkState,
                                cachedQueryCount = cachedQueryCount,
                                favoritesCount = favorites.size,
                                watchHistoryCount = watchHistory.size,
                                isValidatingApiKey = uiState.isValidatingApiKey,
                                apiKeyValidationMessage = uiState.apiKeyValidationMessage,
                                onThemeModeChange = { viewModel.setThemeMode(it) },
                                onPreferredQualityChange = { viewModel.setPreferredQuality(it) },
                                onCaptionsEnabledChange = { viewModel.setCaptionsEnabled(it) },
                                onCaptionsLanguageChange = { viewModel.setCaptionsLanguage(it) },
                                onLowEndModeChange = { viewModel.setLowEndPerformanceMode(it) },
                                onSafeSearchModeChange = { viewModel.setSafeSearchMode(it) },
                                onRegionCodeChange = { viewModel.setRegionCode(it) },
                                onSaveAndValidateApiKey = { viewModel.saveAndValidateApiKey(it) },
                                onClearApiCache = { viewModel.clearApiCache() },
                                onClearSearchHistory = { viewModel.clearSearchHistory() },
                                onClearWatchHistory = { viewModel.clearWatchHistory() }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun VyroHeaderBar(
    networkState: NetworkState,
    themeMode: ThemeMode,
    lowEndMode: Boolean,
    onToggleTheme: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            // Brand Logo & Title
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = VyroPurpleDeep,
                    border = BorderStroke(1.5.dp, VyroCyanAccent),
                    modifier = Modifier.size(36.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(
                                Brush.linearGradient(
                                    listOf(VyroPurplePrimary, VyroPurpleDeep)
                                )
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.PlayArrow,
                            contentDescription = null,
                            tint = VyroCyanAccent,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(10.dp))

                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "VYRO",
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.ExtraBold
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "PLAY",
                            style = MaterialTheme.typography.titleLarge,
                            color = VyroCyanAccent,
                            fontWeight = FontWeight.ExtraBold
                        )
                    }
                    Text(
                        text = "Official YouTube 4K & Local Media",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Status Badges & Theme Switcher
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (lowEndMode) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = VyroPurpleDeep.copy(alpha = 0.7f),
                        border = BorderStroke(1.dp, VyroCyanAccent.copy(alpha = 0.6f))
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Speed,
                                contentDescription = "Low-end optimization active",
                                tint = VyroCyanAccent,
                                modifier = Modifier.size(13.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "TURBO",
                                style = MaterialTheme.typography.labelSmall,
                                color = VyroCyanAccent
                            )
                        }
                    }
                }

                Surface(
                    shape = CircleShape,
                    color = if (networkState.isOnline) {
                        VyroSuccessGreen.copy(alpha = 0.15f)
                    } else {
                        VyroErrorCoral.copy(alpha = 0.15f)
                    },
                    border = BorderStroke(
                        1.dp,
                        if (networkState.isOnline) VyroSuccessGreen else VyroErrorCoral
                    )
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = if (networkState.isOnline) Icons.Default.Wifi else Icons.Default.CloudOff,
                            contentDescription = networkState.connectionLabel,
                            tint = if (networkState.isOnline) VyroSuccessGreen else VyroErrorCoral,
                            modifier = Modifier.size(13.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = if (networkState.isOnline) "ONLINE" else "OFFLINE",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (networkState.isOnline) VyroSuccessGreen else VyroErrorCoral
                        )
                    }
                }

                IconButton(
                    onClick = onToggleTheme,
                    modifier = Modifier.size(34.dp)
                ) {
                    Icon(
                        imageVector = if (themeMode == ThemeMode.LIGHT) Icons.Default.DarkMode else Icons.Default.LightMode,
                        contentDescription = "Toggle Dark/Light Theme",
                        tint = VyroCyanAccent
                    )
                }
            }
        }
        HorizontalDivider(color = VyroPurplePrimary.copy(alpha = 0.3f))
    }
}
