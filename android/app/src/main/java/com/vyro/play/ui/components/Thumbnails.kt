package com.vyro.play.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.BrushPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.vyro.core.model.ThumbnailQuality
import com.vyro.core.model.Thumbnails as ThumbnailSet
import com.vyro.core.util.ThumbnailUrls

/**
 * Central place where every remote image in the app is loaded.
 *
 * - A single low-res "preview" request is used as the placeholder so the layout never
 *   jumps while the full thumbnail streams in.
 * - [size] is passed to Coil so bitmaps are downsampled to the size actually drawn,
 *   which is the single biggest memory win on low-end devices.
 */
@Composable
fun VideoThumbnail(
    videoId: String,
    thumbnails: ThumbnailSet,
    quality: ThumbnailQuality,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    memoryCacheKey: String? = null,
) {
    val context = LocalContext.current
    val url = ThumbnailUrls.pick(thumbnails, quality).ifBlank { ThumbnailUrls.hqDefault(videoId) }

    AsyncImage(
        model =
            ImageRequest.Builder(context)
                .data(url)
                .size(THUMBNAIL_PIXELS)
                .memoryCacheKey(memoryCacheKey ?: url)
                .diskCacheKey(url)
                .crossfade(false)
                .build(),
        contentDescription = contentDescription,
        contentScale = contentScale,
        placeholder = BrushPainter(rememberShimmerBrush()),
        error = BrushPainter(rememberShimmerBrush()),
        modifier = modifier,
    )
}

/** Solid shimmer placeholder used before (or instead of) a thumbnail. */
@Composable
fun rememberShimmerBrush(): Brush {
    val surface = Color(0xFF1F1B2E)
    val highlight = Color(0xFF2A2439)
    return Brush.linearGradient(
        colors = listOf(surface, highlight, surface),
        start = androidx.compose.ui.geometry.Offset(0f, 0f),
        end = androidx.compose.ui.geometry.Offset(320f, 320f),
    )
}

private const val THUMBNAIL_PIXELS = 480
private val THUMBNAIL_SIZE = 160.dp
