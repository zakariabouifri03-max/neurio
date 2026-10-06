package com.neurio.host

import com.neurio.common.QualityReport
import com.neurio.common.QualityTier

/**
 * Adaptive streaming decisions from the client's quality reports.
 *
 * Strategy: smooth gameplay beats image quality.
 *  - Bad reports degrade quickly (bitrate first, then resolution/fps tier).
 *  - Upgrades only happen after several consecutive good reports and a cool
 *    down period, to avoid oscillation.
 *
 * Pure JVM class, covered by unit tests.
 */
class AdaptationController(initialTier: QualityTier, initialBitrateKbps: Int = initialTier.bitrateKbps) {

    sealed class Decision {
        object None : Decision()
        data class Bitrate(val kbps: Int) : Decision()
        data class Tier(val tier: QualityTier) : Decision()
    }

    companion object {
        const val LOSS_DEGRADE_PCT = 2.0
        const val LOSS_HARD_PCT = 6.0
        const val RTT_DEGRADE_MS = 90.0
        const val RTT_HARD_MS = 150.0
        const val DECODE_DEGRADE_MS = 30.0
        const val UPGRADE_STREAK = 4
        const val MIN_CHANGE_GAP_MS = 1500L
        const val COOLDOWN_MS = 5000L
        const val BITRATE_FLOOR_RATIO = 0.5
    }

    var tier: QualityTier = initialTier
        private set
    var bitrateKbps: Int = initialBitrateKbps
        private set

    private var goodStreak = 0
    private var lastChangeMs = 0L

    fun onReport(report: QualityReport, nowMs: Long): Decision {
        val fpsOk = report.fps <= 0 || report.fps >= tier.fps * 0.82
        val healthy = report.lossPct < LOSS_DEGRADE_PCT &&
            report.rttMs < RTT_DEGRADE_MS &&
            report.decodeMs < DECODE_DEGRADE_MS &&
            fpsOk

        if (healthy) {
            goodStreak++
            if (
                goodStreak >= UPGRADE_STREAK &&
                nowMs - lastChangeMs >= COOLDOWN_MS &&
                tier.up() != null &&
                bitrateKbps >= tier.bitrateKbps * 0.999
            ) {
                val up = tier.up()!!
                tier = up
                bitrateKbps = up.bitrateKbps
                goodStreak = 0
                lastChangeMs = nowMs
                return Decision.Tier(up)
            }
            return Decision.None
        }

        goodStreak = 0
        if (nowMs - lastChangeMs < MIN_CHANGE_GAP_MS) return Decision.None

        val hard = report.lossPct >= LOSS_HARD_PCT || report.rttMs >= RTT_HARD_MS
        return if (hard) {
            val down = tier.down()
            if (down != null) {
                tier = down
                bitrateKbps = down.bitrateKbps
                lastChangeMs = nowMs
                Decision.Tier(down)
            } else {
                val floor = (tier.bitrateKbps * BITRATE_FLOOR_RATIO).toInt()
                if (bitrateKbps > floor) {
                    bitrateKbps = maxOf(floor, (bitrateKbps * 0.7).toInt())
                    lastChangeMs = nowMs
                    Decision.Bitrate(bitrateKbps)
                } else Decision.None
            }
        } else {
            val floor = (tier.bitrateKbps * BITRATE_FLOOR_RATIO).toInt()
            val next = (bitrateKbps * 0.8).toInt()
            if (next >= floor && next < bitrateKbps) {
                bitrateKbps = next
                lastChangeMs = nowMs
                Decision.Bitrate(next)
            } else {
                val down = tier.down()
                if (down != null) {
                    tier = down
                    bitrateKbps = down.bitrateKbps
                    lastChangeMs = nowMs
                    Decision.Tier(down)
                } else Decision.None
            }
        }
    }
}
