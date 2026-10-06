package com.aivision.camera.gallery

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.aivision.camera.core.L
import com.aivision.camera.core.Storage
import java.io.File
import kotlin.math.max

/** One item in the built-in gallery. */
data class MediaItem(
    val uri: Uri,
    val file: File?,
    val name: String,
    val isVideo: Boolean,
    val isRaw: Boolean,
    val sizeBytes: Long,
    val dateAdded: Long,
    val width: Int,
    val height: Int,
) {
    /** The unprocessed sidecar written next to an AI result, when present. */
    fun originalFile(): File? {
        val f = file ?: return null
        val candidate = File(f.parentFile, f.name.replace(".jpg", "_original.jpg"))
        return if (candidate.exists()) candidate else null
    }

    val badge: String
        get() = when {
            isRaw -> "DNG"
            isVideo -> "MP4"
            name.contains("ULTRA", true) -> "ULTRA"
            else -> "AI"
        }
}

/**
 * Media access for the built-in gallery. Reads through MediaStore on Android 10+
 * (scoped storage) and falls back to the app's own folder when needed.
 */
object MediaRepo {

    private const val PREFIX = "AIV_"

    fun listItems(ctx: Context, limit: Int = 400): List<MediaItem> {
        val items = ArrayList<MediaItem>()
        items += query(ctx, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, false, limit)
        items += query(ctx, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, limit)
        // app-private copies (always present, even without MediaStore access)
        for (file in privateFiles(ctx)) {
            if (items.any { it.file?.absolutePath == file.absolutePath }) continue
            items += MediaItem(
                uri = Uri.fromFile(file), file = file, name = file.name,
                isVideo = file.extension.equals("mp4", true),
                isRaw = file.extension.equals("dng", true),
                sizeBytes = file.length(), dateAdded = file.lastModified(), width = 0, height = 0,
            )
        }
        return items.sortedByDescending { it.dateAdded }.take(limit)
    }

    private fun privateFiles(ctx: Context): List<File> {
        val dirs = listOf(Storage.appDir(ctx),
            File(ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_MOVIES), "AIVision"))
        val out = ArrayList<File>()
        for (d in dirs) {
            d.listFiles()?.forEach { f ->
                if (f.isFile && (f.extension.equals("jpg", true) || f.extension.equals("mp4", true) ||
                        f.extension.equals("dng", true)) &&
                    !f.name.contains("_original") && !f.name.contains("_ai4k")) {
                    out += f
                }
            }
        }
        return out
    }

    private fun query(ctx: Context, collection: Uri, isVideo: Boolean, limit: Int): List<MediaItem> {
        val items = ArrayList<MediaItem>()
        val projection = arrayOf(
            MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.MIME_TYPE, MediaStore.MediaColumns.RELATIVE_PATH,
            MediaStore.MediaColumns.DATA,
        )
        val selection = if (Build.VERSION.SDK_INT >= 29) null else null
        val sort = "${MediaStore.MediaColumns.DATE_ADDED} DESC"
        var cursor: Cursor? = null
        try {
            cursor = ctx.contentResolver.query(collection, projection, selection, null, sort)
            cursor?.let { c ->
                val idIdx = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameIdx = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                val sizeIdx = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
                val dateIdx = c.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)
                val pathIdx = c.getColumnIndex(MediaStore.MediaColumns.DATA)
                while (c.moveToNext() && items.size < limit) {
                    val name = if (nameIdx >= 0) c.getString(nameIdx) ?: "" else ""
                    if (!name.startsWith(PREFIX)) continue
                    val id = c.getLong(idIdx)
                    val uri = ContentUris.withAppendedId(collection, id)
                    val dataPath = if (pathIdx >= 0) c.getString(pathIdx) else null
                    items += MediaItem(
                        uri = uri,
                        file = dataPath?.let { File(it) },
                        name = name,
                        isVideo = isVideo,
                        isRaw = name.endsWith(".dng", true),
                        sizeBytes = if (sizeIdx >= 0) c.getLong(sizeIdx) else 0L,
                        dateAdded = if (dateIdx >= 0) c.getLong(dateIdx) * 1000 else 0L,
                        width = 0, height = 0,
                    )
                }
            }
        } catch (t: Throwable) {
            L.w("mediastore query failed: ${t.message}")
        } finally {
            runCatching { cursor?.close() }
        }
        return items
    }

    fun thumbnail(ctx: Context, item: MediaItem, size: Int): Bitmap? {
        // 1. system thumbnails (fast, cached)
        try {
            if (Build.VERSION.SDK_INT >= 29 && item.uri.scheme == "content") {
                val bmp = ctx.contentResolver.loadThumbnail(item.uri, android.util.Size(size, size), null)
                if (bmp != null) return bmp
            }
        } catch (t: Throwable) {
            L.d("loadThumbnail failed: ${t.message}")
        }
        // 2. decode a downsampled copy
        return try {
            val file = item.file
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            val stream = when {
                file != null && file.exists() -> file.inputStream()
                else -> ctx.contentResolver.openInputStream(item.uri) ?: return null
            }
            stream.use { BitmapFactory.decodeStream(it, null, options) }
            val sample = max(1, max(options.outWidth, options.outHeight) / max(1, size))
            val opts = BitmapFactory.Options().apply {
                inSampleSize = Integer.highestOneBit(sample).coerceAtLeast(1)
            }
            when {
                file != null && file.exists() -> BitmapFactory.decodeFile(file.absolutePath, opts)
                else -> ctx.contentResolver.openInputStream(item.uri)?.use {
                    BitmapFactory.decodeStream(it, null, opts)
                }
            }
        } catch (t: Throwable) {
            L.d("thumbnail decode failed: ${t.message}")
            null
        }
    }

    /** Latest thumbnail + badge for the camera screen's gallery button. */
    fun latestThumbnail(ctx: Context, size: Int): Pair<Bitmap, String>? {
        val items = listItems(ctx, 24)
        for (item in items) {
            val bmp = thumbnail(ctx, item, size) ?: continue
            return bmp to item.badge
        }
        return null
    }

    fun delete(ctx: Context, item: MediaItem): Boolean {
        return try {
            if (item.uri.scheme == "content") {
                ctx.contentResolver.delete(item.uri, null, null) > 0
            } else {
                item.file?.delete() ?: false
            }
        } catch (t: Throwable) {
            L.w("delete failed: ${t.message}")
            false
        }
    }

    /** Full decode honouring available memory. */
    fun decodeFull(ctx: Context, item: MediaItem, maxPixels: Int = 24_000_000): Bitmap? {
        val file = item.file
        return try {
            if (file != null && file.exists()) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.absolutePath, bounds)
                val sample = Integer.highestOneBit(
                    max(1, (bounds.outWidth.toLong() * bounds.outHeight / maxPixels).toInt()),
                ).coerceAtLeast(1)
                BitmapFactory.decodeFile(file.absolutePath,
                    BitmapFactory.Options().apply { inSampleSize = sample })
            } else {
                ctx.contentResolver.openInputStream(item.uri)?.use { BitmapFactory.decodeStream(it) }
            }
        } catch (t: Throwable) {
            L.w("decodeFull failed: ${t.message}")
            null
        }
    }
}
