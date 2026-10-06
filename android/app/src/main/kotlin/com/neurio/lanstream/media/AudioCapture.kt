package com.neurio.lanstream.media

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import com.neurio.lanstream.core.Log

/**
 * Captures what the phone is *playing* (the game audio) using the Android 10+
 * playback-capture API, which is the only legitimate way for a normal app to
 * grab another app's audio output.
 *
 * Hard platform limits, surfaced to the UI instead of being faked:
 *   * Android < 10: API does not exist.
 *   * The game sets ALLOW_CAPTURE_BY_NONE (common with anti-cheat / DRM) or is
 *     DRM protected: the AudioRecord exists but only delivers silence, or the
 *     system refuses to start it.
 *   * Voice-call audio can never be captured.
 *
 * When this fails the video stream keeps working; see docs/LIMITATIONS.md.
 */
class AudioCapture(private val projection: MediaProjection) {

    //TODO(platform-limit): internal audio is only reachable through playback
    // capture (Android 10+). A game that sets ALLOW_CAPTURE_BY_NONE, uses DRM
    // audio or runs an anti-cheat hook yields an AudioRecord that starts fine
    // but delivers silence — the system tells us nothing. We detect it with the
    // silentReads counter and surface "blocked by the game" instead of faking
    // audio. Voice-call audio can never be captured on any Android version.
    // Legitimate alternatives: none for a third-party app; a root/system audio
    // tap would be required, which is out of scope for this prototype.

    var sampleRate: Int = 48_000
        private set

    var channelCount: Int = 2
        private set

    var failureReason: String? = null
        private set

    @Volatile
    private var record: AudioRecord? = null

    /** Consecutive silent reads — used to detect "capturing but blocked". */
    var silentReads: Int = 0
        private set

    val isRunning: Boolean get() = record != null

    fun start(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            failureReason = "Android 10+ required for playback capture"
            return false
        }
        val config = runCatching {
            AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
        }.getOrElse {
            failureReason = "Playback capture unavailable: ${it.message}"
            return false
        }

        // Stereo first; some devices only accept mono for playback capture.
        for (stereo in booleanArrayOf(true, false)) {
            val channelMask =
                if (stereo) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
            val channels = if (stereo) 2 else 1
            val builder = try {
                AudioRecord.Builder()
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(sampleRate)
                            .setChannelMask(channelMask)
                            .build()
                    )
                    .setBufferSizeInBytes(bufferSize(channels))
                    .setAudioPlaybackCaptureConfig(config)
            } catch (t: Throwable) {
                failureReason = "AudioRecord builder: ${t.message}"
                continue
            }
            val rec = try {
                builder.build()
            } catch (t: Throwable) {
                failureReason = "AudioRecord init: ${t.message}"
                continue
            }
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                failureReason = "AudioRecord not initialised (${if (stereo) "stereo" else "mono"})"
                continue
            }
            return try {
                rec.startRecording()
                record = rec
                channelCount = channels
                silentReads = 0
                failureReason = null
                Log.i("Playback audio capture started (${sampleRate}Hz, ${channels}ch)")
                true
            } catch (t: Throwable) {
                rec.release()
                failureReason = "startRecording: ${t.message}"
                false
            }
        }
        if (failureReason == null) failureReason = "No supported capture configuration"
        return false
    }

    private fun bufferSize(channels: Int): Int {
        val mask = if (channels == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
        val min = AudioRecord.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
        return (min * 2).coerceAtLeast(8192)
    }

    /** Blocking read; returns the number of bytes read (<= length). */
    fun read(into: ByteArray, length: Int): Int {
        val rec = record ?: return -1
        return try {
            val read = rec.read(into, 0, length, AudioRecord.READ_BLOCKING)
            if (read > 0) {
                if (isSilent(into, read)) silentReads++ else silentReads = 0
            }
            read
        } catch (t: Throwable) {
            Log.w("Audio read failed: ${t.message}")
            -1
        }
    }

    private fun isSilent(buffer: ByteArray, length: Int): Boolean {
        var i = 0
        while (i + 1 < length) {
            val sample = (buffer[i].toInt() and 0xFF) or (buffer[i + 1].toInt() shl 8)
            if (sample > 64 && sample < 65472) return false
            i += 2
        }
        return true
    }

    fun stop() {
        try {
            record?.stop()
        } catch (_: Throwable) {
        }
        try {
            record?.release()
        } catch (_: Throwable) {
        }
        record = null
    }
}
