@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.media3.common.audio

import androidx.media3.common.C
import java.nio.ByteBuffer

interface AudioProcessor {
    class AudioFormat {
        val sampleRate: Int
        val channelCount: Int
        val encoding: Int
        val bytesPerFrame: Int

        constructor(sampleRate: Int, channelCount: Int, encoding: Int) {
            this.sampleRate = sampleRate
            this.channelCount = channelCount
            this.encoding = encoding
            this.bytesPerFrame = 0
        }

        companion object {
            @JvmField
            val NOT_SET = AudioFormat(-1, -1, -1)
        }
    }

    class UnhandledAudioFormatException : Exception {
        constructor(inputAudioFormat: AudioFormat) : super()
        constructor(message: String, audioFormat: AudioFormat) : super(message)
    }

    fun configure(inputAudioFormat: AudioFormat): AudioFormat
    fun isActive(): Boolean
    fun queueInput(inputBuffer: ByteBuffer)
    fun queueEndOfStream()
    fun getOutput(): ByteBuffer
    fun isEnded(): Boolean
    fun flush()
    fun reset()

    companion object {
        @JvmField
        val EMPTY_BUFFER: ByteBuffer = ByteBuffer.allocateDirect(0)
    }
}

abstract class BaseAudioProcessor : AudioProcessor {
    protected var inputAudioFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    protected var outputAudioFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET

    final override fun configure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        this.inputAudioFormat = inputAudioFormat
        outputAudioFormat = onConfigure(inputAudioFormat)
        return if (isActive()) outputAudioFormat else AudioProcessor.AudioFormat.NOT_SET
    }

    override fun isActive(): Boolean =
        outputAudioFormat != AudioProcessor.AudioFormat.NOT_SET

    final override fun queueEndOfStream() = onQueueEndOfStream()
    override fun getOutput(): ByteBuffer = AudioProcessor.EMPTY_BUFFER
    override fun isEnded(): Boolean = true
    final override fun flush() = onFlush()
    final override fun reset() = onReset()

    protected final fun replaceOutputBuffer(size: Int): ByteBuffer =
        ByteBuffer.allocateDirect(size).order(java.nio.ByteOrder.nativeOrder())

    protected open fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat =
        AudioProcessor.AudioFormat.NOT_SET

    protected open fun onQueueEndOfStream() {}
    protected open fun onFlush() {}
    protected open fun onReset() {}
}
