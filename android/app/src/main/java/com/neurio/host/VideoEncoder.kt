package com.neurio.host

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.Surface
import com.neurio.common.AppLog
import com.neurio.common.CsdCodec
import com.neurio.common.Ewma
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Continuous hardware video encoder fed by the VirtualDisplay surface.
 *
 * Pipeline: display -> Surface -> MediaCodec (HW preferred) -> UDP packetizer.
 * Low-latency keys are set when the codec advertises them; bitrate is
 * adjustable live for adaptive streaming; keyframes can be requested on
 * demand (client join / packet loss).
 */
class VideoEncoder(private val mime: String) {

    companion object {
        private const val TAG = "VideoEncoder"
    }

    @Volatile
    var onEncoded: ((data: ByteArray, size: Int, ptsUs: Long, key: Boolean) -> Unit)? = null

    @Volatile
    var onConfig: ((csd: ByteArray) -> Unit)? = null

    var inputSurface: Surface? = null
        private set

    private var codec: MediaCodec? = null

    private var lastConfig: ByteArray? = null
    private val started = AtomicBoolean(false)

    private val encodeLatency = Ewma(0.25)
    val encodeLatencyMs: Double get() = encodeLatency.value

    private var framesEncoded = 0
    val totalFramesEncoded: Int get() = framesEncoded

    /** Chooses a hardware encoder when one exists for the mime type. */
    private fun createCodec(): MediaCodec {
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        var fallback: String? = null
        for (info in list.codecInfos) {
            if (!info.isEncoder) continue
            val supported = try {
                info.supportedTypes.any { it.equals(mime, ignoreCase = true) }
            } catch (e: Exception) {
                false
            }
            if (!supported) continue
            val name = info.name.lowercase()
            val isSoftware = name.contains(".sw.") || name.contains("sw.") ||
                name.startsWith("omx.google")
            if (!isSoftware) {
                AppLog.i(TAG, "using hardware encoder ${info.name}")
                return MediaCodec.createByCodecName(info.name)
            }
            if (fallback == null) fallback = info.name
        }
        if (fallback != null) {
            AppLog.w(TAG, "no hardware encoder for $mime, falling back to $fallback")
            return MediaCodec.createByCodecName(fallback)
        }
        AppLog.w(TAG, "createEncoderByType fallback for $mime")
        return MediaCodec.createEncoderByType(mime)
    }

    fun start(width: Int, height: Int, fps: Int, bitrateKbps: Int) {
        if (started.getAndSet(true)) return
        val format = MediaFormat.createVideoFormat(mime, width, height).apply {
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
            )
            setInteger(MediaFormat.KEY_BIT_RATE, bitrateKbps * 1000)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            setInteger(
                MediaFormat.KEY_BITRATE_MODE,
                MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR
            )
            // Realtime priority + low latency hints (guarded: not all codecs know them).
            try {
                setInteger(MediaFormat.KEY_PRIORITY, 0)
            } catch (ignored: Exception) {
            }
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    setInteger(MediaFormat.KEY_LATENCY, 0)
                } catch (ignored: Exception) {
                }
                try {
                    setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
                } catch (ignored: Exception) {
                }
            }
        }

        val mc = createCodec()
        mc.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = mc.createInputSurface()

        mc.setCallback(object : MediaCodec.Callback() {
            override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
                // Surface-input encoder: never used.
            }

            override fun onOutputBufferAvailable(
                codec: MediaCodec,
                index: Int,
                info: MediaCodec.BufferInfo
            ) {
                try {
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        val buf = codec.getOutputBuffer(index)
                        if (buf != null && info.size > 0 && lastConfig == null) {
                            val data = ByteArray(info.size)
                            buf.position(info.offset)
                            buf.get(data, 0, info.size)
                            lastConfig = data
                            onConfig?.invoke(data)
                        }
                        codec.releaseOutputBuffer(index, false)
                        return
                    }
                    if (info.size > 0) {
                        val buf = codec.getOutputBuffer(index)
                        if (buf != null) {
                            val data = ByteArray(info.size)
                            buf.position(info.offset)
                            buf.get(data, 0, info.size)
                            val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
                            framesEncoded++
                            val nowUs = SystemClock.elapsedRealtimeNanos() / 1000L
                            val latencyMs = (nowUs - info.presentationTimeUs) / 1000.0
                            if (latencyMs in 0.0..500.0) encodeLatency.add(latencyMs)
                            onEncoded?.invoke(data, info.size, info.presentationTimeUs, key)
                        }
                    }
                    codec.releaseOutputBuffer(index, false)
                } catch (e: Exception) {
                    AppLog.w(TAG, "output handling error: ${e.message}")
                }
            }

            override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
                AppLog.e(TAG, "codec error: ${e.diagnosticInfo}", e)
            }

            override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
                // Most encoders expose CSD here instead of as buffers.
                val csd0 = format.getByteBuffer("csd-0")
                if (csd0 != null) {
                    val a = ByteArray(csd0.remaining())
                    csd0.get(a)
                    val csd1Buf = format.getByteBuffer("csd-1")
                    var csd1: ByteArray? = null
                    if (csd1Buf != null) {
                        csd1 = ByteArray(csd1Buf.remaining())
                        csd1Buf.get(csd1)
                    }
                    val blob = CsdCodec.encode(a, csd1)
                    lastConfig = blob
                    AppLog.i(TAG, "encoder format ready, csd=${blob.size}B $format")
                    onConfig?.invoke(blob)
                } else {
                    AppLog.d(TAG, "output format: $format")
                }
            }
        })
        mc.start()
        codec = mc
        AppLog.i(TAG, "encoder started ${mime}x${width}x${height}@$fps ${bitrateKbps}kbps")
    }

    fun requestKeyFrame() {
        try {
            val params = Bundle()
            params.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
            codec?.setParameters(params)
        } catch (e: Exception) {
            AppLog.w(TAG, "requestKeyFrame: ${e.message}")
        }
    }

    fun setBitrate(kbps: Int) {
        try {
            val params = Bundle()
            params.putInt(MediaCodec.PARAMETER_KEY_BIT_RATE, kbps * 1000)
            codec?.setParameters(params)
            AppLog.i(TAG, "bitrate set to ${kbps}kbps")
        } catch (e: Exception) {
            AppLog.w(TAG, "setBitrate: ${e.message}")
        }
    }

    fun setFps(fps: Int) {
        try {
            val params = Bundle()
            params.putInt(MediaCodec.PARAMETER_KEY_FRAME_RATE, fps)
            codec?.setParameters(params)
        } catch (e: Exception) {
            AppLog.w(TAG, "setFps: ${e.message}")
        }
    }

    fun retransmitConfig() {
        lastConfig?.let { onConfig?.invoke(it) }
    }

    fun stop() {
        val mc = codec
        codec = null
        started.set(false)
        if (mc != null) {
            try {
                mc.stop()
            } catch (e: Exception) {
                AppLog.w(TAG, "stop: ${e.message}")
            }
            try {
                mc.release()
            } catch (ignored: Exception) {
            }
        }
        try {
            inputSurface?.release()
        } catch (ignored: Exception) {
        }
        inputSurface = null
        lastConfig = null
    }
}
