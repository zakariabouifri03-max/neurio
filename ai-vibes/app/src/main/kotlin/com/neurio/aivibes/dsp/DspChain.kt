package com.neurio.aivibes.dsp

import kotlin.math.abs
import kotlin.math.tanh

/**
 * The complete AI VIBES DSP chain as pure Kotlin operating on interleaved
 * float audio. Order of stages:
 *
 *   [pre-amp] -> [10-band EQ] -> [bass shelf + sub] -> [clarity/tilt]
 *     -> [spatial width + crossfeed] -> [dynamics + loudness] -> [limiter]
 *
 * The Media3 `AudioProcessor` wrapper in `audio/` is a thin buffer-conversion
 * shell around this class, so all signal maths lives here and is unit tested.
 */
class DspChain {
    @Volatile
    private var config: DspConfig = DspConfig()
    private var configSerial: Int = -1

    // Per-channel filter state.
    private var channels = 0
    private var sampleRate = 48000.0
    private lateinit var eqFilters: Array<Biquad>          // channels * EQ_BANDS
    private lateinit var bassFilter: Array<Biquad>
    private lateinit var subFilter: Array<Biquad>
    private lateinit var clarityFilter: Array<Biquad>
    private lateinit var tiltLow: Array<Biquad>
    private lateinit var tiltHigh: Array<Biquad>
    private lateinit var dcBlock: Array<Biquad>

    // Dynamics state (linked stereo).
    private var envRms = 0f
    private var gainSmooth = 1f
    private var limGain = 1f
    private var loudnessGain = 1f

    fun updateConfig(newConfig: DspConfig) {
        config = newConfig
    }

    private fun ensureFilters(ch: Int, sr: Int) {
        if (ch == channels && sr == sampleRate.toInt() && ::eqFilters.isInitialized) return
        channels = ch
        sampleRate = sr.toDouble()
        val bands = DspConfig.EQ_BANDS.size
        eqFilters = Array(ch * bands) { Biquad() }
        bassFilter = Array(ch) { Biquad() }
        subFilter = Array(ch) { Biquad() }
        clarityFilter = Array(ch) { Biquad() }
        tiltLow = Array(ch) { Biquad() }
        tiltHigh = Array(ch) { Biquad() }
        dcBlock = Array(ch) { Biquad() }
        configSerial = -1
    }

    private fun rebuildIfNeeded() {
        val cfg = config
        val serial = cfg.hashCode()
        if (serial == configSerial) return
        configSerial = serial
        val sr = sampleRate
        val bands = DspConfig.EQ_BANDS.size
        for (ch in 0 until channels) {
            for (b in 0 until bands) {
                val gain = cfg.eqGains.getOrNull(b) ?: 0f
                eqFilters[ch * bands + b] =
                    if (abs(gain) < 0.05f) Biquad()
                    else Biquad.peaking(sr, DspConfig.EQ_BANDS[b].toDouble(), 1.1, gain.toDouble())
            }
            bassFilter[ch] =
                if (cfg.bassIntensity <= 0.001f) Biquad()
                else Biquad.lowShelf(sr, cfg.bassFreq.toDouble(), cfg.bassIntensity * 12.0)
            subFilter[ch] =
                if (cfg.subBass <= 0.001f) Biquad()
                else Biquad.peaking(sr, 38.0, 1.2, cfg.subBass * 8.0)
            clarityFilter[ch] =
                if (cfg.clarity <= 0.001f) Biquad()
                else Biquad.highShelf(sr, 3200.0, cfg.clarity * 6.0)
            tiltLow[ch] =
                if (abs(cfg.tilt) < 0.01f) Biquad()
                else Biquad.lowShelf(sr, 250.0, -cfg.tilt * 3.0)
            tiltHigh[ch] =
                if (abs(cfg.tilt) < 0.01f) Biquad()
                else Biquad.highShelf(sr, 3500.0, cfg.tilt * 3.0)
            dcBlock[ch] = Biquad.highPass(sr, 18.0)
        }
    }

    /**
     * Processes [frameCount] interleaved frames of [samples] in place.
     * [channelCount] must match the value used at the last call (the wrapper
     * recreates the chain state on format changes).
     */
    fun process(samples: FloatArray, frameCount: Int, channelCount: Int, sampleRateHz: Int) {
        ensureFilters(channelCount, sampleRateHz)
        rebuildIfNeeded()
        val cfg = config
        if (!cfg.enabled) return

        val bands = DspConfig.EQ_BANDS.size
        val preamp = Math.pow(10.0, cfg.preampDb / 20.0).toFloat()
        val width = cfg.spatialWidth.coerceIn(0f, 2f)
        val cross = cfg.crossfeed.coerceIn(0f, 1f) * 0.35f

        for (f in 0 until frameCount) {
            val base = f * channelCount

            // -- gather one frame per channel, run the filter stages ----------
            for (ch in 0 until channelCount) {
                var s = samples[base + ch] * preamp
                val eqOff = ch * bands
                for (b in 0 until bands) {
                    s = eqFilters[eqOff + b].process(s)
                }
                s = bassFilter[ch].process(s)
                s = subFilter[ch].process(s)
                s = clarityFilter[ch].process(s)
                s = tiltLow[ch].process(s)
                s = tiltHigh[ch].process(s)
                s = dcBlock[ch].process(s)
                samples[base + ch] = s
            }

            // -- stereo width + crossfeed (mid/side) --------------------------
            if (channelCount == 2) {
                var l = samples[base]
                var r = samples[base + 1]
                val mid = (l + r) * 0.5f
                val side = (l - r) * 0.5f * width
                l = mid + side
                r = mid - side
                if (cross > 0f) {
                    val xl = l + (r - l) * cross
                    val xr = r + (l - r) * cross
                    l = xl
                    r = xr
                }
                samples[base] = l
                samples[base + 1] = r
            }

            // -- dynamics: RMS compressor + slow loudness + peak limiter -------
            var framePeak = 0f
            var sumSq = 0f
            for (ch in 0 until channelCount) {
                val v = samples[base + ch]
                val a = abs(v)
                if (a > framePeak) framePeak = a
                sumSq += v * v
            }
            val rms = kotlin.math.sqrt(sumSq / channelCount)

            if (cfg.dynamics > 0.001f || cfg.loudness > 0.001f) {
                // Envelope follower (attack ~10 ms, release ~120 ms at 48 kHz).
                val att = 1f - Math.exp(-1.0 / (0.010 * sampleRateHz)).toFloat()
                val rel = 1f - Math.exp(-1.0 / (0.120 * sampleRateHz)).toFloat()
                val coef = if (rms > envRms) att else rel
                envRms += (rms - envRms) * coef

                // Compression: above threshold, reduce gain progressively.
                val amount = cfg.dynamics
                val threshold = 0.25f // ~-12 dBFS
                var targetGain = 1f
                if (envRms > threshold && amount > 0f) {
                    val over = envRms / threshold
                    val ratio = 1f + amount * 3f // 1:1 .. 4:1
                    targetGain = Math.pow(over.toDouble(), (1.0 / ratio - 1.0)).toFloat()
                }
                gainSmooth += (targetGain - gainSmooth) * 0.002f

                // Loudness balancing: gently nudge toward -18 dBFS RMS (~1 s tau).
                if (cfg.loudness > 0.001f && envRms > 0.0005f) {
                    val targetRms = 0.125f
                    val err = targetRms / envRms
                    val adj = (err - 1f) * cfg.loudness * 0.00005f
                    loudnessGain = (loudnessGain + adj).coerceIn(0.25f, 4f)
                }

                val g = gainSmooth * loudnessGain
                for (ch in 0 until channelCount) {
                    samples[base + ch] *= g
                }
                framePeak *= g
            }

            // -- peak limiter: fast-attack / slow-release gain, ceiling -1 dBFS.
            if (cfg.limiterEnabled) {
                val ceiling = 0.89f
                val need = if (framePeak > 1e-4f) {
                    (ceiling / framePeak).coerceAtMost(1f)
                } else {
                    1f
                }
                limGain += (need - limGain) * if (need < limGain) 0.35f else 0.0004f
                if (limGain < 0.9999f) {
                    for (ch in 0 until channelCount) {
                        samples[base + ch] *= limGain
                    }
                }
            }

            // -- final safety: tanh soft clip for anything still over 0.95 -----
            for (ch in 0 until channelCount) {
                val v = samples[base + ch]
                if (abs(v) > 0.95f) {
                    samples[base + ch] = tanhSoft(v)
                }
            }
        }
    }

    private fun tanhSoft(x: Float): Float = tanh(x).toFloat() * 0.995f

    /** Exposed for tests: current slow loudness gain. */
    fun currentLoudnessGain(): Float = loudnessGain

    /** Resets envelope state (on seek/flush). */
    fun resetState() {
        envRms = 0f
        gainSmooth = 1f
        limGain = 1f
        loudnessGain = 1f
        if (::eqFilters.isInitialized) {
            for (f in eqFilters) f.reset()
            for (f in bassFilter) f.reset()
            for (f in subFilter) f.reset()
            for (f in clarityFilter) f.reset()
            for (f in tiltLow) f.reset()
            for (f in tiltHigh) f.reset()
            for (f in dcBlock) f.reset()
        }
    }
}
