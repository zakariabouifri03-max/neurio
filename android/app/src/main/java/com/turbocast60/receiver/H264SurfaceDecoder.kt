package com.turbocast60.receiver

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.view.Surface
import com.turbocast60.model.VideoConfig
import com.turbocast60.protocol.EncodedAccessUnit
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bounded low-latency decoder queue; old frames are discarded rather than building seconds of delay. */
class H264SurfaceDecoder {
    private data class DecoderFormat(
        val width: Int,
        val height: Int,
        val fps: Int,
        val sps: ByteArray,
        val pps: ByteArray
    )

    private val queue = ArrayBlockingQueue<EncodedAccessUnit>(3)
    private val running = AtomicBoolean(false)
    private val lock = Any()
    @Volatile private var surface: Surface? = null
    @Volatile private var format: DecoderFormat? = null
    @Volatile private var codec: MediaCodec? = null
    @Volatile private var worker: Thread? = null
    @Volatile var decodedFps: Double = 0.0
        private set
    @Volatile var queueDrops: Long = 0
        private set

    fun attachSurface(newSurface: Surface?) {
        surface = newSurface
        restartIfReady()
    }

    fun configure(width: Int, height: Int, fps: Int, sps: ByteArray, pps: ByteArray) {
        require(width > 0 && height > 0 && sps.isNotEmpty() && pps.isNotEmpty())
        format = DecoderFormat(width, height, fps.coerceIn(1, 120), sps.copyOf(), pps.copyOf())
        queue.clear()
        restartIfReady()
    }

    fun offer(unit: EncodedAccessUnit) {
        if (format == null || surface?.isValid != true) return
        if (!queue.offer(unit)) {
            queue.poll()
            queueDrops++
            queue.offer(unit)
        }
    }

    fun close() {
        running.set(false)
        worker?.interrupt()
        runCatching { worker?.join(500) }
        worker = null
        synchronized(lock) {
            codec?.let { old ->
                runCatching { old.stop() }
                runCatching { old.release() }
            }
            codec = null
        }
        queue.clear()
        format = null
        surface = null
    }

    private fun restartIfReady() {
        val currentFormat = format ?: return
        val currentSurface = surface?.takeIf { it.isValid } ?: return
        synchronized(lock) {
            running.set(false)
            worker?.interrupt()
            runCatching { worker?.join(400) }
            worker = null
            codec?.let { old ->
                runCatching { old.stop() }
                runCatching { old.release() }
            }
            codec = null
            try {
                val videoFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, currentFormat.width, currentFormat.height).apply {
                    setByteBuffer("csd-0", ByteBuffer.wrap(byteArrayOf(0, 0, 0, 1) + currentFormat.sps))
                    setByteBuffer("csd-1", ByteBuffer.wrap(byteArrayOf(0, 0, 0, 1) + currentFormat.pps))
                    setInteger(MediaFormat.KEY_FRAME_RATE, currentFormat.fps)
                    if (Build.VERSION.SDK_INT >= 30) setInteger("low-latency", 1)
                }
                val created = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
                created.configure(videoFormat, currentSurface, null, 0)
                created.start()
                codec = created
                running.set(true)
                worker = Thread(::decodeLoop, "TurboCast-AVC-decoder").apply { isDaemon = true; start() }
            } catch (t: Throwable) {
                running.set(false)
                codec?.let { runCatching { it.release() } }
                codec = null
                throw IllegalStateException("This receiver cannot decode the selected H.264 format", t)
            }
        }
    }

    private fun decodeLoop() {
        val info = MediaCodec.BufferInfo()
        var frames = 0
        var fpsStart = System.nanoTime()
        try {
            while (running.get()) {
                val active = codec ?: break
                val unit = queue.poll(15, TimeUnit.MILLISECONDS)
                if (unit != null) {
                    val inputIndex = active.dequeueInputBuffer(5_000)
                    if (inputIndex >= 0) {
                        val input = active.getInputBuffer(inputIndex)
                        val bytes = unit.annexBBytes()
                        if (input != null && bytes.size <= input.capacity()) {
                            input.clear()
                            input.put(bytes)
                            active.queueInputBuffer(inputIndex, 0, bytes.size, unit.presentationTimeUs, 0)
                        } else {
                            active.queueInputBuffer(inputIndex, 0, 0, unit.presentationTimeUs, 0)
                            queueDrops++
                        }
                    } else {
                        queueDrops++
                    }
                }
                while (running.get()) {
                    val outputIndex = active.dequeueOutputBuffer(info, 0)
                    if (outputIndex < 0) break
                    active.releaseOutputBuffer(outputIndex, true)
                    frames++
                    val now = System.nanoTime()
                    val elapsed = now - fpsStart
                    if (elapsed >= 1_000_000_000L) {
                        decodedFps = frames * 1_000_000_000.0 / elapsed
                        frames = 0
                        fpsStart = now
                    }
                }
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (_: IllegalStateException) {
            // MediaCodec may be torn down concurrently during a display rotation or disconnect.
        } catch (_: Throwable) {
            // A decoder failure is surfaced on the next connection attempt; do not crash the TV UI.
        }
    }
}
