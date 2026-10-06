package com.aivision4k.app.benchmark

import android.os.Handler
import android.os.Looper
import android.view.Choreographer

/**
 * Measures the frame cadence this process can actually sustain.
 *
 * ## What this is
 *
 * `Choreographer` delivers the vsync timestamps Android gave *this* app, so the
 * numbers below are real measurements of this app's own render loop: mean frame
 * interval, jitter, worst frame and the 1 % low. The screen deliberately keeps
 * animating while it runs; a benchmark that measures an idle thread would be a
 * fiction.
 *
 * ## What this is not
 *
 * It is **not** a frame rate of any game. An app cannot read another app's
 * frame rate, and the in-pipeline "native vs AI upscaling" comparison needs a
 * Vulkan device handed to the engine by a renderer — the demo host, which is a
 * separate component. The benchmark screen says all of this in plain words
 * rather than printing a number that looks like a game's FPS.
 */
data class CadenceResult(
    val samples: Int,
    val durationSeconds: Double,
    val meanFrameMs: Double,
    val meanFps: Double,
    val onePercentLowFps: Double,
    val worstFrameMs: Double,
    val jitterMs: Double,
    val displayRefreshRate: Float,
)

class FrameCadenceProbe(
    private val onProgress: (elapsedSeconds: Int, samples: Int) -> Unit,
    private val onFinished: (CadenceResult) -> Unit,
    private val onFrame: (Double) -> Unit = {},
) {

    private val handler = Handler(Looper.getMainLooper())
    private val frameTimes = ArrayList<Double>(2048)
    private var running = false
    private var durationSeconds = 30
    private var startNanos = 0L
    private var lastNanos = 0L

    val isRunning: Boolean get() = running

    private val callback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!running) return
            if (lastNanos != 0L) {
                val deltaMs = (frameTimeNanos - lastNanos) / 1_000_000.0
                if (deltaMs > 0.0) {
                    frameTimes.add(deltaMs)
                    onFrame(deltaMs)
                }
            }
            lastNanos = frameTimeNanos
            val elapsed = (frameTimeNanos - startNanos) / 1_000_000_000.0
            onProgress(elapsed.toInt(), frameTimes.size)
            if (elapsed >= durationSeconds) {
                finish()
            } else {
                Choreographer.getInstance().postFrameCallback(this)
            }
        }
    }

    /** Must be called from the main thread. */
    fun start(seconds: Int = 30, refreshRate: Float = 60f) {
        if (running) return
        running = true
        durationSeconds = seconds.coerceAtLeast(5)
        frameTimes.clear()
        startNanos = System.nanoTime()
        lastNanos = 0L
        displayRefreshRate = refreshRate
        Choreographer.getInstance().postFrameCallback(callback)
    }

    /** Cancels without producing a result. */
    fun cancel() {
        if (!running) return
        running = false
        Choreographer.getInstance().removeFrameCallback(callback)
        handler.removeCallbacksAndMessages(null)
    }

    private var displayRefreshRate: Float = 60f

    private fun finish() {
        running = false
        Choreographer.getInstance().removeFrameCallback(callback)
        onFinished(result())
    }

    private fun result(): CadenceResult {
        val samples = frameTimes.toList()
        if (samples.isEmpty()) {
            return CadenceResult(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, displayRefreshRate)
        }
        val mean = samples.average()
        val sorted = samples.sorted()
        val tailCount = (sorted.size / 100).coerceAtLeast(1)
        val worstTail = sorted.takeLast(tailCount)
        val worstTailMean = worstTail.average()
        val variance = samples.map { (it - mean) * (it - mean) }.average()
        val duration = samples.sum() / 1000.0
        return CadenceResult(
            samples = samples.size,
            durationSeconds = duration,
            meanFrameMs = mean,
            meanFps = if (mean > 0.0) 1000.0 / mean else 0.0,
            // "1 % low" is the frame rate the slowest 1 % of frames sustained.
            onePercentLowFps = if (worstTailMean > 0.0) 1000.0 / worstTailMean else 0.0,
            worstFrameMs = sorted.last(),
            jitterMs = kotlin.math.sqrt(variance),
            displayRefreshRate = displayRefreshRate,
        )
    }
}
