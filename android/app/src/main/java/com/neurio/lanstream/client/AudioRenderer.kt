package com.neurio.lanstream.client

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import com.neurio.lanstream.model.AudioStreamConfig
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Low-buffer AAC decoder and AudioTrack renderer. The host's playback-capture policy still applies. */
class AudioRenderer(private val onError: (String) -> Unit) : AutoCloseable {
    private val running = AtomicBoolean(true)
    private val queue = ArrayBlockingQueue<EncodedAccessUnit>(24)
    private val stateLock = Object()
    @Volatile private var config: AudioStreamConfig? = null
    private var worker: Thread? = null

    init {
        worker = Thread(::decodeLoop, "neurio-aac-renderer").apply { isDaemon = true; start() }
    }

    fun updateFormat(value: AudioStreamConfig) {
        config = value
        queue.clear()
        synchronized(stateLock) { stateLock.notifyAll() }
    }

    internal fun enqueue(sample: EncodedAccessUnit) {
        if (!running.get() || sample.mediaType != com.neurio.lanstream.protocol.LanProtocol.MEDIA_AUDIO) return
        if (!queue.offer(sample)) {
            queue.poll()
            queue.offer(sample)
        }
    }

    private fun decodeLoop() {
        var decoder: MediaCodec? = null
        var currentConfig: AudioStreamConfig? = null
        var track: AudioTrack? = null
        val info = MediaCodec.BufferInfo()
        while (running.get()) {
            val wanted = config
            if (wanted == null) {
                synchronized(stateLock) { try { stateLock.wait(200) } catch (_: InterruptedException) { } }
                continue
            }
            if (decoder == null || currentConfig != wanted) {
                release(decoder, track)
                decoder = null
                track = null
                try {
                    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, wanted.sampleRate, wanted.channelCount).apply {
                        setByteBuffer("csd-0", ByteBuffer.wrap(wanted.csd0))
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                    }
                    val createdDecoder = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
                    decoder = createdDecoder
                    createdDecoder.configure(format, null, null, 0)
                    createdDecoder.start()
                    currentConfig = wanted
                } catch (e: Exception) {
                    onError("AAC decoder unavailable: ${e.message ?: "unsupported audio format"}")
                    release(decoder, track)
                    decoder = null
                    track = null
                    try { Thread.sleep(500) } catch (_: InterruptedException) { }
                    continue
                }
            }
            val sample = try { queue.poll(5, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { null }
            if (sample != null) {
                try {
                    val codec = decoder ?: continue
                    val index = codec.dequeueInputBuffer(0)
                    if (index >= 0) {
                        val input = codec.getInputBuffer(index)
                        if (input != null && input.remaining() >= sample.data.size) {
                            input.clear()
                            input.put(sample.data)
                            codec.queueInputBuffer(index, 0, sample.data.size, sample.presentationTimeUs, 0)
                        } else {
                            codec.queueInputBuffer(index, 0, 0, sample.presentationTimeUs, 0)
                        }
                    }
                } catch (e: Exception) {
                    onError("AAC decoder input error: ${e.message ?: "buffer error"}")
                    release(decoder, track)
                    decoder = null
                    track = null
                    continue
                }
            }
            try {
                val codec = decoder ?: continue
                while (true) {
                    when (val index = codec.dequeueOutputBuffer(info, 0)) {
                        MediaCodec.INFO_TRY_AGAIN_LATER -> break
                        MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            val output = codec.outputFormat
                            val rate = if (output.containsKey(MediaFormat.KEY_SAMPLE_RATE)) output.getInteger(MediaFormat.KEY_SAMPLE_RATE) else wanted.sampleRate
                            val channels = if (output.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) output.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else wanted.channelCount
                            track?.let(::releaseTrack)
                            track = createTrack(rate, channels)
                        }
                        else -> if (index >= 0) {
                            try {
                                if (info.size > 0) {
                                    if (track == null) track = createTrack(wanted.sampleRate, wanted.channelCount)
                                    val output = codec.getOutputBuffer(index)
                                    if (output != null) {
                                        output.position(info.offset)
                                        output.limit(info.offset + info.size)
                                        track?.write(output, info.size, AudioTrack.WRITE_BLOCKING)
                                    }
                                }
                            } finally {
                                codec.releaseOutputBuffer(index, false)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                if (running.get()) onError("Audio playback stopped: ${e.message ?: "renderer error"}")
                release(decoder, track)
                decoder = null
                track = null
            }
        }
        release(decoder, track)
    }

    private fun createTrack(sampleRate: Int, channels: Int): AudioTrack {
        val mask = if (channels > 1) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
        val minBuffer = AudioTrack.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
            .coerceAtLeast(sampleRate / 8)
        val builder = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(sampleRate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(mask).build())
            .setBufferSizeInBytes(minBuffer.coerceAtLeast(4096))
            .setTransferMode(AudioTrack.MODE_STREAM)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
        return builder.build().also { it.play() }
    }

    private fun release(decoder: MediaCodec?, track: AudioTrack?) {
        try { decoder?.stop() } catch (_: Exception) { }
        try { decoder?.release() } catch (_: Exception) { }
        releaseTrack(track)
    }

    private fun releaseTrack(track: AudioTrack?) {
        if (track == null) return
        try { track.pause() } catch (_: Exception) { }
        try { track.flush() } catch (_: Exception) { }
        try { track.stop() } catch (_: Exception) { }
        try { track.release() } catch (_: Exception) { }
    }

    override fun close() {
        if (!running.getAndSet(false)) return
        synchronized(stateLock) { stateLock.notifyAll() }
        worker?.interrupt()
        try { worker?.join(800) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        worker = null
        queue.clear()
    }
}
