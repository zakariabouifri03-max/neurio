package com.neurio.client

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import com.neurio.common.AppLog
import com.neurio.common.CsdCodec

/**
 * Decodes the host's audio stream (Opus preferred, AAC fallback) and plays it
 * through AudioTrack. The AudioTrack buffer doubles as the jitter buffer.
 */
class AudioPlayer {

    companion object {
        private const val TAG = "AudioPlayer"
    }

    private var codec: MediaCodec? = null
    private var track: AudioTrack? = null
    @Volatile
    private var running = false

    var started: Boolean = false
        private set

    fun start(mime: String, sampleRate: Int, channels: Int) {
        stop()
        if (mime.isEmpty()) {
            AppLog.i(TAG, "host has no audio; video-only session")
            return
        }
        try {
            val channelConfig = if (channels >= 2)
                AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
            val minBuf = AudioTrack.getMinBufferSize(sampleRate, channelConfig, AudioFormat.ENCODING_PCM_16BIT)
            val at = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_GAME)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(channelConfig)
                        .build()
                )
                .setBufferSizeInBytes(maxOf(minBuf * 2, sampleRate * channels * 2 / 8))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            track = at
            at.play()

            val format = MediaFormat.createAudioFormat(mime, sampleRate, channels)
            val mc = MediaCodec.createDecoderByType(mime)
            mc.setCallback(object : MediaCodec.Callback() {
                override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
                    // Input is queued from feed() using synchronous dequeue.
                }

                override fun onOutputBufferAvailable(
                    codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo
                ) {
                    try {
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                            codec.releaseOutputBuffer(index, false)
                            return
                        }
                        val buf = codec.getOutputBuffer(index)
                        if (buf != null && info.size > 0 && running) {
                            val pcm = ByteArray(info.size)
                            buf.position(info.offset)
                            buf.get(pcm, 0, info.size)
                            track?.write(pcm, 0, pcm.size)
                        }
                        codec.releaseOutputBuffer(index, false)
                    } catch (e: Exception) {
                        AppLog.w(TAG, "audio output error: ${e.message}")
                    }
                }

                override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
                    AppLog.e(TAG, "audio decoder error", e)
                }

                override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
                    AppLog.d(TAG, "audio output format: $format")
                }
            })
            mc.configure(format, null, null, 0)
            mc.start()
            codec = mc
            running = true
            started = true
            AppLog.i(TAG, "audio player started $mime $sampleRate ch=$channels")
        } catch (e: Exception) {
            AppLog.e(TAG, "audio player failed to start", e)
            stop()
        }
    }

    fun feedConfig(configBlob: ByteArray) {
        val csd = CsdCodec.decode(configBlob) ?: return
        val mc = codec ?: return
        try {
            val index = mc.dequeueInputBuffer(20_000)
            if (index >= 0) {
                val buf = mc.getInputBuffer(index)
                if (buf != null) {
                    buf.clear()
                    buf.put(csd.first, 0, minOf(csd.first.size, buf.remaining()))
                    mc.queueInputBuffer(index, 0, minOf(csd.first.size, buf.capacity()), 0, MediaCodec.BUFFER_FLAG_CODEC_CONFIG)
                }
            }
        } catch (e: Exception) {
            AppLog.w(TAG, "feedConfig: ${e.message}")
        }
    }

    fun feed(data: ByteArray, size: Int, ptsUs: Long) {
        if (!running) return
        val mc = codec ?: return
        try {
            val index = mc.dequeueInputBuffer(20_000)
            if (index < 0) return // drop: audio must never build backlog
            val buf = mc.getInputBuffer(index) ?: return
            buf.clear()
            val n = minOf(size, buf.remaining())
            buf.put(data, 0, n)
            mc.queueInputBuffer(index, 0, n, ptsUs, 0)
        } catch (e: Exception) {
            AppLog.w(TAG, "feed: ${e.message}")
        }
    }

    fun stop() {
        running = false
        started = false
        val mc = codec
        codec = null
        if (mc != null) {
            try {
                mc.stop()
            } catch (ignored: Exception) {
            }
            try {
                mc.release()
            } catch (ignored: Exception) {
            }
        }
        val at = track
        track = null
        if (at != null) {
            try {
                at.pause()
                at.flush()
                at.release()
            } catch (ignored: Exception) {
            }
        }
    }
}
