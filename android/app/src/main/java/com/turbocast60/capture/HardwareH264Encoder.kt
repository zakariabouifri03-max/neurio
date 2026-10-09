package com.turbocast60.capture

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.os.Bundle
import android.view.Surface
import com.turbocast60.model.StreamProfile
import com.turbocast60.model.VideoConfig
import com.turbocast60.model.VideoSizing
import com.turbocast60.protocol.EncodedAccessUnit
import com.turbocast60.protocol.H264NalUnits
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

class EncoderSettings(
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrate: Int,
    val profile: StreamProfile,
    val codecName: String,
    val hardwareAccelerated: Boolean
) {
    fun videoConfig() = VideoConfig(width, height, fps, bitrate, profile.maxBitrate, profile)
}

interface H264EncoderListener {
    fun onEncoderReady(settings: EncoderSettings)
    fun onCodecFormat(sps: ByteArray, pps: ByteArray)
    fun onAccessUnit(accessUnit: EncodedAccessUnit)
    fun onMeasuredFps(fps: Double)
    fun onEncoderFailure(message: String)
}

/** Surface-input AVC encoder. Captured pixels go directly from the VirtualDisplay surface to MediaCodec. */
class HardwareH264Encoder(
    private val sourceWidth: Int,
    private val sourceHeight: Int,
    private val requested: VideoConfig,
    private val listener: H264EncoderListener
) {
    private val running = AtomicBoolean(false)
    private val codecLock = Any()
    @Volatile private var codec: MediaCodec? = null
    @Volatile private var inputSurface: Surface? = null
    @Volatile private var codecThread: Thread? = null
    @Volatile private var settings: EncoderSettings? = null
    @Volatile private var sps: ByteArray? = null
    @Volatile private var pps: ByteArray? = null
    private var notifiedSps: ByteArray? = null
    private var notifiedPps: ByteArray? = null
    private var countedFrames = 0
    private var fpsWindowStartNs = System.nanoTime()

    fun start(): Surface {
        var lastFailure: Throwable? = null
        for (choice in candidateEncoders(sourceWidth, sourceHeight, requested)) {
            val mediaFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, choice.width, choice.height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, choice.bitrate)
                setInteger(MediaFormat.KEY_FRAME_RATE, choice.fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }
            val created = try {
                MediaCodec.createByCodecName(choice.codecName)
            } catch (t: Throwable) {
                lastFailure = t
                continue
            }
            var surface: Surface? = null
            try {
                created.configure(mediaFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                val input = created.createInputSurface()
                surface = input
                created.start()
                settings = choice
                codec = created
                inputSurface = input
                running.set(true)
                listener.onEncoderReady(choice)
                codecThread = Thread(::drainOutput, "TurboCast-AVC-output").apply { isDaemon = true; start() }
                return input
            } catch (t: Throwable) {
                lastFailure = t
                runCatching { surface?.release() }
                runCatching { created.stop() }
                runCatching { created.release() }
            }
        }
        throw IllegalStateException("No compatible H.264 encoder mode could be started on this device", lastFailure)
    }

    fun currentSettings(): EncoderSettings? = settings

    fun updateBitrate(bitsPerSecond: Int): Boolean {
        val target = bitsPerSecond.coerceIn(750_000, requested.maxBitrate)
        return synchronized(codecLock) {
            val active = codec ?: return@synchronized false
            try {
                active.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, target) })
                settings = settings?.let { EncoderSettings(it.width, it.height, it.fps, target, it.profile, it.codecName, it.hardwareAccelerated) }
                true
            } catch (_: Throwable) {
                false
            }
        }
    }

    fun requestKeyFrame() {
        synchronized(codecLock) {
            runCatching {
                codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
            }
        }
    }

    fun stop() {
        if (!running.getAndSet(false)) return
        codecThread?.interrupt()
        runCatching { codecThread?.join(1200) }
        codecThread = null
        synchronized(codecLock) {
            codec?.let { old ->
                runCatching { old.stop() }
                runCatching { old.release() }
            }
            codec = null
        }
        inputSurface?.let { runCatching { it.release() } }
        inputSurface = null
    }

    private fun drainOutput() {
        val bufferInfo = MediaCodec.BufferInfo()
        try {
            while (running.get()) {
                val active = codec ?: break
                val index = active.dequeueOutputBuffer(bufferInfo, 10_000)
                when {
                    index == MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> updateCodecSpecificData(active.outputFormat)
                    index == MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit
                    index >= 0 -> {
                        try {
                            val output = active.getOutputBuffer(index)
                            if (output != null && bufferInfo.size > 0) {
                                val bytes = ByteArray(bufferInfo.size)
                                output.duplicate().apply {
                                    position(bufferInfo.offset)
                                    limit(bufferInfo.offset + bufferInfo.size)
                                    get(bytes)
                                }
                                if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                                    acceptCodecData(bytes)
                                } else {
                                    val nals = H264NalUnits.parse(bytes).filter { it.isNotEmpty() }
                                    if (nals.isNotEmpty()) {
                                        val codecData = H264NalUnits.parameterSets(sps, pps)
                                        if (codecData.first != null && codecData.second != null) {
                                            listener.onAccessUnit(
                                                EncodedAccessUnit(
                                                    bufferInfo.presentationTimeUs,
                                                    nals,
                                                    (bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0 ||
                                                        nals.any { nal -> (nal[0].toInt() and 0x1f) == 5 }
                                                )
                                            )
                                            tickFps()
                                        }
                                    }
                                }
                            }
                        } finally {
                            active.releaseOutputBuffer(index, false)
                        }
                    }
                }
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (t: Throwable) {
            if (running.get()) listener.onEncoderFailure("H.264 encoder stopped: ${t.javaClass.simpleName}")
        }
    }

    private fun updateCodecSpecificData(format: MediaFormat) {
        val first = format.byteBufferOrNull("csd-0")
        val second = format.byteBufferOrNull("csd-1")
        val sets = H264NalUnits.parameterSets(first, second)
        if (sets.first != null) sps = sets.first
        if (sets.second != null) pps = sets.second
        notifyFormatIfReady()
    }

    private fun acceptCodecData(bytes: ByteArray) {
        val sets = H264NalUnits.parameterSets(bytes)
        if (sets.first != null) sps = sets.first
        if (sets.second != null) pps = sets.second
        notifyFormatIfReady()
    }

    private fun notifyFormatIfReady() {
        val currentSps = sps
        val currentPps = pps
        if (currentSps != null && currentPps != null &&
            (!currentSps.contentEquals(notifiedSps) || !currentPps.contentEquals(notifiedPps))) {
            notifiedSps = currentSps.copyOf()
            notifiedPps = currentPps.copyOf()
            listener.onCodecFormat(currentSps, currentPps)
        }
    }

    private fun tickFps() {
        countedFrames++
        val now = System.nanoTime()
        val elapsed = now - fpsWindowStartNs
        if (elapsed >= 1_000_000_000L) {
            listener.onMeasuredFps(countedFrames * 1_000_000_000.0 / elapsed)
            countedFrames = 0
            fpsWindowStartNs = now
        }
    }

    private fun MediaFormat.byteBufferOrNull(key: String): ByteArray? = runCatching {
        getByteBuffer(key)?.duplicate()?.let { buffer ->
            ByteArray(buffer.remaining()).also { bytes -> buffer.get(bytes) }
        }
    }.getOrNull()

    companion object {
        private fun isHardwareAccelerated(info: MediaCodecInfo): Boolean =
            if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated
            else !info.name.contains("google", true) && !info.name.contains("software", true)

        private fun candidateEncoders(sourceWidth: Int, sourceHeight: Int, requested: VideoConfig): List<EncoderSettings> {
            val encoders = MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
                .filter { it.isEncoder && it.supportedTypes.any { type -> type.equals(MediaFormat.MIMETYPE_VIDEO_AVC, true) } }
                .sortedBy { codec ->
                    if (Build.VERSION.SDK_INT >= 29 && codec.isHardwareAccelerated) 0
                    else if (!codec.name.contains("google", true) && !codec.name.contains("software", true)) 1 else 2
                }
            val longEdges = listOf(maxOf(requested.width, requested.height), 1280, 960, 720, 640).distinct()
            val fpsOptions = listOf(requested.fps, 30, 24, 20).distinct()
            val choices = ArrayList<EncoderSettings>()
            for (longEdge in longEdges) {
                val (width, height) = VideoSizing.fit(sourceWidth, sourceHeight, longEdge)
                for (fps in fpsOptions) {
                    for (info in encoders) {
                        val supported = runCatching {
                            info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC)
                                .videoCapabilities.areSizeAndRateSupported(width, height, fps.toDouble())
                        }.getOrDefault(false)
                        if (!supported) continue
                        val upper = runCatching {
                            info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).videoCapabilities.bitrateRange.upper
                        }.getOrDefault(requested.bitrate)
                        val bitrate = requested.bitrate.coerceAtMost(upper).coerceAtLeast(750_000)
                        choices += EncoderSettings(width, height, fps, bitrate, requested.profile, info.name, isHardwareAccelerated(info))
                    }
                }
            }
            if (choices.isEmpty()) {
                val fallback = encoders.firstOrNull() ?: throw IllegalStateException("No H.264 encoder is available on this device")
                val (width, height) = VideoSizing.fit(sourceWidth, sourceHeight, 640)
                choices += EncoderSettings(width, height, 20, 1_500_000, requested.profile, fallback.name, isHardwareAccelerated(fallback))
            }
            return choices.distinctBy { "${it.codecName}:${it.width}x${it.height}:${it.fps}" }
        }

    }
}
