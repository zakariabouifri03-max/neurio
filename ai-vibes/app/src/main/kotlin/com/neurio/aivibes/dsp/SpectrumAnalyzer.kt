package com.neurio.aivibes.dsp

/**
 * Real-time spectrum analyser fed by the app's own playback pipeline.
 *
 * The visualizer reads actual processed PCM from [SpectrumAnalyzer.submit] —
 * never synthetic data. When no audio is flowing, the UI shows an explicit
 * "no signal" state rather than a fake animation.
 */
class SpectrumAnalyzer(private val fftSize: Int = 1024) {
    private val ring = FloatArray(fftSize * 2)
    private var writePos = 0
    private var filled = 0
    private val window = Fft.hann(fftSize)
    private val scratch = FloatArray(fftSize)
    private val magnitudes = FloatArray(fftSize / 2)

    // Beat detection: bass band energy vs running average.
    private var bassAvg = 0f
    private var beatCooldown = 0
    private var lastBeatMs = 0L

    @Volatile
    var spectrum: FloatArray = FloatArray(BANDS)
        private set

    @Volatile
    var bassEnergy = 0f
        private set

    @Volatile
    var overallLevel = 0f
        private set

    @Volatile
    var lastBeatAtMs = 0L
        private set

    /** Call from the audio thread with interleaved post-DSP samples. */
    fun submit(samples: FloatArray, frameCount: Int, channelCount: Int) {
        for (f in 0 until frameCount) {
            var mono = 0f
            for (ch in 0 until channelCount) {
                mono += samples[f * channelCount + ch]
            }
            mono /= channelCount
            ring[writePos] = mono
            ring[writePos + fftSize] = mono
            writePos = (writePos + 1) % fftSize
        }
        if (filled < fftSize) {
            filled = (filled + frameCount).coerceAtMost(fftSize)
        }
    }

    /**
     * Recomputes the spectrum from the newest window. Call from the UI/analysis
     * thread at a modest rate (e.g. 30 Hz), not from the audio thread.
     */
    fun analyze(nowMs: Long): SpectrumSnapshot {
        if (filled < fftSize / 4) {
            return SpectrumSnapshot.EMPTY
        }
        val start = writePos
        for (i in 0 until fftSize) {
            scratch[i] = ring[(start + i) % fftSize] * window[i]
        }
        val mags = Fft.magnitudes(scratch, fftSize)
        System.arraycopy(mags, 0, magnitudes, 0, magnitudes.size)

        // Log-spaced bands for the UI.
        val bands = FloatArray(BANDS)
        val binHz = 48000.0 / fftSize // approx; display-only mapping
        for (b in 0 until BANDS) {
            val fLow = 30.0 * Math.pow(2.0, b.toDouble() / BANDS * 8.0)
            val fHigh = 30.0 * Math.pow(2.0, (b + 1).toDouble() / BANDS * 8.0)
            val iLow = (fLow / binHz).toInt().coerceIn(1, magnitudes.size - 1)
            val iHigh = (fHigh / binHz).toInt().coerceIn(iLow + 1, magnitudes.size)
            var acc = 0f
            for (i in iLow until iHigh) {
                if (magnitudes[i] > acc) acc = magnitudes[i]
            }
            bands[b] = acc
        }

        var level = 0f
        for (m in bands) level += m
        level /= (BANDS * fftSize / 4f)

        // Bass energy = first 3 bands.
        val bass = (bands[0] + bands[1] + bands[2]) / (3f * fftSize / 4f)
        bassEnergy = bass
        overallLevel = level
        spectrum = bands

        // Beat: bass crosses 1.35x its running average, with 250 ms cooldown.
        var beat = false
        if (bassAvg > 0f && bass > bassAvg * 1.35f && bass > 0.02f) {
            if (nowMs - lastBeatMs > 250) {
                beat = true
                lastBeatMs = nowMs
                lastBeatAtMs = nowMs
            }
        }
        bassAvg += (bass - bassAvg) * 0.05f
        if (beatCooldown > 0) beatCooldown--

        return SpectrumSnapshot(bands, bass, level, beat)
    }

    data class SpectrumSnapshot(
        val bands: FloatArray,
        val bass: Float,
        val level: Float,
        val beat: Boolean
    ) {
        companion object {
            val EMPTY = SpectrumSnapshot(FloatArray(BANDS), 0f, 0f, false)
        }
    }

    companion object {
        const val BANDS = 24
    }
}
