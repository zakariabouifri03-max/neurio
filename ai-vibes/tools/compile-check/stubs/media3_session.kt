@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.media3.session

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player

class SessionToken {
    constructor(context: Context, serviceComponent: ComponentName)
}

open class MediaSession {
    class ControllerInfo

    interface Callback

    val player: Player
        get() = throw UnsupportedOperationException()

    class Builder {
        constructor(context: Context, player: Player)

        fun setId(id: String): Builder = this
        fun setSessionActivity(sessionActivity: PendingIntent): Builder = this
        fun build(): MediaSession = MediaSession()
    }

    fun release() {}
}

abstract class MediaSessionService : android.app.Service() {
    abstract fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession?
    override fun onBind(intent: android.content.Intent?): android.os.IBinder? = null
}

class MediaController private constructor() : Player {
    override val isPlaying: Boolean get() = false
    override val currentMediaItem: MediaItem? get() = null
    override val currentPosition: Long get() = 0
    override val duration: Long get() = 0
    override val mediaItemCount: Int get() = 0
    override val playWhenReady: Boolean get() = false

    override fun addListener(listener: Player.Listener) {}
    override fun removeListener(listener: Player.Listener) {}
    override fun setMediaItems(mediaItems: List<MediaItem>, startIndex: Int, startPositionMs: Long) {}
    override fun prepare() {}
    override fun play() {}
    override fun pause() {}
    override fun seekTo(positionMs: Long) {}
    override fun seekToNextMediaItem() {}
    override fun seekToPreviousMediaItem() {}
    override fun release() {}

    class Builder(context: Context, token: SessionToken) {
        fun buildAsync(): com.google.common.util.concurrent.ListenableFuture<MediaController> =
            throw UnsupportedOperationException()
    }

    companion object {
        @JvmStatic
        fun releaseFuture(controllerFuture: java.util.concurrent.Future<out MediaController>) {}
    }
}
