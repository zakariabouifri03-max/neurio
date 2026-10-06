package com.aivision.camera.ui

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Rect
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.Image
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.app.Activity
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView
import android.widget.Toast
import com.aivision.camera.BuildConfig
import com.aivision.camera.ai.AiResult
import com.aivision.camera.ai.CapturePlan
import com.aivision.camera.ai.DepthMap
import com.aivision.camera.ai.EnhanceProfile
import com.aivision.camera.ai.Imaging
import com.aivision.camera.ai.Planes
import com.aivision.camera.ai.Region
import com.aivision.camera.ai.Shift
import com.aivision.camera.ai.Align
import com.aivision.camera.ai.AiEngine
import com.aivision.camera.ai.SceneReport
import com.aivision.camera.camera.CameraEngine
import com.aivision.camera.camera.CameraStatus
import com.aivision.camera.camera.CameraRegistry
import com.aivision.camera.camera.CaptureMode
import com.aivision.camera.camera.FlashMode
import com.aivision.camera.camera.LensInfo
import com.aivision.camera.camera.LensKind
import com.aivision.camera.capture.PhotoSaver
import com.aivision.camera.capture.TimeLapseEncoder
import com.aivision.camera.capture.VideoController
import com.aivision.camera.capture.VideoSpec
import com.aivision.camera.capture.VideoTranscoder
import com.aivision.camera.core.DeviceProfiler
import com.aivision.camera.core.DeviceReport
import com.aivision.camera.core.DeviceTier
import com.aivision.camera.core.L
import com.aivision.camera.core.Crash
import com.aivision.camera.core.M
import com.aivision.camera.core.Prefs
import com.aivision.camera.core.QualityPolicy
import com.aivision.camera.core.Ui
import com.aivision.camera.core.Work
import com.aivision.camera.gl.GlPreviewView
import com.aivision.camera.gallery.GalleryActivity
import com.aivision.camera.gallery.MediaRepo
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The camera screen.
 *
 * Real hardware, real capture, real on-device AI:
 *   PHOTO  - full quality stills, AI enhanced automatically when it helps
 *   VIDEO  - 1080p / 2K / native 4K when the sensor supports it
 *   PRO    - ISO, shutter, focus, white balance and EV, plus RAW when available
 *   NIGHT  - long exposure + multi-frame stacking with the AI night recipe
 *   AI     - maximum computational photography: stacking + super resolution
 *            (AI ENHANCE and AI ULTRA are always available as quick buttons)
 */
class MainActivity : Activity(), CameraEngine.Callback, AiEngine.Progress {

    private lateinit var prefs: Prefs
    private lateinit var registry: CameraRegistry
    private lateinit var report: DeviceReport
    private lateinit var policy: QualityPolicy
    private lateinit var ai: AiEngine
    private var engine: CameraEngine? = null
    private lateinit var video: VideoController
    private var transcoder: VideoTranscoder? = null
    private val timeLapse = TimeLapseEncoder(this, 30)

    private lateinit var preview: GlPreviewView
    private lateinit var overlay: ViewfinderOverlay
    private lateinit var shutter: ShutterButton
    private lateinit var modeBar: ModeBar
    private lateinit var zoomDial: ZoomDial
    private lateinit var enhanceButton: AiActionButton
    private lateinit var ultraButton: AiActionButton
    private lateinit var statusBar: LinearLayout
    private lateinit var resultBar: LinearLayout
    private lateinit var thumb: ThumbView
    private lateinit var proPanel: LinearLayout
    private lateinit var quickRow: LinearLayout
    private lateinit var bottomBar: LinearLayout
    private var startupAnimationPlayed = false
    private var lastAnalysisAt = 0L
    private var analysisSeen = false
    private val startupStart = android.os.SystemClock.elapsedRealtime()
    private var modeSwitchAllowedAt = 0L

    private var mode = "PHOTO"
    private var zoom = 1f
    private var aiZeomActive = false
    private var capturing = false
    private var burstFrames = ArrayList<Planes>()
    private var burstShifts = ArrayList<Shift>()
    private var burstDepth: DepthMap? = null
    private var burstPlan: CapturePlan? = null
    private var burstScene: SceneReport? = null
    private var lastJpegBytes: ByteArray? = null
    private var pendingSaveOriginal: Planes? = null
    private var sensorManager: SensorManager? = null
    private var tiltSensor: Sensor? = null
    private var recording = false
    private var panoramaFrames = ArrayList<Planes>()
    private var panoramaActive = false
    private var lastShotTime = 0L
    private var lastRequestedFps = 30

    // ---------------------------------------------------------------- lifecycle
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        prefs = Prefs(this)
        // ask about the previous run first: if this launch also dies early, the
        // report was already in front of the user
        if (savedInstanceState == null) maybeShowLastCrash()
        Crash.step(this, "onCreate: settings")
        Crash.step(this, "onCreate: reading camera capabilities")
        registry = CameraRegistry.read(this)
        Crash.step(this, "onCreate: profiling device")
        report = DeviceProfiler.report(this, registry.score, registry.notes)
        policy = DeviceProfiler.policy(report, prefs.tierOverride)
        ai = AiEngine(policy, report)
        ai.aiEnhance = prefs.aiEnhance
        ai.aiUltra = prefs.aiUltra
        ai.setProgressListener(this)
        video = VideoController(this, policy)
        Crash.step(this, "onCreate: AI engine ready (${policy.tier})")

        try {
            Crash.step(this, "building the camera screen")
            buildUi()
            Crash.step(this, "screen built")
            overlay.hint = "Starting camera…"
            applyMode(prefs.lastMode, initial = true)
            updateThumb()
            registerSensors()
            Crash.step(this, "sensors + thumbnails ready")
        } catch (t: Throwable) {
            // a failure while building the screen is reported instead of closing
            L.e("startup failed", t)
            com.aivision.camera.core.Crash.note(this, "building the camera screen", t)
            showFatal(t)
            return
        }

        Crash.step(this, if (hasPermission()) "permission granted" else "asking for permission")
        if (hasPermission()) startCamera() else requestPermissions()
    }

    /** The failure path: tell the user what broke and let them send it back. */
    private fun showFatal(t: Throwable) {
        runCatching {
            AlertDialog.Builder(this)
                .setTitle("AI Vision Camera could not start")
                .setMessage(t.javaClass.simpleName + ": " + t.message +
                    "\n\nA report was saved - you can copy it and send it back to be fixed.")
                .setPositiveButton("Copy report") { _, _ -> copyCrashReport() }
                .setNegativeButton("Close") { _, _ -> finish() }
                .show()
        }
    }

    /** Offer the previous run's crash report, once per crash. */
    private fun maybeShowLastCrash() {
        val report = Crash.readLast(this)
        val bootTrace = if (report == null) Crash.incompleteBoot(this) else null
        if (report == null && bootTrace == null) return
        val summary = report?.lineSequence()?.firstOrNull { it.startsWith("exception") }
            ?: "The app stopped before the camera was ready."
        val where = bootTrace?.lineSequence()?.lastOrNull { it.contains("  ") }
        val text = report ?: bootTrace.orEmpty()
        AlertDialog.Builder(this)
            .setTitle("Last run stopped unexpectedly")
            .setMessage(summary + (if (where != null) "\n\nLast step reached:\n$where" else "") +
                "\n\nSend this report and the cause gets fixed.")
            .setPositiveButton("Copy report") { _, _ -> copyCrashReport(text) }
            .setNeutralButton("Share") { _, _ -> shareCrashReport(text) }
            .setNegativeButton("Dismiss") { _, _ ->
                Crash.clear(this)
                Crash.clearBoot(this)
            }
            .show()
    }

    private fun copyCrashReport(report: String? = null) {
        val text = report ?: Crash.readLast(this) ?: Crash.incompleteBoot(this) ?: return
        runCatching {
            val clipboard = getSystemService(android.content.Context.CLIPBOARD_SERVICE)
                as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("AI Vision crash", text))
            toast("Crash report copied")
        }.onFailure { toast("Copy failed") }
    }

    private fun shareCrashReport(text: String) {
        runCatching {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, "AI Vision Camera crash report")
                putExtra(Intent.EXTRA_TEXT, text)
            }, "Send crash report"))
        }.onFailure { toast("Share failed") }
    }

    override fun onResume() {
        super.onResume()
        preview.onResume()
        if (hasPermission()) startCamera()
        updateThumb()
    }

    override fun onPause() {
        super.onPause()
        preview.onPause()
        engine?.shutDown()
        engine = null
    }

    // ------------------------------------------------------------------ UI build
    private fun buildUi() {
        val root = FrameLayout(this)
        root.setBackgroundColor(Theme.bg)

        preview = GlPreviewView(this)
        preview.onSurfaceReady = { texture ->
            Crash.step(this, "GL surface ready (${preview.width}x${preview.height})")
            engine?.start(texture, preview.width, preview.height, currentCaptureMode())
        }
        preview.onSurfaceSize = { _, _ ->
            updatePreviewTransform()
            preview.requestRender()
        }
        // NOTE: the GL callbacks below arrive on the GL thread, which has no
        // Looper - touching UI (a Toast, a dialog, even LayoutParams) there
        // throws and kills the process. Start-up work runs inline (it is
        // thread-safe); everything else is posted to the main thread.
        preview.onGlError = { msg ->
            Handler(Looper.getMainLooper()).post { toast(msg) }
        }
        root.addView(preview, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        overlay = ViewfinderOverlay(this)
        overlay.gridMode = prefs.grid
        root.addView(overlay, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // ---- top status row ----------------------------------------------------
        statusBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val lpTop = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this@MainActivity, 44f),
            Gravity.TOP).apply { topMargin = Ui.dp(this@MainActivity, 30f)
            leftMargin = Ui.dp(this@MainActivity, 12f)
            rightMargin = Ui.dp(this@MainActivity, 12f) }
        root.addView(statusBar, lpTop)

        // ---- right side: AI quick actions -------------------------------------
        val aiColumn = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
        }
        enhanceButton = AiActionButton(this).apply {
            title = "AI ENHANCE"
            active = prefs.aiEnhance
            onToggle = { on ->
                prefs.aiEnhance = on
                ai.aiEnhance = on
                if (!on && ultraButton.active) { ultraButton.active = false; ai.aiUltra = false; prefs.aiUltra = false }
                refreshAiState()
                flashResult(if (on) "AI Enhance ON" else "AI Enhance OFF",
                    if (on) "Multi-frame detail, denoise, tone & colour" else "Straight capture")
            }
        }
        ultraButton = AiActionButton(this).apply {
            title = "AI ULTRA"
            accentColor = Theme.ultra
            active = prefs.aiUltra
            onToggle = { on ->
                if (mode == "VIDEO") {
                    // in video the same button drives the AI Enhanced 4K pipeline
                    prefs.aiEnhancedVideo = on
                    ultraButton.title = if (on) "AI 4K ON" else "AI 4K"
                    flashResult(if (on) "AI Enhanced 4K armed" else "AI Enhanced 4K off",
                        if (on) "Footage is super-resolved and re-encoded up to 4K with AI"
                        else "Recordings are saved at their native resolution")
                } else {
                    prefs.aiUltra = on
                    ai.aiUltra = on
                    if (on) {
                        prefs.aiEnhance = true
                        ai.aiEnhance = true
                        enhanceButton.active = true
                    }
                    val cap = policy.upscaleCapLongEdge
                    flashResult(if (on) "AI Ultra ON" else "AI Ultra OFF",
                        if (on) "Maximum detail reconstruction up to ${cap}px"
                        else "Super resolution off")
                }
                refreshAiState()
            }
        }
        aiColumn.addView(enhanceButton, LinearLayout.LayoutParams(Ui.dp(this@MainActivity, 148f), Ui.dp(this@MainActivity, 40f)))
        aiColumn.addView(Space(this), LinearLayout.LayoutParams(1, Ui.dp(this@MainActivity, 8f)))
        aiColumn.addView(ultraButton, LinearLayout.LayoutParams(Ui.dp(this@MainActivity, 148f), Ui.dp(this@MainActivity, 40f)))
        ultraButton.visibility = View.VISIBLE
        val lpAi = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.END or Gravity.CENTER_VERTICAL).apply {
            rightMargin = Ui.dp(this@MainActivity, 12f)
            bottomMargin = Ui.dp(this@MainActivity, 60f)
        }
        root.addView(aiColumn, lpAi)

        // ---- bottom cluster ----------------------------------------------------
        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }

        quickRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        bottom.addView(quickRow, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this@MainActivity, 34f)))

        proPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(Ui.dp(this@MainActivity, 16f), 0, Ui.dp(this@MainActivity, 16f), 0)
        }
        bottom.addView(proPanel, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        modeBar = ModeBar(this).apply {
            onSelect = { selected -> applyMode(selected) }
        }
        bottom.addView(modeBar, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this@MainActivity, 46f)))

        val shutterRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        thumb = ThumbView(this).apply {
            onClick = { openGallery() }
        }
        shutterRow.addView(thumb, LinearLayout.LayoutParams(Ui.dp(this@MainActivity, 52f), Ui.dp(this@MainActivity, 52f)))

        shutter = ShutterButton(this)
        shutter.setOnClickListener { onShutter() }
        val shutterLp = LinearLayout.LayoutParams(Ui.dp(this@MainActivity, 86f), Ui.dp(this@MainActivity, 86f))
        shutterLp.marginStart = Ui.dp(this@MainActivity, 28f)
        shutterLp.marginEnd = Ui.dp(this@MainActivity, 28f)
        shutterRow.addView(shutter, shutterLp)

        val flip = ChipButton(this).apply {
            text = "FLIP"
            onClick = {
                val front = !(engine?.isFrontFacing() ?: false)
                prefs.lastFacing = if (front) 1 else 0
                engine?.flip(front)
                preview.mirror = front
            }
        }
        shutterRow.addView(flip, LinearLayout.LayoutParams(Ui.dp(this@MainActivity, 58f), Ui.dp(this@MainActivity, 30f)))
        bottom.addView(shutterRow, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this@MainActivity, 96f)))

        zoomDial = ZoomDial(this).apply {
            minZoom = 0.5f
            maxZoom = registry.maxAiZoom(0, policy.tier == DeviceTier.FLAGSHIP)
            onZoomChange = { z -> onZoomChanged(z) }
        }
        bottom.addView(zoomDial, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this@MainActivity, 42f)))

        val lpBottom = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM).apply { bottomMargin = Ui.dp(this@MainActivity, 8f) }
        bottomBar = bottom
        root.addView(bottom, lpBottom)

        // ---- result / info bar -------------------------------------------------
        resultBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(Ui.dp(this@MainActivity, 14f), Ui.dp(this@MainActivity, 10f),
                Ui.dp(this@MainActivity, 14f), Ui.dp(this@MainActivity, 10f))
            background = Theme.rounded(Theme.withAlpha(Theme.surface, 235), Ui.dp(this@MainActivity, 14f).toFloat(),
                Ui.dp(this@MainActivity, 1f), Theme.stroke)
        }
        val lpResult = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM).apply {
            bottomMargin = Ui.dp(this@MainActivity, 246f)
            leftMargin = Ui.dp(this@MainActivity, 14f)
            rightMargin = Ui.dp(this@MainActivity, 14f)
        }
        root.addView(resultBar, lpResult)

        setContentView(root)
        rebuildQuickRow()
        rebuildProPanel()
        refreshAiState()
        updateStatusBar()
        installGestures()
    }

    private fun rebuildQuickRow() {
        quickRow.removeAllViews()
        val chips = when (mode) {
            "VIDEO" -> listOf("RES", "FPS", "AI 4K", "SLOW", "LAPSE")
            "PRO" -> listOf("RAW", "STAB", "GRID", "TIMER")
            "NIGHT" -> listOf("STACK", "EV", "GRID", "STAB")
            "AI" -> listOf("ULTRA", "PORTRAIT", "DOC", "PANO", "MACRO")
            else -> listOf("FLASH", "TIMER", "GRID", "STAB")
        }
        for (name in chips) {
            val chip = ChipButton(this).apply {
                text = when (name) {
                    "RES" -> prefs.videoResolution.uppercase()
                    "FPS" -> "${prefs.videoFps}fps"
                    "AI 4K" -> "AI 4K"
                    "STAB" -> "STAB"
                    "RAW" -> "RAW"
                    "GRID" -> "GRID"
                    "TIMER" -> if (prefs.timerSeconds > 0) "${prefs.timerSeconds}s" else "TIMER"
                    "STACK" -> "${prefs.nightStack}F"
                    "EV" -> "EV ${if (prefs.proEv > 0) "+" else ""}${prefs.proEv}"
                    "ULTRA" -> "ULTRA"
                    "PORTRAIT" -> "PORTRAIT"
                    "DOC" -> "SCAN"
                    "PANO" -> if (panoramaActive) "PANO ${panoramaFrames.size}" else "PANO"
                    "MACRO" -> if (macroActive) "MACRO ✓" else "MACRO"
                    "SLOW" -> if (slowMotionEnabled) "SLOW ${slowMotionFps}fps" else "SLOW"
                    "LAPSE" -> if (timeLapse.capturing) "LAPSE ${timeLapse.frameCount}" else "LAPSE"
                    else -> name
                }
                active = when (name) {
                    "FLASH" -> flashMode != FlashMode.OFF
                    "STAB" -> prefs.hybridStabilization
                    "RAW" -> prefs.proRaw
                    "GRID" -> prefs.grid > 0
                    "AI 4K" -> prefs.aiEnhancedVideo
                    "ULTRA" -> prefs.aiUltra
                    "PORTRAIT" -> ai.portraitMode
                    "DOC" -> ai.documentMode
                    "PANO" -> panoramaActive
                    "MACRO" -> macroActive
                    "SLOW" -> slowMotionEnabled
                    "LAPSE" -> timeLapse.capturing
                    "TIMER" -> prefs.timerSeconds > 0
                    else -> false
                }
                onClick = { onChip(name) }
            }
            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this@MainActivity, 30f))
            lp.marginStart = Ui.dp(this@MainActivity, 4f)
            lp.marginEnd = Ui.dp(this@MainActivity, 4f)
            quickRow.addView(chip, lp)
        }
    }

    private var flashMode = FlashMode.OFF

    private fun onChip(name: String) {
        when (name) {
            "FLASH" -> {
                flashMode = when (flashMode) {
                    FlashMode.OFF -> FlashMode.AUTO
                    FlashMode.AUTO -> FlashMode.ON
                    FlashMode.ON -> FlashMode.TORCH
                    FlashMode.TORCH -> FlashMode.OFF
                }
                engine?.setFlash(flashMode)
                flashResult("Flash ${flashMode.name}", flashHint(flashMode))
            }
            "TIMER" -> {
                val next = when (prefs.timerSeconds) {
                    0 -> 3; 3 -> 10; else -> 0
                }
                prefs.timerSeconds = next
                flashResult(if (next == 0) "Timer off" else "Timer ${next}s", "Tap the shutter to arm it")
            }
            "GRID" -> {
                prefs.grid = (prefs.grid + 1) % 4
                overlay.gridMode = prefs.grid
                prefs.showHud = true
                flashResult("Grid ${if (prefs.grid == 0) "off" else "on"}",
                    "Thirds, golden ratio or square framing guide")
            }
            "STAB" -> {
                prefs.hybridStabilization = !prefs.hybridStabilization
                engine?.setStabilization(prefs.hybridStabilization)
                flashResult(if (prefs.hybridStabilization) "Stabilisation ON" else "Stabilisation OFF",
                    "OIS + EIS in camera, software stabilisation in AI Enhanced 4K")
            }
            "RAW" -> {
                prefs.proRaw = !prefs.proRaw
                engine?.setRawStream(prefs.proRaw)
                flashResult(if (prefs.proRaw) "RAW (DNG) enabled" else "RAW off",
                    if (registry.backGroup?.hasRaw == true) "Written next to the JPEG" else "Not supported by this device")
            }
            "RES" -> {
                val order = listOf("auto", "4K", "2K", "1080p", "720p")
                val next = order[(order.indexOf(prefs.videoResolution).coerceAtLeast(0) + 1) % order.size]
                prefs.videoResolution = next
                flashResult("Video $next", "Applied on the next recording")
            }
            "FPS" -> {
                val order = listOf(24, 30, 60, 120)
                val next = order[(order.indexOf(prefs.videoFps).coerceAtLeast(0) + 1) % order.size]
                prefs.videoFps = next
                engine?.setTargetFps(next)
                flashResult("$next fps", if (next >= 60) "Requires a supported sensor mode" else "Standard cadence")
            }
            "AI 4K" -> {
                prefs.aiEnhancedVideo = !prefs.aiEnhancedVideo
                flashResult(if (prefs.aiEnhancedVideo) "AI Enhanced 4K ON" else "AI Enhanced 4K OFF",
                    "Records at sensor max, then super-resolves to 4K (labelled honestly)")
            }
            "STACK" -> {
                val options = listOf(4, 8, 12, 16)
                val next = options[(options.indexOf(prefs.nightStack).coerceAtLeast(0) + 1) % options.size]
                prefs.nightStack = next
                flashResult("Night stack $next frames", "More frames = cleaner, needs a steady hand")
            }
            "EV" -> {
                prefs.proEv = if (prefs.proEv >= 4) -4 else prefs.proEv + 1
                engine?.setEv(prefs.proEv)
                flashResult("EV ${if (prefs.proEv > 0) "+" else ""}${prefs.proEv}", "Exposure compensation")
            }
            "ULTRA" -> {
                ultraButton.active = !ultraButton.active
                ultraButton.onToggle?.invoke(ultraButton.active)
            }
            "PORTRAIT" -> {
                ai.portraitMode = !ai.portraitMode
                flashResult(if (ai.portraitMode) "Portrait AI armed" else "Portrait AI off",
                    if (registry.backGroup?.hasDepth == true) "Depth stream available - real subject separation"
                    else "No depth stream: face-guided separation")
            }
            "DOC" -> {
                ai.documentMode = !ai.documentMode
                flashResult(if (ai.documentMode) "Document AI armed" else "Document AI off",
                    "Captures, detects the sheet, flattens and cleans it")
            }
            "PANO" -> {
                if (panoramaActive) stopPanorama() else startPanorama()
            }
            "MACRO" -> toggleMacro()
            "SLOW" -> toggleSlowMotion()
            "LAPSE" -> toggleTimeLapse()
        }
        rebuildQuickRow()
    }

    private fun flashHint(mode: FlashMode) = when (mode) {
        FlashMode.OFF -> "Flash disabled"
        FlashMode.AUTO -> "Fires automatically in low light"
        FlashMode.ON -> "Always fires"
        FlashMode.TORCH -> "Continuous light for video"
    }

    // ------------------------------------------------------------- pro controls
    private fun rebuildProPanel() {
        proPanel.removeAllViews()
        val lens = engine?.currentLens ?: registry.backGroup?.reference ?: return
        val chars = engine?.currentCharacteristics()

        fun addSlider(label: String, value: Float, display: String, auto: Boolean,
                      onChange: (Float) -> Unit, onAuto: () -> Unit) {
            val slider = ProSlider(this).apply {
                this.label = label
                this.value = value
                this.displayValue = display
                this.auto = auto
                this.onValueChange = onChange
                this.onAutoToggle = onAuto
            }
            proPanel.addView(slider, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this@MainActivity, 34f)))
        }

        val isoRange = lens.isoRange
        addSlider(
            "ISO", M.clamp((prefs.proIso - isoRange.lower).toFloat() /
                max(1f, (isoRange.upper - isoRange.lower).toFloat()), 0f, 1f).toFloat(),
            if (prefs.proIso == 0) "AUTO" else prefs.proIso.toString(),
            prefs.proIso == 0,
            onChange = { fraction ->
                val value = (isoRange.lower + fraction * (isoRange.upper - isoRange.lower)).roundToInt()
                prefs.proIso = value
                engine?.setManualExposure(value, prefs.proShutterNs)
                rebuildProPanel()
            },
            onAuto = {
                prefs.proIso = 0
                engine?.setManualEnabled(false)
                flashResult("ISO auto", "Camera chooses sensitivity")
                rebuildProPanel()
            },
        )

        val exposureRange = lens.exposureRange
        val shutterValue = if (prefs.proShutterNs == 0L) 0.5f else {
            val lo = kotlin.math.ln(exposureRange.lower.toDouble()).toFloat()
            val hi = kotlin.math.ln(exposureRange.upper.toDouble()).toFloat()
            (kotlin.math.ln(prefs.proShutterNs.toDouble()).toFloat() - lo) / (hi - lo)
        }
        addSlider(
            "SHUTTER", shutterValue,
            if (prefs.proShutterNs == 0L) "AUTO" else CapturePlan.formatExposure(prefs.proShutterNs),
            prefs.proShutterNs == 0L,
            onChange = { fraction ->
                val lo = kotlin.math.ln(exposureRange.lower.toDouble())
                val hi = kotlin.math.ln(exposureRange.upper.toDouble())
                val ns = kotlin.math.exp(lo + (hi - lo) * fraction.toDouble()).toLong()
                    .coerceIn(exposureRange.lower, exposureRange.upper)
                prefs.proShutterNs = ns
                engine?.setManualExposure(prefs.proIso, ns)
                rebuildProPanel()
            },
            onAuto = {
                prefs.proShutterNs = 0L
                engine?.setManualEnabled(false); rebuildProPanel()
            },
        )

        val focusMax = lens.minFocusDistance.coerceAtLeast(0.001f)
        addSlider(
            "FOCUS", if (prefs.proFocusDiopters < 0) 0.5f
            else M.clamp(prefs.proFocusDiopters / focusMax, 0f, 1f),
            if (prefs.proFocusDiopters < 0) "AUTO"
            else "%.2fm".format(1f / max(0.05f, prefs.proFocusDiopters)),
            prefs.proFocusDiopters < 0,
            onChange = { fraction ->
                val diopters = fraction * focusMax
                prefs.proFocusDiopters = diopters
                engine?.setManualFocus(diopters)
                rebuildProPanel()
            },
            onAuto = { prefs.proFocusDiopters = -1f; engine?.setManualFocus(-1f); rebuildProPanel() },
        )

        addSlider(
            "WB", if (prefs.proWbKelvin == 0) 0.42f
            else M.clamp((prefs.proWbKelvin - 2000f) / 6000f, 0f, 1f),
            if (prefs.proWbKelvin == 0) "AUTO" else "${prefs.proWbKelvin}K",
            prefs.proWbKelvin == 0,
            onChange = { fraction ->
                val kelvin = (2000f + fraction * 6000f).roundToInt()
                prefs.proWbKelvin = kelvin
                engine?.setManualWhiteBalance(kelvin)
                rebuildProPanel()
            },
            onAuto = { prefs.proWbKelvin = 0; engine?.setManualEnabled(false); rebuildProPanel() },
        )

        addSlider(
            "EV", (prefs.proEv + 4) / 8f,
            "${if (prefs.proEv > 0) "+" else ""}${prefs.proEv} EV", prefs.proEv == 0,
            onChange = { fraction ->
                val ev = (fraction * 8f - 4f).roundToInt()
                prefs.proEv = ev
                engine?.setEv(ev)
                rebuildProPanel()
            },
            onAuto = { prefs.proEv = 0; engine?.setEv(0); rebuildProPanel() },
        )

        val info = Theme.label(this@MainActivity,
            "RAW: ${if (lens.supportsRaw) "supported" else "not available"} • " +
                "ISO ${lens.isoRange.lower}-${lens.isoRange.upper} • " +
                "T ${CapturePlan.formatExposure(lens.exposureRange.lower)}-" +
                CapturePlan.formatExposure(lens.exposureRange.upper))
        proPanel.addView(info)
    }

    // ---------------------------------------------------------------- permissions
    private fun hasPermission() =
        checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun requestPermissions() {
        requestPermissions(
            arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO),
            101,
        )
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            toast("Camera permission is required")
        }
    }

    // --------------------------------------------------------------- camera setup
    private fun currentCaptureMode(): CaptureMode = when (mode) {
        "VIDEO" -> CaptureMode.VIDEO
        "PRO" -> CaptureMode.PRO
        "NIGHT" -> CaptureMode.NIGHT
        "AI" -> CaptureMode.AI
        else -> CaptureMode.PHOTO
    }

    private fun startCamera() {
        // called from onCreate (main thread) and from the GL thread - a failure
        // here must never escape, it just gets reported
        try {
            val existing = engine
            if (existing == null) {
                engine = CameraEngine(this, registry, this).also { eng ->
                    eng.setRawStream(prefs.proRaw)
                    eng.setStabilization(prefs.hybridStabilization)
                    val st = preview.surfaceTexture
                    if (st != null) {
                        eng.start(st, preview.width, preview.height, currentCaptureMode())
                    }
                }
            } else {
                existing.openCamera(prefs.lastFacing == 1)
            }
        } catch (t: Throwable) {
            L.e("startCamera failed", t)
            com.aivision.camera.core.Crash.note(this, "starting the camera", t)
            runOnUiThread {
                toast("Camera failed to start: ${t.message}")
                overlay.hint = "Camera could not start - tap FLIP or reopen the app"
                overlay.invalidate()
            }
        }
    }

    private fun applyMode(newMode: String, initial: Boolean = false) {
        if (!initial) {
            // tapping a mode while the session is still coming up used to tear
            // down a half-open camera; wait until it is actually streaming
            val now = android.os.SystemClock.elapsedRealtime()
            if (engine?.currentLens == null && now - startupStart < 10_000L) {
                toast("Camera is still starting…")
                return
            }
            if (now < modeSwitchAllowedAt) return
            modeSwitchAllowedAt = now + 900L
        }
        mode = newMode
        prefs.lastMode = newMode
        modeBar.selected = modeBar.modes.indexOf(newMode).coerceAtLeast(0)
        ai.nightMode = newMode == "NIGHT"
        proPanel.visibility = if (newMode == "PRO") View.VISIBLE else View.GONE
        if (newMode == "VIDEO") {
            ultraButton.title = if (prefs.aiEnhancedVideo) "AI 4K ON" else "AI 4K"
            ultraButton.active = prefs.aiEnhancedVideo
            ultraButton.accentColor = Theme.accent
        } else {
            ultraButton.title = "AI ULTRA"
            ultraButton.active = ai.aiUltra
            ultraButton.accentColor = Theme.ultra
        }
        ultraButton.visibility = View.VISIBLE
        shutter.mode = if (newMode == "VIDEO") "VIDEO" else "PHOTO"
        engine?.setProcessCap(currentProcessCap())
        engine?.switchMode(currentCaptureMode())
        // a mode switch must not leave another mode's arming behind
        if (newMode != "AI") {
            if (panoramaActive) stopPanorama()
            ai.documentMode = false
        }
        if (newMode != "VIDEO" && slowMotionEnabled) {
            slowMotionEnabled = false
            engine?.setHighSpeedEnabled(false)
            slowMotionFps = 120
        }
        if (newMode == "PRO") rebuildProPanel()
        rebuildQuickRow()
        if (!initial) {
            flashResult(
                when (newMode) {
                    "PHOTO" -> "Photo mode"
                    "VIDEO" -> {
                        val lens = engine?.currentLens ?: registry.backGroup?.reference
                            ?: registry.frontGroup?.reference
                        if (lens == null) "Video mode" else "Video mode • " +
                            video.chooseSpec(lens, prefs.videoResolution, prefs.videoFps,
                                prefs.aiEnhancedVideo).label
                    }
                    "PRO" -> "Pro mode"
                    "NIGHT" -> "Night mode"
                    else -> "AI mode"
                },
                when (newMode) {
                    "PHOTO" -> "AI enhance applies automatically when it helps"
                    "VIDEO" -> "Tap the shutter to start and stop recording"
                    "PRO" -> "Manual ISO, shutter, focus, WB and EV"
                    "NIGHT" -> "Long exposure + ${prefs.nightStack}-frame AI stack"
                    else -> "Stacking, super resolution, portrait and document AI"
                },
            )
        }
        if (initial && newMode != "PHOTO") rebuildQuickRow()
    }

    // ------------------------------------------------------------------- callbacks
    override fun onCameraReady(lens: LensInfo, previewSize: android.util.Size, captureSize: android.util.Size) {
        Crash.step(this, "session configured: ${lens.kind.label} ${previewSize.width}x${previewSize.height}")
        // the trace only counts the launch as good once the camera has actually
        // been streaming for a while - a death right after the first frame is
        // exactly the kind of failure this file has to survive for
        overlay.postDelayed({ Crash.bootComplete(this) }, 12_000L)
        uiSafe {
            val rotation = engine?.jpegOrientation() ?: 90
            val mirror = (engine?.isFrontFacing() ?: false) && prefs.mirrorFront
            preview.updateTransform(previewSize.width, previewSize.height, rotation, mirror)
            val group = registry.group(lens.facing)
            zoomDial.stops = group?.zoomStops() ?: listOf("1" to 1f)
            zoomDial.minZoom = zoomDial.stops.minOfOrNull { it.second }?.coerceAtLeast(0.5f) ?: 0.5f
            zoomDial.maxZoom = registry.maxAiZoom(lens.facing, policy.tier == DeviceTier.FLAGSHIP)
            if (prefs.proRaw) engine?.setRawStream(true)
            overlay.hint = ""
            playStartupAnimation()
            val capture = captureSize.width.toString() + "×" + captureSize.height
            flashResult("${lens.kind.label} ${"%.1f".format(lens.nativeZoom)}× • ${lens.equivFocal.roundToInt()}mm eq",
                "Capture $capture • ${captureSize.width * captureSize.height / 1_000_000}MP max")
            if (mode == "PRO") rebuildProPanel()
        }
    }

    /** Recompute the preview transform (rotation can change while running). */
    /**
     * Multi-frame AI needs several copies of a frame at once, so it runs on a
     * bounded resolution; a plain single shot can use the full sensor stream.
     */
    private fun currentProcessCap(): Long =
        if (ai.aiEnhance || ai.aiUltra || ai.nightMode) aiProcessPixels()
        else min(24_000_000L, heapSafePixels() * 2L)

    private fun updatePreviewTransform() {
        val rotation = engine?.jpegOrientation() ?: 90
        val mirror = (engine?.isFrontFacing() ?: false) && prefs.mirrorFront
        preview.updateTransform(preview.sensorWidth, preview.sensorHeight, rotation, mirror)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        updatePreviewTransform()
        preview.requestRender()
        applyMode(mode, initial = true)
    }

    /**
     * Short reveal when the camera comes up: the HUD fades in while the bottom
     * tray slides up, so the first impression is the live image, not chrome.
     */
    private fun playStartupAnimation() {
        if (startupAnimationPlayed) return
        startupAnimationPlayed = true
        overlay.alpha = 0f
        statusBar.alpha = 0f
        bottomBar.alpha = 0f
        overlay.translationY = Ui.dp(this@MainActivity, 10f).toFloat()
        bottomBar.translationY = Ui.dp(this@MainActivity, 34f).toFloat()
        overlay.animate().alpha(1f).translationY(0f).setDuration(420L).start()
        statusBar.animate().alpha(1f).setDuration(420L).setStartDelay(80L).start()
        bottomBar.animate().alpha(1f).translationY(0f).setDuration(460L)
            .setStartDelay(120L).start()
        preview.requestRender()
    }

    private var streams = 0

    override fun onStatus(status: CameraStatus) {
        streams++
        if (streams == 1) Crash.step(this, "first camera frame (${status.previewSize.width}x${status.previewSize.height})")
        if (streams == 60) Crash.step(this, "camera streaming steadily")
        uiSafe {
            val exposure = if (status.exposureNs > 0) {
                "ISO ${status.iso} • ${CapturePlan.formatExposure(status.exposureNs)}"
            } else "ISO ${status.iso}"
            overlay.exposureLine = "$exposure • ${status.fps}fps" +
                if (status.aeLocked) " • AE ✓" else ""
            overlay.aiHeadline = if (ai.aiUltra) "AI ULTRA" else if (ai.aiEnhance) "AI ENHANCE" else ""
            overlay.zoomLabel = zoomLabelText(status.zoom)
            overlay.zoomIsAi = aiZeomActive
            shutter.aiActive = ai.aiEnhance || ai.aiUltra
            shutter.invalidate()
            overlay.invalidate()
        }
    }

    /**
     * UI updates that arrive from camera / GL / worker threads. The body runs on
     * the main thread inside a guard: a mistake in one of these blocks used to be
     * an uncaught main-thread exception, i.e. the app closing under the user.
     */
    private inline fun uiSafe(crossinline body: () -> Unit) {
        runOnUiThread {
            try {
                body()
            } catch (t: Throwable) {
                L.e("ui update failed", t)
                Crash.note(this, "updating the camera screen", t)
            }
        }
    }

    private fun zoomLabelText(z: Float): String {
        val text = if (z < 1f) "%.1f×".format(z) else if (z < 10f) "%.1f×".format(z) else "${z.roundToInt()}×"
        return if (aiZeomActive) "$text AI" else text
    }

    override fun onAnalysisFrame(luma: ByteArray, width: Int, height: Int, stride: Int, faces: List<Rect>) {
        if (streams > 0 && !analysisSeen) {
            analysisSeen = true
            Crash.step(this, "first analysis frame ${width}x$height")
        }
        if (!prefs.sceneDetection && !ai.aiEnhance) return
        // runs on the camera thread: rate-limit before doing any per-frame work
        val elapsed = android.os.SystemClock.elapsedRealtime()
        if (elapsed - lastAnalysisAt < 500L) return
        lastAnalysisAt = elapsed
        val report = ai.analysePreview(luma, width, height, stride, faces, zoom,
            motionHint = if (recording) 0.4f else 0f) ?: return
        uiSafe {
            overlay.sceneLine = "AI scene: ${report.label.display} • noise ${"%.3f".format(report.noise)}"
            if (prefs.faceEnhance && faces.isNotEmpty()) {
                val lens = engine?.currentLens
                val active = lens?.activeArray ?: Rect(0, 0, width, height)
                overlay.faces = faces.map { r ->
                    val sx = overlay.width.toFloat() / active.width()
                    val sy = overlay.height.toFloat() / active.height()
                    Rect((r.left * sx).toInt(), (r.top * sy).toInt(),
                        (r.right * sx).toInt(), (r.bottom * sy).toInt())
                }
            } else {
                overlay.faces = emptyList()
            }
            overlay.invalidate()
            applySceneToPreview(report)
        }
    }

    private fun applySceneToPreview(report: SceneReport) {
        val p = report.profile
        val active = ai.aiEnhance || ai.aiUltra || ai.nightMode
        if (!active) {
            preview.disableEnhancement()
            return
        }
        preview.applyEnhancement(
            denoise = p.denoiseLuma * 0.8f,
            sharpen = p.sharpenFine,
            clarity = p.clarity,
            tone = p.toneStrength,
            shadow = p.shadowLift,
            highlight = p.highlightRoll,
            contrast = p.contrast,
            vibrance = p.vibrance,
            saturation = p.saturation,
            aiZoom = zoom / max(1f, engine?.currentHardwareZoom() ?: 1f),
            aiActive = true,
        )
    }

    override fun onFrameForProcessing(image: Image, lens: LensInfo, result: android.hardware.camera2.CaptureResult?) {
        val format = image.format
        if (format == android.graphics.ImageFormat.RAW_SENSOR) {
            val chars = engine?.currentCharacteristics()
            if (chars != null) {
                val saved = PhotoSaver.saveDng(this, image, chars, result, "AI Vision RAW")
                uiSafe {
                    if (saved != null) flashResult("RAW saved", "${saved.width}×${saved.height} DNG")
                }
            }
            return
        }
        if (format == android.graphics.ImageFormat.DEPTH16) {
            burstDepth = DepthMap.fromImage(image)
            return
        }
        if (capturing) {
            // burst frame (handled by onBurstFrame for YUV)
            return
        }
        // single frame path: enhance + save
        val planes = Planes.fromImage(image) ?: return
        handleSingleCapture(planes)
    }

    override fun onBurstFrame(image: Image, index: Int, total: Int, lens: LensInfo) {
        if (image.format == android.graphics.ImageFormat.DEPTH16) {
            burstDepth = DepthMap.fromImage(image)
            return
        }
        if (image.format == android.graphics.ImageFormat.RAW_SENSOR) {
            val chars = engine?.currentCharacteristics()
            if (chars != null) PhotoSaver.saveDng(this, image, chars, engine?.latestResult(), "AI Vision RAW")
            return
        }
        val planes = Planes.fromImage(image) ?: return
        val reference = burstFrames.firstOrNull()
        val shift = if (reference != null && reference.w == planes.w) {
            val refLuma = alignLuma(reference)
            val curLuma = alignLuma(planes)
            Align.estimate(refLuma.data, curLuma.data, refLuma.w, refLuma.h, 20)
        } else Shift.ZERO
        burstFrames.add(planes)
        burstShifts.add(shift)
        uiSafe {
            overlay.processingStage = "AI capture $index/$total"
            overlay.processingProgress = (index.toFloat() / total) * 0.4f
            overlay.processing = true
        }
        if (panoramaActive) {
            panoramaFrames.add(planes)
            uiSafe { overlay.processingStage = "Panorama ${panoramaFrames.size} frames" }
        }
        if (timeLapse.capturing) timeLapse.addFrame(planes)
    }

    override fun onBurstDone(count: Int, lens: LensInfo) {
        Crash.step(this, "burst done ($count frames)")
        val frames = ArrayList(burstFrames)
        val shifts = ArrayList(burstShifts)
        burstFrames = ArrayList()
        burstShifts = ArrayList()
        if (frames.isEmpty()) {
            finishProcessing()
            return
        }
        if (panoramaActive || timeLapse.capturing) {
            finishProcessing()
            return
        }
        val plan = burstPlan
        val scene = burstScene
        val depth = burstDepth
        burstDepth = null
        Work.serial.execute {
            val faces = engine?.faces()?.let { rects ->
                val lens = engine?.currentLens
                val active = lens?.activeArray
                if (active != null && active.width() > 0) {
                    val sx = frames[0].w.toFloat() / active.width()
                    val sy = frames[0].h.toFloat() / active.height()
                    Region.fromRects(rects, sx, sy)
                } else emptyList()
            } ?: emptyList()

            val result = ai.processCapture(
                frames = frames, shifts = shifts, evs = plan?.evLadder ?: emptyList(),
                depth = depth, faceRegions = faces, zoom = zoom,
                wantUltra = ai.aiUltra, wantEnhance = ai.aiEnhance || ai.nightMode,
                wantPortrait = ai.portraitMode, wantDocument = ai.documentMode,
                nativeLongEdge = max(frames[0].w, frames[0].h),
            )
            saveResult(result)
        }
    }

    override fun onVideoEvent(event: String, extra: Long) {
        L.i("video event $event $extra")
    }

    override fun onError(message: String) {
        Crash.step(this, "camera error: $message")
        uiSafe {
            toast(message)
            finishProcessing()
        }
    }

    override fun onProgress(stage: String, fraction: Float) {
        uiSafe {
            overlay.processing = true
            overlay.processingStage = stage
            overlay.processingProgress = fraction
        }
    }

    // ------------------------------------------------------------------ capturing
    private fun onShutter() {
        val eng = engine ?: run { toast("Camera starting…"); return }
        when (mode) {
            "VIDEO" -> toggleRecording()
            else -> {
                if (ai.documentMode) { captureDocument(); return }
                if (panoramaActive) { stopPanorama(); return }
                if (mode == "AI" && quickRowContainsPanorama()) { /* handled by chip */ }
                if (capturing) return
                val now = System.currentTimeMillis()
                if (now - lastShotTime < 600) return
                lastShotTime = now
                val timer = prefs.timerSeconds
                if (timer > 0) {
                    runCountdown(timer) { startCapture() }
                } else startCapture()
            }
        }
    }

    private fun quickRowContainsPanorama() = false

    private fun runCountdown(seconds: Int, done: () -> Unit) {
        var remaining = seconds
        overlay.processing = false
        val tick = object : Runnable {
            override fun run() {
                if (remaining <= 0) {
                    overlay.hint = ""
                    overlay.invalidate()
                    done()
                    return
                }
                overlay.hint = "• $remaining"
                overlay.invalidate()
                remaining--
                overlay.postDelayed(this, 1000)
            }
        }
        overlay.post(tick)
    }

    /** Pixels the AI pipeline may work on, from the real heap and the tier. */
    private fun aiProcessPixels(): Long {
        val tierCap = when (policy.tier) {
            DeviceTier.FLAGSHIP -> 9_000_000L
            DeviceTier.MID_RANGE -> 5_000_000L
            else -> 2_500_000L
        }
        return min(tierCap, heapSafePixels())
    }

    /** Half the heap divided by ~6 bytes/pixel leaves room for the burst stack. */
    private fun heapSafePixels(): Long {
        val heap = Runtime.getRuntime().maxMemory()
        val usable = heap / 3L
        return (usable / 6L).coerceIn(1_500_000L, 24_000_000L)
    }

    /**
     * How many frames of the plan actually fit in memory. A frame costs about
     * 6 bytes per pixel (float luma + quarter-res chroma) and every pool copy adds
     * more, so the burst is trimmed before a single frame is captured.
     */
    private fun framesThatFit(planned: Int): Int {
        val size = engine?.captureSizeForMode()
        val pixels = (size?.let { it.width.toLong() * it.height.toLong() } ?: 4_000_000L)
        val perFrame = pixels * 6L
        val budget = Runtime.getRuntime().maxMemory() / 3L
        val fits = (budget / perFrame.coerceAtLeast(1L)).toInt()
        return planned.coerceAtMost(fits.coerceIn(1, 24))
    }

    private fun startCapture() {
        val eng = engine ?: return
        val scene = ai.lastScene
        burstScene = scene
        val action = (scene?.motion ?: 0f) > 0.45f
        val planned = ai.planCapture(zoom, scene, action)
        val usableFrames = framesThatFit(planned.frames)
        val plan = if (usableFrames < planned.frames) {
            planned.copy(frames = usableFrames, evLadder = planned.evLadder.take(usableFrames))
        } else planned
        burstPlan = plan
        Crash.step(this, "capture requested (${plan.frames} frames, iso ${plan.manualIso})")
        capturing = true
        burstFrames = ArrayList()
        burstShifts = ArrayList()
        overlay.processing = true
        overlay.processingStage = "AI capture • ${plan.frames} frames"
        overlay.processingProgress = 0.05f
        L.i("capture plan: ${plan.describe()}")
        if (plan.frames <= 1) {
            eng.requestStillCapture(single = true, raw = prefs.proRaw)
        } else {
            eng.requestBurstCapture(plan.frames, plan.evLadder,
                if (ai.nightMode) min(plan.manualIso, 1600) else 0,
                if (ai.nightMode) computeNightExposure(eng) else 0L)
        }
    }

    /** Night exposure limited to what the sensor + frame rate can actually hold. */
    private fun computeNightExposure(eng: CameraEngine): Long {
        val lens = eng.currentLens ?: return 0L
        val maxByRange = lens.exposureRange.upper
        val maxByFps = 1_000_000_000L / 30L * 3      // three frame intervals
        return min(min(maxByRange, maxByFps), 250_000_000L)
    }

    private fun handleSingleCapture(planes: Planes) {
        if (capturing) return
        Work.serial.execute {
            val faces = engine?.faces() ?: emptyList()
            val lens = engine?.currentLens
            val active = lens?.activeArray
            val regions = if (active != null && active.width() > 0) {
                Region.fromRects(faces, planes.w.toFloat() / active.width(),
                    planes.h.toFloat() / active.height())
            } else emptyList()
            val result = ai.processCapture(
                frames = listOf(planes), shifts = listOf(Shift.ZERO), evs = emptyList(),
                depth = null, faceRegions = regions, zoom = zoom,
                wantUltra = ai.aiUltra, wantEnhance = ai.aiEnhance || ai.nightMode,
                wantPortrait = ai.portraitMode, wantDocument = false,
                nativeLongEdge = max(planes.w, planes.h),
            )
            saveResult(result)
        }
    }

    private fun saveResult(result: AiResult) {
        val planes = result.planes
        if (planes == null) {
            uiSafe { toast(result.headline); finishProcessing() }
            return
        }
        val orientation = engine?.jpegOrientation() ?: 0
        val label = result.headline + " • " + planes.w + "×" + planes.h
        val description = result.label + "\n" + result.details.joinToString("\n")
        val saved = PhotoSaver.saveJpeg(
            this, planes, policy.jpegQuality, orientation, label, description,
            engine?.isFrontFacing() ?: false, prefs.mirrorFront,
        )
        // keep the unprocessed frame next to the result so the gallery can show
        // a truthful before/after comparison
        if (prefs.saveOriginal && result.before != null) {
            try {
                val originalFile = File(saved.file?.parentFile ?: cacheDir,
                    (saved.file?.name ?: "AIV_${System.currentTimeMillis()}.jpg")
                        .replace(".jpg", "_original.jpg"))
                java.io.FileOutputStream(originalFile).use { out ->
                    result.before.compress(android.graphics.Bitmap.CompressFormat.JPEG, 94, out)
                }
            } catch (t: Throwable) {
                L.w("original sidecar failed: ${t.message}")
            }
        }
        uiSafe {
            flashResult(
                "${result.headline} • ${planes.w}×${planes.h}",
                (result.details.take(3).joinToString(" • ") + " • saved " +
                    com.aivision.camera.core.Storage.humanSize(saved.bytes)),
            )
            updateThumb()
            finishProcessing()
        }
    }

    private fun finishProcessing() {
        capturing = false
        overlay.processing = false
        overlay.processingStage = ""
        overlay.processingProgress = 0f
        overlay.invalidate()
    }

    // ------------------------------------------------------------------- video
    private fun toggleRecording() {
        if (recording) {
            val file = video.stop()
            recording = false
            shutter.recording = false
            shutter.invalidate()
            if (file != null) {
                val spec = video.currentSpec()
                PhotoSaver.registerVideo(this, file, spec?.width ?: 0, spec?.height ?: 0,
                    "AI Vision ${spec?.label ?: "video"}")
                flashResult("Video saved", "${spec?.label ?: ""} • ${com.aivision.camera.core.Storage.humanSize(file.length())}")
                if (prefs.aiEnhancedVideo && spec?.aiEnhanced4k == true) transcodeTo4k(file)
                updateThumb()
            } else {
                toast("Recording failed")
            }
            engine?.setRecorderSurface(null)
            return
        }
        val eng = engine ?: return
        val lens = eng.currentLens ?: return
        val spec = video.chooseSpec(lens, prefs.videoResolution, prefs.videoFps, prefs.aiEnhancedVideo)
        val surface = video.prepare(this, lens, spec, eng.jpegOrientation(), audio = prefs.aiEnhancedVideo)
            ?: run { toast("Cannot start recording at ${spec.width}×${spec.height}"); return }
        eng.setRecorderSurface(surface)
        if (video.start()) {
            recording = true
            shutter.recording = true
            shutter.invalidate()
            if (spec.aiEnhanced4k) flashResult("Recording ${spec.label}",
                "AI Enhanced 4K: sensor max now, super-resolved after you stop")
            else flashResult("Recording ${spec.label}",
                "${spec.width}×${spec.height} @${spec.fps}fps ${spec.bitrate / 1_000_000}Mbps")
        } else {
            toast("Recorder failed to start")
            eng.setRecorderSurface(null)
        }
    }

    private fun transcodeTo4k(file: File) {
        val profile = ai.lastScene?.profile ?: EnhanceProfile.neutral()
        val tc = VideoTranscoder(this, policy, profile)
        transcoder = tc
        overlay.processing = true
        overlay.processingStage = "AI Enhanced 4K"
        Work.serial.execute {
            val out = tc.transcodeTo4k(file, 3840, object : VideoTranscoder.Progress {
                override fun onProgress(fraction: Float, stage: String) {
                    uiSafe {
                        overlay.processingProgress = fraction
                        overlay.processingStage = stage
                    }
                }
            })
            uiSafe {
                overlay.processing = false
                if (out != null) {
                    PhotoSaver.registerVideo(this, out, 3840, 2160, "AI Enhanced 4K")
                    flashResult("AI Enhanced 4K ready",
                        "${com.aivision.camera.core.Storage.humanSize(out.length())} • reconstructed from ${file.name}")
                    updateThumb()
                } else {
                    flashResult("AI Enhanced 4K unavailable",
                        "Kept the original recording - this device could not re-encode it")
                }
            }
        }
    }

    // ------------------------------------------------------------------ panorama
    private fun startPanorama() {
        val eng = engine ?: return
        panoramaFrames = ArrayList()
        panoramaActive = true
        overlay.hint = "Pan slowly, keep the centre on the horizon"
        eng.switchMode(CaptureMode.PANORAMA)
        panoramaCaptureLoop()
    }

    private fun panoramaCaptureLoop() {
        if (!panoramaActive) return
        engine?.captureFrameForSequence()
        if (panoramaFrames.size >= 14) {
            stopPanorama()
            return
        }
        overlay.postDelayed({ panoramaCaptureLoop() }, 700)
    }

    private fun stopPanorama() {
        panoramaActive = false
        overlay.hint = ""
        overlay.processing = true
        overlay.processingStage = "AI panorama stitch"
        val frames = ArrayList(panoramaFrames)
        panoramaFrames = ArrayList()
        engine?.switchMode(currentCaptureMode())
        Work.serial.execute {
            val result = ai.buildPanorama(frames)
            saveResult(result)
        }
    }

    // -------------------------------------------------------------------- macro
    /**
     * Macro: switch to the back lens that actually focuses closest (usually the
     * main wide sensor, sometimes a dedicated macro), put the AF into MACRO mode
     * and tell the user the real working distance instead of pretending every
     * lens can shoot at 2 cm.
     */
    private fun toggleMacro() {
        val eng = engine ?: run { toast("Camera starting…"); return }
        if (macroActive) {
            macroActive = false
            eng.setMacroFocus(false)
            eng.clearLensOverride()
            eng.setZoom(1f)
            flashResult("Macro off", "Back to normal lens selection")
            rebuildQuickRow()
            return
        }
        val group = registry.backGroup
        if (group == null) {
            flashResult("Macro unavailable", "No back camera reported")
            return
        }
        val lens = group.lenses
            .filter { it.minFocusDistance > 0f && it.facing == android.hardware.camera2.CameraMetadata.LENS_FACING_BACK }
            .maxByOrNull { it.minFocusDistance }
            ?: group.lenses.minByOrNull { it.equivFocal }
        if (lens == null) {
            flashResult("Macro unavailable", "No lens reported a focus range")
            return
        }
        val supportsMacroAf = lens.afModes.contains(
            android.hardware.camera2.CaptureRequest.CONTROL_AF_MODE_MACRO)
        macroActive = true
        eng.useLens(lens)
        eng.setMacroFocus(supportsMacroAf)
        val cm = if (lens.minFocusDistance > 0f) 100f / lens.minFocusDistance else 0f
        flashResult("Macro armed • ${lens.kind.label}",
            if (cm > 0f) "Closest focus ≈ ${"%.1f".format(cm)} cm" +
                (if (supportsMacroAf) " • close-range AF on" else " • AF only, stay inside that distance")
            else "Lens has no close-focus range • use document AI instead")
        rebuildQuickRow()
    }

    // -------------------------------------------------------------- slow motion
    private var slowMotionEnabled = false
    private var slowMotionFps = 120
    private var macroActive = false

    private fun toggleSlowMotion() {
        val eng = engine ?: return
        if (recording) { toast("Stop recording first"); return }
        val lens = eng.currentLens ?: return
        if (!slowMotionEnabled) {
            val size = lens.highSpeedSizes.maxByOrNull { it.width.toLong() * it.height }
            val range = lens.highSpeedFps.maxByOrNull { it.upper }
            if (size == null || range == null) {
                flashResult("Slow motion unavailable",
                    "This camera exposes no high-speed modes")
                return
            }
            slowMotionFps = range.upper
            if (!eng.setHighSpeedProfile(size, range.upper)) {
                flashResult("Slow motion unavailable", "High-speed profile rejected")
                return
            }
            slowMotionEnabled = true
            eng.switchMode(CaptureMode.SLOW_MOTION)
            eng.setHighSpeedEnabled(true)
            flashResult("Slow motion armed",
                "${size.width}×${size.height} @ ${range.upper}fps on this sensor")
        } else {
            slowMotionEnabled = false
            eng.setHighSpeedEnabled(false)
            eng.switchMode(currentCaptureMode())
            flashResult("Slow motion off", "Back to normal capture")
        }
        rebuildQuickRow()
    }

    // -------------------------------------------------------------- time lapse
    private fun toggleTimeLapse() {
        if (recording) { toast("Stop recording first"); return }
        if (!timeLapse.capturing) {
            timeLapse.intervalMs = 1000L
            timeLapse.start()
            timeLapseLoop()
            flashResult("Time-lapse started", "One frame per second, encoded to MP4 when you stop")
        } else {
            overlay.processing = true
            overlay.processingStage = "AI time-lapse encode"
            Work.serial.execute {
                val file = timeLapse.finishAndEncode(engine?.jpegOrientation() ?: 0)
                uiSafe {
                    overlay.processing = false
                    if (file != null) {
                        flashResult("Time-lapse saved", file.name)
                        updateThumb()
                    } else {
                        flashResult("Time-lapse ended", "No frames captured")
                    }
                    rebuildQuickRow()
                }
            }
        }
        rebuildQuickRow()
    }

    private fun timeLapseLoop() {
        if (!timeLapse.capturing) return
        engine?.captureFrameForSequence()
        overlay.postDelayed({ timeLapseLoop() }, timeLapse.intervalMs)
    }

    // ------------------------------------------------------------------ document
    private fun captureDocument() {
        val eng = engine ?: return
        overlay.processing = true
        overlay.processingStage = "AI document scan"
        eng.requestStillCapture(single = true)
        capturing = true
        // single frame arrives in onBurstFrame with total=1
    }

    // ---------------------------------------------------------------------- zoom
    private fun onZoomChanged(newZoom: Float) {
        zoom = newZoom
        engine?.setZoom(newZoom)
        val lensZoom = engine?.currentLens?.nativeZoom ?: 1f
        val hardwareMax = engine?.currentLens?.hardwareMaxZoom ?: 1f
        val aiZone = newZoom > lensZoom * hardwareMax * 0.98f || (prefs.autoZoomAi && newZoom >= 4f)
        val wasAi = aiZeomActive
        aiZeomActive = aiZone
        if (aiZone && !wasAi && prefs.autoZoomAi) {
            // AI enhancement activates itself in the digital zoom range
            if (!ai.aiEnhance) {
                ai.aiEnhance = true
                enhanceButton.active = true
                prefs.aiEnhance = true
            }
            flashResult("AI zoom engaged", "Super resolution is recovering detail beyond the optical range")
        }
        applyPreviewZoomOnly()
        overlay.zoomLabel = zoomLabelText(zoom)
        overlay.zoomIsAi = aiZeomActive
        overlay.invalidate()
    }

    private fun applyPreviewZoomOnly() {
        val hardware = engine?.currentHardwareZoom() ?: 1f
        val aiZoom = (zoom / max(0.5f, (engine?.currentLens?.nativeZoom ?: 1f) * hardware))
            .coerceIn(1f, 8f)
        preview.aiZoom = aiZoom
        preview.requestRender()
    }

    // ------------------------------------------------------------------- gestures
    private var downY = 0f
    private var downX = 0f
    private var pinchStartDistance = 0f
    private var pinchStartZoom = 1f

    private fun installGestures() {
        overlay.isClickable = true
        overlay.setOnTouchListener { _, event ->
            val view = overlay
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.x
                    downY = event.y
                    true
                }
                MotionEvent.ACTION_POINTER_DOWN -> {
                    if (event.pointerCount >= 2) {
                        pinchStartDistance = distanceBetween(event)
                        pinchStartZoom = zoom
                    }
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    if (event.pointerCount >= 2 && pinchStartDistance > 0f) {
                        val d = distanceBetween(event)
                        if (d > 0f) {
                            val factor = d / pinchStartDistance
                            val target = (pinchStartZoom * factor)
                                .coerceIn(zoomDial.minZoom, zoomDial.maxZoom)
                            zoomDial.zoom = target
                            onZoomChanged(target)
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val dx = abs(event.x - downX)
                    val dy = abs(event.y - downY)
                    if (dx < Ui.dp(this@MainActivity, 14f) && dy < Ui.dp(this@MainActivity, 14f) &&
                        event.y < view.height * 0.78f && !capturing) {
                        view.focusAt(event.x, event.y)
                        engine?.tapToFocus(event.x / view.width, event.y / view.height)
                        view.invalidate()
                    }
                    true
                }
                else -> true
            }
        }
    }

    private fun distanceBetween(event: MotionEvent): Float {
        if (event.pointerCount < 2) return 0f
        val dx = event.getX(0) - event.getX(1)
        val dy = event.getY(0) - event.getY(1)
        return kotlin.math.sqrt(dx * dx + dy * dy)
    }

    private fun registerSensors() {
        try {
            sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
            tiltSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_GRAVITY)
                ?: sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    val x = event.values.getOrNull(0) ?: 0f
                    val y = event.values.getOrNull(1) ?: 0f
                    val tilt = Math.toDegrees(kotlin.math.atan2(x.toDouble(), y.toDouble())).toFloat()
                    overlay.tiltDegrees = if (tilt > 90) tilt - 180 else if (tilt < -90) tilt + 180 else tilt
                }
                override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
            }
            tiltSensor?.let { sensorManager?.registerListener(listener, it, SensorManager.SENSOR_DELAY_UI) }
        } catch (t: Throwable) {
            L.w("sensors unavailable: ${t.message}")
        }
    }

    // --------------------------------------------------------------------- shell
    private fun refreshAiState() {
        engine?.setProcessCap(currentProcessCap())
        preview.aiActive = ai.aiEnhance || ai.aiUltra
        shutter.aiActive = ai.aiEnhance || ai.aiUltra
        shutter.invalidate()
        val scene = ai.lastScene
        if (scene != null) applySceneToPreview(scene)
        if (!ai.aiEnhance && !ai.aiUltra) preview.disableEnhancement()
        updateStatusBar()
    }

    private fun updateStatusBar() {
        statusBar.removeAllViews()
        val chip = TextView(this).apply {
            text = "  ${policy.tierLabel} AI • ${report.gpuRenderer.take(18)}  "
            setTextColor(Theme.accent)
            textSize = 10.5f
            letterSpacing = 0.06f
            background = Theme.pill(this@MainActivity, Theme.withAlpha(Theme.accentDim, 150))
            setPadding(Ui.dp(this@MainActivity, 8f), Ui.dp(this@MainActivity, 5f),
                Ui.dp(this@MainActivity, 8f), Ui.dp(this@MainActivity, 5f))
            setOnClickListener { showDeviceSheet() }
        }
        statusBar.addView(chip)
        val spacer = Space(this)
        statusBar.addView(spacer, LinearLayout.LayoutParams(0, 1, 1f))
        val settings = TextView(this).apply {
            text = "  SETTINGS  "
            setTextColor(Color.WHITE)
            textSize = 10.5f
            background = Theme.pill(this@MainActivity, Theme.withAlpha(Theme.surface, 200))
            setPadding(Ui.dp(this@MainActivity, 8f), Ui.dp(this@MainActivity, 5f),
                Ui.dp(this@MainActivity, 8f), Ui.dp(this@MainActivity, 5f))
            setOnClickListener { showSettingsSheet() }
        }
        statusBar.addView(settings)
    }

    private fun flashResult(headline: String, details: String) {
        resultBar.removeAllViews()
        val title = Theme.text(this@MainActivity, headline, 12.5f, Color.WHITE, bold = true)
        resultBar.addView(title)
        if (details.isNotEmpty()) {
            resultBar.addView(Theme.text(this@MainActivity, details, 10.5f, Theme.textSecondary))
        }
        resultBar.visibility = View.VISIBLE
        resultBar.alpha = 0f
        resultBar.animate().alpha(1f).setDuration(160).start()
        resultBar.postDelayed({
            resultBar.animate().alpha(0f).setDuration(220)
                .withEndAction { resultBar.visibility = View.GONE }.start()
        }, 4200)
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun showDeviceSheet() {
        val message = buildString {
            append("App: ${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE})\n")
            append("SoC: ${report.soc}\n")
            append("CPU: ${report.cores} cores @ ${"%.2f".format(report.maxFreqGhz)} GHz\n")
            append("RAM: ${"%.1f".format(report.ramGb)} GB\n")
            append("GPU: ${report.gpuRenderer}\n")
            append("GL: ${report.glesVersion} • max texture ${report.maxTextureSize}px\n")
            append("Android: ${report.androidRelease} (API ${report.sdkInt})\n")
            append("ABI: ${report.abi}\n")
            append("Device: ${report.buildDevice}\n")
            append("AI tier: ${policy.tierLabel} (score ${report.score})\n")
            append("Cameras: ${registry.summary()}\n")
            append("AI limits: stack ${policy.burstFrames}f, night ${policy.nightFrames}f, ")
            append("upscale ≤${policy.upscaleCapLongEdge}px, ${policy.threads} threads")
        }
        AlertDialog.Builder(this)
            .setTitle("Device & AI capabilities")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .setNeutralButton("Copy") { _, _ ->
                runCatching {
                    val clipboard = getSystemService(android.content.Context.CLIPBOARD_SERVICE)
                        as android.content.ClipboardManager
                    clipboard.setPrimaryClip(
                        android.content.ClipData.newPlainText("AI Vision report", message))
                    toast("Report copied")
                }
            }
            .show()
    }

    private fun showSettingsSheet() {
        val scroll = ScrollView(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(Ui.dp(this@MainActivity, 18f), Ui.dp(this@MainActivity, 14f),
                Ui.dp(this@MainActivity, 18f), Ui.dp(this@MainActivity, 14f))
            setBackgroundColor(Theme.surface)
        }
        fun section(title: String) {
            column.addView(Theme.label(this@MainActivity, title, Theme.accent))
            column.addView(Space(this), LinearLayout.LayoutParams(1, Ui.dp(this@MainActivity, 6f)))
        }
        fun toggle(label: String, checked: Boolean, onToggle: (Boolean) -> Unit) {
            val row = TextView(this).apply {
                text = "$label: ${if (checked) "ON" else "OFF"}"
                textSize = 13.5f
                setTextColor(if (checked) Color.WHITE else Theme.textSecondary)
                setPadding(0, Ui.dp(this@MainActivity, 10f), 0, Ui.dp(this@MainActivity, 10f))
                setOnClickListener {
                    val next = !(text.toString().endsWith("ON"))
                    onToggle(next)
                    text = "$label: ${if (next) "ON" else "OFF"}"
                    setTextColor(if (next) Color.WHITE else Theme.textSecondary)
                }
            }
            column.addView(row)
        }

        column.addView(Theme.label(this@MainActivity,
            "AI Vision Camera ${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE})",
            Theme.textSecondary))
        column.addView(Space(this), LinearLayout.LayoutParams(1, Ui.dp(this@MainActivity, 10f)))
        section("AI")
        toggle("AI Enhance", prefs.aiEnhance) { prefs.aiEnhance = it; ai.aiEnhance = it; enhanceButton.active = it; refreshAiState() }
        toggle("AI Ultra Resolution", prefs.aiUltra) { prefs.aiUltra = it; ai.aiUltra = it; ultraButton.active = it; refreshAiState() }
        toggle("AI at high zoom", prefs.autoZoomAi) { prefs.autoZoomAi = it }
        toggle("Scene detection", prefs.sceneDetection) { prefs.sceneDetection = it }
        toggle("Face enhancement", prefs.faceEnhance) { prefs.faceEnhance = it }
        toggle("Text enhancement", prefs.textEnhance) { prefs.textEnhance = it }
        toggle("HDR bracketing", prefs.hdrBracketing) { prefs.hdrBracketing = it }
        toggle("Save original alongside AI result", prefs.saveOriginal) { prefs.saveOriginal = it }

        section("Capture")
        toggle("Stabilisation", prefs.hybridStabilization) {
            prefs.hybridStabilization = it; engine?.setStabilization(it)
        }
        toggle("Save RAW (DNG)", prefs.proRaw) { prefs.proRaw = it; engine?.setRawStream(it) }
        toggle("Mirror front camera", prefs.mirrorFront) { prefs.mirrorFront = it }

        section("Video")
        toggle("AI Enhanced 4K", prefs.aiEnhancedVideo) { prefs.aiEnhancedVideo = it }
        val resRow = TextView(this).apply {
            text = "Resolution: ${prefs.videoResolution}"
            textSize = 13.5f
            setTextColor(Color.WHITE)
            setPadding(0, Ui.dp(this@MainActivity, 10f), 0, Ui.dp(this@MainActivity, 10f))
            setOnClickListener {
                val order = listOf("auto", "4K", "2K", "1080p", "720p")
                val next = order[(order.indexOf(prefs.videoResolution).coerceAtLeast(0) + 1) % order.size]
                prefs.videoResolution = next
                text = "Resolution: $next"
            }
        }
        column.addView(resRow)

        section("Performance")
        val tierRow = TextView(this).apply {
            text = "AI tier: ${policy.tierLabel}" +
                if (prefs.tierOverride >= 0) " (manual)" else " (auto-detected)"
            textSize = 13.5f
            setTextColor(Color.WHITE)
            setPadding(0, Ui.dp(this@MainActivity, 10f), 0, Ui.dp(this@MainActivity, 10f))
            setOnClickListener {
                prefs.tierOverride = when (prefs.tierOverride) {
                    -1 -> 0; 0 -> 1; 1 -> 2; else -> -1
                }
                policy = DeviceProfiler.policy(report, prefs.tierOverride)
                ai = AiEngine(policy, report).also {
                    it.aiEnhance = prefs.aiEnhance; it.aiUltra = prefs.aiUltra
                    it.setProgressListener(this@MainActivity)
                }
                video = VideoController(this@MainActivity, policy)
                text = "AI tier: ${policy.tierLabel}" +
                    if (prefs.tierOverride >= 0) " (manual)" else " (auto-detected)"
                updateStatusBar()
            }
        }
        column.addView(tierRow)
        column.addView(Theme.label(this@MainActivity, "Auto: ${report.soc} • ${report.cores} cores • " +
            "${"%.1f".format(report.ramGb)} GB RAM"), )
        column.addView(Theme.text(this@MainActivity,
            "AI processing: ${policy.threads} threads • stack ${policy.burstFrames} frames • " +
                "upscale ≤${policy.upscaleCapLongEdge}px", 11f, Theme.textSecondary))

        scroll.addView(column)
        AlertDialog.Builder(this).setView(scroll).setPositiveButton("Done", null).show()
    }

    private fun openGallery() {
        startActivity(Intent(this, GalleryActivity::class.java))
    }

    private fun updateThumb() {
        Work.io.execute {
            val latest = MediaRepo.latestThumbnail(this, Ui.dp(this@MainActivity, 120f))
            runOnUiThread {
                thumb.bitmap = latest?.first
                thumb.badge = latest?.second ?: ""
                thumb.invalidate()
            }
        }
    }

    // ------------------------------------------------------------------ helpers
    /** Small luma plane used for the burst alignment search. */
    private fun alignLuma(p: Planes): AlignImage {
        val target = 240
        val scale = max(1, max(p.w, p.h) / target)
        if (scale == 1) return AlignImage(p.y, p.w, p.h)
        val w = max(8, p.w / scale)
        val h = max(8, p.h / scale)
        return AlignImage(Imaging.resizeBilinear(p.y, p.w, p.h, w, h), w, h)
    }
}

/** Tiny container so the alignment step knows the plane's real dimensions. */
class AlignImage(val data: FloatArray, val w: Int, val h: Int)
