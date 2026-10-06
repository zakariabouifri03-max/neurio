package com.neurio.client

import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.view.Surface
import com.neurio.common.AppLog
import com.neurio.common.CsdCodec
import com.neurio.common.Ewma
import java.util.ArrayDeque
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Hardware video decoder rendering straight to the SurfaceView surface.
 *
 * Latency rules implemented here:
 *  - input queue is bounded and drops stale non-keyframes instead of building
 *    up backlog;
 *  - output side renders only the newest ready frame (older ready frames are
 *    released without rendering);
 *  - KEY_LOW_LATENCY is requested on API 30+ devices.
 */
class VideoDecoder(private val surface: Surface) {

    companion object {
        private const val TAG = "VideoDecoder"
        private const val INPUT_QUEUE_LIMIT = 5
        private const val OUT_TIMEOUT_US = 8_000L
    }

    private class QueuedFrame(
        val data: ByteArray,
        val size: Int,
        val ptsUs: Long,
        val config: Boolean,
        val enqueuedNano: Long
    )

    private var codec: MediaCodec? = null
    private var inputThread: Thread? = null
    private var outputThread: Thread? = null

    @Volatile
    private var running = false

    private val lock = ReentrantLock()
    private val notEmpty = lock.newCondition()
    private val queue = ArrayDeque<QueuedFrame>()

    private var pendingCsd0: ByteArray? = null
    private var pendingCsd1: ByteArray? = null

    private val decodeLatency = Ewma(0.2)
    val decodeLatencyMs: Double get() = decodeLatency.value

    private var renderWindowStart = 0L
    private var renderWindowCount = 0
    @Volatile
    var renderedFps: Double = 0.0
        private set

    @Volatile
    var droppedFrames: Int = 0
        private set

    var width: Int = 0
        private set
    var height: Int = 0
        private set
    var mime: String = "video/avc"
        private set

    /** Stores CSD from a CONFIG packet; starts/restarts the codec as needed. */
    fun applyConfig(configBlob: ByteArray, newWidth: Int, newHeight: Int, newMime: String) {
        val csd = CsdCodec.decode(configBlob)
        if (csd == null) {
            AppLog.w(TAG, "bad config blob (${configBlob.size}B)")
            return
        }
        pendingCsd0 = csd.first
        pendingCsd1 = csd.second
        val needsRestart = !running || newWidth != width || newHeight != height || newMime != mime
        if (needsRestart) {
            stop()
            start(newMime, newWidth, newHeight)
        }
    }

    private fun chooseDecoder(mimeType: String): MediaCodec {
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        var fallback: String? = null
        for (info in list.codecInfos) {
            if (info.isEncoder) continue
            val supported = try {
                info.supportedTypes.any { it.equals(mimeType, ignoreCase = true) }
            } catch (e: Exception) {
                false
            }
            if (!supported) continue
            val name = info.name.lowercase()
            val isSoftware = name.contains(".sw.") || name.startsWith("omx.google")
            if (!isSoftware) {
                AppLog.i(TAG, "using hardware decoder ${info.name}")
                return MediaCodec.createByCodecName(info.name)
            }
            if (fallback == null) fallback = info.name
        }
        if (fallback != null) {
            AppLog.w(TAG, "no hardware decoder for $mimeType; using $fallback")
            return MediaCodec.createByCodecName(fallback)
        }
        return MediaCodec.createDecoderByType(mimeType)
    }

    fun start(mimeType: String, w: Int, h: Int) {
        stop()
        mime = mimeType
        width = w
        height = h

        val format = MediaFormat.createVideoFormat(mime, w, h)
        pendingCsd0?.let { format.setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(it)) }
        pendingCsd1?.let { format.setByteBuffer("csd-1", java.nio.ByteBuffer.wrap(it)) }
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
            } catch (ignored: Exception) {
            }
        }

        val mc = chooseDecoder(mime)
        try {
            mc.configure(format, surface, null, 0)
        } catch (e: Exception) {
            AppLog.e(TAG, "configure failed, retrying without CSD", e)
            mc.release()
            val bare = MediaFormat.createVideoFormat(mime, w, h)
            val retry = chooseDecoder(mime)
            retry.configure(bare, surface, null, 0)
            startThreads(retry)
            return
        }
        startThreads(mc)
    }

    private fun startThreads(mc: MediaCodec) {
        mc.start()
        codec = mc
        running = true
        droppedFrames = 0
        renderedFps = 0.0
        renderWindowStart = System.nanoTime()
        renderWindowCount = 0

        inputThread = Thread { inputLoop(mc) }.apply {
            name = "neurio-vdec-in"
            isDaemon = true
            start()
        }
        outputThread = Thread { outputLoop(mc) }.apply {
            name = "neurio-vdec-out"
            isDaemon = true
            start()
        }
        AppLog.i(TAG, "decoder started $mime ${width}x$height")
    }

    fun decode(data: ByteArray, size: Int, ptsUs: Long) {
        if (!running) return
        lock.withLock {
            while (queue.size >= INPUT_QUEUE_LIMIT) {
                // Drop the oldest non-keyframe; keep backlog flat for latency.
                val oldest = queue.peekFirst()
                if (oldest == null) break
                queue.removeFirst()
                droppedFrames++
            }
            queue.addLast(QueuedFrame(data, size, ptsUs, false, System.nanoTime()))
            notEmpty.signal()
        }
    }

    private fun inputLoop(mc: MediaCodec) {
        while (running) {
            val frame = lock.withLock {
                while (queue.isEmpty() && running) {
                    try {
                        notEmpty.await(50, java.util.concurrent.TimeUnit.MILLISECONDS)
                    } catch (e: InterruptedException) {
                        return@withLock null
                    }
                }
                if (!running) null else queue.pollFirst()
            } ?: continue

            val inIndex = try {
                mc.dequeueInputBuffer(15_000)
            } catch (e: Exception) {
                break
            }
            if (inIndex < 0) {
                // Encoder outran us; drop frame to stay live.
                droppedFrames++
                continue
            }
            try {
                val buf = mc.getInputBuffer(inIndex) ?: continue
                buf.clear()
                val n = minOf(frame.size, buf.remaining())
                buf.put(frame.data, 0, n)
                mc.queueInputBuffer(inIndex, 0, n, frame.ptsUs, 0)
                ptsToEnqueue[frame.ptsUs] = frame.enqueuedNano
                if (ptsToEnqueue.size > 240) {
                    val iter = ptsToEnqueue.keys.iterator()
                    repeat(120) { if (iter.hasNext()) { iter.next(); iter.remove() } }
                }
            } catch (e: Exception) {
                AppLog.w(TAG, "input queue error: ${e.message}")
                break
            }
        }
        AppLog.d(TAG, "input loop ended")
    }

    private val ptsToEnqueue = HashMap<Long, Long>()

    private fun outputLoop(mc: MediaCodec) {
        val info = MediaCodec.BufferInfo()
        while (running) {
            val index = try {
                mc.dequeueOutputBuffer(info, OUT_TIMEOUT_US)
            } catch (e: Exception) {
                break
            }
            if (index < 0) continue

            // Drain any further immediately-available outputs and only render
            // the most recent one: that is the lowest-latency frame.
            var renderIndex = index
            var latestInfo = info
            while (true) {
                val next = try {
                    mc.dequeueOutputBuffer(info, 0)
                } catch (e: Exception) {
                    -2
                }
                if (next < 0) break
                try {
                    mc.releaseOutputBuffer(renderIndex, false)
                } catch (ignored: Exception) {
                }
                droppedFrames++
                renderIndex = next
                latestInfo = info
            }

            val enqueued = ptsToEnqueue.remove(latestInfo.presentationTimeUs)
            if (enqueued != null) {
                val latencyMs = (System.nanoTime() - enqueued) / 1_000_000.0
                if (latencyMs in 0.0..800.0) decodeLatency.add(latencyMs)
            }
            try {
                mc.releaseOutputBuffer(renderIndex, true)
                countRendered()
            } catch (e: Exception) {
                AppLog.w(TAG, "render error: ${e.message}")
            }
        }
        AppLog.d(TAG, "output loop ended")
    }

    private fun countRendered() {
        renderWindowCount++
        val now = System.nanoTime()
        val elapsed = now - renderWindowStart
        if (elapsed >= 1_000_000_000L) {
            renderedFps = renderWindowCount * 1_000_000_000.0 / elapsed
            renderWindowStart = now
            renderWindowCount = 0
        }
    }

    fun stop() {
        running = false
        lock.withLock {
            queue.clear()
            notEmpty.signal()
        }
        try {
            inputThread?.join(300)
        } catch (ignored: InterruptedException) {
        }
        try {
            outputThread?.join(300)
        } catch (ignored: InterruptedException) {
        }
        inputThread = null
        outputThread = null
        val mc = codec
        codec = null
        if (mc != null) {
            try {
                mc.stop()
            } catch (ignored: Exception) {
            }
            try {
                mc.release()
            } catch (ignored: Exception) {
            }
        }
        ptsToEnqueue.clear()
    }
}
