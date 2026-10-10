package com.neurio.aivibes.audio

import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.media.audiofx.Virtualizer
import android.util.Log
import com.neurio.aivibes.dsp.DspConfig

/**
 * Optional "device DSP assist": attaches the platform [android.media.audiofx]
 * effects to the app's own playback session where the device supports them.
 *
 * Everything here is best-effort — devices differ wildly in which effects they
 * implement and whether the app has control. Failures are caught, recorded in
 * [status] and surfaced in the UI; nothing ever crashes playback.
 */
class SystemEffects {

    data class Status(
        val equalizer: String = "not probed",
        val bassBoost: String = "not probed",
        val virtualizer: String = "not probed",
        val loudness: String = "not probed",
        val attached: Boolean = false
    ) {
        val anySupported: Boolean
            get() = listOf(equalizer, bassBoost, virtualizer, loudness)
                .any { it.startsWith("ok") }
    }

    private var equalizer: Equalizer? = null
    private var bassBoost: BassBoost? = null
    private var virtualizer: Virtualizer? = null
    private var loudness: LoudnessEnhancer? = null

    @Volatile
    var status: Status = Status()
        private set

    /** Probes and attaches every effect to [sessionId]. Safe to call repeatedly. */
    @Synchronized
    fun attach(sessionId: Int): Status {
        if (sessionId <= 0) return status
        release()
        var st = Status(attached = true)

        equalizer = try {
            val eq = Equalizer(0, sessionId)
            eq.enabled = true
            st = st.copy(equalizer = "ok (${eq.numberOfBands} bands)")
            eq
        } catch (t: Throwable) {
            Log.i(TAG, "Equalizer unavailable: ${t.message}")
            st = st.copy(equalizer = "unsupported")
            null
        }

        bassBoost = try {
            val bb = BassBoost(0, sessionId)
            if (bb.strengthSupported) {
                bb.enabled = true
                st = st.copy(bassBoost = "ok (strength control)")
            } else {
                st = st.copy(bassBoost = "ok (no strength control)")
                bb.enabled = true
            }
            bb
        } catch (t: Throwable) {
            st = st.copy(bassBoost = "unsupported")
            null
        }

        virtualizer = try {
            val v = Virtualizer(0, sessionId)
            v.enabled = true
            st = st.copy(
                virtualizer = if (v.strengthSupported) "ok (strength control)" else "ok (no strength control)"
            )
            v
        } catch (t: Throwable) {
            st = st.copy(virtualizer = "unsupported")
            null
        }

        loudness = try {
            val le = LoudnessEnhancer(sessionId)
            le.enabled = true
            st = st.copy(loudness = "ok")
            le
        } catch (t: Throwable) {
            st = st.copy(loudness = "unsupported")
            null
        }

        status = st
        return st
    }

    /**
     * Mirrors the user's config onto the device effects (assist mode).
     * Software DSP remains the primary engine; these add gentle device-level
     * shaping only where the platform can actually do it.
     */
    @Synchronized
    fun applyAssist(config: DspConfig) {
        try {
            bassBoost?.let { bb ->
                if (bb.strengthSupported) {
                    bb.setStrength((config.bassIntensity * 400f).toInt().coerceIn(0, 1000).toShort())
                }
            }
        } catch (t: Throwable) {
            Log.i(TAG, "bass assist failed: ${t.message}")
        }
        try {
            virtualizer?.let { v ->
                if (v.strengthSupported) {
                    val amt = ((config.spatialWidth - 1f).coerceIn(0f, 1f) * 400f).toInt()
                    v.setStrength(amt.coerceIn(0, 1000).toShort())
                }
            }
        } catch (t: Throwable) {
            Log.i(TAG, "virtualizer assist failed: ${t.message}")
        }
        try {
            loudness?.setTargetGain((config.loudness * 300f).toInt()) // mB
        } catch (t: Throwable) {
            Log.i(TAG, "loudness assist failed: ${t.message}")
        }
        try {
            equalizer?.let { eq ->
                val bands = eq.numberOfBands.toInt().coerceAtMost(DspConfig.EQ_BANDS.size)
                for (b in 0 until bands) {
                    val db = config.eqGains.getOrNull(b) ?: 0f
                    val range = eq.bandLevelRange
                    val mb = (db * 100f).toInt()
                        .coerceIn(range[0].toInt(), range[1].toInt())
                    eq.setBandLevel(b.toShort(), mb.toShort())
                }
            }
        } catch (t: Throwable) {
            Log.i(TAG, "eq assist failed: ${t.message}")
        }
    }

    @Synchronized
    fun release() {
        try { equalizer?.release() } catch (_: Throwable) {}
        try { bassBoost?.release() } catch (_: Throwable) {}
        try { virtualizer?.release() } catch (_: Throwable) {}
        try { loudness?.release() } catch (_: Throwable) {}
        equalizer = null
        bassBoost = null
        virtualizer = null
        loudness = null
    }

    private companion object {
        const val TAG = "AiVibesFx"
    }
}
