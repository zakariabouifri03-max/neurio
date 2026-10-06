package com.neurio.lanstream.client

import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.view.Surface
import com.neurio.lanstream.core.NetworkStats
import com.neurio.lanstream.model.VideoStreamConfig
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Continuous MediaCodec AVC decoder rendering directly to a SurfaceView surface. */
class VideoDecoder(
    private val stats: NetworkStats,
    private val onError: (String) -> Unit,
    private val requestKeyFrame: () -> Unit,
) : AutoCloseable {
    private val running = AtomicBoolean(true)
    private val queue = ArrayBlockingQueue<EncodedAccessUnit>(5)
    private val stateLock = Object()
    @Volatile private var streamConfig: VideoStreamConfig? = null
    @Volatile private var surface: Surface? = null
    private var worker: Thread? = null
    @Volatile private var droppedInputs = 0

    init {
        worker = Thread(::decodeLoop, "neurio-avc-decoder").apply { isDaemon = true; start() }
    }

    fun setSurface(value: Surface?) {
        surface = value
        synchronized(stateLock) { stateLock.notifyAll() }
    }

    fun updateFormat(config: VideoStreamConfig) {
        streamConfig = config
        queue.clear()
        requestKeyFrame()
        synchronized(stateLock) { stateLock.notifyAll() }
    }

    internal fun enqueue(sample: EncodedAccessUnit) {
        if (!running.get() || sample.mediaType != com.neurio.lanstream.protocol.LanProtocol.MEDIA_VIDEO) return
        if (!queue.offer(sample)) {
            queue.poll()
            if (!queue.offer(sample)) droppedInputs++
        }
    }

    private fun decodeLoop() {
        var codec: MediaCodec? = null
        var activeConfig: VideoStreamConfig? = null
        var activeSurface: Surface? = null
        val info = MediaCodec.BufferInfo()
        while (running.get()) {
            val wantedConfig = streamConfig
            val wantedSurface = surface
            if (wantedConfig == null || wantedSurface == null || !wantedSurface.isValid) {
                synchronized(stateLock) {
                    try { stateLock.wait(150) } catch (_: InterruptedException) { }
                }
                continue
            }
            if (codec == null || activeConfig != wantedConfig || activeSurface !== wantedSurface) {
                releaseCodec(codec)
                codec = null
                try {
                    val decoder = configureDecoder(wantedConfig, wantedSurface)
                    codec = decoder
                    activeConfig = wantedConfig
                    activeSurface = wantedSurface
                    droppedInputs = 0
                    requestKeyFrame()
                } catch (e: Exception) {
                    onError("H.264 decoder setup failed: ${e.message ?: "codec or stream format unsupported"}")
                    releaseCodec(codec)
                    codec = null
                    try { Thread.sleep(500) } catch (_: InterruptedException) { }
                    continue
                }
            }

            val sample = try { queue.poll(5, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { null }
            if (sample != null) {
                try {
                    val decoder = codec ?: continue
                    val index = decoder.dequeueInputBuffer(0)
                    if (index >= 0) {
                        val input = decoder.getInputBuffer(index)
                        if (input != null && input.remaining() >= sample.data.size) {
                            input.clear()
                            input.put(sample.data)
                            decoder.queueInputBuffer(index, 0, sample.data.size, sample.presentationTimeUs, 0)
                        } else {
                            decoder.queueInputBuffer(index, 0, 0, sample.presentationTimeUs, 0)
                            droppedInputs++
                        }
                    } else {
                        droppedInputs++
                    }
                } catch (e: Exception) {
                    onError("Video decoder input error: ${e.message ?: "buffer error"}")
                    releaseCodec(codec)
                    codec = null
                    continue
                }
            }

            try {
                val decoder = codec ?: continue
                while (true) {
                    when (val index = decoder.dequeueOutputBuffer(info, 0)) {
                        MediaCodec.INFO_TRY_AGAIN_LATER -> break
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED, MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit
                        else -> if (index >= 0) {
                            val render = info.size > 0
                            decoder.releaseOutputBuffer(index, render)
                            if (render) stats.decoded()
                        }
                    }
                }
            } catch (e: Exception) {
                if (running.get()) onError("Video decode error: ${e.message ?: "decoder reset"}")
                releaseCodec(codec)
                codec = null
            }
        }
        releaseCodec(codec)
    }

    private fun configureDecoder(config: VideoStreamConfig, surface: Surface): MediaCodec {
        val candidates = try {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
                .filter { info ->
                    if (info.isEncoder || info.supportedTypes.none { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, true) }) return@filter false
                    try {
                        info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).videoCapabilities
                            ?.areSizeAndRateSupported(config.width, config.height, config.fps.toDouble()) ?: true
                    } catch (_: Exception) { false }
                }
                .sortedBy { info ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        if (info.isHardwareAccelerated) 0 else 1
                    } else {
                        if (info.name.startsWith("OMX.google.") || info.name.startsWith("c2.android.")) 1 else 0
                    }
                }
        } catch (_: Exception) { emptyList() }

        var lastError: Exception? = null
        for (info in candidates) {
            var decoder: MediaCodec? = null
            try {
                val created = MediaCodec.createByCodecName(info.name)
                decoder = created
                created.configure(makeFormat(config), surface, null, 0)
                created.start()
                return created
            } catch (e: Exception) {
                lastError = e
                releaseCodec(decoder)
            }
        }
        val fallback = try { MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC) } catch (e: Exception) {
            throw IllegalStateException(lastError?.message ?: e.message ?: "No compatible AVC decoder", e)
        }
        return try {
            fallback.configure(makeFormat(config), surface, null, 0)
            fallback.start()
            fallback
        } catch (e: Exception) {
            releaseCodec(fallback)
            throw IllegalStateException(lastError?.message ?: e.message ?: "No compatible AVC decoder", e)
        }
    }

    private fun makeFormat(config: VideoStreamConfig): MediaFormat = MediaFormat.createVideoFormat(
        MediaFormat.MIMETYPE_VIDEO_AVC,
        config.width,
        config.height,
    ).apply {
        setByteBuffer("csd-0", ByteBuffer.wrap(config.csd0))
        if (config.csd1.isNotEmpty()) setByteBuffer("csd-1", ByteBuffer.wrap(config.csd1))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 4 * 1024 * 1024)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
    }

    private fun releaseCodec(codec: MediaCodec?) {
        if (codec == null) return
        try { codec.stop() } catch (_: Exception) { }
        try { codec.release() } catch (_: Exception) { }
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
