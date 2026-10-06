package com.neurio.client

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.neurio.R
import com.neurio.app.PerformanceActivity
import com.neurio.app.PrefsStore
import com.neurio.common.PerfBus
import com.neurio.common.StatsSnapshot
import java.net.InetSocketAddress

/**
 * Fullscreen live game player: hardware-decoded video on a SurfaceView,
 * virtual controller overlay, HUD pills and the mirror-touch layer.
 */
class StreamViewActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "StreamView"
    }

    private lateinit var client: StreamClient
    private lateinit var sender: InputSender
    private var decoder: VideoDecoder? = null
    private val audioPlayer = AudioPlayer()

    private lateinit var surfaceHolderView: com.neurio.client.StreamSurfaceView
    private lateinit var overlay: ControllerOverlay
    private lateinit var hudTitle: TextView
    private lateinit var hudRes: TextView
    private lateinit var hudFps: TextView
    private lateinit var hudPing: TextView
    private lateinit var hudQuality: TextView
    private lateinit var menuPanel: LinearLayout
    private lateinit var editPanel: LinearLayout
    private lateinit var progress: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var btnMirror: Button

    private var surfaceReady = false
    private var connectAttempted = false
    private var mirrorTouch = true
    private var started: StreamStarted? = null

    private val handler = Handler(Looper.getMainLooper())
    private var pendingConfig: ByteArray? = null
    private var adaptPending = false
    private var adaptWidth = 0
    private var adaptHeight = 0

    private val hudTicker = object : Runnable {
        override fun run() {
            updateHud()
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_stream)

        val host = PendingSession.host
        val manual = PendingSession.manualAddress
        val code = PendingSession.pairingCode
        val config = PendingSession.config
        if ((host == null && manual == null) || code.isBlank() || config == null) {
            Toast.makeText(this, R.string.session_missing, Toast.LENGTH_LONG).show()
            finish()
            return
        }
        mirrorTouch = PrefsStore(this).mirrorTouchDefault()

        client = StreamClient()
        sender = InputSender(client)

        surfaceHolderView = findViewById(R.id.streamSurface)
        overlay = findViewById(R.id.controllerOverlay)
        hudTitle = findViewById(R.id.tvStreamTitle)
        hudRes = findViewById(R.id.tvHudRes)
        hudFps = findViewById(R.id.tvHudFps)
        hudPing = findViewById(R.id.tvHudPing)
        hudQuality = findViewById(R.id.tvHudQuality)
        menuPanel = findViewById(R.id.menuPanel)
        editPanel = findViewById(R.id.editPanel)
        progress = findViewById(R.id.progressStream)
        statusText = findViewById(R.id.tvStreamStatus)
        btnMirror = findViewById(R.id.btnMirrorTouch)

        findViewById<ImageButton>(R.id.btnMenu).setOnClickListener { toggleMenu() }
        findViewById<Button>(R.id.btnToggleControls).setOnClickListener { toggleControls() }
        findViewById<Button>(R.id.btnEditLayout).setOnClickListener { toggleEditMode() }
        btnMirror.setOnClickListener { toggleMirrorTouch() }
        findViewById<Button>(R.id.btnPerf).setOnClickListener {
            startActivity(Intent(this, PerformanceActivity::class.java))
        }
        findViewById<Button>(R.id.btnDisconnect).setOnClickListener { confirmDisconnect() }
        findViewById<Button>(R.id.btnResizeUp).setOnClickListener { overlay.resizeAll(+0.1f) }
        findViewById<Button>(R.id.btnResizeDown).setOnClickListener { overlay.resizeAll(-0.1f) }
        findViewById<Button>(R.id.btnEditDone).setOnClickListener { toggleEditMode() }

        overlay.applySavedJson(PrefsStore(this).controllerLayoutJson())
        overlay.enableDragging()
        overlay.onLayoutEdited = { PrefsStore(this).saveControllerLayoutJson(overlay.saveJson()) }
        overlay.onAxis = { axisId, x, y -> sender.axis(axisId, x, y) }
        overlay.onButton = { buttonId, pressed -> sender.button(buttonId, pressed) }
        updateMirrorLabel()

        wireClient()
        setupSurface(host, manual, code, config)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        enterImmersive()
        window.setKeepScreenOn(true)
        handler.post(hudTicker)
    }

    // ------------------------------------------------------------------ wiring

    private fun wireClient() {
        client.decoderFpsProvider = { decoder?.renderedFps ?: 0.0 }
        client.decoderMsProvider = { decoder?.decodeLatencyMs ?: 0.0 }

        client.onVideoFrame = { data, size, pts, key, config ->
            handler.post {
                if (config) {
                    pendingConfig = data.copyOf(size)
                    val s = started ?: return@post
                    val w = if (adaptPending) adaptWidth else s.width
                    val h = if (adaptPending) adaptHeight else s.height
                    if (decoder == null && surfaceReady && surfaceHolderView.holder.surface.isValid) {
                        decoder = VideoDecoder(surfaceHolderView.holder.surface)
                    }
                    decoder?.applyConfig(pendingConfig!!, w, h, s.videoMime)
                    adaptPending = false
                } else {
                    decoder?.decode(data, size, pts)
                }
            }
        }
        client.onAudioFrame = { data, size, pts, config ->
            if (config) {
                handler.post { audioPlayer.feedConfig(data.copyOf(size)) }
            } else {
                audioPlayer.feed(data, size, pts)
            }
        }

        client.listener = object : StreamClient.Listener {
            override fun onConnecting(host: String) {
                showStatus(getString(R.string.status_connecting, host))
            }

            override fun onPaired(hostName: String) {
                showStatus(getString(R.string.status_starting))
                hudTitle.text = hostName
            }

            override fun onStarted(s: StreamStarted) {
                started = s
                runOnUiThread {
                    progress.visibility = View.GONE
                    statusText.visibility = View.GONE
                    hudRes.text = "${s.width}×${s.height}"
                    if (s.audioMime.isNotEmpty()) {
                        audioPlayer.start(s.audioMime, s.audioSampleRate, s.audioChannels)
                    }
                    val note = audioNote(s)
                    if (note.isNotEmpty()) Toast.makeText(this@StreamViewActivity, note, Toast.LENGTH_LONG).show()
                }
            }

            override fun onAdapt(width: Int, height: Int, fps: Int, bitrateKbps: Int) {
                adaptPending = true
                adaptWidth = width
                adaptHeight = height
                runOnUiThread {
                    Toast.makeText(
                        this@StreamViewActivity,
                        getString(R.string.status_adapting, width, height, fps),
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }

            override fun onDisconnected(reason: String) {
                runOnUiThread {
                    AlertDialog.Builder(this@StreamViewActivity)
                        .setTitle(R.string.stream_ended)
                        .setMessage(reason)
                        .setPositiveButton(R.string.ok) { _, _ -> finish() }
                        .setCancelable(false)
                        .show()
                }
            }

            override fun onError(message: String) {
                runOnUiThread {
                    progress.visibility = View.GONE
                    statusText.visibility = View.VISIBLE
                    statusText.setText(R.string.status_error)
                    AlertDialog.Builder(this@StreamViewActivity)
                        .setTitle(R.string.stream_ended)
                        .setMessage(message)
                        .setPositiveButton(R.string.ok) { _, _ -> finish() }
                        .setCancelable(false)
                        .show()
                }
            }
        }
    }

    private fun audioNote(s: StreamStarted): String = when (s.audioActual) {
        "NONE" -> getString(R.string.audio_note_none)
        "MIC" -> getString(R.string.audio_note_mic)
        "INTERNAL" -> ""
        else -> ""
    }

    private fun setupSurface(
        host: DiscoveredHost?,
        manual: InetSocketAddress?,
        code: String,
        config: com.neurio.common.StreamConfig
    ) {
        surfaceHolderView.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                surfaceReady = true
                if (!connectAttempted) {
                    connectAttempted = true
                    val address = manual
                        ?: InetSocketAddress(host!!.address, host.port)
                    showStatus(getString(R.string.status_connecting, address.address.hostAddress))
                    client.connect(
                        address,
                        code,
                        Build.MODEL ?: "Neurio client",
                        config
                    )
                }
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}
            override fun surfaceDestroyed(holder: SurfaceHolder) {
                surfaceReady = false
            }
        })
        setupMirrorTouch()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupMirrorTouch() {
        val container = findViewById<FrameLayout>(R.id.surfaceContainer)
        container.setOnTouchListener { v, ev ->
            if (!mirrorTouch || client.streaming.not()) return@setOnTouchListener false
            val nx = (ev.x / v.width).coerceIn(0f, 1f)
            val ny = (ev.y / v.height).coerceIn(0f, 1f)
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> sender.touchDown(nx, ny)
                MotionEvent.ACTION_MOVE -> sender.touchMove(nx, ny)
                MotionEvent.ACTION_UP -> sender.touchUp(nx, ny)
                MotionEvent.ACTION_CANCEL -> sender.touchUp(nx, ny)
            }
            true
        }
    }

    // --------------------------------------------------------------------- UI

    private fun showStatus(text: String) {
        runOnUiThread {
            progress.visibility = View.VISIBLE
            statusText.visibility = View.VISIBLE
            statusText.text = text
        }
    }

    private fun toggleMenu() {
        menuPanel.visibility = if (menuPanel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
    }

    private fun toggleControls() {
        overlay.visibility = if (overlay.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        menuPanel.visibility = View.GONE
        enterImmersive()
    }

    private fun toggleEditMode() {
        val next = !overlay.editMode
        overlay.editMode = next
        editPanel.visibility = if (next) View.VISIBLE else View.GONE
        menuPanel.visibility = View.GONE
        if (!next) {
            PrefsStore(this).saveControllerLayoutJson(overlay.saveJson())
            Toast.makeText(this, R.string.layout_saved, Toast.LENGTH_SHORT).show()
        }
    }

    private fun toggleMirrorTouch() {
        mirrorTouch = !mirrorTouch
        updateMirrorLabel()
    }

    private fun updateMirrorLabel() {
        btnMirror.text = if (mirrorTouch)
            getString(R.string.mirror_touch_on) else getString(R.string.mirror_touch_off)
    }

    private fun confirmDisconnect() {
        AlertDialog.Builder(this)
            .setTitle(R.string.disconnect_q)
            .setMessage(R.string.disconnect_body)
            .setPositiveButton(R.string.disconnect) { _, _ ->
                client.disconnect()
                finish()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun updateHud() {
        val stats = client.stats
        val fps = decoder?.renderedFps ?: 0.0
        val rtt = stats.snapshotRttMs()
        val loss = stats.snapshotLossPct()

        hudFps.text = getString(R.string.hud_fps, fps)
        hudPing.text = if (rtt > 0) getString(R.string.hud_ping, rtt) else getString(R.string.hud_ping_na)

        val quality = when {
            !client.streaming -> "…"
            loss > 5 || rtt > 90 -> getString(R.string.quality_weak)
            rtt > 40 || loss > 2 -> getString(R.string.quality_good)
            else -> getString(R.string.quality_excellent)
        }
        hudQuality.text = quality
        hudQuality.setBackgroundResource(
            when {
                !client.streaming -> R.drawable.bg_pill
                loss > 5 || rtt > 90 -> R.drawable.bg_pill_bad
                rtt > 40 || loss > 2 -> R.drawable.bg_pill_warn
                else -> R.drawable.bg_pill_good
            }
        )

        val s = started
        PerfBus.publish(
            StatsSnapshot(
                active = client.streaming,
                role = "CLIENT",
                rttMs = rtt,
                lossPct = loss,
                jitterMs = stats.snapshotJitterMs(),
                bitrateMbps = stats.snapshotBitrateMbps(),
                fps = fps,
                decodeMs = decoder?.decodeLatencyMs ?: -1.0,
                encodeMs = -1.0,
                width = if (adaptPending) adaptWidth else (s?.width ?: 0),
                height = if (adaptPending) adaptHeight else (s?.height ?: 0),
                dropped = decoder?.droppedFrames ?: 0,
                batteryTempC = readBatteryTempC()
            )
        )
    }

    private fun readBatteryTempC(): Double {
        return try {
            val intent = registerReceiver(
                null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED)
            )
            (intent?.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10.0
        } catch (e: Exception) {
            0.0
        }
    }

    private fun enterImmersive() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersive()
    }

    // ------------------------------------------------- physical controller IO

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (PhysicalControllerHandler.handleKey(event.keyCode, event.action == KeyEvent.ACTION_DOWN, sender)) {
            return true
        }
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            if (overlay.editMode) {
                toggleEditMode()
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (PhysicalControllerHandler.handleMotion(event, sender)) return true
        return super.dispatchGenericMotionEvent(event)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (overlay.editMode) {
            toggleEditMode()
            return
        }
        confirmDisconnect()
    }

    // ---------------------------------------------------------------- teardown

    override fun onDestroy() {
        handler.removeCallbacks(hudTicker)
        try {
            client.disconnect()
        } catch (ignored: Exception) {
        }
        try {
            decoder?.stop()
        } catch (ignored: Exception) {
        }
        decoder = null
        audioPlayer.stop()
        PhysicalControllerHandler.reset()
        super.onDestroy()
    }
}
