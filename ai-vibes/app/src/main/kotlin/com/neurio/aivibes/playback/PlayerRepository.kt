package com.neurio.aivibes.playback

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.neurio.aivibes.audio.AudioEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors

/** Immutable UI snapshot of what the player is doing right now. */
data class NowPlaying(
    val track: Track? = null,
    val isPlaying: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val connected: Boolean = false
)

/**
 * Bridge between Compose UI and the Media3 [MediaController]. Connects to
 * [MusicService] on first use; reconnection is handled by Media3 itself.
 */
class PlayerRepository(private val context: Context) {

    private var controller: MediaController? = null
    private val _nowPlaying = MutableStateFlow(NowPlaying())
    val nowPlaying: StateFlow<NowPlaying> = _nowPlaying.asStateFlow()

    private val mainExecutor = Executors.newSingleThreadExecutor()

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            publish(player)
        }
    }

    suspend fun connect() = withContext(Dispatchers.Main) {
        if (controller != null) return@withContext
        val token = SessionToken(context, ComponentName(context, MusicService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener({
            try {
                val c = future.get()
                c.addListener(listener)
                controller = c
                publish(c)
            } catch (t: Throwable) {
                _nowPlaying.value = NowPlaying(connected = false)
            }
        }, mainExecutor)
    }

    private fun publish(player: Player) {
        val item = player.currentMediaItem
        val track = item?.mediaId?.let { id -> trackCache[id] }
        _nowPlaying.value = NowPlaying(
            track = track,
            isPlaying = player.isPlaying,
            positionMs = player.currentPosition.coerceAtLeast(0),
            durationMs = (if (player.duration > 0) player.duration else track?.durationMs ?: 0L),
            connected = true
        )
    }

    fun play(tracks: List<Track>, startIndex: Int = 0) {
        val c = controller ?: return
        trackCache.clear()
        tracks.forEach { trackCache[it.id.toString()] = it }
        val items = tracks.map { t ->
            MediaItem.Builder()
                .setMediaId(t.id.toString())
                .setUri(t.uri)
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle(t.title)
                        .setArtist(t.artist)
                        .setAlbumTitle(t.album)
                        .setArtworkUri(t.artworkUri)
                        .build()
                )
                .build()
        }
        c.setMediaItems(items, startIndex.coerceIn(0, (items.size - 1).coerceAtLeast(0)), 0)
        c.prepare()
        c.play()
    }

    fun togglePlayPause() {
        val c = controller ?: return
        if (c.isPlaying) c.pause() else c.play()
    }

    fun next() {
        controller?.seekToNextMediaItem()
    }

    fun previous() {
        val c = controller ?: return
        if (c.currentPosition > 3000) c.seekTo(0) else c.seekToPreviousMediaItem()
    }

    fun seekTo(positionMs: Long) {
        controller?.seekTo(positionMs)
    }

    fun refresh() {
        controller?.let { publish(it) }
    }

    fun release() {
        controller?.removeListener(listener)
        try {
            controller?.release()
        } catch (t: Throwable) {
            // Already released / not connected — nothing to do.
        }
        controller = null
    }

    companion object {
        /** Tiny in-memory id → Track map so the UI can render metadata. */
        private val trackCache = HashMap<String, Track>()
    }
}
