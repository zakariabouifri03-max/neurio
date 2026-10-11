package com.vyro.core.domain

import com.vyro.core.model.NetworkClass
import com.vyro.core.model.PlaybackQuality

/**
 * Decides which quality to request from the official YouTube player.
 *
 * Rules (mirrors what the official YouTube app does on a constrained device):
 *  - Data Saver on a metered/slow link caps playback at 480p.
 *  - "Auto" adapts to the measured network class.
 *  - An explicit preference is honoured whenever the stream is available; otherwise
 *    the next best *lower* stream is used so playback never fails.
 *  - 4K (`highres`) is only ever selected on Wi-Fi or a fast unmetered link.
 */
object QualityResolver {
    fun resolve(
        preferred: PlaybackQuality,
        available: List<PlaybackQuality>,
        network: NetworkClass,
        dataSaver: Boolean,
    ): PlaybackQuality {
        val usable = available.filter { it != PlaybackQuality.AUTO }
        if (usable.isEmpty()) return PlaybackQuality.AUTO

        val cap =
            when {
                dataSaver && network != NetworkClass.UNMETERED_WIFI -> PlaybackQuality.SD_HIGH
                network == NetworkClass.SLOW -> PlaybackQuality.SD_HIGH
                network == NetworkClass.METERED -> PlaybackQuality.HD
                else -> null
            }

        val target =
            when {
                preferred == PlaybackQuality.AUTO -> autoTarget(network, usable)
                else -> preferred
            }

        val capped = cap?.let { lowerOf(target, it) } ?: target
        return bestMatch(capped, usable)
    }

    private fun autoTarget(
        network: NetworkClass,
        usable: List<PlaybackQuality>,
    ): PlaybackQuality {
        if (network == NetworkClass.NONE) return PlaybackQuality.AUTO
        val ceiling =
            when (network) {
                NetworkClass.UNMETERED_WIFI -> PlaybackQuality.UHD_4K
                NetworkClass.FAST -> PlaybackQuality.FULL_HD
                NetworkClass.METERED -> PlaybackQuality.HD
                NetworkClass.SLOW -> PlaybackQuality.SD_HIGH
                NetworkClass.NONE -> PlaybackQuality.SD
            }
        val candidates = usable.filter { it.height != null && it.height <= (ceiling.height ?: 0) }
        return candidates.maxByOrNull { it.height ?: 0 } ?: usable.minByOrNull { it.height ?: 0 }!!
    }

    /** Nearest available quality at or below [target]; falls back to the lowest one. */
    private fun bestMatch(
        target: PlaybackQuality,
        usable: List<PlaybackQuality>,
    ): PlaybackQuality {
        if (target == PlaybackQuality.AUTO) return PlaybackQuality.AUTO
        val targetHeight = target.height ?: return PlaybackQuality.AUTO
        val atOrBelow = usable.filter { (it.height ?: 0) <= targetHeight }
        if (atOrBelow.isEmpty()) return usable.minByOrNull { it.height ?: 0 }!!
        return atOrBelow.maxByOrNull { it.height ?: 0 }!!
    }

    private fun lowerOf(
        a: PlaybackQuality,
        b: PlaybackQuality,
    ): PlaybackQuality =
        if ((a.height ?: Int.MAX_VALUE) <= (b.height ?: Int.MAX_VALUE)) a else b
}
