package com.neurio.host

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.neurio.common.AppLog
import com.neurio.common.AudioMode
import com.neurio.common.CsdCodec

/**
 * Host audio capture + encoding.
 *
 * HONEST LIMITATIONS (documented, not faked):
 *
 *  1. INTERNAL (game audio via AudioPlaybackCapture, Android 10+): only works
 *     for audio the *game itself* allows to be captured. An app must opt in
 *     with `allowAudioPlaybackCapture(true)`; most big titles (including
 *     eFootball) do NOT opt in, so this path often produces silence.
 *     Neurio measures the signal and reports silence instead of pretending.
 *
 *  2. MIC fallback: always available with RECORD_AUDIO granted, but it picks
 *     up the host speaker through the microphone - i.e. ambient quality.
 *
 *  3. When both are unavailable/empty the stream continues VIDEO-ONLY and the
 *     UI says so.
 */
class AudioCapture(private val context: Context) {

    companion object {
        private const val TAG = "AudioCapture"
        private const val SAMPLE_RATE = 48_000
        private const val BITRATE = 96_000
        private const val SILENCE_RMS = 8.0      // ~ -90 dBFS for 16-bit PCM
        private const val SILENCE_CHECK_MS = 1500
    }

    enum class Actual { INTERNAL, MIC, NONE }

    @Volatile
    var actual: Actual = Actual.NONE
        private set

    @Volatile
    var onEncoded: ((data: ByteArray, size: Int, ptsUs: Long) -> Unit)? = null

    @Volatile
    var onConfig: ((csd: ByteArray) -> Unit)? = null

    /** Fired once when INTERNAL capture produces only silence. */
    @Volatile
    var onSilenceDetected: (() -> Unit)? = null

    var mime: String = "audio/mp4a-latm"
        private set
    var channels: Int = 2
        private set
    val sampleRate: Int get() = SAMPLE_RATE

    private var record: AudioRecord? = null
    private var encoder: MediaCodec? = null
    private var thread: Thread? = null
    @Volatile
    private var running = false
    private var silenceReported = false

    fun start(mode: AudioMode, projection: MediaProjection?): Actual {
        stop()
        if (mode == AudioMode.OFF) {
            actual = Actual.NONE
            return actual
        }
        val canInternal = projection != null && Build.VERSION.SDK_INT >= 29 &&
            (mode == AudioMode.INTERNAL || mode == AudioMode.AUTO)
        if (canInternal && startInternal(projection!!)) {
            actual = Actual.INTERNAL
            return actual
        }
        if ((mode == AudioMode.MIC || mode == AudioMode.AUTO || mode == AudioMode.INTERNAL) &&
            startMic()
        ) {
            actual = Actual.MIC
            return actual
        }
        actual = Actual.NONE
        AppLog.w(TAG, "no audio source available; streaming video-only")
        return actual
    }

    private fun startInternal(projection: MediaProjection): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        return try {
            val config = AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build()
            val minBuf = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT
            )
            val rec = AudioRecord.Builder()
                .setAudioPlaybackCaptureConfig(config)
                .setAudioFormat(format)
                .setBufferSizeInBytes(minBuf * 2)
                .build()
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                return false
            }
            beginPipeline(rec, channels = 2, checkSilence = true)
            AppLog.i(TAG, "internal playback capture started")
            true
        } catch (e: Exception) {
            AppLog.w(TAG, "internal capture failed: ${e.message}")
            false
        }
    }

    private fun startMic(): Boolean {
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            AppLog.w(TAG, "RECORD_AUDIO not granted, mic fallback unavailable")
            return false
        }
        return try {
            val minBuf = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            val rec = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                minBuf * 2
            )
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                return false
            }
            beginPipeline(rec, channels = 1, checkSilence = false)
            AppLog.i(TAG, "mic fallback capture started")
            true
        } catch (e: SecurityException) {
            AppLog.w(TAG, "mic denied: ${e.message}")
            false
        } catch (e: Exception) {
            AppLog.w(TAG, "mic failed: ${e.message}")
            false
        }
    }

    private fun beginPipeline(rec: AudioRecord, channels: Int, checkSilence: Boolean) {
        this.channels = channels
        rec.startRecording()
        record = rec

        // Prefer Opus (lower latency at low bitrate), fall back to AAC-LC.
        var chosenMime = "audio/opus"
        var codec = try {
            MediaCodec.createEncoderByType(chosenMime)
        } catch (e: Exception) {
            chosenMime = "audio/mp4a-latm"
            MediaCodec.createEncoderByType(chosenMime)
        }
        mime = chosenMime

        val format = MediaFormat.createAudioFormat(mime, SAMPLE_RATE, channels).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
            if (mime == "audio/mp4a-latm") {
                setInteger(
                    MediaFormat.KEY_AAC_PROFILE,
                    MediaCodecInfo.CodecProfileLevel.AACObjectLC
                )
            } else {
                try {
                    setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 4096)
                } catch (ignored: Exception) {
                }
            }
        }
        // The callback MUST be set before configure() for async mode.
        codec.setCallback(object : MediaCodec.Callback() {
            override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {}
            override fun onOutputBufferAvailable(
                codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo
            ) {
                try {
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        val buf = codec.getOutputBuffer(index)
                        if (buf != null && info.size > 0) {
                            val data = ByteArray(info.size)
                            buf.position(info.offset)
                            buf.get(data, 0, info.size)
                            onConfig?.invoke(CsdCodec.encode(data, null))
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
                            onEncoded?.invoke(data, info.size, info.presentationTimeUs)
                        }
                    }
                    codec.releaseOutputBuffer(index, false)
                } catch (e: Exception) {
                    AppLog.w(TAG, "audio output error: ${e.message}")
                }
            }

            override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
                AppLog.e(TAG, "audio codec error", e)
            }

            override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
                val csd = format.getByteBuffer("csd-0")
                if (csd != null) {
                    val data = ByteArray(csd.remaining())
                    csd.get(data)
                    onConfig?.invoke(CsdCodec.encode(data, null))
                }
            }
        })
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        encoder = codec

        running = true
        silenceReported = !checkSilence
        val t = Thread { captureLoop(rec, codec) }
        t.name = "neurio-audio-capture"
        t.isDaemon = true
        thread = t
        t.start()
    }

    private fun captureLoop(rec: AudioRecord, codec: MediaCodec) {
        val chunkBytes = SAMPLE_RATE * channels * 2 / 50 // 20ms of PCM
        val pcm = ByteArray(chunkBytes)
        var checkDeadline = System.currentTimeMillis() + SILENCE_CHECK_MS
        var rmsSum = 0.0
        var rmsCount = 0

        while (running) {
            val read = try {
                rec.read(pcm, 0, pcm.size)
            } catch (e: Exception) {
                AppLog.w(TAG, "read error: ${e.message}")
                break
            }
            if (read <= 0) break

            if (!silenceReported) {
                rmsSum += rms(pcm, read)
                rmsCount++
                if (System.currentTimeMillis() > checkDeadline) {
                    val avg = if (rmsCount > 0) rmsSum / rmsCount else 0.0
                    silenceReported = true
                    if (avg < SILENCE_RMS) {
                        AppLog.w(TAG, "internal capture is silent (game did not opt in)")
                        try {
                            onSilenceDetected?.invoke()
                        } catch (ignored: Exception) {
                        }
                    }
                }
            }

            // Feed the encoder (bounded wait keeps latency low).
            val inIndex = try {
                codec.dequeueInputBuffer(20_000)
            } catch (e: Exception) {
                break
            }
            if (inIndex < 0) continue
            val inBuf = codec.getInputBuffer(inIndex) ?: continue
            val toCopy = minOf(read, inBuf.remaining())
            inBuf.clear()
            inBuf.put(pcm, 0, toCopy)
            val pts = SystemClock.elapsedRealtimeNanos() / 1000L
            try {
                codec.queueInputBuffer(inIndex, 0, toCopy, pts, 0)
            } catch (e: Exception) {
                break
            }
        }
        AppLog.d(TAG, "capture loop ended")
    }

    private fun rms(pcm: ByteArray, len: Int): Double {
        var sum = 0.0
        var i = 0
        while (i + 1 < len) {
            val s = ((pcm[i].toInt() and 0xFF) or (pcm[i + 1].toInt() shl 8)).toShort().toInt()
            sum += s.toDouble() * s.toDouble()
            i += 2
        }
        val samples = (len / 2).coerceAtLeast(1)
        return Math.sqrt(sum / samples)
    }

    fun stop() {
        running = false
        try {
            thread?.join(500)
        } catch (ignored: InterruptedException) {
        }
        thread = null
        try {
            record?.stop()
        } catch (ignored: Exception) {
        }
        try {
            record?.release()
        } catch (ignored: Exception) {
        }
        record = null
        val codec = encoder
        encoder = null
        if (codec != null) {
            try {
                codec.stop()
            } catch (ignored: Exception) {
            }
            try {
                codec.release()
            } catch (ignored: Exception) {
            }
        }
        actual = Actual.NONE
    }
}
