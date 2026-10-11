package com.vyro.play.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.vyro.play.BuildConfig
import com.vyro.play.model.AppSettings
import com.vyro.play.model.NetworkState
import com.vyro.play.model.SafeSearchMode
import com.vyro.play.model.ThemeMode
import com.vyro.play.model.VideoQualityOption
import com.vyro.play.ui.theme.VyroCyanAccent
import com.vyro.play.ui.theme.VyroPurpleDeep
import com.vyro.play.ui.theme.VyroPurplePrimary

@Composable
fun SettingsScreen(
    settings: AppSettings,
    networkState: NetworkState,
    cachedQueryCount: Int,
    favoritesCount: Int,
    watchHistoryCount: Int,
    isValidatingApiKey: Boolean,
    apiKeyValidationMessage: String?,
    onThemeModeChange: (ThemeMode) -> Unit,
    onPreferredQualityChange: (VideoQualityOption) -> Unit,
    onCaptionsEnabledChange: (Boolean) -> Unit,
    onCaptionsLanguageChange: (String) -> Unit,
    onLowEndModeChange: (Boolean) -> Unit,
    onSafeSearchModeChange: (SafeSearchMode) -> Unit,
    onRegionCodeChange: (String) -> Unit,
    onSaveAndValidateApiKey: (String) -> Unit,
    onClearApiCache: () -> Unit,
    onClearSearchHistory: () -> Unit,
    onClearWatchHistory: () -> Unit,
    modifier: Modifier = Modifier
) {
    var apiKeyDraft by remember(settings.customApiKey) { mutableStateOf(settings.customApiKey) }
    var showApiKeyPlain by remember { mutableStateOf(false) }

    val availableLanguages = listOf("en" to "English", "es" to "Español", "fr" to "Français", "de" to "Deutsch", "ar" to "العربية", "ja" to "日本語")
    val availableRegions = listOf("US", "GB", "CA", "DE", "FR", "JP", "IN", "BR")

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item(key = "settings_header") {
            Column {
                Text(
                    text = "Settings & Configuration",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Text(
                    text = "Network: ${networkState.connectionLabel} • VYRO PLAY v${BuildConfig.VERSION_NAME}",
                    style = MaterialTheme.typography.bodySmall,
                    color = VyroCyanAccent
                )
            }
        }

        // 1. YouTube Data API v3 Key Card
        item(key = "api_key_section") {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, VyroCyanAccent.copy(alpha = 0.6f))
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Key, contentDescription = null, tint = VyroCyanAccent)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "YouTube Data API v3 Configuration",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    val buildConfigHasKey = BuildConfig.YOUTUBE_API_KEY.isNotBlank()
                    Text(
                        text = if (settings.customApiKey.isNotBlank()) {
                            "Status: Active custom API key stored securely in DataStore."
                        } else if (buildConfigHasKey) {
                            "Status: Active build-time API key loaded from local.properties."
                        } else {
                            "Status: No API key configured yet. Paste your Google Cloud YouTube Data API v3 key below or set YOUTUBE_API_KEY in local.properties."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = VyroCyanAccent
                    )

                    OutlinedTextField(
                        value = apiKeyDraft,
                        onValueChange = { apiKeyDraft = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("YouTube Data API v3 Key") },
                        placeholder = { Text("AIzaSy...") },
                        singleLine = true,
                        visualTransformation = if (showApiKeyPlain) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        trailingIcon = {
                            IconButton(onClick = { showApiKeyPlain = !showApiKeyPlain }) {
                                Icon(
                                    imageVector = if (showApiKeyPlain) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = if (showApiKeyPlain) "Hide key" else "Show key"
                                )
                            }
                        }
                    )

                    if (!apiKeyValidationMessage.isNullOrBlank()) {
                        Text(
                            text = apiKeyValidationMessage,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (apiKeyValidationMessage.contains("failed", ignoreCase = true)) {
                                MaterialTheme.colorScheme.error
                            } else {
                                VyroCyanAccent
                            }
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = { onSaveAndValidateApiKey(apiKeyDraft) },
                            enabled = !isValidatingApiKey,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = VyroPurplePrimary,
                                contentColor = Color.White
                            )
                        ) {
                            if (isValidatingApiKey) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = Color.White
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                            }
                            Text("Save & Verify Key")
                        }

                        if (apiKeyDraft.isNotEmpty()) {
                            OutlinedButton(
                                onClick = {
                                    apiKeyDraft = ""
                                    onSaveAndValidateApiKey("")
                                }
                            ) {
                                Text("Clear Key")
                            }
                        }
                    }

                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))

                    Text(
                        text = "How to get a free YouTube Data API v3 Key:\n" +
                            "1. Open console.cloud.google.com and create/select a project.\n" +
                            "2. Go to APIs & Services → Library → enable 'YouTube Data API v3'.\n" +
                            "3. Go to APIs & Services → Credentials → Create Credentials → API Key.\n" +
                            "4. Paste the key above or add YOUTUBE_API_KEY=your_key in local.properties.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }

        // 2. Theme & Appearance Card
        item(key = "theme_section") {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Palette, contentDescription = null, tint = VyroCyanAccent)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Theme & Appearance",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    ThemeMode.entries.forEach { mode ->
                        val selected = settings.themeMode == mode
                        FilterChip(
                            selected = selected,
                            onClick = { onThemeModeChange(mode) },
                            label = { Text(mode.label) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = VyroPurpleDeep,
                                selectedLabelColor = VyroCyanAccent
                            )
                        )
                    }
                }
            }
        }

        // 3. Playback Quality (Up to 4K) & Captions Card
        item(key = "quality_captions_section") {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.HighQuality, contentDescription = null, tint = VyroCyanAccent)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Playback Quality & Captions",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Text(
                        text = "Default Preferred Quality (Up to 2160p 4K Ultra HD):",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurface
                    )

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        VideoQualityOption.entries.forEach { quality ->
                            val selected = settings.preferredQuality == quality
                            FilterChip(
                                selected = selected,
                                onClick = { onPreferredQualityChange(quality) },
                                label = { Text("${quality.badge} (${quality.label.substringBefore(" ")})") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = VyroPurpleDeep,
                                    selectedLabelColor = VyroCyanAccent
                                )
                            )
                        }
                    }

                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.ClosedCaption, contentDescription = null, tint = VyroCyanAccent)
                        Spacer(modifier = Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Enable Captions (CC) by Default",
                                style = MaterialTheme.typography.titleSmall
                            )
                            Text(
                                text = "Automatically load closed captions when supported by the video",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = settings.captionsEnabledByDefault,
                            onCheckedChange = onCaptionsEnabledChange,
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = VyroCyanAccent,
                                checkedTrackColor = VyroPurpleDeep
                            )
                        )
                    }

                    Text(
                        text = "Preferred Caption Language:",
                        style = MaterialTheme.typography.labelLarge
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        availableLanguages.forEach { (code, name) ->
                            FilterChip(
                                selected = settings.captionsLanguage == code,
                                onClick = { onCaptionsLanguageChange(code) },
                                label = { Text("$name ($code)") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = VyroPurpleDeep,
                                    selectedLabelColor = VyroCyanAccent
                                )
                            )
                        }
                    }

                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))

                    Text(
                        text = "Search SafeSearch Filter:",
                        style = MaterialTheme.typography.labelLarge
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SafeSearchMode.entries.forEach { mode ->
                            FilterChip(
                                selected = settings.safeSearchMode == mode,
                                onClick = { onSafeSearchModeChange(mode) },
                                label = { Text(mode.label) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = VyroPurpleDeep,
                                    selectedLabelColor = VyroCyanAccent
                                )
                            )
                        }
                    }

                    Text(
                        text = "Trending Region Code:",
                        style = MaterialTheme.typography.labelLarge
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        availableRegions.forEach { reg ->
                            FilterChip(
                                selected = settings.regionCode == reg,
                                onClick = { onRegionCodeChange(reg) },
                                label = { Text(reg) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = VyroPurpleDeep,
                                    selectedLabelColor = VyroCyanAccent
                                )
                            )
                        }
                    }
                }
            }
        }

        // 4. Low-End Phone Performance Optimization Card
        item(key = "low_end_optimization_section") {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Memory, contentDescription = null, tint = VyroCyanAccent)
                        Spacer(modifier = Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Low-End Phone Performance Mode",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "Uses compact 320p thumbnails, RGB_565 bitmap decoding, and reduced GPU overdraw for smooth 60fps scrolling on budget phones.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = settings.lowEndPerformanceMode,
                            onCheckedChange = onLowEndModeChange,
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = VyroCyanAccent,
                                checkedTrackColor = VyroPurpleDeep
                            )
                        )
                    }
                }
            }
        }

        // 5. Storage, Cache & Privacy Management Card
        item(key = "storage_cache_section") {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Storage, contentDescription = null, tint = VyroCyanAccent)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Cache & Local Data Management",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Text(
                        text = "• Cached API Queries (15-min TTL): $cachedQueryCount\n" +
                            "• Saved Favorites: $favoritesCount\n" +
                            "• Watch History Items: $watchHistoryCount",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = onClearApiCache,
                            border = BorderStroke(1.dp, VyroCyanAccent)
                        ) {
                            Icon(Icons.Default.DeleteOutline, contentDescription = null, tint = VyroCyanAccent, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Clear API Cache", color = VyroCyanAccent)
                        }

                        OutlinedButton(onClick = onClearSearchHistory) {
                            Text("Clear Search History")
                        }

                        OutlinedButton(onClick = onClearWatchHistory) {
                            Text("Clear Watch History")
                        }
                    }
                }
            }
        }
    }
}
