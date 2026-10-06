package com.neurio.lanstream.host

import android.media.projection.MediaProjection
import android.os.Build
import com.neurio.lanstream.core.NetworkStats
import com.neurio.lanstream.model.AudioStreamConfig
import com.neurio.lanstream.model.StreamOptions
import com.neurio.lanstream.model.VideoStreamConfig

class HostStreamEngine(
    context: android.content.Context,
    projection: MediaProjection,
    options: StreamOptions,
    initialBitrate: Int,
    audioPermissionGranted: Boolean,
    stats: NetworkStats,
    onVideoConfig: (VideoStreamConfig) -> Unit,
    onVideoAccessUnit: (ByteArray, Long, Boolean) -> Unit,
    onAudioConfig: (AudioStreamConfig) -> Unit,
    onAudioAccessUnit: (ByteArray, Long) -> Unit,
    onVideoStatus: (String) -> Unit,
    onAudioStatus: (String) -> Unit,
) : AutoCloseable {
    val videoEncoder = VideoEncoder(
        context = context.applicationContext,
        projection = projection,
        options = options,
        initialBitrate = initialBitrate,
        stats = stats,
        onConfig = onVideoConfig,
        onEncodedAccessUnit = onVideoAccessUnit,
        onStatus = onVideoStatus,
    )
    private var audioEncoder: AudioCaptureEncoder? = null

    init {
        if (audioPermissionGranted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            audioEncoder = AudioCaptureEncoder(
                projection = projection,
                onConfig = onAudioConfig,
                onEncodedAccessUnit = onAudioAccessUnit,
                onStatus = onAudioStatus,
            ).also { it.start() }
        } else {
            onAudioStatus(
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) "Internal playback audio requires Android 10+"
                else "Audio permission not granted; video streaming is active without audio",
            )
        }
    }

    fun setBitrate(bitsPerSecond: Int) = videoEncoder.setBitrate(bitsPerSecond)
    fun requestKeyFrame() = videoEncoder.requestKeyFrame()

    override fun close() {
        try { audioEncoder?.close() } catch (_: Exception) { }
        audioEncoder = null
        try { videoEncoder.close() } catch (_: Exception) { }
    }
}
