package com.neurio.lanstream.media

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import com.neurio.lanstream.core.Log

/**
 * AAC-LC encoder fed with raw PCM from [AudioCapture].
 *
 * Unlike video there is no input Surface for audio, so we queue PCM buffers
 * directly. The buffer is drained from the same call, which keeps the audio
 * path free of extra threads and extra latency.
 */
class AudioEncoder(
    private val sampleRate: Int,
    private val channelCount: Int,
    private val bitrateBps: Int,
    private val onOutput: (payload: ByteArray, isConfig: Boolean, ptsUs: Long) -> Unit
) {
    private var codec: MediaCodec? = null

    @Volatile
    private var presentationUs = 0L

    @Volatile
    private var running = false

    @Volatile
    var codecName: String = ""
        private set

    fun start(): Boolean {
        val format = MediaFormat.createAudioFormat(
            MediaFormat.MIMETYPE_AUDIO_AAC,
            sampleRate,
            channelCount
        ).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrateBps)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
        }
        return try {
            val instance = CodecCapabilities.preferEncoder(MediaFormat.MIMETYPE_AUDIO_AAC)
                ?.let { MediaCodec.createByCodecName(it.name) }
                ?: MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            codecName = runCatching { instance.name }.getOrDefault("aac")
            instance.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            instance.start()
            codec = instance
            running = true
            Log.i("Audio encoder started: $codecName ${sampleRate}Hz ${channelCount}ch")
            true
        } catch (t: Throwable) {
            Log.w("Audio encoder failed: ${t.message}")
            codec = null
            false
        }
    }

    /** Feeds one PCM chunk (16 bit little endian). */
    fun feed(pcm: ByteArray, length: Int) {
        val instance = codec ?: return
        if (!running || length <= 0) return
        try {
            val index = instance.dequeueInputBuffer(0)
            if (index >= 0) {
                val buffer = instance.getInputBuffer(index)
                if (buffer != null) {
                    buffer.clear()
                    val toWrite = minOf(length, buffer.capacity())
                    buffer.put(pcm, 0, toWrite)
                    val framesAdvanced = toWrite / (2 * channelCount)
                    val pts = presentationUs
                    presentationUs += framesAdvanced * 1_000_000L / sampleRate
                    instance.queueInputBuffer(index, 0, toWrite, pts, 0)
                }
            }
        } catch (t: Throwable) {
            Log.w("Audio encode input failed: ${t.message}")
        }
        drain()
    }

    private fun drain() {
        val instance = codec ?: return
        val info = MediaCodec.BufferInfo()
        while (true) {
            val index = try {
                instance.dequeueOutputBuffer(info, 0)
            } catch (t: Throwable) {
                Log.w("Audio drain failed: ${t.message}")
                return
            }
            when {
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> return
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> continue
                index >= 0 -> {
                    val buffer = runCatching { instance.getOutputBuffer(index) }.getOrNull()
                    if (buffer != null && info.size > 0) {
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        val payload = ByteArray(info.size)
                        buffer.get(payload)
                        val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                        onOutput(payload, isConfig, info.presentationTimeUs)
                    }
                    runCatching { instance.releaseOutputBuffer(index, false) }
                }
                else -> return
            }
        }
    }

    fun stop() {
        running = false
        try {
            codec?.stop()
        } catch (_: Throwable) {
        }
        try {
            codec?.release()
        } catch (_: Throwable) {
        }
        codec = null
    }
}
