package com.neurio.lanstream.media

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.view.Surface
import com.neurio.lanstream.core.Log
import java.nio.ByteBuffer

/**
 * Hardware H.264/H.265 decoder rendering straight into a Surface.
 *
 * Latency policy (this is a game stream, not a video player):
 *   * input buffers are requested with a 0 us timeout: if the decoder is busy we
 *     drop the access unit and wait for the next keyframe instead of queueing;
 *   * output frames are released with renderTimeNs = now, i.e. "show it as soon
 *     as possible" instead of respecting a presentation timeline;
 *   * there is no reorder buffer, no smooth playback logic and no audio sync.
 */
class VideoDecoder(
    private val mime: String,
    private val lowLatency: Boolean,
    private val onFrameRendered: (ptsUs: Long) -> Unit,
    private val onError: (Throwable) -> Unit
) {
    @Volatile
    private var codec: MediaCodec? = null

    @Volatile
    private var surface: Surface? = null

    private var csd0: ByteArray? = null
    private var csd1: ByteArray? = null
    private var width: Int = 1280
    private var height: Int = 720

    @Volatile
    var needKeyframe: Boolean = true
        private set

    @Volatile
    var decoderName: String = ""
        private set

    @Volatile
    var hardware: Boolean = false
        private set

    @Volatile
    var framesDecoded: Long = 0L
        private set

    @Volatile
    var framesDropped: Long = 0L
        private set

    @Volatile
    var outputWidth: Int = 0
        private set

    @Volatile
    var outputHeight: Int = 0
        private set

    @Synchronized
    fun setSurface(next: Surface?) {
        surface = next
        if (next == null) {
            stopCodec()
            return
        }
        val existing = codec
        if (existing != null) {
            runCatching { existing.setOutputSurface(next) }
                .onFailure { Log.w("setOutputSurface failed, recreating decoder") }
                .onSuccess { return }
            stopCodec()
        }
        startCodec()
    }

    /** Called with the codec configuration received from the host. */
    @Synchronized
    fun applyConfig(sps: ByteArray?, pps: ByteArray?, width: Int, height: Int) {
        val changed =
            !(sps contentEquals csd0) || !(pps contentEquals csd1) ||
                width != this.width || height != this.height
        csd0 = sps
        csd1 = pps
        this.width = width
        this.height = height
        if (changed) {
            Log.i("Decoder config updated: ${width}x${height} (sps=${sps?.size}, pps=${pps?.size})")
            stopCodec()
            if (surface != null) startCodec()
        }
    }

    @Synchronized
    private fun startCodec() {
        val target = surface ?: return
        val info = CodecCapabilities.preferDecoder(mime) ?: run {
            onError(IllegalStateException("No $mime decoder available"))
            return
        }
        decoderName = info.name
        hardware = CodecCapabilities.isHardware(info)
        var instance: MediaCodec? = null
        try {
            instance = MediaCodec.createByCodecName(info.name)
            instance.configure(buildFormat(lowLatency), target, null, 0)
            instance.start()
        } catch (t: Throwable) {
            Log.w("Decoder configure failed (${t.message}), retrying without latency hint")
            runCatching { instance?.release() }
            try {
                instance = MediaCodec.createByCodecName(info.name)
                instance?.configure(buildFormat(false), target, null, 0)
                instance?.start()
            } catch (t2: Throwable) {
                runCatching { instance?.release() }
                onError(t2)
                return
            }
        }
        codec = instance
        needKeyframe = true
        Log.i("Decoder started: $decoderName (hardware=$hardware)")
    }

    private fun buildFormat(latency: Boolean): MediaFormat =
        MediaFormat.createVideoFormat(mime, width, height).apply {
            csd0?.let { setByteBuffer("csd-0", ByteBuffer.wrap(it)) }
            csd1?.let { setByteBuffer("csd-1", ByteBuffer.wrap(it)) }
            if (latency && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                runCatching { setInteger(MediaFormat.KEY_LATENCY, 0) }
            }
        }

    /** Feeds one complete access unit. Returns false when it had to be dropped. */
    @Synchronized
    fun submit(data: ByteArray, offset: Int, size: Int, ptsUs: Long, isKeyframe: Boolean): Boolean {
        val instance = codec
        if (instance == null) {
            framesDropped++
            return false
        }
        if (needKeyframe && !isKeyframe) {
            framesDropped++
            return false
        }
        val index = try {
            instance.dequeueInputBuffer(0)
        } catch (t: Throwable) {
            onError(t)
            return false
        }
        if (index < 0) {
            // Decoder backlog: drop and resync. Queuing here would only add lag.
            framesDropped++
            needKeyframe = true
            return false
        }
        val buffer = runCatching { instance.getInputBuffer(index) }.getOrNull()
        if (buffer == null) {
            framesDropped++
            return false
        }
        if (size > buffer.capacity()) {
            framesDropped++
            needKeyframe = true
            return false
        }
        buffer.clear()
        buffer.put(data, offset, size)
        runCatching {
            instance.queueInputBuffer(
                index,
                0,
                size,
                ptsUs,
                if (isKeyframe) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
            )
        }.onFailure { t ->
            onError(t)
            return false
        }
        needKeyframe = false
        drain(instance)
        return true
    }

    /** Call after packet loss: forget pending frames and wait for an IDR. */
    fun requestResync() {
        needKeyframe = true
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
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val format = runCatching { instance.outputFormat }.getOrNull()
                    if (format != null) {
                        outputWidth = runCatching { format.getInteger(MediaFormat.KEY_WIDTH) }.getOrDefault(0)
                        outputHeight = runCatching { format.getInteger(MediaFormat.KEY_HEIGHT) }.getOrDefault(0)
                    }
                }
                index >= 0 -> {
                    val render = info.size > 0
                    if (render) {
                        runCatching { instance.releaseOutputBuffer(index, System.nanoTime()) }
                        framesDecoded++
                        onFrameRendered(info.presentationTimeUs)
                    } else {
                        runCatching { instance.releaseOutputBuffer(index, false) }
                    }
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
                else -> return
            }
        }
    }

    @Synchronized
    private fun stopCodec() {
        try {
            codec?.stop()
        } catch (_: Throwable) {
        }
        try {
            codec?.release()
        } catch (_: Throwable) {
        }
        codec = null
        needKeyframe = true
    }

    fun stop() {
        stopCodec()
        framesDecoded = 0
        framesDropped = 0
    }
}
