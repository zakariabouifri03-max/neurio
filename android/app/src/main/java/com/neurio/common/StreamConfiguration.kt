package com.neurio.common

/** Video codec choice. AUTO prefers H.264 for maximum decoder compatibility. */
enum class VideoCodec(val mime: String, val label: String) {
    H264("video/avc", "H.264"),
    H265("video/hevc", "H.265");

    companion object {
        fun fromPref(pref: String): VideoCodec = when (pref) {
            "H265" -> H265
            else -> H264
        }
    }
}

/** Where the host gets game audio from. See docs for the honest limitations. */
enum class AudioMode { AUTO, INTERNAL, MIC, OFF }

/**
 * Quality ladder used by the adaptive streaming controller.
 * The goal is smooth gameplay, not maximum image quality.
 */
enum class QualityTier(
    val label: String,
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrateKbps: Int
) {
    EXCELLENT("Excellent", 1920, 1080, 60, 12000),
    GOOD("Good", 1280, 720, 60, 8000),
    WEAK("Weak", 1280, 720, 30, 4500),
    VERY_WEAK("Very weak", 854, 480, 30, 2200);

    fun down(): QualityTier? = when (this) {
        EXCELLENT -> GOOD
        GOOD -> WEAK
        WEAK -> VERY_WEAK
        VERY_WEAK -> null
    }

    fun up(): QualityTier? = when (this) {
        VERY_WEAK -> WEAK
        WEAK -> GOOD
        GOOD -> EXCELLENT
        EXCELLENT -> null
    }

    companion object {
        fun fromResolutionPref(res: String, fps: String): QualityTier = when (res) {
            "1080" -> EXCELLENT
            "480" -> VERY_WEAK
            else -> if (fps == "30") WEAK else GOOD
        }
    }
}

/** Negotiated stream configuration for one session. */
data class StreamConfig(
    var tier: QualityTier,
    var codec: VideoCodec,
    var audioMode: AudioMode,
    var maxBitrateKbps: Int = tier.bitrateKbps
) {
    val width: Int get() = tier.width
    val height: Int get() = tier.height
    val fps: Int get() = tier.fps
    val bitrateKbps: Int get() = minOf(tier.bitrateKbps, maxBitrateKbps)

    fun copy(): StreamConfig = StreamConfig(tier, codec, audioMode, maxBitrateKbps)
}
