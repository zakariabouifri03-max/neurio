package com.neurio.lanstream.host

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Build
import com.neurio.lanstream.model.AudioStreamConfig
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

/** Android 10+ playback-capture API. Games may opt out, so callers keep video running on failure. */
class AudioCaptureEncoder(
    private val projection: MediaProjection,
    private val onConfig: (AudioStreamConfig) -> Unit,
    private val onEncodedAccessUnit: (ByteArray, Long) -> Unit,
    private val onStatus: (String) -> Unit,
) : AutoCloseable {
    private val running = AtomicBoolean(false)
    private var record: AudioRecord? = null
    private var codec: MediaCodec? = null
    private var worker: Thread? = null

    fun start() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            onStatus("Internal game audio needs Android 10 or newer; video remains available")
            return
        }
        try {
            val playbackCapture = AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .build()
            val inputFormat = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build()
            val minBuffer = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_STEREO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBuffer <= 0) throw IllegalStateException("AudioRecord reported an unsupported playback format")
            val audioRecord = AudioRecord.Builder()
                .setAudioFormat(inputFormat)
                .setBufferSizeInBytes((minBuffer * 2).coerceAtLeast(4_096))
                .setAudioPlaybackCaptureConfig(playbackCapture)
                .build()
            if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
                audioRecord.release()
                throw IllegalStateException("Android did not initialize playback capture")
            }
            record = audioRecord
            val audioFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, CHANNELS).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
            }
            val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            codec = encoder
            encoder.configure(audioFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()
            running.set(true)
            onStatus("Playback audio capture started; the game may restrict internal-audio capture")
            worker = Thread(::captureAndEncode, "neurio-audio-capture").apply { isDaemon = true; start() }
        } catch (e: Exception) {
            releaseResources()
            onStatus("Game audio unavailable: ${e.message ?: "Android/game capture policy denied it"}; video continues")
        }
    }

    private fun captureAndEncode() {
        val audioRecord = record ?: return
        val encoder = codec ?: return
        val info = MediaCodec.BufferInfo()
        val pcm = ByteArray(4_096)
        var ptsUs = 0L
        try {
            audioRecord.startRecording()
            while (running.get()) {
                val inputIndex = encoder.dequeueInputBuffer(5_000)
                if (inputIndex >= 0) {
                    val input = encoder.getInputBuffer(inputIndex)
                    if (input == null) {
                        encoder.queueInputBuffer(inputIndex, 0, 0, ptsUs, 0)
                    } else {
                        input.clear()
                        val requested = minOf(input.remaining(), pcm.size)
                        val read = audioRecord.read(pcm, 0, requested, AudioRecord.READ_BLOCKING)
                        val bytes = if (read > 0) read - (read % (CHANNELS * 2)) else 0
                        if (bytes > 0) {
                            input.put(pcm, 0, bytes)
                            val frames = bytes / (CHANNELS * 2)
                            encoder.queueInputBuffer(inputIndex, 0, bytes, ptsUs, 0)
                            ptsUs += frames * 1_000_000L / SAMPLE_RATE
                        } else {
                            encoder.queueInputBuffer(inputIndex, 0, 0, ptsUs, 0)
                            if (read < 0) Thread.sleep(10)
                        }
                    }
                }
                drain(encoder, info)
            }
        } catch (e: Exception) {
            if (running.get()) onStatus("Audio capture stopped: ${e.message ?: "capture policy or codec error"}; video continues")
        }
    }

    private fun drain(encoder: MediaCodec, info: MediaCodec.BufferInfo) {
        while (running.get()) {
            val index = try { encoder.dequeueOutputBuffer(info, 0) } catch (_: Exception) { return }
            when {
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> return
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val format = encoder.outputFormat
                    val csd0 = format.getByteBuffer("csd-0")?.toByteArray() ?: ByteArray(0)
                    if (csd0.isNotEmpty()) onConfig(AudioStreamConfig(SAMPLE_RATE, CHANNELS, csd0))
                }
                index == MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit
                index >= 0 -> {
                    try {
                        if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                            val output = encoder.getOutputBuffer(index)
                            if (output != null) {
                                val view = output.duplicate()
                                view.position(info.offset)
                                view.limit(info.offset + info.size)
                                val accessUnit = ByteArray(info.size)
                                view.get(accessUnit)
                                onEncodedAccessUnit(accessUnit, info.presentationTimeUs)
                            }
                        }
                    } finally {
                        try { encoder.releaseOutputBuffer(index, false) } catch (_: Exception) { }
                    }
                }
            }
        }
    }

    override fun close() {
        if (!running.getAndSet(false) && record == null && codec == null) return
        releaseResources()
    }

    private fun releaseResources() {
        running.set(false)
        try { record?.stop() } catch (_: Exception) { }
        try { record?.release() } catch (_: Exception) { }
        record = null
        try { codec?.stop() } catch (_: Exception) { }
        try { codec?.release() } catch (_: Exception) { }
        codec = null
        worker?.interrupt()
        try { worker?.join(500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        worker = null
    }

    private fun ByteBuffer.toByteArray(): ByteArray {
        val duplicate = duplicate()
        duplicate.rewind()
        val bytes = ByteArray(duplicate.remaining())
        duplicate.get(bytes)
        return bytes
    }

    companion object {
        private const val SAMPLE_RATE = 48_000
        private const val CHANNELS = 2
        private const val BITRATE = 128_000
    }
}
