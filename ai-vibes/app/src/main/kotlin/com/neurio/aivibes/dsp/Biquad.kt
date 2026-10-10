package com.neurio.aivibes.dsp

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * RBJ audio-EQ-cookbook biquad (transposed direct form II).
 *
 * Pure Kotlin — no Android dependencies — so the filter maths can be unit
 * tested on the JVM and reused verbatim inside the Media3 audio pipeline.
 */
class Biquad {
    private var b0 = 1.0
    private var b1 = 0.0
    private var b2 = 0.0
    private var a1 = 0.0
    private var a2 = 0.0

    // Transposed DF-II state (per channel instances are created by callers).
    private var z1 = 0f
    private var z2 = 0f

    fun reset() {
        z1 = 0f
        z2 = 0f
    }

    /** One sample through the filter. */
    fun process(x: Float): Float {
        val y = (b0 * x + z1).toFloat()
        z1 = (b1 * x - a1 * y + z2).toFloat()
        z2 = (b2 * x - a2 * y).toFloat()
        return y
    }

    /** Magnitude response at [freqHz] (for tests / analysis). */
    fun magnitudeAt(freqHz: Double, sampleRate: Double): Double {
        val w = 2.0 * PI * freqHz / sampleRate
        val cw = cos(w)
        val sw = sin(w)
        val cw2 = cos(2 * w)
        val sw2 = sin(2 * w)
        val numRe = b0 + b1 * cw + b2 * cw2
        val numIm = -(b1 * sw + b2 * sw2)
        val denRe = 1.0 + a1 * cw + a2 * cw2
        val denIm = -(a1 * sw + a2 * sw2)
        return sqrt(numRe * numRe + numIm * numIm) / sqrt(denRe * denRe + denIm * denIm)
    }

    private fun set(b0: Double, b1: Double, b2: Double, a0: Double, a1: Double, a2: Double) {
        this.b0 = b0 / a0
        this.b1 = b1 / a0
        this.b2 = b2 / a0
        this.a1 = a1 / a0
        this.a2 = a2 / a0
    }

    companion object {
        /** Peaking EQ. [gainDb] positive = boost. */
        fun peaking(sampleRate: Double, freq: Double, q: Double, gainDb: Double): Biquad {
            val a = pow10(gainDb / 40.0)
            val w0 = 2.0 * PI * clampFreq(freq, sampleRate) / sampleRate
            val alpha = sin(w0) / (2.0 * q.coerceAtLeast(0.05))
            val cw = cos(w0)
            val f = Biquad()
            f.set(
                1.0 + alpha * a, -2.0 * cw, 1.0 - alpha * a,
                1.0 + alpha / a, -2.0 * cw, 1.0 - alpha / a
            )
            return f
        }

        /** Low-shelf. [gainDb] positive = boost below the corner. */
        fun lowShelf(sampleRate: Double, freq: Double, gainDb: Double, s: Double = 0.9): Biquad {
            val a = pow10(gainDb / 40.0)
            val w0 = 2.0 * PI * clampFreq(freq, sampleRate) / sampleRate
            val cw = cos(w0)
            val alpha = sin(w0) / 2.0 * sqrt((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0)
            val twoSqrtAAlpha = 2.0 * sqrt(a) * alpha
            val f = Biquad()
            f.set(
                a * ((a + 1.0) - (a - 1.0) * cw + twoSqrtAAlpha),
                2.0 * a * ((a - 1.0) - (a + 1.0) * cw),
                a * ((a + 1.0) - (a - 1.0) * cw - twoSqrtAAlpha),
                (a + 1.0) + (a - 1.0) * cw + twoSqrtAAlpha,
                -2.0 * ((a - 1.0) + (a + 1.0) * cw),
                (a + 1.0) + (a - 1.0) * cw - twoSqrtAAlpha
            )
            return f
        }

        /** High-shelf. [gainDb] positive = boost above the corner. */
        fun highShelf(sampleRate: Double, freq: Double, gainDb: Double, s: Double = 0.9): Biquad {
            val a = pow10(gainDb / 40.0)
            val w0 = 2.0 * PI * clampFreq(freq, sampleRate) / sampleRate
            val cw = cos(w0)
            val alpha = sin(w0) / 2.0 * sqrt((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0)
            val twoSqrtAAlpha = 2.0 * sqrt(a) * alpha
            val f = Biquad()
            f.set(
                a * ((a + 1.0) + (a - 1.0) * cw + twoSqrtAAlpha),
                -2.0 * a * ((a - 1.0) + (a + 1.0) * cw),
                a * ((a + 1.0) + (a - 1.0) * cw - twoSqrtAAlpha),
                (a + 1.0) - (a - 1.0) * cw + twoSqrtAAlpha,
                2.0 * ((a - 1.0) - (a + 1.0) * cw),
                (a + 1.0) - (a - 1.0) * cw - twoSqrtAAlpha
            )
            return f
        }

        /** DC-blocking high-pass (2nd order, Q = 0.707). */
        fun highPass(sampleRate: Double, freq: Double): Biquad {
            val w0 = 2.0 * PI * clampFreq(freq, sampleRate) / sampleRate
            val cw = cos(w0)
            val alpha = sin(w0) / (2.0 * 0.70710678)
            val f = Biquad()
            f.set(
                (1.0 + cw) / 2.0, -(1.0 + cw), (1.0 + cw) / 2.0,
                1.0 + alpha, -2.0 * cw, 1.0 - alpha
            )
            return f
        }

        private fun pow10(x: Double): Double = Math.pow(10.0, x)

        private fun clampFreq(freq: Double, sampleRate: Double): Double =
            freq.coerceIn(5.0, sampleRate * 0.45)
    }
}
