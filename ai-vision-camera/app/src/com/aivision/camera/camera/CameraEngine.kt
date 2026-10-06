package com.aivision.camera.camera

import android.content.Context
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureFailure
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.Face
import android.hardware.camera2.params.MeteringRectangle
import android.media.Image
import android.media.ImageReader
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Range
import android.util.Size
import android.view.Surface
import com.aivision.camera.core.L
import com.aivision.camera.core.M
import com.aivision.camera.core.Work
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/** Running modes of the camera engine. */
enum class CaptureMode { PHOTO, VIDEO, PRO, NIGHT, AI, SLOW_MOTION, TIME_LAPSE, PANORAMA, DOCUMENT, PORTRAIT }

enum class FlashMode { OFF, AUTO, ON, TORCH }

/** Live statistics of the running camera - shown in the AI HUD. */
data class CameraStatus(
    val lens: LensInfo?,
    val previewSize: Size,
    val captureSize: Size,
    val zoom: Float,
    val hardwareZoom: Float,
    val effectiveFocal: Float,
    val iso: Int,
    val exposureNs: Long,
    val fps: Int,
    val faces: Int,
    val afLocked: Boolean,
    val aeLocked: Boolean,
    val aiActive: Boolean,
)

/** Everything the camera can be told to do; implemented by the engine. */
interface CameraController {
    fun setZoom(zoom: Float)
    fun tapToFocus(x: Float, y: Float)
    fun setFlash(mode: FlashMode)
    fun setEv(ev: Int)
    fun setManualExposure(iso: Int, exposureNs: Long)
    fun setManualFocus(diopters: Float)
    fun setManualWhiteBalance(kelvin: Int)
    fun setManualEnabled(enabled: Boolean)
    fun setStabilization(enabled: Boolean)
    fun setTargetFps(fps: Int)
    fun setTorch(on: Boolean)
    /** Macro focus mode: the lens keeps hunting close instead of to infinity. */
    fun setMacroFocus(enabled: Boolean)
}

/**
 * Camera2 engine: opens real camera hardware, owns the capture session, streams
 * preview + analysis frames and performs still/video/burst captures.
 *
 * Design notes
 *  - one session per configuration, rebuilt when the surface set changes
 *  - YUV_420_888 frames feed the AI pipeline (we never re-encode camera JPEGs)
 *  - hardware zoom is used first, AI super-resolution covers the rest
 *  - every hardware call is guarded: unsupported features degrade, never crash
 */
class CameraEngine(
    private val context: Context,
    private val registry: CameraRegistry,
    private val callback: Callback,
) : CameraController {

    interface Callback {
        fun onCameraReady(lens: LensInfo, previewSize: Size, captureSize: Size)
        fun onStatus(status: CameraStatus)
        /** A captured frame that the AI pipeline should consume. */
        fun onFrameForProcessing(image: Image, lens: LensInfo, result: CaptureResult?)
        fun onBurstFrame(image: Image, index: Int, total: Int, lens: LensInfo)
        fun onBurstDone(count: Int, lens: LensInfo)
        fun onVideoEvent(event: String, extra: Long)
        fun onError(message: String)
        fun onAnalysisFrame(luma: ByteArray, width: Int, height: Int, stride: Int, faces: List<Rect>)
    }

    // ------------------------------------------------------------------ state
    private val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var highSpeedSession: CameraConstrainedHighSpeedCaptureSession? = null
    private var characteristics: CameraCharacteristics? = null
    private var lens: LensInfo? = null
    private var mode = CaptureMode.PHOTO

    private var previewTexture: SurfaceTexture? = null
    private var previewSurface: Surface? = null
    private var recorderSurface: Surface? = null
    private var jpegReader: ImageReader? = null
    private var yuvReader: ImageReader? = null
    private var rawReader: ImageReader? = null
    private var depthReader: ImageReader? = null
    private var analysisReader: ImageReader? = null

    private var previewSize = Size(1920, 1080)
    private var captureSize = Size(4000, 3000)
    private var analysisSize = Size(320, 240)

    private var zoom = 1f
    private var flash = FlashMode.OFF
    private var ev = 0
    private var manual = false
    private var manualIso = 0
    private var manualExposure = 0L
    private var manualFocus = -1f         // diopters, <0 = auto
    private var manualKelvin = 0          // 0 = auto WB
    private var stabilization = true
    private var targetFps = 30

    // burst bookkeeping
    private val bursting = AtomicBoolean(false)
    private var burstTotal = 0
    private var burstIndex = 0
    private var burstEv = listOf<Int>()
    private var burstManualExposure = 0L
    private var burstManualIso = 0
    private var burstSingle = false
    private var wantRawForNext = false
    private var recording = false
    private var highSpeedActive = false
    private var rawStreamEnabled = false

    private var lastStatusAt = 0L
    private var faceRects: List<Rect> = emptyList()
    private var lastFaces: List<Rect> = emptyList()

    /**
     * `CaptureResult.STATISTICS_FACE_RECTANGLES` - resolved reflectively: the
     * compile-time platform stubs omit this array-valued face key (it exists on
     * every shipped Android). Null means "ask the software detector instead".
     */
    private val faceRectsKey: CaptureResult.Key<Array<Rect>>? = try {
        @Suppress("UNCHECKED_CAST")
        CaptureResult::class.java
            .getField("STATISTICS_FACE_RECTANGLES")
            .get(null) as? CaptureResult.Key<Array<Rect>>
    } catch (t: Throwable) {
        L.d("face rectangles key unavailable: ${t.message}")
        null
    }

    private fun readFaces(result: CaptureResult): List<Rect> {
        val key = faceRectsKey ?: return emptyList()
        return try {
            result.get(key)?.toList() ?: emptyList()
        } catch (t: Throwable) {
            emptyList()
        }
    }

    private val thread = HandlerThread("aiv-camera").apply { start() }
    private val handler = Handler(thread.looper)
    val handlerThread: HandlerThread get() = thread

    private val sensorOrientation: Int
        get() = characteristics?.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90

    val currentZoom get() = zoom
    val currentLens get() = lens
    val currentMode get() = mode

    // ------------------------------------------------------------- public API
    fun start(previewTarget: SurfaceTexture, targetWidth: Int, targetHeight: Int, mode: CaptureMode) {
        this.mode = mode
        this.previewTexture = previewTarget
        previewSurface?.let { runCatching { it.release() } }
        previewSurface = Surface(previewTarget)
        configureSizes(targetWidth, targetHeight)
        openCamera()
    }

    /** Reconfigure for another mode (video, slow motion, raw stills, ...). */
    fun switchMode(newMode: CaptureMode) {
        if (newMode == mode) return
        mode = newMode
        closeSession()
        configureSizes(previewSize.width, previewSize.height)
        createSession()
    }

    fun setRecorderSurface(surface: Surface?) {
        recorderSurface = surface
        closeSession()
        createSession()
    }

    fun setHighSpeedProfile(size: Size, fps: Int): Boolean {
        val l = lens ?: return false
        val fpsRange = l.highSpeedFps.firstOrNull { it.upper >= fps } ?: return false
        highSpeedRequested = fps
        highSpeedSize = size
        highSpeedRange = fpsRange
        return true
    }

    /**
     * Ceiling for the still/burst stream, in pixels. The AI pipeline works on
     * 32-bit float planes (~6 bytes per pixel once chroma is counted), so a naive
     * 24 MP burst of 12 frames would ask for ~1.7 GB and be killed by the OS.
     * The cap is derived from the real heap in MainActivity and applied here.
     */
    private var processCapPixels: Long = 12_000_000L

    fun setProcessCap(pixels: Long) {
        val clamped = pixels.coerceIn(1_500_000L, 24_000_000L)
        if (clamped == processCapPixels) return
        processCapPixels = clamped
        if (device != null) {
            closeSession()
            configureSizes(previewSize.width, previewSize.height)
            createSession()
        }
    }

    private var highSpeedRequested = 0
    private var highSpeedSize: Size? = null
    private var highSpeedRange: Range<Int>? = null

    fun requestStillCapture(single: Boolean = true, raw: Boolean = false) {
        burstSingle = single
        wantRawForNext = raw
        burstTotal = 1
        burstIndex = 0
        bursting.set(true)
        issueBurstFrame()
    }

    /**
     * Burst capture used by the AI multi-frame pipeline.
     * @param count how many frames
     * @param evSequence exposure compensation per frame (may be empty)
     * @param iso/nanoseconds optional manual exposure for night mode
     */
    fun requestBurstCapture(count: Int, evSequence: List<Int> = emptyList(),
                            iso: Int = 0, nanoseconds: Long = 0L) {
        burstSingle = false
        burstTotal = count.coerceIn(1, 24)
        burstIndex = 0
        burstEv = evSequence
        burstManualExposure = nanoseconds
        burstManualIso = iso
        bursting.set(true)
        issueBurstFrame()
    }

    fun cancelBurst() {
        bursting.set(false)
        burstTotal = 0
    }

    fun takeAnalysisSnapshotNow() { /* analysis is continuous */ }

    // ----------------------------------------------------------------- opening
    private fun configureSizes(width: Int, height: Int) {
        val group = registry.group(if (isFront) CameraMetadata.LENS_FACING_FRONT else CameraMetadata.LENS_FACING_BACK)
            ?: registry.groups.values.firstOrNull()
        val l = lens ?: group?.lensFor(zoom) ?: return
        lens = l

        val previewCandidates = l.previewSizes.filter { it.width <= 1920 && it.height <= 1080 }
        previewSize = SizePick.best(previewCandidates.ifEmpty { l.previewSizes }, width, height, 1920, 1080)

        val maxPixels = when (mode) {
            CaptureMode.SLOW_MOTION, CaptureMode.VIDEO -> 1920L * 1080L
            CaptureMode.TIME_LAPSE -> 3840L * 2160L
            else -> minOf(24_000_000L, processCapPixels)
        }
        captureSize = SizePick.largest(l.yuvSizes, maxPixels) ?: Size(1920, 1080)

        analysisSize = SizePick.best(l.yuvSizes, 4, 3, 640, 480)
    }

    private var isFront = false
    private var forcedLens: LensInfo? = null
    private var macroFocus = false

    /**
     * Pin the session to one physical lens - used by macro (the wide lens is
     * usually the only one that focuses close) and by the lens chips. The pin is
     * dropped as soon as the user zooms somewhere that lens cannot serve.
     */
    fun useLens(l: LensInfo) {
        forcedLens = l
        isFront = l.facing == CameraMetadata.LENS_FACING_FRONT
        lens = l
        zoom = l.nativeZoom.coerceIn(0.5f, 100f)
        openCamera(isFront)
    }

    fun clearLensOverride() {
        forcedLens = null
    }

    override fun setMacroFocus(enabled: Boolean) {
        macroFocus = enabled
        applyAllControls()
    }

    val isMacroFocus get() = macroFocus

    fun openCamera(useFront: Boolean? = null) {
        useFront?.let { isFront = it }
        closeCamera()
        val facing = if (isFront) CameraMetadata.LENS_FACING_FRONT else CameraMetadata.LENS_FACING_BACK
        val group = registry.group(facing) ?: registry.groups.values.firstOrNull()
        if (group == null) {
            callback.onError("No camera available on this device")
            return
        }
        val chosen = forcedLens?.takeIf { it.facing == facing }
            ?: group.lensFor(zoom.coerceAtLeast(1f))
        lens = chosen
        safe("choosing stream sizes") { configureSizes(previewSize.width, previewSize.height) }
        try {
            characteristics = cameraManager.getCameraCharacteristics(chosen.id)
            @Suppress("MissingPermission")
            cameraManager.openCamera(chosen.id, stateCallback, handler)
        } catch (t: SecurityException) {
            safe("reporting permission error") { callback.onError("Camera permission denied") }
        } catch (t: Throwable) {
            L.e("openCamera failed", t)
            callback.onError("Cannot open camera ${chosen.id}: ${t.message}")
        }
    }

    fun isFrontFacing() = isFront

    private val stateCallback = object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
            L.i("camera ${camera.id} opened")
            device = camera
            safe("creating the capture session") { createSession() }
        }

        override fun onDisconnected(camera: CameraDevice) {
            L.w("camera disconnected")
            camera.close()
            if (device === camera) device = null
            safe("reporting disconnect") { callback.onError("Camera disconnected") }
        }

        override fun onError(camera: CameraDevice, error: Int) {
            L.e("camera error $error")
            camera.close()
            if (device === camera) device = null
            safe("reporting camera error") { callback.onError("Camera error ${errorName(error)}") }
        }
    }

    private fun errorName(error: Int) = when (error) {
        CameraDevice.StateCallback.ERROR_CAMERA_IN_USE -> "in use"
        CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE -> "too many cameras in use"
        CameraDevice.StateCallback.ERROR_CAMERA_DISABLED -> "disabled by policy"
        CameraDevice.StateCallback.ERROR_CAMERA_DEVICE -> "device failure"
        CameraDevice.StateCallback.ERROR_CAMERA_SERVICE -> "service failure"
        else -> "code $error"
    }

    /**
     * Camera callbacks are invoked from the camera service's binder thread, from
     * the ImageReader handlers and from the main thread. An exception escaping any
     * of them kills the process, so every entry point is wrapped here rather than
     * trusting each call site.
     */
    private inline fun safe(where: String, body: () -> Unit) {
        try {
            body()
        } catch (t: Throwable) {
            L.e("$where failed", t)
        }
    }

    // ----------------------------------------------------------------- sessions
    private fun prepareReaders() {
        closeReaders()
        val l = lens ?: return
        // Capture reader: YUV for the AI pipeline
        yuvReader = ImageReader.newInstance(captureSize.width, captureSize.height, ImageFormat.YUV_420_888, 3)
        yuvReader?.setOnImageAvailableListener({ reader ->
            val image = try { reader.acquireLatestImage() } catch (t: Throwable) { null } ?: return@setOnImageAvailableListener
            try {
                if (bursting.get()) {
                    val idx = burstIndex
                    burstIndex++
                    callback.onBurstFrame(image, idx, burstTotal, l)
                    if (burstIndex >= burstTotal) {
                        bursting.set(false)
                        callback.onBurstDone(burstTotal, l)
                    } else {
                        issueBurstFrame()
                    }
                } else {
                    callback.onFrameForProcessing(image, l, lastResult)
                }
            } catch (t: Throwable) {
                L.w("frame handling failed: ${t.message}")
            } finally {
                runCatching { image.close() }
            }
        }, handler)

        if (rawStreamEnabled || wantRawForNext) {
            val rawSize = l.bestRawSize
            if (rawSize != null && l.supportsRaw) {
                rawReader = ImageReader.newInstance(rawSize.width, rawSize.height, ImageFormat.RAW_SENSOR, 2)
                rawReader?.setOnImageAvailableListener({ reader ->
                    val image = try { reader.acquireLatestImage() } catch (t: Throwable) { null }
                    if (image != null) {
                        try { callback.onFrameForProcessing(image, l, lastResult) }
                        finally { runCatching { image.close() } }
                    }
                }, handler)
            }
        }

        if (l.supportsDepth && (mode == CaptureMode.PORTRAIT || mode == CaptureMode.AI)) {
            val depthSize = l.depthSizes.maxByOrNull { it.width.toLong() * it.height }
            if (depthSize != null) {
                try {
                    depthReader = ImageReader.newInstance(depthSize.width, depthSize.height, ImageFormat.DEPTH16, 2)
                    depthReader?.setOnImageAvailableListener({ reader ->
                        val image = try { reader.acquireLatestImage() } catch (t: Throwable) { null }
                        if (image != null) {
                            try { callback.onFrameForProcessing(image, l, lastResult) }
                            finally { runCatching { image.close() } }
                        }
                    }, handler)
                } catch (t: Throwable) { L.w("depth stream unavailable: ${t.message}") }
            }
        }

        // Small analysis reader for scene detection (cheap, always on)
        analysisReader = ImageReader.newInstance(analysisSize.width, analysisSize.height, ImageFormat.YUV_420_888, 2)
        val analysisCounter = intArrayOf(0)
        analysisReader?.setOnImageAvailableListener({ reader ->
            val image = try { reader.acquireLatestImage() } catch (t: Throwable) { null } ?: return@setOnImageAvailableListener
            try {
                analysisCounter[0]++
                if (analysisCounter[0] % 3 == 0) {
                    val plane = image.planes[0]
                    val buf = plane.buffer
                    val bytes = ByteArray(buf.remaining())
                    buf.get(bytes)
                    callback.onAnalysisFrame(bytes, image.width, image.height, plane.rowStride, lastFaces)
                }
            } catch (t: Throwable) {
                L.d("analysis frame dropped: ${t.message}")
            } finally {
                runCatching { image.close() }
            }
        }, handler)
    }

    private fun closeReaders() {
        listOf(yuvReader, rawReader, depthReader, analysisReader, jpegReader).forEach {
            runCatching { it?.close() }
        }
        yuvReader = null; rawReader = null; depthReader = null
        analysisReader = null; jpegReader = null
    }

    private fun createSession() {
        val dev = device ?: return
        val preview = previewSurface ?: return
        prepareReaders()

        val surfaces = mutableListOf<Surface>(preview)
        yuvReader?.surface?.let { surfaces += it }
        analysisReader?.surface?.let { surfaces += it }
        rawReader?.surface?.let { surfaces += it }
        depthReader?.surface?.let { surfaces += it }
        recorderSurface?.let { surfaces += it }

        val hs = highSpeedRange
        if (highSpeedActive && hs != null && recorderSurface != null) {
            createHighSpeedSession(dev, surfaces, hs)
            return
        }

        try {
            dev.createCaptureSession(surfaces, sessionCallback, handler)
        } catch (t: Throwable) {
            L.e("createCaptureSession failed", t)
            callback.onError("Unable to start preview: ${t.message}")
        }
    }

    private fun createHighSpeedSession(dev: CameraDevice, surfaces: List<Surface>, range: Range<Int>) {
        try {
            dev.createConstrainedHighSpeedCaptureSession(surfaces, object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(s: CameraCaptureSession) {
                    session = s
                    (s as? CameraConstrainedHighSpeedCaptureSession)?.let { hs ->
                        highSpeedSession = hs
                        try {
                            val req = buildRequest(CameraDevice.TEMPLATE_RECORD)
                            req.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
                            val list = hs.createHighSpeedRequestList(req.build())
                            hs.setRepeatingBurst(list, captureCallback, handler)
                            callback.onVideoEvent("high-speed-ready", range.upper.toLong())
                        } catch (t: Throwable) {
                            callback.onError("High-speed session failed: ${t.message}")
                        }
                    }
                }

                override fun onConfigureFailed(s: CameraCaptureSession) {
                    safe("reporting high-speed failure") {
                        callback.onError("High-speed configuration failed")
                    }
                }
            }, handler)
        } catch (t: Throwable) {
            L.e("high speed session failed", t)
            callback.onError("Slow motion not supported on this camera: ${t.message}")
        }
    }

    private val sessionCallback = object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(s: CameraCaptureSession) {
            session = s
            safe("starting the preview") {
                val l = lens
                if (l != null) callback.onCameraReady(l, previewSize, captureSize)
                startRepeating()
                applyAllControls()
            }
        }

        override fun onConfigureFailed(s: CameraCaptureSession) {
            L.e("session configure failed")
            safe("reporting configure failure") {
                callback.onError("Camera configuration failed - trying a simpler setup")
            }
            // one retry with the bare minimum (preview + capture)
            safe("retrying a simpler session") {
                val dev = device ?: return@safe
                val preview = previewSurface ?: return@safe
                val basic = mutableListOf(preview)
                yuvReader?.surface?.let { basic += it }
                dev.createCaptureSession(basic, this, handler)
            }
        }
    }

    private fun closeSession() {
        runCatching { session?.close() }
        session = null
        highSpeedSession = null
    }

    fun closeCamera() {
        closeSession()
        runCatching { device?.close() }
        device = null
        closeReaders()
    }

    fun release() {
        closeCamera()
        runCatching { previewSurface?.release() }
        previewSurface = null
        runCatching { thread.quitSafely() }
    }

    // ----------------------------------------------------------------- requests
    private var lastResult: CaptureResult? = null

    private fun buildRequest(template: Int): CaptureRequest.Builder {
        val dev = device ?: throw IllegalStateException("camera closed")
        val builder = dev.createCaptureRequest(template)
        previewSurface?.let { builder.addTarget(it) }
        yuvReader?.surface?.let { builder.addTarget(it) }
        rawReader?.surface?.let { builder.addTarget(it) }
        depthReader?.surface?.let { builder.addTarget(it) }
        analysisReader?.surface?.let { builder.addTarget(it) }
        recorderSurface?.let { builder.addTarget(it) }
        return builder
    }

    private fun startRepeating() {
        val s = session ?: return
        try {
            val template = when (mode) {
                CaptureMode.VIDEO, CaptureMode.SLOW_MOTION, CaptureMode.TIME_LAPSE -> CameraDevice.TEMPLATE_RECORD
                else -> CameraDevice.TEMPLATE_PREVIEW
            }
            val req = buildRequest(template)
            applyControls(req)
            s.setRepeatingRequest(req.build(), captureCallback, handler)
        } catch (t: Throwable) {
            L.w("repeating request failed: ${t.message}")
        }
    }

    /** Apply every user-facing control to a request builder. */
    private fun applyControls(req: CaptureRequest.Builder) {
        val ch = characteristics ?: return
        val l = lens ?: return

        // ---- zoom (hardware crop) --------------------------------------------
        applyZoom(req, l)
        // ---- focus ------------------------------------------------------------
        if (manual && manualFocus >= 0f) {
            req.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
            req.set(CaptureRequest.LENS_FOCUS_DISTANCE, manualFocus.coerceAtMost(l.minFocusDistance))
        } else if (macroFocus && l.afModes.contains(CaptureRequest.CONTROL_AF_MODE_MACRO)) {
            // close-range AF: keeps the lens from jumping back to infinity
            req.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_MACRO)
        } else if (l.afModes.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)) {
            req.set(CaptureRequest.CONTROL_AF_MODE,
                if (mode == CaptureMode.VIDEO || mode == CaptureMode.SLOW_MOTION)
                    CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO
                else CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
        }

        // ---- exposure ---------------------------------------------------------
        if (manual && (manualIso > 0 || manualExposure > 0L)) {
            req.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
            if (manualIso > 0) req.set(CaptureRequest.SENSOR_SENSITIVITY, manualIso)
            if (manualExposure > 0L) req.set(CaptureRequest.SENSOR_EXPOSURE_TIME, manualExposure)
        } else {
            req.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            req.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, ev)
        }

        // ---- white balance ----------------------------------------------------
        if (manual && manualKelvin > 0) {
            req.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_OFF)
            val gains = kelvinToGains(manualKelvin)
            req.set(CaptureRequest.COLOR_CORRECTION_MODE, CaptureRequest.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX)
            req.set(CaptureRequest.COLOR_CORRECTION_GAINS,
                android.hardware.camera2.params.RggbChannelVector(
                    gains[0], gains[1], gains[1], gains[2]))
        } else {
            req.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
        }

        // ---- flash ------------------------------------------------------------
        when (flash) {
            FlashMode.OFF -> req.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            FlashMode.ON -> {
                req.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON_ALWAYS_FLASH)
                req.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_SINGLE)
            }
            FlashMode.AUTO -> req.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON_AUTO_FLASH)
            FlashMode.TORCH -> req.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_TORCH)
        }

        // ---- stabilisation ----------------------------------------------------
        val oisAvailable = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)
            ?.contains(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_ON) == true
        if (stabilization && oisAvailable) {
            req.set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE,
                CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_ON)
        }
        val eisAvailable = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES)
            ?.contains(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_ON) == true
        if (stabilization && eisAvailable && (mode == CaptureMode.VIDEO || mode == CaptureMode.SLOW_MOTION)) {
            req.set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE,
                CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_ON)
        }

        // ---- frame rate -------------------------------------------------------
        if (mode == CaptureMode.VIDEO || mode == CaptureMode.SLOW_MOTION) {
            val range = chooseFpsRange(l, targetFps)
            if (range != null) req.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
        }

        // ---- face detection ---------------------------------------------------
        val faceModes = ch.get(CameraCharacteristics.STATISTICS_INFO_AVAILABLE_FACE_DETECT_MODES)
        if (faceModes?.contains(CaptureRequest.STATISTICS_FACE_DETECT_MODE_SIMPLE) == true) {
            req.set(CaptureRequest.STATISTICS_FACE_DETECT_MODE, CaptureRequest.STATISTICS_FACE_DETECT_MODE_SIMPLE)
        }

        // ---- zoom ratio (modern path) ----------------------------------------
        if (Build.VERSION.SDK_INT >= 30 && l.zoomRatioRange != null) {
            req.set(CaptureRequest.CONTROL_ZOOM_RATIO, currentHardwareZoom(l))
        }
    }

    private fun applyZoom(req: CaptureRequest.Builder, l: LensInfo) {
        val hardware = currentHardwareZoom(l)
        if (Build.VERSION.SDK_INT >= 30 && l.zoomRatioRange != null) {
            req.set(CaptureRequest.CONTROL_ZOOM_RATIO, hardware)
        } else {
            val active = l.activeArray
            val cropW = (active.width() / hardware).roundToInt().coerceAtLeast(16)
            val cropH = (active.height() / hardware).roundToInt().coerceAtLeast(16)
            val cx = active.centerX(); val cy = active.centerY()
            val crop = Rect(
                (cx - cropW / 2).coerceIn(active.left, active.right - cropW),
                (cy - cropH / 2).coerceIn(active.top, active.bottom - cropH),
                (cx - cropW / 2).coerceIn(active.left, active.right - cropW) + cropW,
                (cy - cropH / 2).coerceIn(active.top, active.bottom - cropH) + cropH,
            )
            req.set(CaptureRequest.SCALER_CROP_REGION, crop)
        }
    }

    /** Hardware zoom is capped by the device; the rest is AI super-resolution. */
    fun currentHardwareZoom(l: LensInfo? = lens): Float {
        val info = l ?: return 1f
        val digital = zoom / info.nativeZoom
        return digital.coerceIn(1f, max(1f, info.hardwareMaxZoom))
    }

    fun aiZoomFactor(): Float {
        val l = lens ?: return 1f
        val hardware = currentHardwareZoom(l)
        val total = zoom
        return (total / (l.nativeZoom * hardware)).coerceAtLeast(1f)
    }

    private fun chooseFpsRange(l: LensInfo, fps: Int): Range<Int>? {
        val candidates = l.fpsRanges.filter { it.upper >= fps }
        return candidates.minByOrNull { abs(it.upper - fps) } ?: l.fpsRanges.firstOrNull()
    }

    /**
     * Manual white balance: approximate a black-body spectrum for the requested
     * Kelvin and convert it into relative R/G/B channel gains.
     */
    private fun kelvinToGains(kelvin: Int): FloatArray {
        val t = M.clamp(kelvin.toFloat() / 100f, 20f, 150f)
        val r: Float
        val g: Float
        val b: Float
        if (t <= 66f) {
            r = 255f
            g = 99.4708f * kotlin.math.ln(t).toFloat() - 161.1196f
            b = if (t <= 19f) 0f else 138.5177f * kotlin.math.ln(t - 10f).toFloat() - 305.0448f
        } else {
            r = 329.6987f * (t - 60f).toDouble().pow(-0.1332).toFloat()
            g = 288.1222f * (t - 60f).toDouble().pow(-0.0755).toFloat()
            b = 255f
        }
        val rn = M.clamp(r / 255f, 0.05f, 6f)
        val gn = M.clamp(g / 255f, 0.05f, 6f)
        val bn = M.clamp(b / 255f, 0.05f, 6f)
        val norm = M.clamp(gn, 0.05f, 6f)
        return floatArrayOf(rn / norm, 1f, bn / norm)
    }

    fun applyAllControls() {
        val s = session ?: return
        try {
            val template = when (mode) {
                CaptureMode.VIDEO, CaptureMode.SLOW_MOTION, CaptureMode.TIME_LAPSE -> CameraDevice.TEMPLATE_RECORD
                else -> CameraDevice.TEMPLATE_PREVIEW
            }
            val req = buildRequest(template)
            applyControls(req)
            s.setRepeatingRequest(req.build(), captureCallback, handler)
        } catch (t: Throwable) {
            L.d("applyAllControls: ${t.message}")
        }
    }

    private val captureCallback = object : CameraCaptureSession.CaptureCallback() {
        override fun onCaptureCompleted(s: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
            lastResult = result
            val faces = readFaces(result)
            lastFaces = faces
            faceRects = faces
            val now = System.currentTimeMillis()
            if (now - lastStatusAt > 350) {
                lastStatusAt = now
                emitStatus(result, faces.size)
            }
        }

        override fun onCaptureFailed(s: CameraCaptureSession, request: CaptureRequest, failure: CaptureFailure) {
            L.w("capture failed reason=${failure.reason}")
            if (bursting.get()) {
                bursting.set(false)
                callback.onError("Capture interrupted")
            }
        }
    }

    private fun emitStatus(result: CaptureResult, faces: Int) {
        val l = lens ?: return
        val iso = result.get(CaptureResult.SENSOR_SENSITIVITY) ?: manualIso
        val exposure = result.get(CaptureResult.SENSOR_EXPOSURE_TIME) ?: manualExposure
        val fpsRange = result.get(CaptureResult.CONTROL_AE_TARGET_FPS_RANGE)
        val af = result.get(CaptureResult.CONTROL_AF_STATE)
        val afLocked = af == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED ||
            af == CaptureResult.CONTROL_AF_STATE_PASSIVE_FOCUSED
        val ae = result.get(CaptureResult.CONTROL_AE_STATE)
        val aeLocked = ae == CaptureResult.CONTROL_AE_STATE_CONVERGED || ae == CaptureResult.CONTROL_AE_STATE_LOCKED
        callback.onStatus(
            CameraStatus(
                lens = l, previewSize = previewSize, captureSize = captureSize, zoom = zoom,
                hardwareZoom = currentHardwareZoom(l),
                effectiveFocal = l.equivFocal * zoom,
                iso = iso ?: 0, exposureNs = exposure ?: 0L,
                fps = fpsRange?.upper ?: targetFps, faces = faces,
                afLocked = afLocked, aeLocked = aeLocked, aiActive = zoom > max(2f, l.nativeZoom * 2f),
            )
        )
    }

    // ------------------------------------------------------------------ capture
    private fun issueBurstFrame() {
        val s = session ?: return
        val dev = device ?: return
        try {
            val req = buildRequest(
                if (mode == CaptureMode.VIDEO || mode == CaptureMode.SLOW_MOTION) CameraDevice.TEMPLATE_RECORD
                else CameraDevice.TEMPLATE_STILL_CAPTURE
            )
            applyControls(req)
            req.set(CaptureRequest.JPEG_ORIENTATION, jpegOrientation())
            // per-frame exposure for bracketing / night stacking
            if (burstEv.isNotEmpty()) {
                val idx = (burstIndex - 1).coerceIn(0, burstEv.size - 1)
                req.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, burstEv[idx])
            }
            if (burstManualExposure > 0L || burstManualIso > 0) {
                req.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
                if (burstManualIso > 0) req.set(CaptureRequest.SENSOR_SENSITIVITY, burstManualIso)
                if (burstManualExposure > 0L) req.set(CaptureRequest.SENSOR_EXPOSURE_TIME, burstManualExposure)
            }
            if (burstSingle) {
                req.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
            }
            s.capture(req.build(), captureCallback, handler)
        } catch (t: Throwable) {
            L.e("capture failed", t)
            bursting.set(false)
            callback.onError("Capture failed: ${t.message}")
        }
    }

    fun jpegOrientation(): Int {
        val sensor = sensorOrientation
        val deviceRotation = rotationDegrees()
        return when (deviceRotation) {
            90 -> (sensor + 270) % 360
            270 -> (sensor + 90) % 360
            180 -> (sensor + 180) % 360
            else -> sensor % 360
        }
    }

    private fun rotationDegrees(): Int = try {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
        when (wm.defaultDisplay.rotation) {
            Surface.ROTATION_90 -> 90
            Surface.ROTATION_180 -> 180
            Surface.ROTATION_270 -> 270
            else -> 0
        }
    } catch (t: Throwable) { 0 }

    // ------------------------------------------------------------ CameraController
    override fun setZoom(newZoom: Float) {
        val clamped = newZoom.coerceIn(0.5f, 100f)
        forcedLens?.let { pinned ->
            if (kotlin.math.abs(clamped - pinned.nativeZoom) > pinned.nativeZoom * 0.35f) forcedLens = null
        }
        val group = if (isFront) registry.frontGroup else registry.backGroup
        val candidate = group?.lensFor(clamped) ?: return
        val current = lens
        // only pay the cost of switching physical cameras when it is clearly better
        val l = if (current != null && candidate.id != current.id &&
            candidate.nativeZoom < current.nativeZoom * 1.5f &&
            candidate.nativeZoom > current.nativeZoom * 0.65f) current else candidate
        val lensChanged = l.id != lens?.id
        zoom = clamped
        if (lensChanged) {
            // optical switch: reopen on the better lens and keep the zoom factor
            lens = l
            characteristics = try { cameraManager.getCameraCharacteristics(l.id) } catch (t: Throwable) { characteristics }
            openCamera(isFront)
        } else {
            applyAllControls()
        }
    }

    override fun tapToFocus(x: Float, y: Float) {
        val s = session ?: return
        val l = lens ?: return
        try {
            val active = l.activeArray
            val hw = currentHardwareZoom(l)
            val cropW = (active.width() / hw).roundToInt()
            val cropH = (active.height() / hw).roundToInt()
            val left = active.centerX() - cropW / 2
            val top = active.centerY() - cropH / 2
            val px = (left + x.coerceIn(0f, 1f) * cropW).roundToInt().coerceIn(active.left, active.right - 1)
            val py = (top + y.coerceIn(0f, 1f) * cropH).roundToInt().coerceIn(active.top, active.bottom - 1)
            val half = (min(cropW, cropH) * 0.08f).roundToInt().coerceAtLeast(20)
            val rect = Rect((px - half).coerceAtLeast(active.left), (py - half).coerceAtLeast(active.top),
                (px + half).coerceAtMost(active.right), (py + half).coerceAtMost(active.bottom))
            val area = MeteringRectangle(rect, MeteringRectangle.METERING_WEIGHT_MAX)

            val req = buildRequest(if (mode == CaptureMode.VIDEO) CameraDevice.TEMPLATE_RECORD else CameraDevice.TEMPLATE_PREVIEW)
            applyControls(req)
            req.set(CaptureRequest.CONTROL_AF_REGIONS, arrayOf(area))
            req.set(CaptureRequest.CONTROL_AE_REGIONS, arrayOf(area))
            req.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_AUTO)
            req.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_START)
            s.setRepeatingRequest(req.build(), captureCallback, handler)

            // restore continuous AF after the trigger settles
            handler.postDelayed({
                val restore = buildRequest(if (mode == CaptureMode.VIDEO) CameraDevice.TEMPLATE_RECORD else CameraDevice.TEMPLATE_PREVIEW)
                applyControls(restore)
                runCatching { s.setRepeatingRequest(restore.build(), captureCallback, handler) }
            }, 1400)
        } catch (t: Throwable) {
            L.d("tapToFocus: ${t.message}")
        }
    }

    override fun setFlash(mode: FlashMode) {
        if (mode != FlashMode.OFF && lens?.flash != true) {
            callback.onError("This camera has no flash")
            return
        }
        flash = mode
        applyAllControls()
    }

    override fun setEv(value: Int) {
        ev = value.coerceIn(-12, 12)
        applyAllControls()
    }

    override fun setManualExposure(iso: Int, exposureNs: Long) {
        manual = true
        manualIso = iso
        manualExposure = exposureNs
        applyAllControls()
    }

    override fun setManualFocus(diopters: Float) {
        manual = true
        manualFocus = if (diopters < 0f) -1f else diopters.coerceAtLeast(0f)
        applyAllControls()
    }

    override fun setManualWhiteBalance(kelvin: Int) {
        manual = true
        manualKelvin = kelvin
        applyAllControls()
    }

    override fun setManualEnabled(enabled: Boolean) {
        manual = enabled
        if (!enabled) {
            manualFocus = -1f
            manualKelvin = 0
            manualIso = 0
            manualExposure = 0L
        }
        applyAllControls()
    }

    override fun setStabilization(enabled: Boolean) {
        stabilization = enabled
        applyAllControls()
    }

    override fun setTargetFps(fps: Int) {
        targetFps = fps
        applyAllControls()
    }

    override fun setTorch(on: Boolean) {
        flash = if (on) FlashMode.TORCH else FlashMode.OFF
        applyAllControls()
    }

    /** Enable/disable the RAW (DNG) stream; rebuilds the session when needed. */
    fun setRawStream(enabled: Boolean) {
        if (rawStreamEnabled == enabled) return
        rawStreamEnabled = enabled
        closeSession()
        createSession()
    }

    fun setHighSpeedEnabled(enabled: Boolean) {
        highSpeedActive = enabled
        closeSession()
        createSession()
    }

    fun lockCaptureForVideo(recorder: MediaRecorder?) {
        recording = recorder != null
    }

    val isRecording: Boolean get() = recording

    /** Switch to the front camera (or back) keeping the current mode. */
    fun flip(useFront: Boolean) {
        isFront = useFront
        zoom = 1f
        openCamera(useFront)
    }

    /** Capture a single frame for time-lapse / panorama sequences. */
    fun captureFrameForSequence(bracketEv: Int = 0) {
        burstSingle = true
        burstTotal = 1
        burstIndex = 0
        burstEv = listOf(bracketEv)
        burstManualExposure = 0L
        burstManualIso = 0
        bursting.set(true)
        issueBurstFrame()
    }

    fun currentCharacteristics(): CameraCharacteristics? = characteristics

    fun faces(): List<Rect> = faceRects

    fun previewSurfaceOrNull(): Surface? = previewSurface

    fun latestResult(): CaptureResult? = lastResult

    fun captureSizeForMode(): Size = captureSize

    fun shutDown() {
        runCatching { session?.stopRepeating() }
        release()
    }
}

/** Face rectangles come back in sensor coordinates; map them to view space. */
object FaceMap {
    fun toView(faces: List<Rect>, active: Rect, viewW: Int, viewH: Int, mirror: Boolean): List<Rect> {
        if (faces.isEmpty() || active.width() <= 0) return emptyList()
        return faces.map { r ->
            val l = ((r.left - active.left).toFloat() / active.width() * viewW)
            val t = ((r.top - active.top).toFloat() / active.height() * viewH)
            val rr = ((r.right - active.left).toFloat() / active.width() * viewW)
            val b = ((r.bottom - active.top).toFloat() / active.height() * viewH)
            if (mirror) Rect((viewW - rr).roundToInt(), t.roundToInt(), (viewW - l).roundToInt(), b.roundToInt())
            else Rect(l.roundToInt(), t.roundToInt(), rr.roundToInt(), b.roundToInt())
        }
    }
}
