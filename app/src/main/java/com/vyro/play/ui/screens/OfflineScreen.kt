package com.vyro.play.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.FolderSpecial
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.vyro.play.model.LocalVideoFile
import com.vyro.play.ui.components.LocalVideoRowCard
import com.vyro.play.ui.theme.VyroCyanAccent
import com.vyro.play.ui.theme.VyroPurpleDeep
import com.vyro.play.ui.theme.VyroPurplePrimary

private enum class OfflineSectionTab(val label: String) {
    LOCAL_PLAYER("My Local Videos"),
    OFFICIAL_GUIDE("Official YouTube Offline Guide")
}

@Composable
fun OfflineScreen(
    savedLocalVideos: List<LocalVideoFile>,
    deviceLocalVideos: List<LocalVideoFile>,
    isScanningDeviceVideos: Boolean,
    onPickVideoFilesClick: () -> Unit,
    onScanDeviceVideosClick: () -> Unit,
    onPlayLocalVideo: (LocalVideoFile) -> Unit,
    onRemoveSavedLocalVideo: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var activeTab by remember { mutableStateOf(OfflineSectionTab.LOCAL_PLAYER) }

    Column(modifier = modifier.fillMaxSize()) {
        // Section Header & Tab Selector
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "Offline Viewing & Local Media",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground
            )
            Text(
                text = "Play your own local video files (up to 4K) & view official YouTube offline guidance",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OfflineSectionTab.entries.forEach { tab ->
                    val selected = activeTab == tab
                    FilterChip(
                        selected = selected,
                        onClick = { activeTab = tab },
                        label = { Text(tab.label, style = MaterialTheme.typography.labelLarge) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = VyroPurpleDeep,
                            selectedLabelColor = VyroCyanAccent
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            enabled = true,
                            selected = selected,
                            selectedBorderColor = VyroCyanAccent,
                            borderColor = MaterialTheme.colorScheme.outline
                        )
                    )
                }
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (activeTab == OfflineSectionTab.LOCAL_PLAYER) {
                // Local Video Picker & MediaStore Scanner Action Card
                item(key = "local_video_actions") {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(18.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, VyroCyanAccent.copy(alpha = 0.55f))
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Default.VideoLibrary,
                                    contentDescription = null,
                                    tint = VyroCyanAccent
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "Play Your Local Video Files",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Text(
                                text = "Open any MP4, MKV, WebM, or MOV video stored on your phone or SD card using Android's secure file picker, or scan your device's video folders.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Button(
                                    onClick = onPickVideoFilesClick,
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = VyroPurplePrimary,
                                        contentColor = Color.White
                                    ),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Icon(
                                        Icons.Default.AddCircleOutline,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("Pick Video File")
                                }

                                OutlinedButton(
                                    onClick = onScanDeviceVideosClick,
                                    border = BorderStroke(1.dp, VyroCyanAccent),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    if (isScanningDeviceVideos) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(16.dp),
                                            strokeWidth = 2.dp,
                                            color = VyroCyanAccent
                                        )
                                    } else {
                                        Icon(
                                            Icons.Default.Refresh,
                                            contentDescription = null,
                                            tint = VyroCyanAccent,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("Scan Device", color = VyroCyanAccent)
                                }
                            }
                        }
                    }
                }

                // User-Picked Offline Videos Section
                if (savedLocalVideos.isNotEmpty()) {
                    item(key = "picked_videos_header") {
                        Text(
                            text = "Imported Offline Videos (${savedLocalVideos.size})",
                            style = MaterialTheme.typography.titleMedium,
                            color = VyroCyanAccent,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                    items(
                        items = savedLocalVideos,
                        key = { "picked_${it.uri}" },
                        contentType = { "local_video" }
                    ) { video ->
                        LocalVideoRowCard(
                            video = video,
                            onPlayClick = { onPlayLocalVideo(video) },
                            onRemoveClick = { onRemoveSavedLocalVideo(video.uri) }
                        )
                    }
                }

                // Scanned MediaStore Device Videos Section
                if (deviceLocalVideos.isNotEmpty()) {
                    item(key = "device_videos_header") {
                        Text(
                            text = "Device MediaStore Videos (${deviceLocalVideos.size})",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                            modifier = Modifier.padding(top = 8.dp)
                        )
                    }
                    items(
                        items = deviceLocalVideos,
                        key = { "device_${it.uri}" },
                        contentType = { "local_video" }
                    ) { video ->
                        LocalVideoRowCard(
                            video = video,
                            onPlayClick = { onPlayLocalVideo(video) },
                            onRemoveClick = null
                        )
                    }
                }

                if (savedLocalVideos.isEmpty() && deviceLocalVideos.isEmpty()) {
                    item(key = "empty_local_videos") {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
                            )
                        ) {
                            Column(
                                modifier = Modifier.padding(20.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.FolderSpecial,
                                    contentDescription = null,
                                    tint = VyroCyanAccent,
                                    modifier = Modifier.size(42.dp)
                                )
                                Text(
                                    text = "No Local Videos Loaded Yet",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    text = "Tap 'Pick Video File' to choose any video file from your device storage without granting broad folder permissions, or tap 'Scan Device' to browse your phone's video library.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }

                // Always include a concise summary link to the Official YouTube Offline Guide at bottom
                item(key = "official_guide_teaser") {
                    OfficialYouTubeOfflineCard(
                        onOpenOfficialYouTubeApp = {
                            val intent = Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("https://www.youtube.com/feed/downloads")
                            ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                            runCatching { context.startActivity(intent) }
                        }
                    )
                }
            } else {
                // Tab 2: Detailed Official YouTube Offline Viewing Guidance
                item(key = "official_guide_full") {
                    OfficialYouTubeOfflineCard(
                        onOpenOfficialYouTubeApp = {
                            val intent = Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("https://www.youtube.com/feed/downloads")
                            ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                            runCatching { context.startActivity(intent) }
                        }
                    )
                }

                item(key = "policy_compliance_card") {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Default.Security,
                                    contentDescription = null,
                                    tint = VyroCyanAccent
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "Policy & DRM Compliance Guarantee",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Text(
                                text = "VYRO PLAY strictly complies with YouTube API Services Terms of Service and Google Play Developer Policies:\n\n" +
                                    "• No Unauthorized Downloading: VYRO PLAY does not rip, scrape, or download YouTube video/audio streams.\n" +
                                    "• No Stream Extraction or DRM Circumvention: All YouTube playback runs through the official YouTube IFrame Player integration.\n" +
                                    "• Personal Local Media Support: You can freely play your own camera recordings, downloaded Creative Commons films, and personal video files using the built-in AndroidX Media3 ExoPlayer.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OfficialYouTubeOfflineCard(
    onOpenOfficialYouTubeApp: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, VyroPurplePrimary.copy(alpha = 0.6f))
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.CloudDownload,
                    contentDescription = null,
                    tint = VyroCyanAccent
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Official YouTube Offline Viewing Guide",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold
                )
            }

            Text(
                text = "To watch YouTube videos offline in accordance with YouTube's Terms of Service and creator licensing:",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            GuideStepItem(
                stepNumber = "1",
                title = "Use the Official YouTube App & YouTube Premium",
                description = "Open any video in the official YouTube app and tap the 'Download' button below the player to cache encrypted offline copies legally."
            )
            GuideStepItem(
                stepNumber = "2",
                title = "Enable Smart Downloads over Wi-Fi",
                description = "In the official YouTube app under Library → Downloads → Settings, enable Smart Downloads and select up to 1080p Full HD quality."
            )
            GuideStepItem(
                stepNumber = "3",
                title = "Play Your Personal Video Files in VYRO PLAY",
                description = "For your own MP4/MKV/WebM videos, camera clips, or Creative Commons videos stored on your phone, use the 'My Local Videos' tab above."
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.VerifiedUser,
                        contentDescription = null,
                        tint = VyroCyanAccent,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "100% YouTube ToS Compliant",
                        style = MaterialTheme.typography.labelSmall,
                        color = VyroCyanAccent
                    )
                }

                OutlinedButton(
                    onClick = onOpenOfficialYouTubeApp,
                    border = BorderStroke(1.dp, VyroCyanAccent)
                ) {
                    Icon(
                        imageVector = Icons.Default.OpenInNew,
                        contentDescription = null,
                        tint = VyroCyanAccent,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Open YouTube Downloads", color = VyroCyanAccent)
                }
            }
        }
    }
}

@Composable
private fun GuideStepItem(
    stepNumber: String,
    title: String,
    description: String
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(10.dp),
            verticalAlignment = Alignment.Top
        ) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = VyroPurpleDeep,
                border = BorderStroke(1.dp, VyroCyanAccent)
            ) {
                Text(
                    text = stepNumber,
                    style = MaterialTheme.typography.labelLarge,
                    color = VyroCyanAccent,
                    modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp)
                )
            }
            Spacer(modifier = Modifier.width(10.dp))
            Column {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
