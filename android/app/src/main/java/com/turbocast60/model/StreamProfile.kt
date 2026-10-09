package com.turbocast60.model

import kotlin.math.min

/** User-facing quality presets. Resolution is a long-edge cap, preserving the phone's aspect ratio. */
enum class StreamProfile(
    val title: String,
    val detail: String,
    val longEdge: Int,
    val fps: Int,
    val startBitrate: Int,
    val maxBitrate: Int,
    val adaptive: Boolean
) {
    PERFORMANCE("Performance", "720p · up to 60 FPS", 1280, 60, 4_500_000, 8_000_000, false),
    BALANCED("Balanced", "1080p · up to 30 FPS", 1920, 30, 7_000_000, 12_000_000, false),
    HIGH_QUALITY("High Quality", "1080p · up to 60 FPS when supported", 1920, 60, 12_000_000, 18_000_000, false),
    ADAPTIVE("Adaptive", "Adjusts bitrate, then steps down quality", 1920, 60, 8_000_000, 14_000_000, true)
}

data class VideoConfig(
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrate: Int,
    val maxBitrate: Int,
    val profile: StreamProfile
)

object VideoSizing {
    fun fit(sourceWidth: Int, sourceHeight: Int, longEdge: Int): Pair<Int, Int> {
        val safeWidth = sourceWidth.coerceAtLeast(2)
        val safeHeight = sourceHeight.coerceAtLeast(2)
        val scale = min(1.0, longEdge.toDouble() / maxOf(safeWidth, safeHeight))
        val width = (safeWidth * scale).toInt().coerceAtLeast(2).let { it - it % 2 }
        val height = (safeHeight * scale).toInt().coerceAtLeast(2).let { it - it % 2 }
        return width to height
    }

    fun initial(sourceWidth: Int, sourceHeight: Int, profile: StreamProfile): VideoConfig {
        val (width, height) = fit(sourceWidth, sourceHeight, profile.longEdge)
        return VideoConfig(width, height, profile.fps, profile.startBitrate, profile.maxBitrate, profile)
    }
}

enum class AdaptationKind { KEEP, CHANGE_BITRATE, LOWER_QUALITY, RECOVER_QUALITY }

data class AdaptationDecision(
    val kind: AdaptationKind,
    val bitrate: Int,
    val longEdge: Int,
    val fps: Int
)

/** Conservative controller driven by measured receiver packet loss/RTT, not guessed signal bars. */
class AdaptiveBitrateController(private val profile: StreamProfile, initialBitrate: Int = profile.startBitrate) {
    private var bitrate = initialBitrate.coerceIn(1_000_000, profile.maxBitrate)
    private var longEdge = profile.longEdge
    private var fps = profile.fps
    private var badWindows = 0
    private var goodWindows = 0

    fun onFeedback(lossPercent: Double, rttMs: Long?, nowMs: Long = System.currentTimeMillis()): AdaptationDecision {
        @Suppress("UNUSED_VARIABLE") val observationTimeMs = nowMs
        if (!profile.adaptive) return AdaptationDecision(AdaptationKind.KEEP, bitrate, longEdge, fps)

        val unhealthy = lossPercent >= 3.0 || (rttMs != null && rttMs >= 250)
        if (unhealthy) {
            badWindows++
            goodWindows = 0
            if (badWindows >= 2) {
                badWindows = 0
                val reduced = (bitrate * 0.78).toInt().coerceAtLeast(1_000_000)
                if (reduced < bitrate) {
                    bitrate = reduced
                    return AdaptationDecision(AdaptationKind.CHANGE_BITRATE, bitrate, longEdge, fps)
                }
            }
            if (lossPercent >= 10.0 && (longEdge > 1280 || fps > 30)) {
                longEdge = 1280
                fps = 30
                bitrate = bitrate.coerceAtMost(4_500_000)
                badWindows = 0
                return AdaptationDecision(AdaptationKind.LOWER_QUALITY, bitrate, longEdge, fps)
            }
        } else if (lossPercent < 0.5 && rttMs != null && rttMs < 120) {
            goodWindows++
            badWindows = 0
            if (goodWindows >= 5) {
                goodWindows = 0
                if (bitrate < profile.maxBitrate) {
                    bitrate = (bitrate * 1.08).toInt().coerceAtMost(profile.maxBitrate)
                    return AdaptationDecision(AdaptationKind.CHANGE_BITRATE, bitrate, longEdge, fps)
                }
                if (longEdge < profile.longEdge || fps < profile.fps) {
                    longEdge = profile.longEdge
                    fps = profile.fps
                    bitrate = bitrate.coerceAtLeast(profile.startBitrate).coerceAtMost(profile.maxBitrate)
                    return AdaptationDecision(AdaptationKind.RECOVER_QUALITY, bitrate, longEdge, fps)
                }
            }
        } else {
            badWindows = 0
            goodWindows = 0
        }
        return AdaptationDecision(AdaptationKind.KEEP, bitrate, longEdge, fps)
    }
}
