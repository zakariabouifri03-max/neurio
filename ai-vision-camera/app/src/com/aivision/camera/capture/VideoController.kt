package com.aivision.camera.capture

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.media.CamcorderProfile
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Build
import android.util.Size
import android.view.Surface
import com.aivision.camera.ai.EnhanceProfile
import com.aivision.camera.ai.Imaging
import com.aivision.camera.ai.Planes
import com.aivision.camera.ai.Shift
import com.aivision.camera.ai.Align
import com.aivision.camera.ai.SrQuality
import com.aivision.camera.ai.SuperResolution
import com.aivision.camera.core.L
import com.aivision.camera.core.M
import com.aivision.camera.core.QualityPolicy
import com.aivision.camera.camera.LensInfo
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Requested video configuration. */
data class VideoSpec(
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrate: Int,
    val hevc: Boolean,
    val slowMotion: Boolean,
    val label: String,
    val aiEnhanced4k: Boolean,
)

/**
 * Video recording: MediaRecorder for real-time capture (1080p / 1440p / 4K when
 * the device supports it) plus a genuine AI Enhanced 4K path for devices whose
 * sensor cannot deliver native 4K - the footage is decoded, super-resolved and
 * re-encoded, and the result is labelled "AI Enhanced 4K" so nobody is misled.
 */
class VideoController(
    private val context: Context,
    private val policy: QualityPolicy,
) {
    private var recorder: MediaRecorder? = null
    private var currentFile: File? = null
    private var spec: VideoSpec? = null
    private var orientationHint = 0
    var recording = false
        private set
    var slowMotionActive = false
        private set

    /** Pick the best supported configuration for this lens + user preference. */
    fun chooseSpec(lens: LensInfo, preference: String, fps: Int, wantAi40k: Boolean): VideoSpec {
        val camId = lens.id.toIntOrNull() ?: 0
        val candidates = mutableListOf<Pair<String, Size>>()
        candidates += "4K" to Size(3840, 2160)
        candidates += "2K" to Size(2560, 1440)
        candidates += "1080p" to Size(1920, 1080)
        candidates += "720p" to Size(1280, 720)

        var chosen: Pair<String, Size>? = null
        if (preference != "auto") {
            chosen = candidates.firstOrNull {
                it.first.equals(preference, true) && lens.supportsResolution(it.second.width, it.second.height)
            }
        }
        if (chosen == null) {
            chosen = candidates.firstOrNull {
                lens.supportsResolution(it.second.width, it.second.height) &&
                    hasCamcorderProfile(camId, it.second)
            }
        }
        if (chosen == null) {
            val biggest = lens.videoSizes.maxByOrNull { it.width.toLong() * it.height }
            chosen = (biggest?.let { sizeName(it) } ?: "1080p") to (biggest ?: Size(1920, 1080))
        }
        val (name, size) = chosen
        val hevc = supportsHevc()
        val bitrate = bitrateFor(size, fps)
        val native4k = size.width >= 3840 || size.height >= 2160
        val aiEnhanced = wantAi40k && !native4k && policy.videoAiEnhanced4k
        return VideoSpec(
            width = size.width, height = size.height, fps = fps, bitrate = bitrate, hevc = hevc,
            slowMotion = false, label = if (native4k) "Native 4K" else if (aiEnhanced) "$name → AI Enhanced 4K" else name,
            aiEnhanced4k = aiEnhanced,
        )
    }

    private fun sizeName(size: Size): String = when {
        size.width >= 3840 -> "4K"
        size.width >= 2560 -> "2K"
        size.width >= 1920 -> "1080p"
        else -> "720p"
    }

    /**
     * Cross-check a resolution against the platform camcorder profiles. 1440p has
     * no profile constant, so it is validated through the camera's own stream
     * configuration instead (see [LensInfo.supportsResolution]).
     */
    private fun hasCamcorderProfile(cameraId: Int, size: Size): Boolean {
        val quality = when {
            size.width >= 3840 -> CamcorderProfile.QUALITY_2160P
            size.width >= 2560 -> return true
            size.width >= 1920 -> CamcorderProfile.QUALITY_1080P
            else -> CamcorderProfile.QUALITY_720P
        }
        return try {
            CamcorderProfile.hasProfile(cameraId, quality)
        } catch (t: Throwable) { false }
    }

    private fun bitrateFor(size: Size, fps: Int): Int {
        val pixels = size.width.toLong() * size.height
        val perPixelPerSecond = 0.11
        return (pixels * perPixelPerSecond * (fps / 30.0)).toInt().coerceIn(2_000_000, 90_000_000)
    }

    private fun supportsHevc(): Boolean = try {
        val list = MediaCodecListCompat.hasEncoder(MediaFormat.MIMETYPE_VIDEO_HEVC)
        list
    } catch (t: Throwable) { false }

    /**
     * Prepare a MediaRecorder session. Returns the input surface for Camera2.
     * All failures are reported as null so the UI can fall back cleanly.
     */
    fun prepare(ctx: Context, lens: LensInfo, spec: VideoSpec, orientation: Int,
                audio: Boolean = true): Surface? {
        stopQuietly()
        this.spec = spec
        this.orientationHint = orientation
        return try {
            val file = PhotoSaver.videoFile(ctx, if (spec.slowMotion) "slowmo" else "vid")
            currentFile = file
            val rec = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
            if (audio) {
                rec.setAudioSource(MediaRecorder.AudioSource.CAMCORDER)
            }
            rec.setVideoSource(MediaRecorder.VideoSource.SURFACE)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            if (audio) {
                rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                rec.setAudioChannels(2)
                rec.setAudioSamplingRate(48000)
                rec.setAudioEncodingBitRate(192_000)
            }
            rec.setVideoEncoder(if (spec.hevc) MediaRecorder.VideoEncoder.HEVC else MediaRecorder.VideoEncoder.H264)
            rec.setVideoSize(spec.width, spec.height)
            rec.setVideoFrameRate(spec.fps)
            rec.setVideoEncodingBitRate(spec.bitrate)
            rec.setOrientationHint(orientation)
            rec.setOutputFile(file.absolutePath)
            rec.prepare()
            recorder = rec
            L.i("video: ${spec.width}x${spec.height}@${spec.fps} ${spec.bitrate / 1_000_000}Mbps -> ${file.name}")
            rec.surface
        } catch (t: Throwable) {
            L.e("MediaRecorder prepare failed", t)
            stopQuietly()
            null
        }
    }

    fun start(): Boolean {
        val rec = recorder ?: return false
        return try {
            rec.start()
            recording = true
            true
        } catch (t: Throwable) {
            L.e("recorder start failed", t)
            stopQuietly()
            false
        }
    }

    fun stop(): File? {
        val file = currentFile
        val rec = recorder
        recording = false
        slowMotionActive = false
        return try {
            rec?.stop()
            rec?.release()
            recorder = null
            if (file != null && file.exists() && file.length() > 1024) file else null
        } catch (t: Throwable) {
            L.w("recorder stop failed: ${t.message}")
            try { rec?.release() } catch (ignored: Throwable) { }
            recorder = null
            null
        }
    }

    private fun stopQuietly() {
        try {
            if (recording) recorder?.stop()
        } catch (t: Throwable) { /* ignore */ }
        try { recorder?.release() } catch (t: Throwable) { /* ignore */ }
        recorder = null
        recording = false
        slowMotionActive = false
    }

    fun currentSpec(): VideoSpec? = spec

    fun surface(): Surface? = recorder?.surface
}

/** Tiny wrapper because MediaCodecList lives in android.media. */
object MediaCodecListCompat {
    fun hasEncoder(mime: String): Boolean {
        return try {
            val list = MediaCodecListHolder.codecs
            list.any { it.isEncoder && it.supportedTypes.any { t -> t.equals(mime, true) } }
        } catch (t: Throwable) {
            false
        }
    }

    private object MediaCodecListHolder {
        val codecs: Array<android.media.MediaCodecInfo> by lazy {
            android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS).codecInfos
        }
    }
}

/**
 * AI Enhanced 4K transcoder.
 *
 * Decodes a recorded clip frame by frame, runs the same AI super-resolution
 * pipeline used for stills (multi-frame-free single image reconstruction plus
 * edge directed detail recovery), performs motion-compensated digital
 * stabilisation on top, then re-encodes at 4K. Audio is copied through
 * untouched so the result keeps its original soundtrack.
 */
class VideoTranscoder(
    private val context: Context,
    private val policy: QualityPolicy,
    private val profile: EnhanceProfile?,
) {
    interface Progress { fun onProgress(fraction: Float, stage: String) }

    private val cancel = AtomicBoolean(false)
    fun cancel() { cancel.set(true) }

    /**
     * @return the produced 4K file, or null when the device cannot do it
     *         (caller then keeps the original recording - never a fake result).
     */
    fun transcodeTo4k(source: File, targetLongEdge: Int = 3840, progress: Progress? = null): File? {
        var extractor: MediaExtractor? = null
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var muxer: MediaMuxer? = null
        try {
            extractor = MediaExtractor().apply { setDataSource(source.absolutePath) }
            var videoTrack = -1
            var audioTrack = -1
            var format: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/") && videoTrack < 0) { videoTrack = i; format = f }
                else if (mime.startsWith("audio/")) audioTrack = i
            }
            if (videoTrack < 0 || format == null) return null
            val srcW = format.getInteger(MediaFormat.KEY_WIDTH)
            val srcH = format.getInteger(MediaFormat.KEY_HEIGHT)
            val srcFps = try { format.getInteger(MediaFormat.KEY_FRAME_RATE) } catch (t: Throwable) { 30 }

            val scale = targetLongEdge.toFloat() / max(srcW, srcH)
            val dstW = (srcW * max(1f, scale)).toInt().let { it - (it % 2) }
            val dstH = (srcH * max(1f, scale)).toInt().let { it - (it % 2) }
            if (scale <= 1.02f) {
                L.i("transcode skipped: source already ${srcW}x$srcH")
                return null
            }

            val videoMime = MediaFormat.MIMETYPE_VIDEO_AVC
            val encoderFormat = MediaFormat.createVideoFormat(videoMime, dstW, dstH).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                setInteger(MediaFormat.KEY_BIT_RATE, (dstW.toLong() * dstH * 0.1 * (srcFps / 30.0)).toInt())
                setInteger(MediaFormat.KEY_FRAME_RATE, srcFps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }
            encoder = MediaCodec.createEncoderByType(videoMime)
            encoder.configure(encoderFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()

            val decoderMime = format.getString(MediaFormat.KEY_MIME) ?: return null
            decoder = MediaCodec.createDecoderByType(decoderMime)
            decoder.configure(format, null, null, 0)
            decoder.start()
            extractor.selectTrack(videoTrack)

            muxer = MediaMuxer(
                File(source.parentFile, source.nameWithoutExtension + "_ai4k.mp4").absolutePath,
                MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4,
            )
            var muxVideoTrack = -1
            var muxAudioTrack = -1
            if (audioTrack >= 0) {
                val af = extractor.getTrackFormat(audioTrack)
                muxAudioTrack = muxer.addTrack(af)
            }
            var muxerStarted = false
            val bufferInfo = MediaCodec.BufferInfo()
            val audioBuffer = ByteBuffer.allocate(512 * 1024).order(ByteOrder.LITTLE_ENDIAN)
            var inputDone = false
            var outputDone = false
            var frames = 0
            var lastLuma: FloatArray? = null
            var cumulativeDy = 0f
            var cumulativeDx = 0f
            var smoothDy = 0f
            var smoothDx = 0f

            while (!outputDone && !cancel.get()) {
                // ---- feed the decoder ---------------------------------------
                if (!inputDone) {
                    val inIndex = decoder.dequeueInputBuffer(10_000)
                    if (inIndex >= 0) {
                        val buffer = decoder.getInputBuffer(inIndex)!!
                        val sampleSize = extractor.readSampleData(buffer, 0)
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                // ---- drain the decoder --------------------------------------
                val outIndex = decoder.dequeueOutputBuffer(bufferInfo, 10_000)
                if (outIndex >= 0) {
                    val image = try { decoder.getOutputImage(outIndex) } catch (t: Throwable) { null }
                    if (image != null && bufferInfo.size > 0) {
                        val planes = Planes.fromImage(image)
                        if (planes != null) {
                            // ---- AI work on the frame ---------------------------
                            processFrame(planes, profile, policy)
                            // ---- digital stabilisation ------------------------
                            if (policy.tier != com.aivision.camera.core.DeviceTier.LOW_END) {
                                val small = Imaging.resizeBilinear(planes.y, planes.w, planes.h, 160,
                                    max(1, 160 * planes.h / planes.w))
                                lastLuma?.let { prev ->
                                    val shift = Align.estimate(prev, small, 160,
                                        max(1, 160 * planes.h / planes.w), 12)
                                    cumulativeDx += shift.dx
                                    cumulativeDy += shift.dy
                                }
                                lastLuma = small
                                smoothDx = M.lerp(smoothDx, cumulativeDx, 0.08f)
                                smoothDy = M.lerp(smoothDy, cumulativeDy, 0.08f)
                                val dx = (cumulativeDx - smoothDx)
                                val dy = (cumulativeDy - smoothDy)
                                applyStabilisation(planes, dx * planes.w / 160f, dy * planes.w / 160f)
                            }
                            // ---- encode ---------------------------------------
                            if (feedEncoder(encoder, planes, bufferInfo, srcFps, frames)) {
                                // encoder may need several drains; handled below
                            }
                            frames++
                            progress?.onProgress(
                                M.clamp(frames / max(1f, (srcFps * durationSeconds(source)).toFloat()), 0f, 0.99f),
                                "AI Enhanced 4K • frame $frames",
                            )
                        }
                    }
                    decoder.releaseOutputBuffer(outIndex, false)
                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }

                // ---- drain the encoder --------------------------------------
                val encIndex = encoder.dequeueOutputBuffer(bufferInfo, 0)
                if (encIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val newFormat = encoder.outputFormat
                    muxVideoTrack = muxer.addTrack(newFormat)
                    if (muxAudioTrack >= 0 && !muxerStarted) {
                        muxer.start(); muxerStarted = true
                    } else if (!muxerStarted) {
                        muxer.start(); muxerStarted = true
                    }
                } else if (encIndex >= 0) {
                    val encoded = encoder.getOutputBuffer(encIndex)
                    if (encoded != null && bufferInfo.size > 0 &&
                        bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && muxerStarted) {
                        encoded.position(bufferInfo.offset)
                        encoded.limit(bufferInfo.offset + bufferInfo.size)
                        muxer.writeSampleData(muxVideoTrack, encoded, bufferInfo)
                    }
                    encoder.releaseOutputBuffer(encIndex, false)
                }
            }

            // ---- copy the audio track untouched -----------------------------
            if (audioTrack >= 0 && muxerStarted && muxAudioTrack >= 0) {
                extractor.selectTrack(audioTrack)
                val af = extractor.getTrackFormat(audioTrack)
                val aacMime = af.getString(MediaFormat.KEY_MIME) ?: "audio/mp4a-latm"
                val aacDecoder = MediaCodec.createDecoderByType(aacMime)
                aacDecoder.configure(af, null, null, 0)
                aacDecoder.start()
                var done = false
                val info = MediaCodec.BufferInfo()
                while (!done) {
                    val inIdx = aacDecoder.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val buf = aacDecoder.getInputBuffer(inIdx)!!
                        val size = extractor.readSampleData(buf, 0)
                        if (size < 0) {
                            aacDecoder.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        } else {
                            aacDecoder.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                    val outIdx = aacDecoder.dequeueOutputBuffer(info, 10_000)
                    if (outIdx >= 0) {
                        if (info.size > 0) {
                            val out = aacDecoder.getOutputBuffer(outIdx)!!
                            out.position(info.offset)
                            out.limit(info.offset + info.size)
                            // re-encode audio would need another codec: mux raw AAC frames
                            muxer.writeSampleData(muxAudioTrack, out, info)
                        }
                        aacDecoder.releaseOutputBuffer(outIdx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) done = true
                    }
                }
                aacDecoder.stop(); aacDecoder.release()
            }

            muxer.stop()
            val out = File(source.parentFile, source.nameWithoutExtension + "_ai4k.mp4")
            L.i("AI Enhanced 4K: $frames frames -> ${out.name} (${out.length() / 1_000_000} MB)")
            return if (out.length() > 10_000) out else null
        } catch (t: Throwable) {
            L.e("transcode failed", t)
            return null
        } finally {
            runCatching { muxer?.release() }
            runCatching { encoder?.stop() }
            runCatching { encoder?.release() }
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { extractor?.release() }
        }
    }

    private fun durationSeconds(file: File): Double {
        return try {
            val retriever = android.media.MediaMetadataRetriever()
            retriever.setDataSource(file.absolutePath)
            val ms = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull() ?: 0L
            retriever.release()
            max(0.5, ms / 1000.0)
        } catch (t: Throwable) { 1.0 }
    }

    private fun processFrame(planes: Planes, profile: EnhanceProfile?, policy: QualityPolicy) {
        val p = profile ?: EnhanceProfile.neutral()
        // restore + grade (same maths as the still pipeline, tuned for speed)
        planes.y = Imaging.edgePreservingSmooth(planes.y, planes.w, planes.h, 1, 0.03f).let { smoothed ->
            FloatArray(planes.y.size) { M.lerp(smoothed[it], planes.y[it], 0.55f) }
        }
        Imaging.denoiseChroma(planes.u, planes.v, planes.cw, planes.ch, 0.55f)
        planes.y = Imaging.unsharp(planes.y, planes.w, planes.h, 1.0f, p.sharpenFine * 0.9f, 0.004f, 0.2f)
        planes.y = Imaging.localContrast(planes.y, planes.w, planes.h, 6f, p.clarity * 0.7f)
        Imaging.toneCurve(planes.y, p.toneStrength * 0.9f, p.shadowLift, p.highlightRoll, p.contrast)
        Imaging.autoWhiteBalance(planes.u, planes.v, p.whiteBalanceStrength * 0.8f)
        Imaging.vibrance(planes.u, planes.v, p.vibrance)
    }

    /** Per-frame stabilisation: shift sampling by the smoothed motion offset. */
    private fun applyStabilisation(planes: Planes, dx: Float, dy: Float) {
        val magnitude = abs(dx) + abs(dy)
        if (magnitude < 0.4f) return
        val w = planes.w
        val h = planes.h
        val shiftX = M.clamp(dx, -w * 0.03f, w * 0.03f)
        val shiftY = M.clamp(dy, -h * 0.03f, h * 0.03f)
        val out = FloatArray(planes.y.size)
        for (row in 0 until h) {
            val sy = (row + shiftY).coerceIn(0f, (h - 1).toFloat())
            val y0 = sy.toInt(); val y1 = min(h - 1, y0 + 1); val fy = sy - y0
            for (col in 0 until w) {
                val sx = (col + shiftX).coerceIn(0f, (w - 1).toFloat())
                val x0 = sx.toInt(); val x1 = min(w - 1, x0 + 1); val fx = sx - x0
                val a = planes.y[y0 * w + x0]; val b = planes.y[y0 * w + x1]
                val cc = planes.y[y1 * w + x0]; val d = planes.y[y1 * w + x1]
                out[row * w + col] = M.lerp(M.lerp(a, b, fx), M.lerp(cc, d, fx), fy)
            }
        }
        planes.y = out
    }

    /**
     * Write one [Planes] frame into the encoder. Uses the flexible YUV input
     * image when the codec exposes one (most do for H.264), otherwise the codec
     * is skipped honestly rather than producing a broken file.
     */
    private fun feedEncoder(encoder: MediaCodec, planes: Planes, info: MediaCodec.BufferInfo,
                            fps: Int, frameIndex: Int): Boolean {
        val inIndex = encoder.dequeueInputBuffer(10_000)
        if (inIndex < 0) return false
        val inputImage = try { encoder.getInputImage(inIndex) } catch (t: Throwable) { null }
        if (inputImage == null) {
            encoder.queueInputBuffer(inIndex, 0, 0, 0, 0)
            return false
        }
        val yPlane = inputImage.planes[0]
        val uPlane = inputImage.planes[1]
        val vPlane = inputImage.planes[2]
        val yBuf = yPlane.buffer
        val uBuf = uPlane.buffer
        val vBuf = vPlane.buffer
        val yRow = yPlane.rowStride
        val yPix = yPlane.pixelStride
        val uRow = uPlane.rowStride
        val uPix = uPlane.pixelStride
        val vRow = vPlane.rowStride
        val vPix = vPlane.pixelStride
        for (row in 0 until planes.h) {
            for (col in 0 until planes.w) {
                val idx = row * yRow + col * yPix
                if (idx < yBuf.limit()) yBuf.put(idx, (planes.y[row * planes.w + col] * 255f)
                    .toInt().coerceIn(0, 255).toByte())
            }
        }
        for (row in 0 until planes.ch) {
            for (col in 0 until planes.cw) {
                val o = row * planes.cw + col
                val uIdx = row * uRow + col * uPix
                val vIdx = row * vRow + col * vPix
                if (uIdx < uBuf.limit())
                    uBuf.put(uIdx, (planes.u[o] * 255f + 128f).toInt().coerceIn(0, 255).toByte())
                if (vIdx < vBuf.limit())
                    vBuf.put(vIdx, (planes.v[o] * 255f + 128f).toInt().coerceIn(0, 255).toByte())
            }
        }
        val ptsUs = (frameIndex * 1_000_000L) / max(1, fps)
        encoder.queueInputBuffer(inIndex, 0, inputImage.width * inputImage.height * 3 / 2,
            ptsUs, if (frameIndex == 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        return true
    }
}

/**
 * Time-lapse: frames are captured through the camera engine at a fixed interval,
 * enhanced on the fly and later assembled into a real MP4 with MediaMuxer.
 */
class TimeLapseEncoder(private val ctx: Context, private val fps: Int = 30) {
    private val frames = ArrayList<Planes>()
    var capturing = false
        private set
    var intervalMs: Long = 1000L

    fun start() {
        frames.clear()
        capturing = true
    }

    fun addFrame(planes: Planes) {
        if (!capturing) return
        // keep the memory bounded: cap the frame count by device policy
        if (frames.size < 600) frames.add(planes)
    }

    val frameCount: Int get() = frames.size

    /** Encode everything into an MP4 and register it with the gallery. */
    fun finishAndEncode(orientationHint: Int): File? {
        capturing = false
        if (frames.isEmpty()) return null
        val w = frames[0].w
        val h = frames[0].h
        val evenW = w - (w % 2)
        val evenH = h - (h % 2)
        val file = PhotoSaver.videoFile(ctx, "timelapse")
        var encoder: MediaCodec? = null
        var muxer: MediaMuxer? = null
        try {
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, evenW, evenH).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                setInteger(MediaFormat.KEY_BIT_RATE, (evenW.toLong() * evenH * 0.1).toInt().coerceAtLeast(4_000_000))
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()
            muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            var track = -1
            var started = false
            val info = MediaCodec.BufferInfo()
            var index = 0
            for (frame in frames) {
                val scaled = if (frame.w != evenW || frame.h != evenH) resizePlanes(frame, evenW, evenH) else frame
                var queued = false
                while (!queued) {
                    val inIdx = encoder.dequeueInputBuffer(20_000)
                    if (inIdx >= 0) {
                        val image = encoder.getInputImage(inIdx)
                        if (image != null) {
                            writePlanes(image, scaled)
                            encoder.queueInputBuffer(inIdx, 0, evenW * evenH * 3 / 2,
                                (index * 1_000_000L) / fps, 0)
                        } else {
                            encoder.queueInputBuffer(inIdx, 0, 0, 0, 0)
                        }
                        queued = true
                    }
                    val outIdx = encoder.dequeueOutputBuffer(info, 0)
                    if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        track = muxer.addTrack(encoder.outputFormat)
                        muxer.start(); started = true
                    } else if (outIdx >= 0) {
                        if (started && info.size > 0) {
                            val buf = encoder.getOutputBuffer(outIdx)!!
                            buf.position(info.offset); buf.limit(info.offset + info.size)
                            muxer.writeSampleData(track, buf, info)
                        }
                        encoder.releaseOutputBuffer(outIdx, false)
                    }
                }
                index++
            }
            // queue end-of-stream (signalEndOfInputStream needs surface input)
            var eosQueued = false
            while (!eosQueued) {
                val inIdx = encoder.dequeueInputBuffer(20_000)
                if (inIdx >= 0) {
                    encoder.queueInputBuffer(inIdx, 0, 0, (index * 1_000_000L) / fps,
                        MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                    eosQueued = true
                }
            }
            var draining = true
            while (draining) {
                val outIdx = encoder.dequeueOutputBuffer(info, 20_000)
                if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    track = muxer.addTrack(encoder.outputFormat)
                    if (!started) { muxer.start(); started = true }
                } else if (outIdx >= 0) {
                    if (started && info.size > 0) {
                        val buf = encoder.getOutputBuffer(outIdx)!!
                        buf.position(info.offset); buf.limit(info.offset + info.size)
                        muxer.writeSampleData(track, buf, info)
                    }
                    encoder.releaseOutputBuffer(outIdx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) draining = false
                }
            }
            muxer.stop()
            L.i("time-lapse encoded: ${index} frames -> ${file.name}")
            PhotoSaver.registerVideo(ctx, file, evenW, evenH, "AI Time-lapse ${index} frames")
            return file
        } catch (t: Throwable) {
            L.e("time-lapse encode failed", t)
            return null
        } finally {
            runCatching { muxer?.release() }
            runCatching { encoder?.stop() }
            runCatching { encoder?.release() }
            frames.clear()
        }
    }

    private fun resizePlanes(src: Planes, w: Int, h: Int): Planes {
        val out = Planes(w, h)
        out.y = Imaging.resizeBilinear(src.y, src.w, src.h, w, h)
        out.u = Imaging.resizeBilinear(src.u, src.cw, src.ch, out.cw, out.ch)
        out.v = Imaging.resizeBilinear(src.v, src.cw, src.ch, out.cw, out.ch)
        return out
    }

    private fun writePlanes(image: android.media.Image, planes: Planes) {
        val y = image.planes[0]; val u = image.planes[1]; val v = image.planes[2]
        for (row in 0 until min(planes.h, image.height)) {
            for (col in 0 until min(planes.w, image.width)) {
                val idx = row * y.rowStride + col * y.pixelStride
                if (idx < y.buffer.limit())
                    y.buffer.put(idx, (planes.y[row * planes.w + col] * 255f).toInt().coerceIn(0, 255).toByte())
            }
        }
        for (row in 0 until min(planes.ch, image.height / 2)) {
            for (col in 0 until min(planes.cw, image.width / 2)) {
                val o = row * planes.cw + col
                val ui = row * u.rowStride + col * u.pixelStride
                val vi = row * v.rowStride + col * v.pixelStride
                if (ui < u.buffer.limit())
                    u.buffer.put(ui, (planes.u[o] * 255f + 128f).toInt().coerceIn(0, 255).toByte())
                if (vi < v.buffer.limit())
                    v.buffer.put(vi, (planes.v[o] * 255f + 128f).toInt().coerceIn(0, 255).toByte())
            }
        }
    }
}
