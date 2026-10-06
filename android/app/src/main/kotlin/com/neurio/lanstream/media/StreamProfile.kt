package com.neurio.lanstream.media

import android.media.MediaFormat
import com.neurio.lanstream.core.BitratePreset
import com.neurio.lanstream.core.FpsMode
import com.neurio.lanstream.core.ResolutionTier
import com.neurio.lanstream.core.Settings
import kotlin.math.max
import kotlin.math.min

/** Everything the encoder needs to know about one video stream. */
data class StreamProfile(
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrateBps: Int,
    val mime: String = MediaFormat.MIMETYPE_VIDEO_AVC
) {
    fun label(): String = "${width}x${height}"
    fun fullLabel(): String = "${width}x${height}@${fps}"

    companion object {
        const val MIN_BITRATE_BPS = 500_000
        const val MAX_BITRATE_BPS = 40_000_000

        /**
         * Derives the encoded size from the *real* host screen so the aspect
         * ratio always matches what the player sees, then scales it down to
         * the requested tier. The virtual display is created at exactly this
         * size, so the GPU does the downscale once, for free.
         */
        fun compute(
            screenWidth: Int,
            screenHeight: Int,
            tier: ResolutionTier,
            fpsMode: FpsMode,
            preset: BitratePreset,
            customBitrateMbps: Int
        ): StreamProfile {
            val longSide = max(screenWidth, screenHeight).coerceAtLeast(1)
            val scale = min(1f, tier.longSide.toFloat() / longSide.toFloat())
            val width = align(screenWidth * scale)
            val height = align(screenHeight * scale)
            val fps = fpsMode.fps
            val bitrateBps = if (preset == BitratePreset.CUSTOM) {
                (customBitrateMbps.coerceIn(1, 60) * 1_000_000L)
            } else {
                (width.toLong() * height.toLong() * fps.toLong() * preset.bitsPerPixel).toLong()
            }.coerceIn(MIN_BITRATE_BPS.toLong(), MAX_BITRATE_BPS.toLong()).toInt()
            return StreamProfile(width, height, fps, bitrateBps)
        }

        fun from(settings: Settings, screenWidth: Int, screenHeight: Int): StreamProfile =
            compute(
                screenWidth = screenWidth,
                screenHeight = screenHeight,
                tier = settings.resolution,
                fpsMode = settings.fpsMode,
                preset = settings.bitratePreset,
                customBitrateMbps = settings.customBitrateMbps
            )

        /** H.264 macroblocks: keep dimensions on a 16 pixel grid, never below 160. */
        fun align(value: Float): Int {
            val v = value.toInt() and 0x7FFFFFF0 // even
            val aligned = (v / 16) * 16
            return aligned.coerceAtLeast(160)
        }
    }
}

/** Audio stream description exchanged during the handshake. */
data class AudioProfile(
    val sampleRate: Int = 48_000,
    val channelCount: Int = 2,
    val bitrateBps: Int = 128_000,
    val mime: String = MediaFormat.MIMETYPE_AUDIO_AAC
) {
    fun label(): String = "${sampleRate / 1000} kHz · ${channelCount}ch · ${bitrateBps / 1000} kbps"
}
