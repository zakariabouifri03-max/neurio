package com.neurio.lanstream.media

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Build
import android.os.Bundle
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import com.neurio.lanstream.core.Log
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Continuous hardware H.264/H.265 encoder fed *directly* from a Surface.
 *
 * This is the important performance decision of the whole prototype: the
 * VirtualDisplay renders the captured screen into the encoder's input surface,
 * so frames never enter the app's memory (no bitmaps, no JPEG, no copies). We
 * only ever touch the small compressed output buffers.
 */
class VideoEncoder(
    private val profile: StreamProfile,
    private val lowLatency: Boolean,
    private val onOutput: (payload: ByteArray, isConfig: Boolean, isKeyframe: Boolean, ptsUs: Long, captureWallMs: Long) -> Unit,
    private val onError: (Throwable) -> Unit
) {

    //TODO(platform-limit): MediaCodec gives us baseline/main H.264 (and H.265
    // where the SoC exposes it) with no B-frames, no 10-bit/HDR and no control
    // over the encoder's internal latency beyond the low-latency hint, which
    // some vendors ignore. Vendor encoders also cap the number of concurrent
    // sessions, so a second simultaneous capture on the same phone can fail.

    private val running = AtomicBoolean(false)
    private var codec: MediaCodec? = null
    private var surface: Surface? = null
    private var thread: HandlerThread? = null

    @Volatile
    private var currentBitrate = profile.bitrateBps

    @Volatile
    var encoderName: String = ""
        private set

    @Volatile
    var hardwareAccelerated: Boolean = false
        private set

    @Volatile
    var framesEncoded: Long = 0L
        private set

    /** Latest SPS/PPS seen, so every keyframe is self contained. */
    private var sps: ByteArray? = null
    private var pps: ByteArray? = null
    private val hevc: Boolean = profile.mime.contains("hevc", true)

    /** Starts the encoder and returns the Surface the VirtualDisplay must draw into. */
    fun start(): Surface {
        val info = CodecCapabilities.preferEncoder(profile.mime)
            ?: throw IllegalStateException("No ${profile.mime} encoder on this device")
        encoderName = info.name
        hardwareAccelerated = CodecCapabilities.isHardware(info)
        Log.i("Using encoder ${info.name} (hardware=$hardwareAccelerated) at ${profile.fullLabel()}")

        var codecInstance = MediaCodec.createByCodecName(info.name)
        try {
            codecInstance.configure(buildFormat(withLatency = lowLatency), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        } catch (t: Throwable) {
            Log.w("Encoder rejected low-latency format, retrying without vendor keys", t)
            runCatching { codecInstance.release() }
            codecInstance = MediaCodec.createByCodecName(info.name)
            codecInstance.configure(buildFormat(withLatency = false), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        }

        val input = codecInstance.createInputSurface()
        codecInstance.start()
        codec = codecInstance
        surface = input
        running.set(true)

        val t = HandlerThread("neurio-encoder").apply { start() }
        thread = t
        android.os.Handler(t.looper).post { drain(codecInstance) }
        return input
    }

    private fun buildFormat(withLatency: Boolean): MediaFormat =
        MediaFormat.createVideoFormat(profile.mime, profile.width, profile.height).apply {
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
            )
            setInteger(MediaFormat.KEY_BIT_RATE, currentBitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, profile.fps)
            // 1s GOP keeps a keyframe close at hand after packet loss.
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, if (lowLatency) 1 else 2)
            setInteger(
                MediaFormat.KEY_BITRATE_MODE,
                MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR
            )
            if (withLatency && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                runCatching { setInteger(MediaFormat.KEY_LATENCY, 0) }
            }
            if (withLatency) {
                // Vendor hint (Qualcomm). Unknown keys are ignored by other SoCs.
                runCatching { setInteger("vendor.qti-ext-enc-low-latency.enable", 1) }
            }
        }

    private fun drain(codecInstance: MediaCodec) {
        val info = MediaCodec.BufferInfo()
        while (running.get()) {
            val index = try {
                codecInstance.dequeueOutputBuffer(info, 5_000)
            } catch (t: Throwable) {
                if (running.get()) onError(t)
                break
            }
            when {
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> continue
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    Log.i("Encoder format changed: ${codecInstance.outputFormat}")
                }
                index >= 0 -> {
                    val buffer = try {
                        codecInstance.getOutputBuffer(index)
                    } catch (t: Throwable) {
                        null
                    }
                    if (buffer != null && info.size > 0) {
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        val payload = ByteArray(info.size)
                        buffer.get(payload)
                        val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                        val isKeyframe = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
                        handlePayload(payload, isConfig, isKeyframe, info.presentationTimeUs)
                    }
                    runCatching { codecInstance.releaseOutputBuffer(index, false) }
                }
            }
        }
        Log.i("Encoder drain loop finished")
    }

    private fun handlePayload(payload: ByteArray, isConfig: Boolean, isKeyframe: Boolean, ptsUs: Long) {
        val nowMonoUs = System.nanoTime() / 1000L
        val captureWallMs = if (ptsUs > 0) {
            System.currentTimeMillis() - ((nowMonoUs - ptsUs) / 1000L)
        } else {
            System.currentTimeMillis()
        }

        if (isConfig) {
            val (s, p) = AnnexB.spsPps(payload, hevc)
            if (s != null) sps = s
            if (p != null) pps = p
            // Send the parameter sets as their own tiny datagram: the client needs
            // them before it can even configure its decoder.
            onOutput(payload, true, false, ptsUs, captureWallMs)
            return
        }

        framesEncoded++
        val out = if (isKeyframe && sps != null) {
            AnnexB.prependConfig(payload, sps, pps)
        } else {
            payload
        }
        onOutput(out, false, isKeyframe, ptsUs, captureWallMs)
    }

    fun requestKeyframe() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val params = Bundle().apply {
                putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
            }
            runCatching { codec?.setParameters(params) }
                .onFailure { Log.w("requestKeyframe failed: ${it.message}") }
        }
    }

    /** Live bitrate change (adaptive bitrate) without restarting the encoder. */
    fun setBitrate(bitrateBps: Int) {
        currentBitrate = bitrateBps
        val params = Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, bitrateBps) }
        runCatching { codec?.setParameters(params) }
            .onFailure { Log.w("setBitrate failed: ${it.message}") }
    }

    fun captureLatencyHint(): Long = SystemClock.elapsedRealtime()

    fun stop() {
        running.set(false)
        try {
            codec?.stop()
        } catch (t: Throwable) {
            Log.w("Encoder stop: ${t.message}")
        }
        try {
            codec?.release()
        } catch (_: Throwable) {
        }
        codec = null
        try {
            surface?.release()
        } catch (_: Throwable) {
        }
        surface = null
        thread?.quitSafely()
        thread = null
    }
}
