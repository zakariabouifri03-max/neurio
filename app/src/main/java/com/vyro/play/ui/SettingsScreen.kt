package com.vyro.play.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.vyro.play.data.UserSettings

@Composable fun SettingsScreen(settings: UserSettings, localCount: Int, model: VyroViewModel, openLink: (String) -> Unit) {
    var key by remember(settings.apiKey) { mutableStateOf(settings.apiKey) }
    var showKey by remember { mutableStateOf(false) }
    var showClear by remember { mutableStateOf(false) }
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Text("Make it yours", style = MaterialTheme.typography.headlineMedium) }
        item {
            SettingsCard("YouTube Data API v3") {
                Text("Enter a key from your Google Cloud project with YouTube Data API v3 enabled. Searches and popular lists use your project's quota. The key stays on this device. Restrict it appropriately in Cloud Console.")
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(key, { key = it }, label = { Text("API key") }, singleLine = true, visualTransformation = if (showKey) androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                Row { TextButton(onClick = { showKey = !showKey }) { Text(if (showKey) "Hide key" else "Show key") }; Spacer(Modifier.weight(1f)); Button(onClick = { model.action { setKey(key) } }) { Text("Save key") } }
                TextButton(onClick = { openLink("https://console.cloud.google.com/apis/library/youtube.googleapis.com") }) { Text("How to enable the API ↗") }
            }
        }
        item { SettingsCard("Appearance") { ChoiceRow("Theme", settings.theme, listOf("System", "Dark", "Light")) { model.action { setTheme(it) } } } }
        item {
            SettingsCard("Playback") {
                ChoiceRow("Preferred quality", settings.quality, listOf("Auto", "Data saver", "Higher quality")) { model.action { setQuality(it) } }
                Text("YouTube controls quality automatically in its official player; this setting does not override it. Local playback uses the quality of the file you selected.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                SettingSwitch("Mobile data warning", "Show a reminder before opening online videos on cellular data", settings.warnings) { model.action { setWarnings(it) } }
            }
        }
        item {
            SettingsCard("Privacy & history") {
                SettingSwitch("Save viewing history", "Turn off to stop recording new opens and local playback progress", settings.history) { model.action { setHistory(it) } }
                TextButton(onClick = { showClear = true }) { Text("Clear all viewing history") }
                TextButton(onClick = { model.action { clearSearches() } }) { Text("Clear recent searches") }
                Text("Search terms, favorites and viewing progress are stored only on this device. No accounts, passwords, cookies or personal history are uploaded by VYRO PLAY. YouTube embeds and API requests contact Google subject to its privacy policy.", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { openLink("https://policies.google.com/privacy") }) { Text("Google privacy policy ↗") }
                TextButton(onClick = { openLink("https://www.youtube.com/t/terms") }) { Text("YouTube terms of service ↗") }
            }
        }
        item { SettingsCard("Storage & diagnostics") { Text("$localCount local file references saved · Stored files are never copied into the app."); Text("VYRO PLAY 1.0.0 · Android 7.0+ · YouTube Data API v3 · Media3", style = MaterialTheme.typography.bodySmall); Text("If an imported video is missing, reconnect the drive or reselect the file. API errors may indicate quota, invalid key, restrictions or no connection.", style = MaterialTheme.typography.bodySmall) } }
        item { Text("VYRO PLAY is an independent player and is not affiliated with YouTube or Google. YouTube is a trademark of Google LLC.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    if (showClear) AlertDialog(onDismissRequest = { showClear = false }, title = { Text("Clear history?") }, text = { Text("Remove all local watch history and saved playback positions? Favorites and your files are kept.") }, confirmButton = { TextButton(onClick = { model.action { clearHistory() }; showClear = false }) { Text("Clear") } }, dismissButton = { TextButton(onClick = { showClear = false }) { Text("Cancel") } })
}
@Composable private fun SettingsCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary); content() }
    }
}
@Composable private fun ChoiceRow(label: String, current: String, choices: List<String>, select: (String) -> Unit) {
    Text(label)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) { choices.forEach { value -> FilterChip(selected = current == value, onClick = { select(value) }, label = { Text(value, maxLines = 1) }) } }
}
@Composable private fun SettingSwitch(title: String, description: String, enabled: Boolean, set: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(title); Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Switch(enabled, set)
    }
}
