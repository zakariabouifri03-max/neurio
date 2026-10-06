package com.aivision4k.app.demo

import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.aivision4k.app.ui.AccentCyan
import com.aivision4k.app.ui.AccentViolet
import com.aivision4k.app.ui.AiVision4KTheme
import com.aivision4k.app.ui.DangerRed
import com.aivision4k.app.ui.GoodGreen
import com.aivision4k.app.ui.Hint
import com.aivision4k.app.ui.MetricRow
import com.aivision4k.app.ui.PanelCard
import com.aivision4k.app.ui.SelectChips
import com.aivision4k.app.ui.StatTile
import com.aivision4k.app.ui.StatusChip
import com.aivision4k.app.ui.SurfaceRaised
import com.aivision4k.app.ui.TextMuted
import com.aivision4k.app.ui.WarnAmber
import com.aivision4k.sdk.AndroidCapsCollector
import org.json.JSONObject

/**
 * The Vulkan demo scene, with the native/AI comparison on top of it.
 *
 * What this screen is: a landscape SurfaceView drawn by the native demo renderer
 * (`demo/v4k_demo_renderer.cpp`) with a Compose panel floating over it for the
 * controls and the live measurements. What it is *not*: a mock-up. Every number on
 * the panel comes from a frame that was actually presented, and the benchmark
 * refuses to publish a comparison until both sides have been measured on this
 * device.
 *
 * Threading is deliberately simple and matches what the native side expects:
 *
 *  * one dedicated render thread owns every native call, including configuration
 *    changes, because the engine and the Vulkan objects are not thread safe and
 *    the JNI layer takes a single mutex;
 *  * the panel is polled a few times a second (never per frame), so looking at the
 *    measurement does not change what is being measured;
 *  * the UI thread never blocks on the renderer: a control posts work and returns.
 *
 * Safety, because this drives a real GPU at up to 4K: the render loop stops itself
 * when the platform reports the device is running hot, and the frame-rate cap is
 * part of the panel. The demo is not allowed to cook a phone to make a benchmark
 * look good.
 */
class DemoActivity : ComponentActivity() {

    // -----------------------------------------------------------------------
    // State the panel observes. Written from the render thread or the poller,
    // both of which hand Compose a plain immutable copy.
    // -----------------------------------------------------------------------
    private var ui by mutableStateOf(DemoUiState())

    private var surfaceView: SurfaceView? = null
    private var renderThread: HandlerThread? = null
    private var renderHandler: Handler? = null
    private var pollHandler: Handler? = null

    private var surfaceReady = false
    private var loopRunning = false
    private var firstFrameNanos = 0L
    private var lastFrameNanos = 0L
    private var onScreen = false

    // One benchmark pass: which mode, when it ends, and where its frame count
    // started.
    private var passMode = -1
    private var passEndsAtMs = 0L
    private var passStartFrames = 0

    private val pollIntervalMs = 250L
    private val passDurationMs = 6000L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A benchmark that pauses because the screen dimmed would measure the
        // wrong thing.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val thread = HandlerThread("v4k-demo-render")
        thread.start()
        renderThread = thread
        renderHandler = Handler(thread.looper)
        pollHandler = Handler(Looper.getMainLooper())

        setContent {
            AiVision4KTheme {
                DemoScene(
                    state = ui,
                    onSurface = { view ->
                        surfaceView = view
                        view.holder.addCallback(surfaceCallback)
                    },
                    onConfig = ::postConfig,
                    onPass = ::startPass,
                    onToggleLoop = ::toggleLoop,
                    onFrameCap = { fps -> ui = ui.copy(frameCapFps = fps) },
                )
            }
        }

        renderHandler?.post {
            val error = if (DemoNativeBridge.loaded) DemoNativeBridge.nativeCreate() else NO_LIBRARY
            if (error != null) ui = ui.copy(fatal = error, ready = false)
        }
        pollHandler?.post(poller)
    }

    override fun onResume() {
        super.onResume()
        onScreen = true
        // The engine may have been initialised, or a model installed, while this
        // activity was in the background: re-read both before rendering resumes.
        renderHandler?.post { if (surfaceReady) publishConfig() }
        if (surfaceReady) {
            ui = ui.copy(paused = false)
            startLoop()
        }
    }

    override fun onPause() {
        onScreen = false
        stopLoop("paused")
        ui = ui.copy(paused = true)
        super.onPause()
    }

    override fun onDestroy() {
        pollHandler?.removeCallbacksAndMessages(null)
        // quitSafely() runs the teardown that was just posted before the thread
        // exits, so the renderer is gone before the process lets go of the
        // Surface.
        renderHandler?.post { if (DemoNativeBridge.loaded) DemoNativeBridge.nativeSurfaceDestroyed() }
        renderThread?.quitSafely()
        renderThread = null
        renderHandler = null
        super.onDestroy()
    }

    // -----------------------------------------------------------------------
    // Surface
    // -----------------------------------------------------------------------

    private val surfaceCallback = object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
            Log.i(TAG, "surface created")
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            if (width <= 0 || height <= 0) return
            val first = surfaceReady.not()
            surfaceReady = true
            ui = ui.copy(ready = true)
            renderHandler?.post {
                if (!DemoNativeBridge.loaded) {
                    ui = ui.copy(fatal = NO_LIBRARY, ready = false)
                    return@post
                }
                val error = if (first) {
                    DemoNativeBridge.nativeSurfaceCreated(holder.surface, width, height)
                } else {
                    DemoNativeBridge.nativeSurfaceChanged(holder.surface, width, height)
                }
                if (error != null) {
                    ui = ui.copy(fatal = error, ready = false)
                    return@post
                }
                // The resolution ladder lives natively; read it back rather than
                // keeping a second copy of it in Kotlin where the two could drift.
                publishConfig()
                if (onScreen) {
                    ui = ui.copy(paused = false)
                    startLoop()
                }
            }
        }

        override fun surfaceDestroyed(holder: SurfaceHolder) {
            surfaceReady = false
            renderHandler?.post {
                stopLoop("surface destroyed")
                if (DemoNativeBridge.loaded) DemoNativeBridge.nativeSurfaceDestroyed()
            }
        }
    }

    // -----------------------------------------------------------------------
    // Render loop
    // -----------------------------------------------------------------------

    private val frameRunnable = object : Runnable {
        override fun run() {
            if (!loopRunning || !surfaceReady) return
            val now = System.nanoTime()
            if (firstFrameNanos == 0L) firstFrameNanos = now
            // A stalled frame must not teleport the animation: the delta is
            // clamped, so the scene advances by wall-clock time but a two-second
            // hiccup does not fling the particles across the map.
            val delta = if (lastFrameNanos == 0L) 1.0 / 60.0
            else ((now - lastFrameNanos) / 1e9).coerceIn(0.0, 0.1)
            lastFrameNanos = now
            val elapsed = (now - firstFrameNanos) / 1e9

            val error = DemoNativeBridge.nativeRenderFrame(delta, elapsed)
            if (error != null) {
                loopRunning = false
                ui = ui.copy(fatal = error, paused = true)
                return
            }

            // Frame pacing. 0 means "as fast as the device can draw", which is the
            // honest setting for a measurement; the caps exist so a user can also
            // see the scene at a fixed rate, the way a game would run it.
            val cap = ui.frameCapFps
            val delay = if (cap <= 0) 1L else {
                val spentMs = (System.nanoTime() - now) / 1_000_000L
                (1_000L / cap - spentMs).coerceAtLeast(0L)
            }
            renderHandler?.postDelayed(this, delay)
        }
    }

    private fun startLoop() {
        if (loopRunning || !surfaceReady || !DemoNativeBridge.loaded) return
        loopRunning = true
        lastFrameNanos = 0L
        renderHandler?.post(frameRunnable)
    }

    private fun stopLoop(reason: String) {
        loopRunning = false
        renderHandler?.removeCallbacks(frameRunnable)
        Log.i(TAG, "render loop stopped ($reason)")
    }

    private fun toggleLoop() {
        if (loopRunning) {
            stopLoop("user")
            ui = ui.copy(paused = true)
        } else {
            ui = ui.copy(paused = false, fatal = null)
            startLoop()
        }
    }

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    /** Posts a partial configuration to the render thread and republishes it. */
    private fun postConfig(patch: JSONObject) {
        renderHandler?.post {
            if (!DemoNativeBridge.loaded || !surfaceReady) return@post
            val error = DemoNativeBridge.nativeSetConfig(patch.toString())
            if (error != null) {
                // A rejected configuration is shown, not swallowed: the reason is
                // usually something the user can act on.
                ui = ui.copy(message = error)
                return@post
            }
            publishConfig()
        }
    }

    private fun publishConfig() {
        val config = runCatching { JSONObject(DemoNativeBridge.nativeConfigJson()) }.getOrNull()
        val features = runCatching { JSONObject(DemoNativeBridge.nativeFeatureJson()) }.getOrNull()
        ui = ui.copy(config = config, features = features)
    }

    // -----------------------------------------------------------------------
    // Polling: the panel's numbers and the thermal guard
    // -----------------------------------------------------------------------

    private val poller = object : Runnable {
        override fun run() {
            if (onScreen) {
                renderHandler?.post {
                    if (DemoNativeBridge.loaded && surfaceReady) {
                        val status = runCatching { JSONObject(DemoNativeBridge.nativeStatusJson()) }
                            .getOrNull()
                        val benchmark = runCatching { JSONObject(DemoNativeBridge.nativeBenchmarkJson()) }
                            .getOrNull()
                        ui = ui.copy(status = status, benchmark = benchmark, session = readSession(status))
                        val pass = pollPass(status)
                        if (pass != ui.pass) ui = ui.copy(pass = pass)
                    }
                }
                // Thermal safety. The platform says how hot the device is running;
                // at SEVERE the loop stops by itself and explains why. The user can
                // restart it deliberately — the app never keeps drawing 4K into a
                // phone that is throttling.
                val thermal = thermalStatus()
                val battery = runCatching { AndroidCapsCollector.batteryTemperatureC(this@DemoActivity) }
                    .getOrNull()
                ui = ui.copy(thermalStatus = thermal, batteryC = battery)
                if (thermal != null && thermal >= PowerManager.THERMAL_STATUS_SEVERE && loopRunning) {
                    stopLoop("thermal $thermal")
                    ui = ui.copy(
                        paused = true,
                        message = "Rendering stopped: the device reports thermal status " +
                            "$thermal" + (battery?.let { " at %.1f °C".format(it) } ?: "") +
                            ". Let it cool, or choose a lower resolution, and resume.",
                    )
                }
            }
            pollHandler?.postDelayed(this, pollIntervalMs)
        }
    }

    private fun thermalStatus(): Int? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        val manager = getSystemService(PowerManager::class.java) ?: return null
        return try {
            manager.currentThermalStatus
        } catch (error: RuntimeException) {
            null
        }
    }

    /** Advances a running benchmark pass and closes it when its time is up. */
    private fun pollPass(status: JSONObject?): PassState? {
        if (passMode < 0) return null
        val frames = status?.optJSONObject("frameStats")?.optInt("frames") ?: 0
        val leftMs = (passEndsAtMs - SystemClock.elapsedRealtime()).coerceAtLeast(0L)
        if (leftMs > 0L) {
            return PassState(passMode, (leftMs / 1000L).toInt(), frames - passStartFrames)
        }
        DemoNativeBridge.nativeEndBenchmark()
        val finished = passMode
        passMode = -1
        ui = ui.copy(
            message = "Measured ${if (finished == MODE_NATIVE) "native" else "AI upscaling"} for " +
                "${passDurationMs / 1000} s (${frames - passStartFrames} frames).",
        )
        return null
    }

    private fun startPass(mode: Int) {
        if (!surfaceReady || !DemoNativeBridge.loaded) {
            ui = ui.copy(message = "The renderer is not running yet.")
            return
        }
        if (!loopRunning) {
            ui = ui.copy(message = "Resume the scene first: a paused demo has no frames to measure.")
            return
        }
        // The AI column may only be measured when the AI stage is actually
        // running. Otherwise it would be a low-resolution render presented at the
        // output size, and publishing that as "AI upscaling" would be a lie
        // dressed up as a benchmark.
        if (mode == MODE_AI) {
            val session = ui.session
            if (session == null || !session.running) {
                ui = ui.copy(
                    message = "The AI stage is not running, so there is nothing to measure. " +
                        (session?.reason
                            ?: "Install a model on the AI Engine screen and it will start with the next frame."),
                )
                return
            }
        }
        renderHandler?.post {
            // A pass switches the mode as well: comparing a mode with itself would
            // measure nothing.
            val configError = DemoNativeBridge.nativeSetConfig(JSONObject().put("mode", mode).toString())
            if (configError != null) {
                ui = ui.copy(message = configError)
                return@post
            }
            publishConfig()
            val error = DemoNativeBridge.nativeBeginBenchmark(mode)
            if (error != null) {
                ui = ui.copy(message = error)
                return@post
            }
            passStartFrames = ui.status?.optJSONObject("frameStats")?.optInt("frames") ?: 0
            passEndsAtMs = SystemClock.elapsedRealtime() + passDurationMs
            passMode = mode
            ui = ui.copy(pass = PassState(mode, (passDurationMs / 1000).toInt(), 0))
        }
    }

    /** What the panel needs to know about the AI stage. */
    private fun readSession(status: JSONObject?): SessionState? {
        if (status == null) return null
        if (status.isNull("session")) {
            return SessionState(running = false, reason = "The engine is not available in this build.", stageMs = null)
        }
        val active = status.optBoolean("sessionActive") &&
            status.optJSONObject("session")?.optBoolean("active") == true
        val stages = status.optJSONObject("gpuStages")
        val stageMs = if (stages != null && stages.optBoolean("available")) {
            stages.optDouble("totalMs").takeIf { it.isFinite() && it > 0.0 }
        } else {
            null
        }
        val reason = status.optString("lastError").takeIf { it.isNotEmpty() }
            ?: status.optJSONObject("session")?.optString("lastError")?.takeIf { it.isNotEmpty() }
        return SessionState(active, if (active) null else reason, stageMs)
    }

    private companion object {
        const val TAG = "AiVision4K/demo"
        const val NO_LIBRARY =
            "The native engine library did not load, so the demo cannot render. " +
                "This is a build problem (libaivision4k.so), not a device one."
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Everything the panel shows, as one immutable snapshot. */
private data class DemoUiState(
    val ready: Boolean = false,
    /** A condition that stopped rendering entirely; shown in red. */
    val fatal: String? = null,
    val paused: Boolean = false,
    /** The newest status snapshot from the native renderer. */
    val status: JSONObject? = null,
    val config: JSONObject? = null,
    val features: JSONObject? = null,
    val benchmark: JSONObject? = null,
    val session: SessionState? = null,
    val pass: PassState? = null,
    val thermalStatus: Int? = null,
    val batteryC: Float? = null,
    /** A transient explanation: what was measured, or why a control was refused. */
    val message: String? = null,
    /** 0 = uncapped, otherwise the ceiling the loop paces itself to. */
    val frameCapFps: Int = 60,
)

private data class PassState(val mode: Int, val secondsLeft: Int, val frames: Int)

/**
 * The two sides of the comparison, as `DemoMode` numbers.
 *
 * File scope rather than a companion: the panel composables are top-level and
 * could not see a private companion's members.
 */
private const val MODE_NATIVE = 0
private const val MODE_AI = 1

private data class SessionState(val running: Boolean, val reason: String?, val stageMs: Double?)

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

@Composable
private fun DemoScene(
    state: DemoUiState,
    onSurface: (SurfaceView) -> Unit,
    onConfig: (JSONObject) -> Unit,
    onPass: (Int) -> Unit,
    onToggleLoop: () -> Unit,
    onFrameCap: (Int) -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                SurfaceView(context).also { view ->
                    view.holder.setFormat(android.graphics.PixelFormat.OPAQUE)
                    onSurface(view)
                }
            },
        )
        if (state.ready) {
            // The panel is dense on purpose: it is an instrument, and the scene
            // behind it is the point, so it collapses when it is in the way.
            var collapsed by remember { mutableStateOf(false) }
            Column(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .padding(12.dp)
                    .fillMaxHeight()
                    .width(330.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Header(state, collapsed) { collapsed = !collapsed }
                if (!collapsed) {
                    state.fatal?.let { Banner(it, DangerRed) }
                    state.message?.let { Banner(it, AccentCyan) }
                    if (!state.sessionRunning()) {
                        Banner(
                            "The AI stage is not running" +
                                (state.session?.reason?.let { ": $it" }
                                    ?: ", so AI mode presents the low-resolution render. " +
                                    "Install a model on the AI Engine screen."),
                            WarnAmber,
                        )
                    }
                    LiveCard(state)
                    Modes(state, onConfig)
                    LadderCard(state, onConfig)
                    QualityCard(state, onConfig)
                    LookCard(state, onConfig)
                    BenchmarkCard(state, onPass)
                    Controls(state, onConfig, onToggleLoop, onFrameCap)
                    Hint(
                        "Every number on this panel was measured on this device. Values " +
                            "the device did not report are shown as unavailable, never as zero.",
                    )
                }
            }
        } else {
            Surface(
                modifier = Modifier.align(Alignment.Center),
                color = SurfaceRaised,
                shape = RoundedCornerShape(14.dp),
            ) {
                Text(
                    text = state.fatal ?: "Starting the Vulkan device…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (state.fatal != null) DangerRed else TextMuted,
                    modifier = Modifier.padding(18.dp),
                )
            }
        }
    }
}

private fun DemoUiState.sessionRunning(): Boolean =
    session?.running == true || (session == null && features?.optBoolean("sessionRunning") == true)

@Composable
private fun Header(state: DemoUiState, collapsed: Boolean, onToggle: () -> Unit) {
    Surface(color = SurfaceRaised, shape = RoundedCornerShape(14.dp)) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "AI Vision 4K demo scene",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                // The config carries indices into the ladder, so the names are
                // resolved from the same array the chips are built from.
                val config = state.config
                val subtitle = if (config == null) {
                    "…"
                } else {
                    val render = ladderName(config, config.optInt("renderIndex"))
                    val output = ladderName(config, config.optInt("outputIndex"))
                    "${config.optString("modeName")} · $render → $output"
                }
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = AccentViolet,
                )
            }
            StatusChip(
                text = when {
                    state.fatal != null -> "STOPPED"
                    state.paused -> "PAUSED"
                    else -> "RUNNING"
                },
                color = when {
                    state.fatal != null -> DangerRed
                    state.paused -> WarnAmber
                    else -> GoodGreen
                },
            )
            TextButton(onClick = onToggle) {
                Text(if (collapsed) "Show" else "Hide", color = AccentCyan)
            }
        }
    }
}

@Composable
private fun Banner(text: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.12f),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, color.copy(alpha = 0.5f)),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = color,
            modifier = Modifier.padding(10.dp),
        )
    }
}

@Composable
private fun LiveCard(state: DemoUiState) {
    val stats = state.status?.optJSONObject("frameStats")
    val fps = stats?.optDoubleOrNull("fps")
    val meanMs = stats?.optDoubleOrNull("meanFrameMs")
    val lowMs = stats?.optDoubleOrNull("onePercentLowMs")
    val stageMs = state.session?.stageMs

    PanelCard(title = "Measured now", accent = AccentCyan) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile(
                label = "fps",
                value = fps?.let { "%.0f".format(it) } ?: "—",
                modifier = Modifier.weight(1f),
                accent = if ((fps ?: 0.0) >= 50.0) GoodGreen else AccentCyan,
            )
            StatTile(
                label = "frame",
                value = meanMs?.let { "%.1f".format(it) } ?: "—",
                unit = "ms",
                modifier = Modifier.weight(1f),
            )
            StatTile(
                label = "1% low",
                value = lowMs?.let { "%.1f".format(it) } ?: "—",
                unit = "ms",
                modifier = Modifier.weight(1f),
                accent = WarnAmber,
            )
        }
        Spacer(Modifier.height(8.dp))
        MetricRow(
            "Render → output",
            ladderPair(state.status, "renderWidth", "renderHeight") + "  →  " +
                ladderPair(state.status, "outputWidth", "outputHeight"),
        )
        MetricRow(
            "Scene pass",
            ladderPair(state.status, "scenePassWidth", "scenePassHeight"),
            muted = true,
        )
        MetricRow(
            "AI stage (GPU)",
            stageMs?.let { "%.2f ms".format(it) } ?: "unavailable",
            accent = if (stageMs != null) AccentViolet else null,
            muted = stageMs == null,
        )
        MetricRow("Frames drawn", state.status?.optInt("frames")?.toString() ?: "0", muted = true)
        state.thermalStatus?.let { thermal ->
            MetricRow(
                "Thermal status",
                thermalName(thermal) + (state.batteryC?.let { " · %.1f °C".format(it) } ?: ""),
                accent = if (thermal >= 3) DangerRed else if (thermal == 2) WarnAmber else GoodGreen,
            )
        }
    }
}

@Composable
private fun Modes(state: DemoUiState, onConfig: (JSONObject) -> Unit) {
    PanelCard(title = "Upscaling mode", accent = AccentViolet) {
        SelectChips(
            options = listOf("Native", "AI Upscaled", "Split compare"),
            selectedIndex = state.config?.optInt("mode") ?: 0,
            onSelect = { index -> onConfig(JSONObject().put("mode", index)) },
        )
        Hint(
            "Native renders at the output resolution. AI Upscaled renders low and " +
                "upscales through the engine. Split compare shows both at once.",
        )
    }
}

@Composable
private fun LadderCard(state: DemoUiState, onConfig: (JSONObject) -> Unit) {
    val names = ladderNames(state.config)
    PanelCard(title = "Resolutions") {
        Text("Render at", style = MaterialTheme.typography.labelSmall, color = TextMuted)
        SelectChips(
            options = names,
            selectedIndex = state.config?.optInt("renderIndex") ?: 0,
            onSelect = { index -> onConfig(JSONObject().put("renderIndex", index)) },
        )
        Spacer(Modifier.height(6.dp))
        Text("Upscale to", style = MaterialTheme.typography.labelSmall, color = TextMuted)
        SelectChips(
            options = names,
            selectedIndex = state.config?.optInt("outputIndex") ?: 2,
            onSelect = { index -> onConfig(JSONObject().put("outputIndex", index)) },
        )
        if (state.config?.optBoolean("upscales") == false) {
            Hint(
                "Render and output are the same size: this is a native render, so " +
                    "the AI stage stays off.",
                WarnAmber,
            )
        }
    }
}

@Composable
private fun QualityCard(state: DemoUiState, onConfig: (JSONObject) -> Unit) {
    val names = qualityNames(state.config)
    PanelCard(title = "AI quality") {
        SelectChips(
            options = names,
            selectedIndex = state.config?.optInt("quality") ?: 1,
            onSelect = { index -> onConfig(JSONObject().put("quality", index)) },
        )
        Hint("Higher quality asks for more layers and more of the scene, and costs frame time.")
    }
}

@Composable
private fun LookCard(state: DemoUiState, onConfig: (JSONObject) -> Unit) {
    val split = state.config?.optDouble("splitPosition")?.toFloat() ?: 0.5f
    val magnifier = state.config?.optDouble("magnifierScale")?.toFloat() ?: 1.0f
    PanelCard(title = "Comparison view") {
        Text(
            "Split position  ${"%.0f".format(split * 100)}%",
            style = MaterialTheme.typography.labelSmall,
            color = TextMuted,
        )
        Slider(
            value = split,
            onValueChange = { onConfig(JSONObject().put("splitPosition", it.toDouble())) },
            valueRange = 0.15f..0.85f,
        )
        Text(
            "Magnifier  ${if (magnifier <= 1.01f) "off" else "%.1f×".format(magnifier)}",
            style = MaterialTheme.typography.labelSmall,
            color = TextMuted,
        )
        Slider(
            value = magnifier,
            onValueChange = { onConfig(JSONObject().put("magnifierScale", it.toDouble())) },
            valueRange = 1.0f..4.0f,
        )
        Hint(
            "The magnifier zooms the same screen region on both sides, which is " +
                "where the difference actually shows.",
        )
    }
}

@Composable
private fun BenchmarkCard(state: DemoUiState, onPass: (Int) -> Unit) {
    val pass = state.pass
    val report = state.benchmark
    PanelCard(title = "Native vs AI upscaling", accent = AccentCyan) {
        if (pass != null) {
            Text(
                text = "Measuring ${if (pass.mode == MODE_NATIVE) "native" else "AI upscaling"}… " +
                    "${pass.secondsLeft} s left (${pass.frames} frames)",
                style = MaterialTheme.typography.bodyMedium,
                color = AccentCyan,
            )
        } else if (report?.optBoolean("ready") == true) {
            MetricRow("Native", report.optDoubleOrNull("nativeFps")?.let { "%.1f FPS".format(it) } ?: "unavailable")
            MetricRow("AI upscaling", report.optDoubleOrNull("aiFps")?.let { "%.1f FPS".format(it) } ?: "unavailable")
            val deltaMs = report.optDoubleOrNull("frameTimeDeltaMs")
            MetricRow(
                "Frame time delta",
                if (deltaMs != null) {
                    "%+.2f ms (%+.1f%%)".format(deltaMs, report.optDoubleOrNull("frameTimeDeltaPercent") ?: 0.0)
                } else {
                    "unavailable"
                },
                accent = if ((deltaMs ?: 0.0) > 0.0) WarnAmber else GoodGreen,
            )
            MetricRow(
                "AI stage per frame",
                report.optDoubleOrNull("aiStageMs")?.let { "%.2f ms".format(it) } ?: "unavailable",
                muted = true,
            )
            MetricRow(
                "Render width",
                "${report.optInt("nativeRenderWidth")} (native) → ${report.optInt("aiRenderWidth")} (AI)",
                muted = true,
            )
            Hint(report.optString("note"), accent = TextMuted)
        } else {
            Text(
                text = "Nothing published yet: " + (
                    report?.optString("missing")?.takeIf { it.isNotEmpty() }?.let { "still need $it" }
                        ?: "no measurement has run"
                    ),
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted,
            )
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onPass(MODE_NATIVE) },
                enabled = pass == null,
                modifier = Modifier.weight(1f),
            ) { Text("Measure native") }
            Button(
                onClick = { onPass(MODE_AI) },
                enabled = pass == null,
                modifier = Modifier.weight(1f),
            ) { Text("Measure AI") }
        }
        Hint(
            "Each button runs that mode for six seconds at the current settings; the " +
                "comparison appears once both sides have been measured. Nothing is " +
                "extrapolated from one run.",
        )
    }
}

@Composable
private fun Controls(
    state: DemoUiState,
    onConfig: (JSONObject) -> Unit,
    onToggleLoop: () -> Unit,
    onFrameCap: (Int) -> Unit,
) {
    PanelCard(title = "Render loop") {
        SelectChips(
            options = listOf("30", "60", "120", "Uncapped"),
            selectedIndex = when (state.frameCapFps) {
                30 -> 0
                60 -> 1
                120 -> 2
                else -> 3
            },
            onSelect = { index -> onFrameCap(listOf(30, 60, 120, 0)[index]) },
        )
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onToggleLoop, modifier = Modifier.weight(1f)) {
                Text(if (state.paused) "Resume" else "Pause")
            }
            TextButton(
                onClick = { onConfig(JSONObject().put("seed", (System.currentTimeMillis() % 100000L))) },
                modifier = Modifier.weight(1f),
            ) { Text("New scene", color = AccentCyan) }
        }
        state.features?.let { features ->
            Hint(
                "Engine ${if (features.optBoolean("engineAttached")) "attached" else "unavailable"} · " +
                    "model ${if (features.optBoolean("modelInstalled")) "installed" else "not installed"} · " +
                    "session ${if (features.optBoolean("sessionRunning")) "running" else "stopped"}",
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

private fun ladderNames(config: JSONObject?): List<String> {
    val array = config?.optJSONArray("resolutions") ?: return emptyList()
    return (0 until array.length()).map { array.optJSONObject(it)?.optString("name") ?: "?" }
}

private fun ladderName(config: JSONObject?, index: Int): String =
    config?.optJSONArray("resolutions")?.optJSONObject(index)?.optString("name") ?: "?"

private fun qualityNames(config: JSONObject?): List<String> {
    val array = config?.optJSONArray("qualities") ?: return emptyList()
    return (0 until array.length()).map { array.optJSONObject(it)?.optString("name") ?: "?" }
}

/** `1920×1080`, or `?` when the value was not reported. */
private fun ladderPair(source: JSONObject?, widthKey: String, heightKey: String): String {
    if (source == null) return "?"
    val width = source.optInt(widthKey, 0)
    val height = source.optInt(heightKey, 0)
    if (width <= 0 || height <= 0) return "?"
    return "$width×$height"
}

private fun thermalName(status: Int): String = when (status) {
    0 -> "none"
    1 -> "light"
    2 -> "moderate"
    3 -> "severe"
    4 -> "critical"
    5 -> "emergency"
    6 -> "shutdown"
    else -> "status $status"
}

/** JSON `null` means "not measured"; that is not zero and must not display as one. */
private fun JSONObject.optDoubleOrNull(key: String): Double? {
    if (!has(key) || isNull(key)) return null
    val value = optDouble(key, Double.NaN)
    return if (value.isFinite()) value else null
}
