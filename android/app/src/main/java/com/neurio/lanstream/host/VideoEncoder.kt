package com.neurio.lanstream.host

import android.content.Context
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import android.view.WindowManager
import com.neurio.lanstream.core.NetworkStats
import com.neurio.lanstream.model.StreamOptions
import com.neurio.lanstream.model.VideoStreamConfig
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

/** Surface-input AVC encoder. The OS captures a real MediaProjection display, not screenshots. */
class VideoEncoder(
    private val context: Context,
    private val projection: MediaProjection,
    private val options: StreamOptions,
    initialBitrate: Int,
    private val stats: NetworkStats,
    private val onConfig: (VideoStreamConfig) -> Unit,
    private val onEncodedAccessUnit: (ByteArray, Long, Boolean) -> Unit,
    private val onStatus: (String) -> Unit,
) : AutoCloseable {
    val width: Int
    val height: Int
    private val running = AtomicBoolean(false)
    private var codec: MediaCodec? = null
    private var inputSurface: android.view.Surface? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var drainThread: Thread? = null
    @Volatile private var bitrate = initialBitrate.coerceIn(500_000, 40_000_000)

    init {
        val size = chooseDimensions(context, options.resolutionCap)
        width = size.first
        height = size.second
        start()
    }

    private fun start() {
        val selected = selectAvcEncoder()
        val candidates = listOf(selected?.name to true, null to false).distinct()
        var chosenCodec: MediaCodec? = null
        var chosenSurface: android.view.Surface? = null
        var lastError: Exception? = null
        for ((name, lowLatencyFormat) in candidates) {
            var candidate: MediaCodec? = null
            var candidateSurface: android.view.Surface? = null
            try {
                val codecCandidate = if (name != null) MediaCodec.createByCodecName(name)
                else MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
                candidate = codecCandidate
                val format = makeVideoFormat(lowLatencyFormat)
                codecCandidate.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                val surfaceCandidate = codecCandidate.createInputSurface()
                candidateSurface = surfaceCandidate
                codecCandidate.start()
                chosenCodec = codecCandidate
                chosenSurface = surfaceCandidate
                break
            } catch (e: Exception) {
                lastError = e
                try { candidateSurface?.release() } catch (_: Exception) { }
                try { candidate?.stop() } catch (_: Exception) { }
                try { candidate?.release() } catch (_: Exception) { }
            }
        }
        val encoder = chosenCodec ?: run {
            val failure = lastError ?: IllegalStateException("No H.264 encoder is available")
            onStatus("H.264 encoder unavailable: ${failure.message ?: "codec error"}")
            throw failure
        }
        val encoderSurface = chosenSurface ?: throw IllegalStateException("H.264 encoder did not create an input surface")
        inputSurface = encoderSurface
        codec = encoder
        try {
            val metrics = DisplayMetrics()
            val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)
            val densityDpi = metrics.densityDpi.coerceAtLeast(120)
            virtualDisplay = projection.createVirtualDisplay(
                "Neurio LAN game capture",
                width,
                height,
                densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                encoderSurface,
                null,
                null,
            ) ?: throw IllegalStateException("Android did not create a virtual display")
            running.set(true)
            onStatus("Capturing ${width}×${height} using ${encoder.name}")
            drainThread = Thread(::drainOutput, "neurio-avc-encoder").apply { isDaemon = true; start() }
        } catch (e: Exception) {
            try { virtualDisplay?.release() } catch (_: Exception) { }
            virtualDisplay = null
            try { encoder.stop() } catch (_: Exception) { }
            try { encoder.release() } catch (_: Exception) { }
            codec = null
            try { inputSurface?.release() } catch (_: Exception) { }
            inputSurface = null
            onStatus("Could not start H.264 capture: ${e.message ?: "encoder setup failed"}")
            throw e
        }
    }

    private fun makeVideoFormat(lowLatency: Boolean): MediaFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
        setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        setInteger(MediaFormat.KEY_FRAME_RATE, options.framesPerSecond)
        setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)
        if (lowLatency) {
            setInteger(MediaFormat.KEY_PRIORITY, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
                setInteger(MediaFormat.KEY_LATENCY, 0)
            }
        }
    }

    private fun drainOutput() {
        val localCodec = codec ?: return
        val info = MediaCodec.BufferInfo()
        while (running.get()) {
            try {
                when (val index = localCodec.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> publishFormat(localCodec.outputFormat)
                    MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit
                    else -> if (index >= 0) {
                        try {
                            if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                                val buffer = localCodec.getOutputBuffer(index)
                                if (buffer != null) {
                                    val view = buffer.duplicate()
                                    view.position(info.offset)
                                    view.limit(info.offset + info.size)
                                    val accessUnit = ByteArray(info.size)
                                    view.get(accessUnit)
                                    stats.encoded(accessUnit.size)
                                    val keyFrame = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
                                    onEncodedAccessUnit(accessUnit, info.presentationTimeUs, keyFrame)
                                }
                            }
                        } finally {
                            localCodec.releaseOutputBuffer(index, false)
                        }
                    }
                }
            } catch (e: IllegalStateException) {
                if (running.get()) onStatus("Video encoder stopped: ${e.message ?: "codec state error"}")
                break
            } catch (e: Exception) {
                if (running.get()) onStatus("Video encode error: ${e.message ?: "unknown error"}")
            }
        }
    }

    private fun publishFormat(format: MediaFormat) {
        val csd0 = format.getByteBuffer("csd-0")?.toByteArray() ?: ByteArray(0)
        val csd1 = format.getByteBuffer("csd-1")?.toByteArray() ?: ByteArray(0)
        if (csd0.isEmpty()) {
            onStatus("Encoder has not supplied H.264 decoder configuration yet")
            return
        }
        val configuredWidth = format.getInteger(MediaFormat.KEY_WIDTH).coerceIn(64, 4096)
        val configuredHeight = format.getInteger(MediaFormat.KEY_HEIGHT).coerceIn(64, 4096)
        onConfig(VideoStreamConfig(configuredWidth, configuredHeight, options.framesPerSecond, bitrate, csd0, csd1))
        onStatus("H.264 stream ready (${configuredWidth}×${configuredHeight} @ ${options.framesPerSecond} FPS)")
    }

    fun setBitrate(bitsPerSecond: Int) {
        val value = bitsPerSecond.coerceIn(500_000, 40_000_000)
        bitrate = value
        try {
            val params = Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, value) }
            codec?.setParameters(params)
        } catch (_: Exception) {
            // Some vendor codecs do not support live bitrate changes. Streaming continues at its original rate.
        }
    }

    fun requestKeyFrame() {
        try {
            codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (_: Exception) {
        }
    }

    override fun close() {
        if (!running.getAndSet(false)) return
        try { virtualDisplay?.release() } catch (_: Exception) { }
        virtualDisplay = null
        try { inputSurface?.release() } catch (_: Exception) { }
        inputSurface = null
        try { codec?.stop() } catch (_: Exception) { }
        try { codec?.release() } catch (_: Exception) { }
        codec = null
        drainThread?.interrupt()
        try { drainThread?.join(500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        drainThread = null
    }

    private fun selectAvcEncoder(): MediaCodecInfo? {
        return try {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
                .filter { info ->
                    if (!info.isEncoder || info.supportedTypes.none { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, true) }) return@filter false
                    try {
                        info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).videoCapabilities
                            ?.areSizeAndRateSupported(width, height, options.framesPerSecond.toDouble()) ?: true
                    } catch (_: Exception) {
                        false
                    }
                }
                .sortedBy { info ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        if (info.isHardwareAccelerated) 0 else 1
                    } else {
                        if (info.name.startsWith("OMX.google.") || info.name.startsWith("c2.android.")) 1 else 0
                    }
                }
                .firstOrNull()
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private fun chooseDimensions(context: Context, cap: Int): Pair<Int, Int> {
            val point = Point()
            try {
                val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                @Suppress("DEPRECATION")
                windowManager.defaultDisplay.getRealSize(point)
            } catch (_: Exception) {
                point.set(1080, 1920)
            }
            val sourceWidth = max(1, point.x)
            val sourceHeight = max(1, point.y)
            val longest = max(sourceWidth, sourceHeight)
            val limit = cap.coerceIn(480, 1080)
            val scale = minOf(1.0, limit.toDouble() / longest)
            fun even(value: Double): Int = ((value.toInt().coerceAtLeast(128) / 2) * 2).coerceAtLeast(128)
            return even(sourceWidth * scale) to even(sourceHeight * scale)
        }

        private fun ByteBuffer.toByteArray(): ByteArray {
            val duplicate = duplicate()
            duplicate.rewind()
            val bytes = ByteArray(duplicate.remaining())
            duplicate.get(bytes)
            return bytes
        }
    }
}
