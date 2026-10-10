package com.neurio.aivibes.dsp

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.sin

/**
 * JVM unit tests for the AI VIBES DSP core. These run in CI via `gradlew test`
 * and mirror the numeric self-check in tools/dsp-selfcheck.
 */
class DspTest {

    @Test
    fun peakingFilterBoostsCenterFrequency() {
        val peak = Biquad.peaking(48000.0, 1000.0, 1.1, 6.0)
        val center = peak.magnitudeAt(1000.0, 48000.0)
        assertTrue("center boost ~6dB, got $center", center > 1.85 && center < 2.15)
        val far = peak.magnitudeAt(50.0, 48000.0)
        assertTrue("flat at 50Hz, got $far", far > 0.95 && far < 1.15)
    }

    @Test
    fun lowShelfBoostsBassOnly() {
        val shelf = Biquad.lowShelf(48000.0, 60.0, 12.0)
        val dc = shelf.magnitudeAt(10.0, 48000.0)
        assertTrue("DC gain ~12dB, got $dc", dc > 3.5 && dc < 4.5)
        val high = shelf.magnitudeAt(10000.0, 48000.0)
        assertTrue("flat at 10k, got $high", high > 0.95 && high < 1.15)
    }

    @Test
    fun fftFindsSineFrequency() {
        val n = 1024
        val sig = FloatArray(n) { i -> sin(2.0 * Math.PI * 1000.0 * i / 48000.0).toFloat() }
        val mags = Fft.magnitudes(sig, n)
        var peakBin = 0
        var peakVal = 0f
        for (i in mags.indices) if (mags[i] > peakVal) { peakVal = mags[i]; peakBin = i }
        assertTrue("expected bin ~21, got $peakBin", peakBin in 20..22)
    }

    @Test
    fun limiterPreventsClippingUnderMaxBoost() {
        val chain = DspChain()
        chain.updateConfig(
            DspConfig(
                bassIntensity = 1f, subBass = 1f, clarity = 1f, preampDb = 12f,
                eqGains = FloatArray(10) { 12f }, dynamics = 1f, loudness = 1f,
                limiterEnabled = true
            )
        )
        val frames = 48000
        val buf = FloatArray(frames * 2)
        for (i in 0 until frames) {
            val v = sin(2.0 * Math.PI * 220.0 * i / 48000.0).toFloat()
            buf[i * 2] = v
            buf[i * 2 + 1] = v
        }
        var mx = 0f
        var off = 0
        while (off < frames) {
            val chunk = minOf(1024, frames - off)
            val part = buf.copyOfRange(off * 2, (off + chunk) * 2)
            chain.process(part, chunk, 2, 48000)
            for (s in part) if (abs(s) > mx) mx = abs(s)
            off += chunk
        }
        assertTrue("peak $mx should stay <= 1.05", mx <= 1.05f)
    }

    @Test
    fun spatialWidthAffectsSideChannel() {
        val chain = DspChain()
        chain.updateConfig(
            DspConfig(
                spatialWidth = 2f, dynamics = 0f, loudness = 0f,
                bassIntensity = 0f, subBass = 0f, clarity = 0f, limiterEnabled = false
            )
        )
        val st = FloatArray(2048 * 2)
        for (i in 0 until 2048) {
            val s = 0.1f * sin(2.0 * Math.PI * 300.0 * i / 48000.0).toFloat()
            st[i * 2] = 0.5f + s
            st[i * 2 + 1] = 0.5f - s
        }
        chain.process(st, 2048, 2, 48000)
        var side = 0f
        for (i in 0 until 2048) side += abs((st[i * 2] - st[i * 2 + 1]) * 0.5f)
        assertTrue("side energy grew, got ${side / 2048}", side > 2048 * 0.08f)
    }

    @Test
    fun analyzerReportsEmptyWithoutAudio() {
        val an = SpectrumAnalyzer()
        val snap = an.analyze(0L)
        assertTrue("no fabricated spectrum", snap.bands.all { it == 0f } && snap.level == 0f)
    }

    @Test
    fun analyzerDetectsRealSignal() {
        val an = SpectrumAnalyzer()
        for (k in 0 until 8) {
            val blk = FloatArray(1024 * 2) { i ->
                sin(2.0 * Math.PI * 440.0 * (k * 1024 + i / 2) / 48000.0).toFloat() * 0.5f
            }
            an.submit(blk, 1024, 2)
        }
        val snap = an.analyze(1000L)
        assertTrue("level > 0 for real signal, got ${snap.level}", snap.level > 0f)
    }

    @Test
    fun neutralConfigIsAudiblyTransparent() {
        val chain = DspChain()
        chain.updateConfig(DspConfig())
        val n = 4096
        val buf = FloatArray(n * 2)
        for (i in 0 until n) {
            val v = (0.25f * sin(2.0 * Math.PI * 1000.0 * i / 48000.0)).toFloat()
            buf[i * 2] = v
            buf[i * 2 + 1] = v
        }
        chain.process(buf, n, 2, 48000)
        var err = 0f
        for (i in 0 until n) {
            val ref = (0.25f * sin(2.0 * Math.PI * 1000.0 * i / 48000.0)).toFloat()
            err += abs(buf[i * 2] - ref)
        }
        assertTrue("mean err ${(err / n)} should be tiny", err / n < 0.01f)
    }
}
