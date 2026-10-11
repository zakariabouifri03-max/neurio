package com.vyro.play.data.localvideo

import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import com.vyro.play.data.remote.YouTubeMetadataParser
import com.vyro.play.model.LocalVideoFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Manages scanning device video files via MediaStore and resolving metadata for
 * user-selected video files picked via the Android Storage Access Framework (SAF).
 */
class LocalVideoManager(context: Context) {

    private val appContext = context.applicationContext

    suspend fun scanDeviceVideos(limit: Int = 100): List<LocalVideoFile> = withContext(Dispatchers.IO) {
        val videos = mutableListOf<LocalVideoFile>()
        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        }

        val projection = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.DURATION,
            MediaStore.Video.Media.MIME_TYPE,
            MediaStore.Video.Media.DATE_ADDED,
            MediaStore.Video.Media.WIDTH,
            MediaStore.Video.Media.HEIGHT,
            MediaStore.Video.Media.BUCKET_DISPLAY_NAME
        )

        val sortOrder = "${MediaStore.Video.Media.DATE_ADDED} DESC"

        runCatching {
            appContext.contentResolver.query(
                collection,
                projection,
                null,
                null,
                sortOrder
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
                val durCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)
                val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.MIME_TYPE)
                val dateCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED)
                val widthCol = cursor.getColumnIndex(MediaStore.Video.Media.WIDTH)
                val heightCol = cursor.getColumnIndex(MediaStore.Video.Media.HEIGHT)
                val bucketCol = cursor.getColumnIndex(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)

                var count = 0
                while (cursor.moveToNext() && count < limit) {
                    val id = cursor.getLong(idCol)
                    val contentUri = ContentUris.withAppendedId(collection, id)
                    val name = cursor.getString(nameCol) ?: "Video_$id.mp4"
                    val sizeBytes = cursor.getLong(sizeCol).coerceAtLeast(0L)
                    val durationMs = cursor.getLong(durCol).coerceAtLeast(0L)
                    val mime = cursor.getString(mimeCol) ?: "video/mp4"
                    val dateAdded = cursor.getLong(dateCol)
                    val width = if (widthCol >= 0) cursor.getInt(widthCol) else 0
                    val height = if (heightCol >= 0) cursor.getInt(heightCol) else 0
                    val folder = if (bucketCol >= 0) cursor.getString(bucketCol) ?: "Device Videos" else "Device Videos"

                    val resolutionLabel = formatResolution(width, height)
                    val durationSeconds = durationMs / 1000L

                    videos.add(
                        LocalVideoFile(
                            uri = contentUri.toString(),
                            displayName = name,
                            sizeBytes = sizeBytes,
                            sizeFormatted = YouTubeMetadataParser.formatFileSize(sizeBytes),
                            durationMs = durationMs,
                            durationFormatted = YouTubeMetadataParser.formatDurationSeconds(durationSeconds),
                            mimeType = mime,
                            dateAddedSeconds = dateAdded,
                            resolution = resolutionLabel,
                            folderName = folder,
                            isUserPicked = false
                        )
                    )
                    count++
                }
            }
        }
        videos
    }

    suspend fun resolvePickedVideoUri(uri: Uri): LocalVideoFile? = withContext(Dispatchers.IO) {
        runCatching {
            try {
                appContext.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: SecurityException) {
                // Not all URI providers grant persistable permissions; transient read still works.
            }

            var displayName = uri.lastPathSegment?.substringAfterLast('/') ?: "Local_Video.mp4"
            var sizeBytes = 0L

            appContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                        displayName = cursor.getString(nameIdx)
                    }
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        sizeBytes = cursor.getLong(sizeIdx)
                    }
                }
            }

            var durationMs = 0L
            var width = 0
            var height = 0
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(appContext, uri)
                durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull() ?: 0L
                width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
                    ?.toIntOrNull() ?: 0
                height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
                    ?.toIntOrNull() ?: 0
            } catch (_: Exception) {
                // Ignore retriever errors on unsupported containers
            } finally {
                runCatching { retriever.release() }
            }

            val mimeType = appContext.contentResolver.getType(uri) ?: "video/mp4"
            val durationSeconds = durationMs / 1000L

            LocalVideoFile(
                uri = uri.toString(),
                displayName = displayName,
                sizeBytes = sizeBytes,
                sizeFormatted = YouTubeMetadataParser.formatFileSize(sizeBytes),
                durationMs = durationMs,
                durationFormatted = YouTubeMetadataParser.formatDurationSeconds(durationSeconds),
                mimeType = mimeType,
                dateAddedSeconds = System.currentTimeMillis() / 1000L,
                resolution = formatResolution(width, height),
                folderName = "Picked Offline Files",
                isUserPicked = true
            )
        }.getOrNull()
    }

    private fun formatResolution(width: Int, height: Int): String {
        val maxDim = maxOf(width, height)
        val minDim = minOf(width, height)
        return when {
            maxDim >= 3840 || minDim >= 2160 -> "4K UHD (${width}x$height)"
            maxDim >= 2560 || minDim >= 1440 -> "2K QHD (${width}x$height)"
            maxDim >= 1920 || minDim >= 1080 -> "1080p FHD"
            maxDim >= 1280 || minDim >= 720 -> "720p HD"
            width > 0 && height > 0 -> "${width}x$height"
            else -> "Local Video"
        }
    }
}
