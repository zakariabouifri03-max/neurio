package com.vyro.core.model

/**
 * Playback qualities understood by the YouTube IFrame player.
 *
 * `rawValue` is the exact string the official IFrame Player API expects, which is
 * why these names must not be "prettified".
 */
enum class PlaybackQuality(
    val rawValue: String,
    val label: String,
    val height: Int?,
) {
    AUTO("auto", "Auto", null),
    LOW("small", "240p", 240),
    SD("medium", "360p", 360),
    SD_HIGH("large", "480p", 480),
    HD("hd720", "720p", 720),
    FULL_HD("hd1080", "1080p", 1080),
    QHD("hd1440", "1440p", 1440),
    UHD_4K("highres", "2160p · 4K", 2160),
    ;

    companion object {
        fun fromRawValue(raw: String): PlaybackQuality =
            entries.firstOrNull { it.rawValue.equals(raw, ignoreCase = true) } ?: AUTO

        fun fromHeight(height: Int): PlaybackQuality =
            entries.filter { it.height != null }
                .minByOrNull { kotlin.math.abs((it.height ?: 0) - height) } ?: AUTO
    }
}

/** Thumbnail resolution used across lists (heavily impacts data use on slow networks). */
enum class ThumbnailQuality(val suffix: String, val label: String) {
    LOW("mqdefault", "Low"),
    MEDIUM("hqdefault", "Medium"),
    HIGH("sddefault", "High"),
    MAX("maxresdefault", "Maximum"),
}

/** Rough network class, used to pick a starting quality on low-end devices. */
enum class NetworkClass {
    NONE,
    SLOW,
    METERED,
    FAST,
    UNMETERED_WIFI,
}
