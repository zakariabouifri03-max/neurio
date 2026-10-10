package com.neurio.aivibes.playback

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.core.database.getLongOrNull
import androidx.core.database.getStringOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One local audio file as reported by MediaStore. */
data class Track(
    val id: Long,
    val uri: Uri,
    val title: String,
    val artist: String,
    val album: String,
    val albumId: Long,
    val durationMs: Long
) {
    val artworkUri: Uri
        get() = ContentUris.withAppendedId(
            Uri.parse("content://media/external/audio/albumart"), albumId
        )

    val displayDuration: String
        get() {
            val totalSec = (durationMs / 1000).coerceAtLeast(0)
            val m = totalSec / 60
            val s = totalSec % 60
            return "%d:%02d".format(m, s)
        }
}

/**
 * Scans the device's music library (MediaStore). Runs entirely on-device;
 * AI VIBES has no network code at all.
 */
class LibraryRepository(private val context: Context) {

    suspend fun loadTracks(): List<Track> = withContext(Dispatchers.IO) {
        val out = ArrayList<Track>()
        val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATE_ADDED
        )
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
        try {
            context.contentResolver.query(
                collection, projection, selection, null,
                "${MediaStore.Audio.Media.DATE_ADDED} DESC"
            )?.use { c ->
                val idCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val albumCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val albumIdCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                val durCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                while (c.moveToNext()) {
                    val id = c.getLong(idCol)
                    val title = c.getStringOrNull(titleCol)?.takeIf { it.isNotBlank() } ?: "Unknown title"
                    val artist = c.getStringOrNull(artistCol)?.takeIf { it.isNotBlank() && it != "<unknown>" }
                        ?: "Unknown artist"
                    val album = c.getStringOrNull(albumCol) ?: "Unknown album"
                    val albumId = c.getLongOrNull(albumIdCol) ?: 0L
                    val dur = c.getLongOrNull(durCol) ?: 0L
                    out.add(
                        Track(
                            id = id,
                            uri = ContentUris.withAppendedId(collection, id),
                            title = title,
                            artist = artist,
                            album = album,
                            albumId = albumId,
                            durationMs = dur
                        )
                    )
                }
            }
        } catch (t: SecurityException) {
            // Permission missing — UI shows the empty-library + permission card.
            return@withContext emptyList()
        }
        out
    }
}
