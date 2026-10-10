@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.media3.exoplayer.audio

import android.content.Context
import androidx.media3.common.audio.AudioProcessor

interface AudioSink

class DefaultAudioSink private constructor() : AudioSink {
    class Builder {
        constructor()
        constructor(context: Context)

        fun setEnableFloatOutput(enableFloatOutput: Boolean): Builder = this
        fun setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams: Boolean): Builder = this
        fun setAudioProcessors(audioProcessors: Array<AudioProcessor>): Builder = this
        fun build(): DefaultAudioSink = DefaultAudioSink()
    }
}
