package com.neurio.aivibes.settings

import com.neurio.aivibes.dsp.DspConfig

/** A named DSP preset (EQ curve + bass/spatial/dynamics personality). */
data class SoundPreset(
    val id: String,
    val name: String,
    val description: String,
    val config: DspConfig
)

/**
 * Factory preset library. The EQ curves are real band gains (dB per the 10
 * [DspConfig.EQ_BANDS] bands) matched to each genre's typical tonal balance.
 */
object Presets {
    val factory: List<SoundPreset> = listOf(
        SoundPreset("flat", "Flat", "No colouration — pure signal", DspConfig()),
        SoundPreset(
            "phonk", "Phonk", "Crushed lows, hollow mids, sharp cowbell highs",
            base(bass = 0.75f, sub = 0.55f, clarity = 0.35f, width = 1.12f,
                eq = floatArrayOf(6f, 5f, 2f, -3f, -4f, -1f, 2f, 4f, 5f, 3f))
        ),
        SoundPreset(
            "edm", "EDM", "Club weight with airy top end",
            base(bass = 0.8f, sub = 0.5f, clarity = 0.45f, width = 1.25f,
                eq = floatArrayOf(5f, 4f, 1f, -2f, -2f, 0f, 2f, 3f, 5f, 5f))
        ),
        SoundPreset(
            "hiphop", "Hip-Hop", "Deep 808s, warm mids, crisp hats",
            base(bass = 0.7f, sub = 0.6f, clarity = 0.3f, width = 1.08f,
                eq = floatArrayOf(6f, 5f, 2f, -1f, -2f, -1f, 1f, 3f, 3f, 2f))
        ),
        SoundPreset(
            "rap", "Rap", "Vocal-forward with heavy bottom",
            base(bass = 0.65f, sub = 0.5f, clarity = 0.4f, width = 1.05f,
                eq = floatArrayOf(5f, 4f, 1f, 1f, 0f, 2f, 3f, 2f, 1f, 1f))
        ),
        SoundPreset(
            "pop", "Pop", "Balanced, punchy, vocal clear",
            base(bass = 0.45f, sub = 0.25f, clarity = 0.4f, width = 1.12f,
                eq = floatArrayOf(2f, 2f, 1f, 0f, -1f, 1f, 2f, 2f, 2f, 1f))
        ),
        SoundPreset(
            "rock", "Rock", "Guitar bite, tight lows",
            base(bass = 0.4f, sub = 0.15f, clarity = 0.5f, width = 1.15f,
                eq = floatArrayOf(3f, 2f, -1f, -1f, -2f, 1f, 3f, 4f, 3f, 2f))
        ),
        SoundPreset(
            "classical", "Classical", "Natural, wide, uncompressed",
            base(bass = 0.15f, sub = 0.05f, clarity = 0.35f, width = 1.3f,
                eq = floatArrayOf(1f, 1f, 0f, 0f, -1f, 0f, 1f, 2f, 2f, 2f),
                dynamics = 0.1f, loudness = 0.1f)
        ),
        SoundPreset(
            "gaming", "Gaming", "Footstep clarity + wide positional stage",
            base(bass = 0.35f, sub = 0.1f, clarity = 0.65f, width = 1.4f,
                eq = floatArrayOf(1f, 0f, -2f, -2f, -1f, 2f, 4f, 5f, 4f, 2f),
                dynamics = 0.55f)
        ),
        SoundPreset(
            "bass", "Bass Boost", "Everything else neutral — maximum low end",
            base(bass = 1f, sub = 0.9f, clarity = 0.2f, width = 1.05f,
                eq = floatArrayOf(8f, 7f, 3f, 0f, 0f, 0f, 0f, 0f, 0f, 0f))
        ),
        SoundPreset(
            "clarity", "Vocal Clarity", "Speech and lead-line focus",
            base(bass = 0.15f, sub = 0.05f, clarity = 0.8f, width = 1.1f,
                eq = floatArrayOf(-1f, -1f, -1f, 0f, 2f, 4f, 5f, 3f, 2f, 1f))
        )
    )

    fun byId(id: String): SoundPreset = factory.firstOrNull { it.id == id } ?: factory[0]

    private fun base(
        bass: Float, sub: Float, clarity: Float, width: Float,
        eq: FloatArray, dynamics: Float = 0.45f, loudness: Float = 0.3f
    ) = DspConfig(
        bassIntensity = bass,
        subBass = sub,
        clarity = clarity,
        spatialWidth = width,
        eqGains = eq,
        dynamics = dynamics,
        loudness = loudness
    )
}
