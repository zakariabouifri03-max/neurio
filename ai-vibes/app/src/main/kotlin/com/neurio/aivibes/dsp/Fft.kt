package com.neurio.aivibes.dsp

import kotlin.math.cos
import kotlin.math.sin

/**
 * In-place iterative radix-2 FFT (Cooley–Tukey), power-of-two sizes.
 * Used by the live visualizer and by the AI spectrum analyser.
 */
object Fft {
    /** Returns magnitudes (size/2 bins) of the real signal [input] (length = size). */
    fun magnitudes(input: FloatArray, size: Int): FloatArray {
        require(size > 1 && size and (size - 1) == 0) { "size must be a power of two" }
        require(input.size >= size) { "input too small" }
        val re = FloatArray(size)
        val im = FloatArray(size)
        for (i in 0 until size) {
            re[i] = input[i]
        }
        transform(re, im)
        val out = FloatArray(size / 2)
        for (i in 0 until size / 2) {
            out[i] = kotlin.math.sqrt(re[i] * re[i] + im[i] * im[i])
        }
        return out
    }

    /** Complex FFT in place (length must be a power of two). */
    fun transform(re: FloatArray, im: FloatArray) {
        val n = re.size
        require(n == im.size && n > 1 && n and (n - 1) == 0)
        // Bit reversal permutation.
        var j = 0
        for (i in 0 until n) {
            if (i < j) {
                var t = re[i]; re[i] = re[j]; re[j] = t
                t = im[i]; im[i] = im[j]; im[j] = t
            }
            var m = n shr 1
            while (m in 1..j) {
                j -= m
                m = m shr 1
            }
            j += m
        }
        // Danielson–Lanczos.
        var len = 2
        while (len <= n) {
            val ang = -2.0 * Math.PI / len
            val wRe = cos(ang).toFloat()
            val wIm = sin(ang).toFloat()
            var i = 0
            while (i < n) {
                var curRe = 1f
                var curIm = 0f
                for (k in 0 until len / 2) {
                    val a = i + k
                    val b = i + k + len / 2
                    val tRe = re[b] * curRe - im[b] * curIm
                    val tIm = re[b] * curIm + im[b] * curRe
                    re[b] = re[a] - tRe
                    im[b] = im[a] - tIm
                    re[a] += tRe
                    im[a] += tIm
                    val nRe = curRe * wRe - curIm * wIm
                    curIm = curRe * wIm + curIm * wRe
                    curRe = nRe
                }
                i += len
            }
            len = len shl 1
        }
    }

    /** Hann window of [size] samples. */
    fun hann(size: Int): FloatArray {
        val w = FloatArray(size)
        for (i in 0 until size) {
            w[i] = (0.5 - 0.5 * cos(2.0 * Math.PI * i / (size - 1))).toFloat()
        }
        return w
    }
}
