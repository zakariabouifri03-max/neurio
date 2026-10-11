package com.vyro.play.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.Video
import com.vyro.core.util.Formatters
import com.vyro.play.R

/**
 * The horizontal list card used on Home / Search / Favorites.
 */
@Composable
fun VideoRowCard(
    video: Video,
    thumbnailQuality: ThumbnailQuality,
    isFavorite: Boolean,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    modifier: Modifier = Modifier,
    progressFraction: Float = 0f,
    subtitle: String? = null,
) {
    val scale by animateFloatAsState(
        targetValue = 1f,
        animationSpec = spring(stiffness = 400f),
        label = "row-scale",
    )

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier =
                Modifier
                    .width(160.dp)
                    .aspectRatio(16f / 9f)
                    .clip(RoundedCornerShape(12.dp)),
        ) {
            VideoThumbnail(
                videoId = video.id,
                thumbnails = video.thumbnails,
                quality = thumbnailQuality,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )

            if (video.durationMillis > 0L && !video.isLive) {
                DurationBadge(
                    text = Formatters.clockDuration(video.durationMillis),
                    modifier =
                        Modifier
                            .align(Alignment.BottomEnd)
                            .padding(6.dp),
                )
            }

            if (video.isLive) {
                LiveBadge(modifier = Modifier.align(Alignment.BottomStart).padding(6.dp))
            }

            if (progressFraction > 0f) {
                LinearProgressIndicator(
                    progress = { progressFraction.coerceIn(0f, 1f) },
                    modifier =
                        Modifier
                            .align(Alignment.BottomCenter)
                            .fillMaxWidth()
                            .height(3.dp),
                    color = MaterialTheme.colorScheme.secondary,
                    trackColor = Color.White.copy(alpha = 0.25f),
                )
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = video.title,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = video.channelTitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = buildMetaLine(video, subtitle),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        FavoriteToggle(
            isFavorite = isFavorite,
            onClick = onFavoriteClick,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
}

/** The grid card used for trending rows and the library grid. */
@Composable
fun VideoGridCard(
    video: Video,
    thumbnailQuality: ThumbnailQuality,
    isFavorite: Boolean,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.clickable(onClick = onClick)) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .clip(RoundedCornerShape(14.dp)),
        ) {
            VideoThumbnail(
                videoId = video.id,
                thumbnails = video.thumbnails,
                quality = thumbnailQuality,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (video.durationMillis > 0L && !video.isLive) {
                DurationBadge(
                    text = Formatters.clockDuration(video.durationMillis),
                    modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp),
                )
            }
            FavoriteToggle(
                isFavorite = isFavorite,
                onClick = onFavoriteClick,
                modifier = Modifier.align(Alignment.TopEnd).padding(4.dp),
                size = 32.dp,
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = video.title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = video.channelTitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun FavoriteToggle(
    isFavorite: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 40.dp,
) {
    val tint by animateColorAsState(
        targetValue = if (isFavorite) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant,
        label = "favorite-tint",
    )
    IconButton(onClick = onClick, modifier = modifier.size(size)) {
        AnimatedContent(
            targetState = isFavorite,
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "favorite-icon",
        ) { favorite ->
            Icon(
                painter =
                    painterResource(
                        id = if (favorite) R.drawable.ic_heart else R.drawable.ic_heart_outline,
                    ),
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
fun DurationBadge(
    text: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .clip(RoundedCornerShape(6.dp))
                .background(Color.Black.copy(alpha = 0.78f))
                .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
        )
    }
}

@Composable
fun LiveBadge(modifier: Modifier = Modifier) {
    Box(
        modifier =
            modifier
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.error)
                .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = "LIVE",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onError,
        )
    }
}

@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (actionLabel != null && onAction != null) {
            Text(
                text = actionLabel,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.clickable(onClick = onAction),
            )
        }
    }
}

@Composable
fun GradientScrim(
    modifier: Modifier = Modifier,
    colors: List<Color> =
        listOf(
            Color.Transparent,
            Color.Black.copy(alpha = 0.65f),
        ),
) {
    Box(
        modifier =
            modifier
                .background(Brush.verticalGradient(colors)),
    )
}

internal fun buildMetaLine(
    video: Video,
    subtitle: String?,
): String =
    buildList {
        if (!subtitle.isNullOrBlank()) {
            add(subtitle)
        } else {
            if (video.viewCount > 0L) add("${Formatters.compactCount(video.viewCount)} views")
            if (video.publishedAtMillis > 0L) {
                add(Formatters.relativeTime(video.publishedAtMillis, System.currentTimeMillis()))
            }
        }
    }.joinToString(" • ")
