package com.vyro.play.feature.player

import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.PlayerConstants
import com.vyro.core.model.PlaybackQuality

/** Matches a single quality token inside the JSON array returned by `getAvailableQualityLevels()`. */
private val QUALITY_TOKEN = Regex("[A-Za-z0-9_]+")

/**
 * Parses the JSON string returned by `getAvailableQualityLevels()`.
 *
 * The IFrame Player API hands back a JSON array of raw quality strings, for example
 * `["hd720","hd1080","highres"]` (the quotes arrive escaped, which this parser tolerates).
 * Anything that is not an array - `null`, `undefined`, an empty response - yields no levels,
 * so the UI simply hides the quality menu instead of offering a bogus entry.
 */
fun parseQualityLevels(raw: String?): List<PlaybackQuality> {
    if (raw.isNullOrBlank()) return emptyList()
    val arrayStart = raw.indexOf('[')
    if (arrayStart < 0) return emptyList()
    return QUALITY_TOKEN.findAll(raw, startIndex = arrayStart)
        .map { match -> PlaybackQuality.fromRawValue(match.value) }
        .distinct()
        .toList()
}

/** Library quality enum -> domain quality enum. */
fun mapQuality(quality: PlayerConstants.PlaybackQuality): PlaybackQuality =
    when (quality) {
        PlayerConstants.PlaybackQuality.SMALL -> PlaybackQuality.LOW
        PlayerConstants.PlaybackQuality.MEDIUM -> PlaybackQuality.SD
        PlayerConstants.PlaybackQuality.LARGE -> PlaybackQuality.SD_HIGH
        PlayerConstants.PlaybackQuality.HD720 -> PlaybackQuality.HD
        PlayerConstants.PlaybackQuality.HD1080 -> PlaybackQuality.FULL_HD
        PlayerConstants.PlaybackQuality.HIGH_RES -> PlaybackQuality.UHD_4K
        PlayerConstants.PlaybackQuality.DEFAULT -> PlaybackQuality.AUTO
        PlayerConstants.PlaybackQuality.UNKNOWN -> PlaybackQuality.AUTO
    }
