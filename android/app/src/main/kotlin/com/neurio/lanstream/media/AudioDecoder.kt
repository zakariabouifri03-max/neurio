package com.neurio.lanstream.media

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import com.neurio.lanstream.core.Log

/** Low-latency PCM sink for the streamed game audio. */
class AudioPlayer(sampleRate: Int, channelCount: Int) {

    private val channelMask =
        if (channelCount >= 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO

    private val bufferSize = runCatching {
        val min = AudioTrack.getMinBufferSize(
            sampleRate,
            channelMask,
            AudioFormat.ENCODING_PCM_16BIT
        )
        min.coerceAtLeast(4096)
    }.getOrDefault(8192)

    @Volatile
    private var track: AudioTrack? = null

    @Volatile
    var playing: Boolean = false
        private set

    fun start(): Boolean {
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        val format = AudioFormat.Builder()
            .setSampleRate(sampleRate)
            .setChannelMask(channelMask)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build()
        val instance = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioTrack.Builder()
                    .setAudioAttributes(attributes)
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(bufferSize)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                    .build()
            } else {
                @Suppress("DEPRECATION")
                AudioTrack(
                    attributes,
                    format,
                    bufferSize,
                    AudioTrack.MODE_STREAM,
                    AudioManager.AUDIO_SESSION_ID_GENERATE
                )
            }
        } catch (t: Throwable) {
            Log.w("AudioTrack build failed: ${t.message}")
            return false
        }
        return try {
            instance.play()
            track = instance
            playing = true
            true
        } catch (t: Throwable) {
            Log.w("AudioTrack play failed: ${t.message}")
            runCatching { instance.release() }
            false
        }
    }

    fun write(pcm: ByteArray, length: Int) {
        val instance = track ?: return
        runCatching { instance.write(pcm, 0, length) }
            .onFailure { Log.w("AudioTrack write failed: ${it.message}") }
    }

    fun stop() {
        playing = false
        try {
            track?.stop()
        } catch (_: Throwable) {
        }
        try {
            track?.release()
        } catch (_: Throwable) {
        }
        track = null
    }
}

/**
 * AAC decoder for the host's audio stream.
 *
 * The AudioSpecificConfig (`csd-0`) is mandatory for AAC; the host sends it in
 * the control handshake so the decoder can be created before the first frame.
 */
class AudioDecoder(
    private val sampleRate: Int,
    private val channelCount: Int,
    private val onError: (Throwable) -> Unit
) {
    @Volatile
    private var codec: MediaCodec? = null

    @Volatile
    private var player: AudioPlayer? = null

    @Volatile
    var playing: Boolean = false
        private set

    var decodedFrames: Long = 0L
        private set

    fun start(csd0: ByteArray?): Boolean {
        val format = MediaFormat.createAudioFormat(
            MediaFormat.MIMETYPE_AUDIO_AAC,
            sampleRate,
            channelCount
        ).apply {
            if (csd0 != null) setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(csd0))
        }
        val instance = try {
            val info = CodecCapabilities.preferDecoder(MediaFormat.MIMETYPE_AUDIO_AAC)
            if (info != null) MediaCodec.createByCodecName(info.name)
            else MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        } catch (t: Throwable) {
            onError(t)
            return false
        }
        return try {
            instance.configure(format, null, null, 0)
            instance.start()
            codec = instance
            val sink = AudioPlayer(sampleRate, channelCount)
            if (sink.start()) {
                player = sink
                playing = true
                Log.i("Audio decoder + player started (${sampleRate}Hz ${channelCount}ch)")
            } else {
                playing = false
            }
            true
        } catch (t: Throwable) {
            Log.w("Audio decoder failed: ${t.message}")
            runCatching { instance.release() }
            onError(t)
            false
        }
    }

    fun submit(payload: ByteArray, ptsUs: Long) {
        val instance = codec ?: return
        try {
            val index = instance.dequeueInputBuffer(0)
            if (index < 0) return
            val buffer = instance.getInputBuffer(index) ?: return
            buffer.clear()
            buffer.put(payload)
            instance.queueInputBuffer(index, 0, payload.size, ptsUs, 0)
        } catch (t: Throwable) {
            Log.w("Audio decode input failed: ${t.message}")
            return
        }
        drain(instance)
    }

    private fun drain(instance: MediaCodec) {
        val info = MediaCodec.BufferInfo()
        while (true) {
            val index = try {
                instance.dequeueOutputBuffer(info, 0)
            } catch (t: Throwable) {
                onError(t)
                return
            }
            when {
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> return
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> continue
                index >= 0 -> {
                    val buffer = runCatching { instance.getOutputBuffer(index) }.getOrNull()
                    if (buffer != null && info.size > 0) {
                        val pcm = ByteArray(info.size)
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        buffer.get(pcm)
                        player?.write(pcm, pcm.size)
                        decodedFrames++
                    }
                    runCatching { instance.releaseOutputBuffer(index, false) }
                }
                else -> return
            }
        }
    }

    fun stop() {
        playing = false
        try {
            codec?.stop()
        } catch (_: Throwable) {
        }
        try {
            codec?.release()
        } catch (_: Throwable) {
        }
        codec = null
        player?.stop()
        player = null
    }
}
