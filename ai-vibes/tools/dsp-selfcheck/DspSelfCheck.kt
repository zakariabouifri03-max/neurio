package com.neurio.aivibes.dsp

import kotlin.math.abs
import kotlin.math.sin

/**
 * Standalone numeric self-check for the DSP core (run locally with kotlinc;
 * the same assertions are mirrored in app/src/test for CI).
 */
object DspSelfCheck {
    private var failures = 0

    private fun check(name: String, cond: Boolean, detail: String = "") {
        if (cond) println("PASS  $name") else { failures++; println("FAIL  $name  $detail") }
    }

    @JvmStatic
    fun main(args: Array<String>) {
        val sr = 48000.0

        // --- Biquad peaking: +6 dB at 1 kHz -------------------------------
        val peak = Biquad.peaking(sr, 1000.0, 1.1, 6.0)
        val mPeak = peak.magnitudeAt(1000.0, sr)
        check("peaking +6dB @1k", mPeak > 1.85 && mPeak < 2.15, "got $mPeak")
        val mPeakFar = peak.magnitudeAt(50.0, sr)
        check("peaking flat @50Hz", mPeakFar > 0.95 && mPeakFar < 1.15, "got $mPeakFar")

        // --- Low shelf: +12 dB at 60 Hz ----------------------------------
        val shelf = Biquad.lowShelf(sr, 60.0, 12.0)
        val mDc = shelf.magnitudeAt(10.0, sr)
        check("lowshelf +12dB DC", mDc > 3.5 && mDc < 4.5, "got $mDc")
        val mHigh = shelf.magnitudeAt(10000.0, sr)
        check("lowshelf flat @10k", mHigh > 0.95 && mHigh < 1.15, "got $mHigh")

        // --- High shelf: +6 dB -------------------------------------------
        val hs = Biquad.highShelf(sr, 3200.0, 6.0)
        val mHs = hs.magnitudeAt(12000.0, sr)
        check("highshelf +6dB @12k", mHs > 1.7 && mHs < 2.3, "got $mHs")

        // --- FFT: sine at 1 kHz (48k, 1024 -> bin 21.3) ------------------
        val n = 1024
        val sig = FloatArray(n) { i -> sin(2.0 * Math.PI * 1000.0 * i / sr).toFloat() }
        val mags = Fft.magnitudes(sig, n)
        var peakBin = 0
        var peakVal = 0f
        for (i in mags.indices) if (mags[i] > peakVal) { peakVal = mags[i]; peakBin = i }
        check("fft peak bin ~21", peakBin in 20..22, "got $peakBin")

        // --- DspChain: bounded output with max boosts --------------------
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
            val v = sin(2.0 * Math.PI * 220.0 * i / sr).toFloat()
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
            for (i in part.indices) buf[off * 2 + i] = part[i]
            off += chunk
        }
        check("limiter keeps |x|<=1.05", mx <= 1.05f, "max=$mx")

        // --- DspChain: stereo width increases side energy ----------------
        val chain2 = DspChain()
        chain2.updateConfig(DspConfig(spatialWidth = 2f, dynamics = 0f, loudness = 0f, bassIntensity = 0f, subBass = 0f, clarity = 0f, limiterEnabled = false))
        val st = FloatArray(2048 * 2)
        for (i in 0 until 2048) {
            st[i * 2] = 0.5f + 0.1f * sin(2.0 * Math.PI * 300.0 * i / sr).toFloat()
            st[i * 2 + 1] = 0.5f - 0.1f * sin(2.0 * Math.PI * 300.0 * i / sr).toFloat()
        }
        chain2.process(st, 2048, 2, 48000)
        var side = 0f
        for (i in 0 until 2048) {
            side += abs((st[i * 2] - st[i * 2 + 1]) * 0.5f)
        }
        check("width 2.0 enlarges side", side > 2048 * 0.08, "sideAvg=${side / 2048}")

        // --- SpectrumAnalyzer: no fabricated signal when empty -----------
        val an = SpectrumAnalyzer()
        val snap0 = an.analyze(0L)
        check("empty analyzer returns EMPTY", snap0.bands.all { it == 0f } && snap0.level == 0f)
        for (k in 0 until 8) {
            val blk = FloatArray(1024 * 2) { i -> sin(2.0 * Math.PI * 440.0 * (k * 1024 + i / 2) / sr).toFloat() * 0.5f }
            an.submit(blk, 1024, 2)
        }
        val snap1 = an.analyze(1000L)
        check("analyzer sees signal", snap1.level > 0f, "level=${snap1.level}")

        println(if (failures == 0) "ALL DSP SELF-CHECKS PASSED" else "$failures DSP SELF-CHECKS FAILED")
        if (failures > 0) kotlin.system.exitProcess(1)
    }
}
