// Compile-check stubs mirroring the exact androidx.media3 1.4.1 API surface
// used by AI VIBES. NOT part of the app — used only by tools/compile-check to
// type-check engine code without a full Android SDK. Signatures were copied
// from the real androidx/media source tree (tag 1.4.1).
@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.media3.common

object C {
    const val ENCODING_PCM_16BIT = 2
    const val ENCODING_PCM_FLOAT = 4
    const val USAGE_MEDIA = 1
    const val AUDIO_CONTENT_TYPE_MUSIC = 2
    const val WAKE_MODE_LOCAL = 1
    const val AUDIO_SESSION_ID_UNSET = -1
}

class AudioAttributes private constructor() {
    class Builder {
        fun setUsage(usage: Int): Builder = this
        fun setContentType(contentType: Int): Builder = this
        fun build(): AudioAttributes = AudioAttributes()
    }
}

class MediaMetadata private constructor() {
    class Builder {
        fun setTitle(title: CharSequence?): Builder = this
        fun setArtist(artist: CharSequence?): Builder = this
        fun setAlbumTitle(albumTitle: CharSequence?): Builder = this
        fun setArtworkUri(artworkUri: android.net.Uri?): Builder = this
        fun build(): MediaMetadata = MediaMetadata()
    }
}

class MediaItem private constructor() {
    val mediaId: String = ""
    val localConfiguration: Any? = null
    class Builder {
        fun setMediaId(mediaId: String): Builder = this
        fun setUri(uri: android.net.Uri?): Builder = this
        fun setMediaMetadata(mediaMetadata: MediaMetadata): Builder = this
        fun build(): MediaItem = MediaItem()
    }
}

interface Player {
    interface Listener {
        fun onEvents(player: Player, events: Events) {}
        fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {}
        fun onIsPlayingChanged(isPlaying: Boolean) {}
        fun onAudioSessionIdChanged(audioSessionId: Int) {}
    }

    class Events

    val isPlaying: Boolean
    val currentMediaItem: MediaItem?
    val currentPosition: Long
    val duration: Long
    val mediaItemCount: Int
    val playWhenReady: Boolean

    fun addListener(listener: Listener)
    fun removeListener(listener: Listener)
    fun setMediaItems(mediaItems: List<MediaItem>, startIndex: Int, startPositionMs: Long)
    fun prepare()
    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    fun seekToNextMediaItem()
    fun seekToPreviousMediaItem()
    fun release()
}
