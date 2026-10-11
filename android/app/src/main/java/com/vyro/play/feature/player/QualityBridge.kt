package com.vyro.play.feature.player

import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.PlayerConstants
import com.vyro.core.model.PlaybackQuality

/** Parses the JSON string returned by `getAvailableQualityLevels()`. */
fun parseQualityLevels(raw: String?): List<PlaybackQuality> {
    if (raw.isNullOrBlank()) return emptyList()
    val body = raw.trim().trim('"').replace("\\\"", "\"")
    return body
        .trim('[', ']')
        .split(',')
        .map { it.trim().trim('"') }
        .filter { it.isNotBlank() }
        .map { PlaybackQuality.fromRawValue(it) }
        .distinct()
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
