package com.neurio.aivibes.dsp

/**
 * Complete snapshot of every audio parameter the engine can apply.
 * Everything is 0..1 normalised unless stated otherwise; copies of this class
 * flow from the UI (DataStore-backed) to the audio thread without locks.
 */
data class DspConfig(
    // ---- Bass Studio -------------------------------------------------------
    val bassIntensity: Float = 0.35f,        // 0..1 -> 0..12 dB low-shelf
    val bassFreq: Float = 90f,               // 40..180 Hz shelf corner
    val subBass: Float = 0.25f,              // 0..1 -> 0..8 dB peak @ 38 Hz
    // ---- 10-band graphic EQ (dB per band, -12..+12) -------------------------
    val eqGains: FloatArray = FloatArray(EQ_BANDS.size),
    val preampDb: Float = 0f,                // -12..+12 dB
    // ---- Clarity / tonal balance -------------------------------------------
    val clarity: Float = 0.30f,              // 0..1 -> 0..6 dB presence shelf
    val tilt: Float = 0f,                    // -1..1 -> warm .. bright
    // ---- Spatial (simulated stereo processing) ------------------------------
    val spatialWidth: Float = 1.05f,         // 0..2 (1 = untouched)
    val crossfeed: Float = 0.15f,            // 0..1 headphone crossfeed
    // ---- Dynamics -----------------------------------------------------------
    val dynamics: Float = 0.45f,             // 0..1 compression amount
    val loudness: Float = 0.30f,             // 0..1 slow auto-level toward target
    val limiterEnabled: Boolean = true,      // always-on soft ceiling at -1 dBFS
    // ---- Engine ------------------------------------------------------------
    val enabled: Boolean = true              // false = full bypass
) {
    fun copyWithGains(gains: FloatArray): DspConfig = copy(eqGains = gains.copyOf())

    fun isNeutral(): Boolean = !enabled ||
        (bassIntensity <= 0f && subBass <= 0f && clarity <= 0f &&
            tilt == 0f && preampDb == 0f && spatialWidth == 1f &&
            crossfeed <= 0f && dynamics <= 0f && loudness <= 0f &&
            eqGains.all { it == 0f })

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DspConfig) return false
        return enabled == other.enabled &&
            bassIntensity == other.bassIntensity && bassFreq == other.bassFreq &&
            subBass == other.subBass && preampDb == other.preampDb &&
            clarity == other.clarity && tilt == other.tilt &&
            spatialWidth == other.spatialWidth && crossfeed == other.crossfeed &&
            dynamics == other.dynamics && loudness == other.loudness &&
            limiterEnabled == other.limiterEnabled && eqGains.contentEquals(other.eqGains)
    }

    override fun hashCode(): Int {
        var r = eqGains.contentHashCode()
        r = 31 * r + bassIntensity.hashCode(); r = 31 * r + bassFreq.hashCode()
        r = 31 * r + subBass.hashCode(); r = 31 * r + preampDb.hashCode()
        r = 31 * r + clarity.hashCode(); r = 31 * r + tilt.hashCode()
        r = 31 * r + spatialWidth.hashCode(); r = 31 * r + crossfeed.hashCode()
        r = 31 * r + dynamics.hashCode(); r = 31 * r + loudness.hashCode()
        r = 31 * r + limiterEnabled.hashCode(); r = 31 * r + enabled.hashCode()
        return r
    }

    companion object {
        /** 10-band ISO-ish graphic EQ centre frequencies (Hz). */
        val EQ_BANDS = floatArrayOf(32f, 64f, 125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f, 16000f)
    }
}
