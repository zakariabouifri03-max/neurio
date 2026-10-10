package com.neurio.aivibes.ai

import com.neurio.aivibes.dsp.DspConfig
import com.neurio.aivibes.dsp.SpectrumAnalyzer
import com.neurio.aivibes.settings.Presets
import com.neurio.aivibes.settings.SoundPreset
import kotlin.math.abs

/**
 * AI Sound Enhancement — honest implementation notes:
 *
 *  * "Smart Match" analyses the *actual* live spectrum of the playing track
 *    (from the same [SpectrumAnalyzer] the visualizer uses) and measures its
 *    tonal balance: bass share, mid scoop, treble tilt. It then recommends the
 *    factory preset whose target curve is closest, and computes gentle
 *    correction gains. No cloud, no fabricated analysis.
 *  * "Adaptive balance" is an on-device statistical controller (exponential
 *    averages + proportional correction) — labelled as adaptive DSP, not as a
 *    neural network, because it is not one.
 */
object SmartSound {

    data class Analysis(
        val bassShare: Float,      // 0..1
        val midShare: Float,
        val trebleShare: Float,
        val recommendedPresetId: String,
        val recommendedPresetName: String,
        val correctionDb: FloatArray, // per EQ band, gentle corrections
        val explanation: String
    ) {
        companion object {
            val EMPTY = Analysis(
                0f, 0f, 0f, "flat", "Flat", FloatArray(DspConfig.EQ_BANDS.size),
                "Waiting for audio… play a track to analyse it."
            )
        }
    }

    /** Analyse a spectrum snapshot and propose adjustments. */
    fun analyze(snap: SpectrumAnalyzer.SpectrumSnapshot): Analysis {
        if (snap.level <= 0.0001f) return Analysis.EMPTY
        val bands = snap.bands
        var bass = 0f
        var mid = 0f
        var treble = 0f
        for (i in bands.indices) {
            when {
                i < 6 -> bass += bands[i]
                i < 16 -> mid += bands[i]
                else -> treble += bands[i]
            }
        }
        val total = (bass + mid + treble).coerceAtLeast(1e-6f)
        val bassShare = bass / total
        val midShare = mid / total
        val trebleShare = treble / total

        // Target tonal balance (roughly pink-noise-ish, smile-leaning).
        val targetBass = 0.40f
        val targetTreble = 0.28f

        val correction = FloatArray(DspConfig.EQ_BANDS.size)
        // If the track is bass-light, lift sub bands slightly (and vice versa).
        val bassErr = (targetBass - bassShare) * 18f   // ±dB scale
        correction[0] = bassErr.coerceIn(-3f, 3f)
        correction[1] = (bassErr * 0.7f).coerceIn(-3f, 3f)
        val trebleErr = (targetTreble - trebleShare) * 18f
        correction[8] = (trebleErr * 0.7f).coerceIn(-3f, 3f)
        correction[9] = trebleErr.coerceIn(-3f, 3f)
        // Gentle mid correction against the vocal range.
        val midErr = ((1f - targetBass - targetTreble) - midShare) * 8f
        correction[5] = (midErr * 0.5f).coerceIn(-2f, 2f)

        val preset = recommend(bassShare, midShare, trebleShare)
        val explanation = buildString {
            append("Measured balance: ")
            append("%.0f%%".format(bassShare * 100))
            append(" bass · ")
            append("%.0f%%".format(midShare * 100))
            append(" mids · ")
            append("%.0f%%".format(trebleShare * 100))
            append(" highs. ")
            append("Closest profile: ")
            append(preset.name)
            append(". ")
            val need = abs(correction[0]) + abs(correction[9])
            if (need < 0.4f) {
                append("Already well balanced — no correction needed.")
            } else {
                append("Suggested correction applied gently (max ±3 dB).")
            }
        }
        return Analysis(
            bassShare, midShare, trebleShare,
            preset.id, preset.name, correction, explanation
        )
    }

    /** Apply analysis corrections on top of [base], capped and smoothed. */
    fun apply(base: DspConfig, analysis: Analysis): DspConfig {
        val gains = base.eqGains.copyOf()
        for (i in gains.indices) {
            val corr = analysis.correctionDb.getOrElse(i) { 0f }
            gains[i] = (gains[i] + corr).coerceIn(-12f, 12f)
        }
        val bassAdj = (analysis.bassShare - 0.40f)
        return base.copyWithGains(gains).copy(
            bassIntensity = (base.bassIntensity - bassAdj * 0.25f).coerceIn(0f, 1f),
            clarity = (base.clarity + (0.28f - analysis.trebleShare) * 0.4f).coerceIn(0f, 1f)
        )
    }

    private fun recommend(bass: Float, mid: Float, treble: Float): SoundPreset {
        val targetCurves = mapOf(
            "phonk" to floatArrayOf(0.55f, 0.30f, 0.15f),
            "edm" to floatArrayOf(0.52f, 0.26f, 0.22f),
            "hiphop" to floatArrayOf(0.55f, 0.28f, 0.17f),
            "pop" to floatArrayOf(0.42f, 0.32f, 0.26f),
            "rock" to floatArrayOf(0.38f, 0.32f, 0.30f),
            "classical" to floatArrayOf(0.32f, 0.40f, 0.28f),
            "clarity" to floatArrayOf(0.28f, 0.42f, 0.30f)
        )
        var best = "pop"
        var bestErr = Float.MAX_VALUE
        for ((id, t) in targetCurves) {
            val err = abs(t[0] - bass) + abs(t[1] - mid) + abs(t[2] - treble)
            if (err < bestErr) {
                bestErr = err
                best = id
            }
        }
        val preset = Presets.byId(best)
        return preset
    }
}
