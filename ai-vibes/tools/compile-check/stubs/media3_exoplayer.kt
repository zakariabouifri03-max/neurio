@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.media3.exoplayer

import android.content.Context
import android.os.Handler
import androidx.media3.common.AudioAttributes
import androidx.media3.common.Player

interface ExoPlayer : Player {
    val audioSessionId: Int

    class Builder {
        constructor(context: Context)
        constructor(context: Context, renderersFactory: RenderersFactory)

        fun setAudioAttributes(audioAttributes: AudioAttributes, handleAudioFocus: Boolean): Builder = this
        fun setHandleAudioBecomingNoisy(handleAudioBecomingNoisy: Boolean): Builder = this
        fun setWakeMode(wakeMode: Int): Builder = this
        fun build(): ExoPlayer = throw UnsupportedOperationException()
    }
}

interface RenderersFactory

open class DefaultRenderersFactory(context: Context) : RenderersFactory {
    protected open fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean
    ): androidx.media3.exoplayer.audio.AudioSink = throw UnsupportedOperationException()
}
