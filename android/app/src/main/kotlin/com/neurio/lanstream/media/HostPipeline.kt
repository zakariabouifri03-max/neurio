package com.neurio.lanstream.media

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.DisplayMetrics
import android.view.Surface
import android.view.WindowManager
import com.neurio.lanstream.core.AudioStatus
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.core.ResolutionTier
import com.neurio.lanstream.core.Settings

/**
 * Host media pipeline: VirtualDisplay -> hardware encoder -> network sink,
 * plus the (optional) playback-audio path.
 *
 *   MediaProjection ─┐
 *                    ├─ VirtualDisplay ──▶ encoder input Surface ──▶ H.264 ──▶ sink
 *   (mirrored screen)┘
 *
 *   AudioPlaybackCapture ──▶ AudioRecord ──▶ AAC encoder ──▶ sink
 *
 * No video frame ever passes through application memory: the mirrored screen is
 * rendered straight into the encoder's input surface, and only the small
 * compressed output buffers are handed to the network layer.
 */
class HostPipeline(
    private val context: Context,
    private val projection: MediaProjection,
    private val settings: Settings,
    startProfile: StreamProfile,
    private val sink: Sink,
    private val listener: Listener
) {
    interface Sink {
        fun sendVideo(
            payload: ByteArray,
            isConfig: Boolean,
            isKeyframe: Boolean,
            ptsUs: Long,
            captureWallMs: Long
        )

        fun sendAudio(payload: ByteArray, isConfig: Boolean, ptsUs: Long)
    }

    interface Listener {
        fun onEncoderReady(name: String, hardware: Boolean, profile: StreamProfile)
        fun onAudioStatus(status: AudioStatus, detail: String?)
        fun onError(message: String)
        fun onProfileChanged(profile: StreamProfile)
    }

    private val screenCapture = ScreenCapture(context, projection)

    private var profile: StreamProfile = startProfile
    private var tier: ResolutionTier = settings.resolution

    private var encoder: VideoEncoder? = null
    private var encoderSurface: Surface? = null
    private var audioCapture: AudioCapture? = null
    private var audioEncoder: AudioEncoder? = null
    private var audioThread: HandlerThread? = null

    @Volatile
    private var running = false

    @Volatile
    private var audioRunning = false

    @Volatile
    var lastConfig: Pair<ByteArray?, ByteArray?> = null to null
        private set

    val currentProfile: StreamProfile get() = profile

    fun start() {
        if (running) return
        running = true
        startVideo()
        startAudioIfEnabled()
    }

    // ------------------------------------------------------------------- video

    private fun startVideo() {
        val videoEncoder = VideoEncoder(
            profile = profile,
            lowLatency = settings.lowLatency,
            onOutput = { payload, isConfig, isKeyframe, ptsUs, captureWallMs ->
                if (isConfig) {
                    lastConfig = AnnexB.spsPps(
                        payload,
                        hevc = profile.mime.contains("hevc", true)
                    )
                }
                sink.sendVideo(payload, isConfig, isKeyframe, ptsUs, captureWallMs)
            },
            onError = { t -> listener.onError("Encoder error: ${t.message}") }
        )
        try {
            val surface = videoEncoder.start()
            encoderSurface = surface
            encoder = videoEncoder
            screenCapture.start(profile.width, profile.height, surface)
            listener.onEncoderReady(
                videoEncoder.encoderName,
                videoEncoder.hardwareAccelerated,
                profile
            )
        } catch (t: Throwable) {
            Log.e("Cannot start encoder", t)
            listener.onError("Cannot start encoder: ${t.message}")
            videoEncoder.stop()
        }
    }

    private fun stopVideo() {
        screenCapture.release()
        encoder?.stop()
        encoder = null
        encoderSurface = null
    }

    /** Called by the adaptive controller or when the user changes quality. */
    fun applyProfile(next: StreamProfile, nextTier: ResolutionTier = tier) {
        profile = next
        tier = nextTier
        stopVideo()
        startVideo()
        listener.onProfileChanged(next)
    }

    /** Recreates the virtual display after a rotation. */
    fun refreshDisplay() {
        val (screenW, screenH) = screenSize()
        val next = StreamProfile.compute(
            screenWidth = screenW,
            screenHeight = screenH,
            tier = tier,
            fpsMode = settings.fpsMode,
            preset = settings.bitratePreset,
            customBitrateMbps = settings.customBitrateMbps
        )
        if (next.width != profile.width || next.height != profile.height) {
            Log.i("Rotation changed capture size: ${profile.label()} -> ${next.label()}")
            applyProfile(next)
        } else {
            val surface = encoderSurface
            if (surface != null) screenCapture.resize(next.width, next.height, surface)
        }
    }

    fun requestKeyframe() {
        encoder?.requestKeyframe()
    }

    fun setBitrate(bitrateBps: Int) {
        encoder?.setBitrate(bitrateBps)
    }

    fun framesEncoded(): Long = encoder?.framesEncoded ?: 0L
    fun encoderName(): String = encoder?.encoderName ?: ""
    fun encoderHardware(): Boolean = encoder?.hardwareAccelerated ?: false

    // ------------------------------------------------------------------- audio

    private fun startAudioIfEnabled() {
        if (!settings.audioEnabled) {
            listener.onAudioStatus(AudioStatus.DISABLED, "disabled in settings")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            listener.onAudioStatus(
                AudioStatus.UNSUPPORTED_OS,
                "Android 10+ is required for playback capture"
            )
            return
        }
        val capture = AudioCapture(projection)
        if (!capture.start()) {
            listener.onAudioStatus(
                AudioStatus.FAILED,
                capture.failureReason ?: "AudioRecord could not be started"
            )
            return
        }
        val encoderInstance = AudioEncoder(
            sampleRate = capture.sampleRate,
            channelCount = capture.channelCount,
            bitrateBps = 128_000
        ) { payload, isConfig, ptsUs -> sink.sendAudio(payload, isConfig, ptsUs) }
        if (!encoderInstance.start()) {
            capture.stop()
            listener.onAudioStatus(AudioStatus.FAILED, "AAC encoder unavailable")
            return
        }
        audioCapture = capture
        audioEncoder = encoderInstance
        audioRunning = true
        listener.onAudioStatus(AudioStatus.STARTING, null)

        val thread = HandlerThread("neurio-audio").apply { start() }
        audioThread = thread
        Handler(thread.looper).post { audioLoop(capture, encoderInstance) }
    }

    private fun audioLoop(capture: AudioCapture, encoderInstance: AudioEncoder) {
        val buffer = ByteArray(4096)
        var silentSeconds = 0
        var lastCheckMs = System.currentTimeMillis()
        while (audioRunning) {
            val read = capture.read(buffer, buffer.size)
            if (read > 0) {
                encoderInstance.feed(buffer, read)
            } else if (read < 0) {
                break
            }
            val now = System.currentTimeMillis()
            if (now - lastCheckMs > 1_000) {
                lastCheckMs = now
                if (capture.silentReads > 20) {
                    silentSeconds++
                    if (silentSeconds == 3) {
                        listener.onAudioStatus(
                            AudioStatus.BLOCKED,
                            "the game does not allow audio capture (silence only)"
                        )
                    }
                } else if (capture.silentReads == 0) {
                    silentSeconds = 0
                    listener.onAudioStatus(AudioStatus.CAPTURING, null)
                }
            }
        }
        encoderInstance.stop()
        capture.stop()
        Log.i("Audio capture loop finished")
    }

    // ------------------------------------------------------------------ common

    /** Real screen size in the current orientation. */
    fun screenSize(): Pair<Int, Int> {
        val metrics = DisplayMetrics()
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        if (wm != null) {
            runCatching {
                @Suppress("DEPRECATION")
                wm.defaultDisplay.getRealMetrics(metrics)
            }
        }
        val width = metrics.widthPixels.takeIf { it > 0 } ?: profile.width
        val height = metrics.heightPixels.takeIf { it > 0 } ?: profile.height
        return width to height
    }

    fun stop() {
        running = false
        audioRunning = false
        stopVideo()
        audioThread?.quitSafely()
        audioThread = null
        audioCapture = null
        audioEncoder = null
        screenCapture.release()
    }

    companion object {
        /** Builds the profile that fits the real screen for the given settings. */
        fun profileFor(context: Context, settings: Settings): StreamProfile {
            val metrics = DisplayMetrics()
            val wm = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            if (wm != null) {
                runCatching {
                    @Suppress("DEPRECATION")
                    wm.defaultDisplay.getRealMetrics(metrics)
                }
            }
            val width = metrics.widthPixels.takeIf { it > 0 } ?: 1920
            val height = metrics.heightPixels.takeIf { it > 0 } ?: 1080
            return StreamProfile.from(settings, width, height)
        }

        fun displayListener(onChanged: () -> Unit): DisplayManager.DisplayListener =
            object : DisplayManager.DisplayListener {
                override fun onDisplayAdded(displayId: Int) = Unit
                override fun onDisplayRemoved(displayId: Int) = Unit
                override fun onDisplayChanged(displayId: Int) = onChanged()
            }
    }
}
