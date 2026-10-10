package com.neurio.aivibes.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import com.neurio.aivibes.dsp.DspChain
import com.neurio.aivibes.dsp.SpectrumAnalyzer
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Media3 [BaseAudioProcessor] that runs the AI VIBES DSP chain on decoded PCM
 * and taps the processed signal for the visualizer.
 *
 * Supported encodings: 16-bit little-endian PCM and 32-bit float PCM. Anything
 * else deactivates the processor (audio passes through untouched) instead of
 * failing playback — graceful behaviour on exotic decoders.
 */
class AiAudioProcessor(
    private val chain: DspChain,
    private val analyzer: SpectrumAnalyzer?
) : BaseAudioProcessor() {

    private var scratch = FloatArray(0)

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        val enc = inputAudioFormat.encoding
        return if (enc == C.ENCODING_PCM_16BIT || enc == C.ENCODING_PCM_FLOAT) {
            AudioProcessor.AudioFormat(inputAudioFormat.sampleRate, inputAudioFormat.channelCount, enc)
        } else {
            AudioProcessor.AudioFormat.NOT_SET
        }
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!inputBuffer.hasRemaining()) return
        val channels = inputAudioFormat.channelCount
        val sampleRate = inputAudioFormat.sampleRate
        val bytesPerSample = if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) 4 else 2
        val frameCount = inputBuffer.remaining() / (bytesPerSample * channels)
        if (frameCount == 0) return

        val needed = frameCount * channels
        if (scratch.size < needed) scratch = FloatArray(needed)

        // ---- decode to float [-1, 1] (explicit little-endian) -------------
        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) {
            var i = 0
            while (i < needed) {
                val lo = inputBuffer.get().toInt() and 0xFF
                val hi = inputBuffer.get().toInt()
                val v = ((hi shl 8) or lo).toShort()
                scratch[i] = v.toFloat() / 32768f
                i++
            }
        } else {
            var i = 0
            while (i < needed) {
                val b0 = inputBuffer.get().toInt() and 0xFF
                val b1 = inputBuffer.get().toInt() and 0xFF
                val b2 = inputBuffer.get().toInt() and 0xFF
                val b3 = inputBuffer.get().toInt()
                val bits = (b3 shl 24) or (b2 shl 16) or (b1 shl 8) or b0
                scratch[i] = Float.fromBits(bits)
                i++
            }
        }

        // ---- real DSP ------------------------------------------------------
        chain.process(scratch, frameCount, channels, sampleRate)
        analyzer?.submit(scratch, frameCount, channels)

        // ---- encode back to the input encoding ----------------------------
        val out = replaceOutputBuffer(frameCount * channels * bytesPerSample)
        out.order(ByteOrder.LITTLE_ENDIAN)
        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) {
            for (i in 0 until needed) {
                var v = (scratch[i] * 32768f).toInt().coerceIn(-32768, 32767)
                out.put((v and 0xFF).toByte())
                out.put(((v shr 8) and 0xFF).toByte())
            }
        } else {
            for (i in 0 until needed) {
                out.putFloat(scratch[i])
            }
        }
        out.flip()
    }

    override fun onFlush() {
        chain.resetState()
    }
}
