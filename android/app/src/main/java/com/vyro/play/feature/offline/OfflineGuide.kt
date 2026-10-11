package com.vyro.play.feature.offline

import android.content.Intent
import androidx.compose.foundation.background
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
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.vyro.play.R

private const val YOUTUBE_PREMIUM_URL = "https://www.youtube.com/premium"
private const val YOUTUBE_TERMS_URL = "https://www.youtube.com/static?template=terms"
private const val YOUTUBE_OFFLINE_HELP_URL = "https://support.google.com/youtube/answer/6141269"

/**
 * The app's offline-viewing section.
 *
 * VYRO PLAY streams through the official YouTube player. YouTube's Terms of Service do
 * not permit downloading videos from youtube.com, so this screen explains the supported
 * alternatives and points at the user's own files, which always work offline.
 */
@Composable
fun OfflineGuideScreen(
    modifier: Modifier = Modifier,
    onOpenLocalVideos: (() -> Unit)? = null,
) {
    val context = LocalContext.current

    LazyColumn(
        modifier =
            modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(vertical = 8.dp, horizontal = 0.dp),
    ) {
        item {
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_offline),
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.size(28.dp),
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = stringResource(R.string.offline_title),
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = stringResource(R.string.offline_intro),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        item {
            OfflineCard(
                iconRes = R.drawable.ic_download,
                title = stringResource(R.string.offline_premium_title),
                body = stringResource(R.string.offline_premium_body),
                actionLabel = stringResource(R.string.offline_open_in_browser),
                onAction = { openUrl(context, YOUTUBE_PREMIUM_URL) },
            )
        }
        item {
            OfflineCard(
                iconRes = R.drawable.ic_play,
                title = stringResource(R.string.offline_music_title),
                body = stringResource(R.string.offline_music_body),
            )
        }
        item {
            OfflineCard(
                iconRes = R.drawable.ic_check,
                title = stringResource(R.string.offline_creators_title),
                body = stringResource(R.string.offline_creators_body),
                actionLabel = if (onOpenLocalVideos != null) stringResource(R.string.tab_local) else null,
                onAction = onOpenLocalVideos,
            )
        }
        item {
            OfflineCard(
                iconRes = R.drawable.ic_folder,
                title = stringResource(R.string.offline_local_title),
                body = stringResource(R.string.offline_local_body),
                actionLabel = if (onOpenLocalVideos != null) stringResource(R.string.tab_local) else null,
                onAction = onOpenLocalVideos,
            )
        }
        item {
            OfflineCard(
                iconRes = R.drawable.ic_speed,
                title = stringResource(R.string.offline_data_saver_title),
                body = stringResource(R.string.offline_data_saver_body),
            )
        }

        item {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                TextButton(onClick = { openUrl(context, YOUTUBE_OFFLINE_HELP_URL) }) {
                    Text(
                        text = stringResource(R.string.offline_know_more),
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
                TextButton(onClick = { openUrl(context, YOUTUBE_TERMS_URL) }) {
                    Text(
                        text = "Terms of Service",
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }
        }

        item { Spacer(modifier = Modifier.height(24.dp)) }
    }
}

@Composable
private fun OfflineCard(
    iconRes: Int,
    title: String,
    body: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier =
                    Modifier
                        .size(36.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.secondary.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(id = iconRes),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Start,
        )
        if (actionLabel != null && onAction != null) {
            TextButton(onClick = onAction, contentPadding = PaddingValues(0.dp)) {
                Text(
                    text = actionLabel,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
        }
    }
}

private fun openUrl(
    context: android.content.Context,
    url: String,
) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)))
    }
}
