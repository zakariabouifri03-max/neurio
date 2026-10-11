package com.vyro.play.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vyro.core.model.PlaybackQuality
import com.vyro.core.model.ThemeMode
import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.UserSettings
import com.vyro.play.BuildConfig
import com.vyro.play.R
import kotlinx.coroutines.launch

private val REGIONS =
    listOf(
        "US" to "United States",
        "GB" to "United Kingdom",
        "DE" to "Germany",
        "FR" to "France",
        "ES" to "Spain",
        "IT" to "Italy",
        "BR" to "Brazil",
        "IN" to "India",
        "JP" to "Japan",
        "KR" to "South Korea",
        "MA" to "Morocco",
        "AE" to "United Arab Emirates",
        "CA" to "Canada",
        "AU" to "Australia",
    )

private val CAPTION_LANGUAGES =
    listOf(
        "en" to "English",
        "es" to "Spanish",
        "fr" to "French",
        "de" to "German",
        "it" to "Italian",
        "pt" to "Portuguese",
        "ar" to "Arabic",
        "hi" to "Hindi",
        "ja" to "Japanese",
        "ko" to "Korean",
    )

@Composable
fun SettingsScreen(
    onOpenOfflineGuide: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showApiKeyDialog by remember { mutableStateOf(false) }

    LaunchedEffect(state.message) {
        val text = state.message ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        viewModel.consumeMessage()
    }

    Box(modifier = modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 32.dp),
        ) {
            item {
                Text(
                    text = stringResource(R.string.settings_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                )
            }

            // ---------------- Appearance ----------------
            item { SectionLabel(stringResource(R.string.settings_appearance), R.drawable.ic_palette) }

            item {
                SegmentedSetting(
                    title = stringResource(R.string.settings_theme),
                    options = ThemeMode.entries,
                    selected = state.settings.themeMode,
                    labelOf = { it.label },
                    onSelected = viewModel::setThemeMode,
                )
            }
            item {
                SwitchSetting(
                    title = stringResource(R.string.settings_dynamic_color),
                    subtitle = stringResource(R.string.settings_dynamic_color_body),
                    checked = state.settings.dynamicColor,
                    onCheckedChange = viewModel::setDynamicColor,
                )
            }
            item {
                SwitchSetting(
                    title = stringResource(R.string.settings_pure_black),
                    subtitle = stringResource(R.string.settings_pure_black_body),
                    checked = state.settings.pureBlack,
                    onCheckedChange = viewModel::setPureBlack,
                )
            }
            item {
                SwitchSetting(
                    title = stringResource(R.string.settings_reduced_animations),
                    subtitle = stringResource(R.string.settings_reduced_animations_body),
                    checked = state.settings.reducedAnimations,
                    onCheckedChange = viewModel::setReducedAnimations,
                )
            }

            // ---------------- Playback ----------------
            item { SectionLabel(stringResource(R.string.settings_playback), R.drawable.ic_play) }

            item {
                DropdownSetting(
                    title = stringResource(R.string.settings_quality),
                    subtitle = stringResource(R.string.settings_quality_body),
                    options = PlaybackQuality.entries,
                    selected = state.settings.preferredQuality,
                    labelOf = { it.label },
                    onSelected = viewModel::setPreferredQuality,
                )
            }
            item {
                SwitchSetting(
                    title = stringResource(R.string.settings_captions),
                    subtitle = stringResource(R.string.settings_captions_body),
                    checked = state.settings.captionsEnabled,
                    onCheckedChange = viewModel::setCaptionsEnabled,
                )
            }
            item {
                DropdownSetting(
                    title = stringResource(R.string.settings_captions_language),
                    subtitle = CAPTION_LANGUAGES.firstOrNull { it.first == state.settings.captionsLanguage }?.second
                        ?: state.settings.captionsLanguage,
                    options = CAPTION_LANGUAGES,
                    selected = CAPTION_LANGUAGES.firstOrNull { it.first == state.settings.captionsLanguage }
                        ?: CAPTION_LANGUAGES.first(),
                    labelOf = { it.second },
                    onSelected = { viewModel.setCaptionsLanguage(it.first) },
                )
            }
            item {
                SwitchSetting(
                    title = stringResource(R.string.settings_autoplay),
                    subtitle = "Continue with a related video when playback ends",
                    checked = state.settings.autoplayNext,
                    onCheckedChange = viewModel::setAutoplayNext,
                )
            }

            // ---------------- Data ----------------
            item { SectionLabel(stringResource(R.string.settings_data), R.drawable.ic_storage) }

            item {
                DropdownSetting(
                    title = stringResource(R.string.settings_thumbnails),
                    subtitle = stringResource(R.string.settings_thumbnails_body),
                    options = ThumbnailQuality.entries,
                    selected = state.settings.thumbnailQuality,
                    labelOf = { it.label },
                    onSelected = viewModel::setThumbnailQuality,
                )
            }
            item {
                SwitchSetting(
                    title = stringResource(R.string.settings_data_saver),
                    subtitle = stringResource(R.string.settings_data_saver_body),
                    checked = state.settings.dataSaver,
                    onCheckedChange = viewModel::setDataSaver,
                )
            }
            item {
                ClickSetting(
                    title = stringResource(R.string.settings_clear_cache),
                    subtitle = "Frees the thumbnail cache on this device",
                    icon = painterResource(id = R.drawable.ic_refresh),
                    onClick = viewModel::clearImageCache,
                )
            }

            // ---------------- Search ----------------
            item { SectionLabel(stringResource(R.string.settings_search), R.drawable.ic_search) }

            item {
                SwitchSetting(
                    title = stringResource(R.string.settings_safe_search),
                    subtitle = stringResource(R.string.settings_safe_search_body),
                    checked = state.settings.safeSearch,
                    onCheckedChange = viewModel::setSafeSearch,
                )
            }
            item {
                DropdownSetting(
                    title = stringResource(R.string.settings_region),
                    subtitle = REGIONS.firstOrNull { it.first == state.settings.regionCode }?.second
                        ?: state.settings.regionCode,
                    options = REGIONS,
                    selected = REGIONS.firstOrNull { it.first == state.settings.regionCode } ?: REGIONS.first(),
                    labelOf = { it.second },
                    onSelected = { viewModel.setRegion(it.first) },
                )
            }

            // ---------------- History ----------------
            item { SectionLabel(stringResource(R.string.settings_history), R.drawable.ic_history) }

            item {
                SwitchSetting(
                    title = stringResource(R.string.settings_remember_search),
                    subtitle = "Keeps a list of your recent searches on this device",
                    checked = state.settings.rememberSearchHistory,
                    onCheckedChange = viewModel::setRememberSearchHistory,
                )
            }
            item {
                DropdownSetting(
                    title = stringResource(R.string.settings_history_limit),
                    subtitle = "${state.settings.maxHistoryEntries} entries kept",
                    options = listOf(50, 100, 200, 500, 1000),
                    selected = state.settings.maxHistoryEntries,
                    labelOf = { it.toString() },
                    onSelected = viewModel::setHistoryLimit,
                )
            }
            item {
                ClickSetting(
                    title = stringResource(R.string.settings_clear_search_history),
                    subtitle = "Removes every stored search",
                    icon = painterResource(id = R.drawable.ic_delete),
                    onClick = viewModel::clearSearchHistory,
                )
            }
            item {
                ClickSetting(
                    title = stringResource(R.string.settings_clear_watch_history),
                    subtitle = "Removes every watched video",
                    icon = painterResource(id = R.drawable.ic_delete),
                    onClick = viewModel::clearWatchHistory,
                )
            }

            // ---------------- API ----------------
            item { SectionLabel(stringResource(R.string.settings_api), R.drawable.ic_lock) }

            item {
                ClickSetting(
                    title = stringResource(R.string.settings_api_key),
                    subtitle =
                        when (state.apiKeySource) {
                            ApiKeySource.BUILT_IN -> stringResource(R.string.settings_api_key_builtin)
                            ApiKeySource.USER_SUPPLIED -> stringResource(R.string.settings_api_key_set)
                            ApiKeySource.NONE -> stringResource(R.string.settings_api_key_missing)
                        },
                    icon = painterResource(id = R.drawable.ic_lock),
                    onClick = { showApiKeyDialog = true },
                )
            }

            // ---------------- About ----------------
            item { SectionLabel(stringResource(R.string.settings_about), R.drawable.ic_info) }

            item {
                ClickSetting(
                    title = stringResource(R.string.settings_offline_guide),
                    subtitle = "How to watch offline, the supported way",
                    icon = painterResource(id = R.drawable.ic_offline),
                    onClick = onOpenOfflineGuide,
                )
            }
            item {
                val version = stringResource(R.string.settings_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)
                Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                    Text(
                        text = version,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Playback uses the official YouTube player. VYRO PLAY never downloads, extracts or re-hosts YouTube media.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    if (showApiKeyDialog) {
        ApiKeyDialog(
            initialValue = "",
            onDismiss = { showApiKeyDialog = false },
            onSave = { value ->
                viewModel.saveApiKey(value)
                showApiKeyDialog = false
                scope.launch { snackbarHostState.showSnackbar("API key saved") }
            },
        )
    }
}

@Composable
private fun SectionLabel(
    text: String,
    iconRes: Int,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 22.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(id = iconRes),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.secondary,
            modifier = Modifier.size(16.dp),
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.secondary,
        )
    }
}

@Composable
private fun SwitchSetting(
    title: String,
    subtitle: String?,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable { onCheckedChange(!checked) }
                .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors =
                SwitchDefaults.colors(
                    checkedThumbColor = MaterialTheme.colorScheme.secondary,
                    checkedTrackColor = MaterialTheme.colorScheme.secondary.copy(alpha = 0.4f),
                ),
        )
    }
}

@Composable
private fun <T> DropdownSetting(
    title: String,
    subtitle: String?,
    options: List<T>,
    selected: T,
    labelOf: (T) -> String,
    onSelected: (T) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable { expanded = true }
                .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Box {
            Text(
                text = labelOf(selected),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.secondary,
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.secondary.copy(alpha = 0.12f))
                        .padding(horizontal = 12.dp, vertical = 7.dp),
            )
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { option ->
                    DropdownMenuItem(
                        text = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = labelOf(option),
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.weight(1f),
                                )
                                if (option == selected) {
                                    Icon(
                                        painter = painterResource(id = R.drawable.ic_check),
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.secondary,
                                        modifier = Modifier.size(18.dp),
                                    )
                                }
                            }
                        },
                        onClick = {
                            onSelected(option)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun <T> SegmentedSetting(
    title: String,
    options: List<T>,
    selected: T,
    labelOf: (T) -> String,
    onSelected: (T) -> Unit,
) {
    Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(modifier = Modifier.height(10.dp))
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            options.forEach { option ->
                val isSelected = option == selected
                Box(
                    modifier =
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(50))
                            .background(
                                if (isSelected) {
                                    MaterialTheme.colorScheme.secondary.copy(alpha = 0.2f)
                                } else {
                                    androidx.compose.ui.graphics.Color.Transparent
                                },
                            )
                            .clickable { onSelected(option) }
                            .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = labelOf(option),
                        style = MaterialTheme.typography.labelLarge,
                        color =
                            if (isSelected) {
                                MaterialTheme.colorScheme.secondary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                }
            }
        }
    }
}

@Composable
private fun ClickSetting(
    title: String,
    subtitle: String?,
    icon: Painter,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Spacer(modifier = Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ApiKeyDialog(
    initialValue: String,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf(initialValue) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = stringResource(R.string.settings_api_key_dialog_title),
                style = MaterialTheme.typography.titleSmall,
            )
        },
        text = {
            Column {
                Text(
                    text = stringResource(R.string.settings_api_key_dialog_body),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    placeholder = { Text("AIza...") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(text.trim()) }) {
                Text(stringResource(R.string.settings_api_key_save), color = MaterialTheme.colorScheme.secondary)
            }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { onSave("") }) {
                    Text(stringResource(R.string.settings_api_key_remove), color = MaterialTheme.colorScheme.error)
                }
                TextButton(onClick = onDismiss) {
                    Text(stringResource(R.string.settings_api_key_cancel))
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.surface,
    )
}
