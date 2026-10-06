package com.neurio.lanstream.media

import com.neurio.lanstream.core.ResolutionTier
import kotlin.math.roundToInt

/**
 * AIMD-ish adaptive quality controller.
 *
 * Inputs (all measured, none guessed):
 *  * packet loss reported by the client (or by the host's own counters),
 *  * round trip time,
 *  * how many frames the client had to drop,
 *  * encoder back pressure.
 *
 * Outputs: a new bitrate, and — only after the bitrate has bottomed out and the
 * network is still bad — a request to drop one resolution tier. Dropping the
 * resolution restarts the encoder, so it is rate limited to once every
 * [RESOLUTION_COOLDOWN_MS].
 */
class AdaptiveController(
    initialBitrateBps: Int,
    private val minBitrateBps: Int = 1_000_000,
    private val maxBitrateBps: Int = StreamProfile.MAX_BITRATE_BPS
) {
    data class Decision(
        val bitrateBps: Int,
        val lowResolutionTier: ResolutionTier?,
        val state: String
    )

    private var currentBitrate = initialBitrateBps
    private var targetBitrate = initialBitrateBps
    private var badTicks = 0
    private var goodTicks = 0
    private var lastResolutionChangeMs = 0L
    private var state = "stable"

    fun target(): Int = targetBitrate
    fun current(): Int = currentBitrate

    fun setTarget(bitrateBps: Int) {
        targetBitrate = bitrateBps.coerceIn(minBitrateBps, maxBitrateBps)
        currentBitrate = targetBitrate.coerceIn(minBitrateBps, maxBitrateBps)
        state = "reset"
    }

    fun update(loss: Float, rttMs: Long, clientDroppedFps: Float): Decision {
        val networkBad = loss > LOSS_BAD || rttMs > RTT_BAD_MS || clientDroppedFps > DROP_BAD_FPS
        val networkPoor = loss > LOSS_POOR || rttMs > RTT_POOR_MS

        if (networkBad) {
            badTicks++
            goodTicks = 0
            val reduced = (currentBitrate * 0.80f).roundToInt().coerceAtLeast(minBitrateBps)
            currentBitrate = reduced
            state = buildString {
                append("reducing (")
                if (loss > LOSS_BAD) append("loss ${(loss * 100).roundToInt()}% ")
                if (rttMs > RTT_BAD_MS) append("rtt ${rttMs}ms ")
                if (clientDroppedFps > DROP_BAD_FPS) append("drops ${clientDroppedFps.roundToInt()}/s")
                append(')')
            }
        } else if (networkPoor) {
            badTicks = 0
            goodTicks = 0
            state = "holding (${rttMs}ms)"
        } else {
            badTicks = 0
            goodTicks++
            if (goodTicks >= GOOD_TICKS_BEFORE_RAISE && currentBitrate < targetBitrate) {
                currentBitrate = (currentBitrate * 1.10f).roundToInt().coerceAtMost(targetBitrate)
                state = "raising to ${currentBitrate / 1_000_000f} Mbps"
            } else {
                state = "stable"
            }
        }

        var tier: ResolutionTier? = null
        val now = System.currentTimeMillis()
        if (badTicks >= BAD_TICKS_BEFORE_DOWNSCALE &&
            currentBitrate <= minBitrateBps &&
            now - lastResolutionChangeMs > RESOLUTION_COOLDOWN_MS
        ) {
            tier = ResolutionTier.P480
            lastResolutionChangeMs = now
            badTicks = 0
            state = "network poor — dropping to 480p"
        }
        return Decision(currentBitrate, tier, state)
    }

    fun reset() {
        badTicks = 0
        goodTicks = 0
        state = "stable"
        currentBitrate = targetBitrate
    }

    companion object {
        private const val LOSS_BAD = 0.03f
        private const val LOSS_POOR = 0.01f
        private const val RTT_BAD_MS = 90L
        private const val RTT_POOR_MS = 50L
        private const val DROP_BAD_FPS = 8f
        private const val GOOD_TICKS_BEFORE_RAISE = 4
        private const val BAD_TICKS_BEFORE_DOWNSCALE = 5
        private const val RESOLUTION_COOLDOWN_MS = 15_000L
    }
}
