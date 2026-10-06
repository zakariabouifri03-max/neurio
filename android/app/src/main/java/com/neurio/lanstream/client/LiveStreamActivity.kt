package com.neurio.lanstream.client

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import com.neurio.lanstream.model.HostAdvertisement
import com.neurio.lanstream.model.VideoStreamConfig
import com.neurio.lanstream.ui.UiKit
import java.util.concurrent.atomic.AtomicBoolean

/** Immersive decoded game display and Phone 1's virtual/physical controller surface. */
class LiveStreamActivity : Activity(), SurfaceHolder.Callback {
    private lateinit var root: FrameLayout
    private lateinit var videoSurface: AspectSurfaceView
    private lateinit var controls: GamepadOverlayView
    private lateinit var statsText: TextView
    private lateinit var stateText: TextView
    private var streamClient: StreamClient? = null
    private var host: HostAdvertisement? = null
    private var pairingCode = ""
    private var gameName = ""
    private var showControls = true
    private var leftHanded = false
    private var scale = 1f
    private val activityAlive = AtomicBoolean(true)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastSnapshot = com.neurio.lanstream.core.StatsSnapshot(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0)
    private var lastPing = -1L
    private var latestConfig: VideoStreamConfig? = null
    private var connected = false
    private val statsTicker = object : Runnable {
        override fun run() {
            if (!activityAlive.get()) return
            val client = streamClient
            if (client != null) {
                lastSnapshot = client.statsSnapshot()
                lastPing = client.pingMs()
                statsText.text = buildStatsText(lastSnapshot, lastPing)
            }
            mainHandler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
        readLaunchExtras()
        buildStreamUi()
        connect()
        mainHandler.post(statsTicker)
    }

    private fun readLaunchExtras() {
        val ip = intent.getStringExtra(EXTRA_HOST_IP).orEmpty()
        val name = intent.getStringExtra(EXTRA_HOST_NAME).orEmpty().ifBlank { "Host phone" }
        gameName = intent.getStringExtra(EXTRA_GAME_NAME).orEmpty().ifBlank { "Game stream" }
        val sessionId = intent.getLongExtra(EXTRA_SESSION_ID, 0L)
        val port = intent.getIntExtra(EXTRA_TCP_PORT, com.neurio.lanstream.protocol.LanProtocol.TCP_PORT)
        pairingCode = intent.getStringExtra(EXTRA_PAIRING_CODE).orEmpty()
        showControls = intent.getBooleanExtra(EXTRA_SHOW_CONTROLS, true)
        leftHanded = intent.getBooleanExtra(EXTRA_LEFT_HANDED, false)
        scale = intent.getFloatExtra(EXTRA_CONTROL_SCALE, 1f).coerceIn(.78f, 1.28f)
        host = HostAdvertisement(sessionId, name, gameName, ip, port, com.neurio.lanstream.protocol.LanProtocol.DISCOVERY_PORT)
    }

    private fun buildStreamUi() {
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        videoSurface = AspectSurfaceView(this).apply {
            setVideoSize(16, 9)
            holder.addCallback(this@LiveStreamActivity)
            setZOrderMediaOverlay(false)
        }
        val surfaceParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER)
        root.addView(videoSurface, surfaceParams)

        controls = GamepadOverlayView(this).apply {
            setControlsVisible(showControls)
            setLeftHanded(leftHanded)
            setButtonScale(scale)
        }
        root.addView(controls, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        statsText = UiKit.text(this, "CONNECTING · ${host?.deviceName}", 11f, UiKit.WHITE, true).apply {
            setPadding(UiKit.dp(this@LiveStreamActivity, 13f), UiKit.dp(this@LiveStreamActivity, 9f), UiKit.dp(this@LiveStreamActivity, 13f), UiKit.dp(this@LiveStreamActivity, 9f))
            background = UiKit.rounded(0xBB0B1321.toInt(), UiKit.dp(this@LiveStreamActivity, 18f), 0x5554E4FF, UiKit.dp(this@LiveStreamActivity, 1f))
        }
        val statsParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START)
        statsParams.setMargins(UiKit.dp(this, 14f), UiKit.dp(this, 14f), UiKit.dp(this, 14f), 0)
        root.addView(statsText, statsParams)

        stateText = UiKit.text(this, "PAIRING WITH PHONE 2…", 14f, UiKit.WHITE, true).apply {
            gravity = Gravity.CENTER
            setPadding(UiKit.dp(this@LiveStreamActivity, 18f), UiKit.dp(this@LiveStreamActivity, 12f), UiKit.dp(this@LiveStreamActivity, 18f), UiKit.dp(this@LiveStreamActivity, 12f))
            background = UiKit.rounded(0xD8101828.toInt(), UiKit.dp(this@LiveStreamActivity, 18f), 0x7754E4FF, UiKit.dp(this@LiveStreamActivity, 1f))
        }
        val stateParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        root.addView(stateText, stateParams)
        setContentView(root)
        applyImmersiveMode()
    }

    private fun connect() {
        val target = host ?: return showFatal("No host details were provided")
        if (pairingCode.length != 6) return showFatal("The pairing code is missing")
        val listener = object : StreamClientListener {
            override fun onState(message: String) {
                runOnUiThread {
                    if (!activityAlive.get()) return@runOnUiThread
                    stateText.text = message.uppercase()
                    if (connected && message.startsWith("Live AVC")) {
                        stateText.visibility = View.GONE
                    } else if (!connected || message.contains("failed", true) || message.contains("stopped", true)) {
                        stateText.visibility = View.VISIBLE
                    }
                }
            }

            override fun onConnected(deviceName: String, gameName: String) {
                runOnUiThread {
                    connected = true
                    stateText.text = "CONNECTED TO $deviceName · $gameName"
                    stateText.visibility = View.VISIBLE
                    mainHandler.postDelayed({ if (connected && activityAlive.get()) stateText.visibility = View.GONE }, 2400)
                }
            }

            override fun onError(message: String) {
                runOnUiThread {
                    connected = false
                    stateText.text = "STREAM ENDED\n$message\n\nPRESS BACK TO RETURN"
                    stateText.visibility = View.VISIBLE
                    statsText.text = "DISCONNECTED  ·  ${target.deviceName}"
                }
            }

            override fun onVideoConfig(config: VideoStreamConfig) {
                runOnUiThread {
                    latestConfig = config
                    videoSurface.setVideoSize(config.width, config.height)
                    controls.setVideoAspect(config.width, config.height)
                    stateText.text = "LIVE · ${config.width}×${config.height} · ${config.fps} FPS TARGET"
                }
            }

            override fun onAudioConfig(config: com.neurio.lanstream.model.AudioStreamConfig) {
                runOnUiThread {
                    if (activityAlive.get()) Toast.makeText(this@LiveStreamActivity, "Host audio channel connected", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onStats(snapshot: com.neurio.lanstream.core.StatsSnapshot, pingMs: Long) {
                runOnUiThread {
                    lastSnapshot = snapshot
                    lastPing = pingMs
                    statsText.text = buildStatsText(snapshot, pingMs)
                }
            }
        }
        streamClient = StreamClient(target, pairingCode, com.neurio.lanstream.model.LocalNetwork.deviceName(), listener).also { client ->
            controls.setInputTransport(client)
            if (videoSurface.holder.surface?.isValid == true) client.setSurface(videoSurface.holder.surface)
            client.connect()
        }
    }

    private fun buildStatsText(snapshot: com.neurio.lanstream.core.StatsSnapshot, ping: Long): String {
        val fps = if (snapshot.decodedFps > .1) String.format("%.0f FPS", snapshot.decodedFps) else "-- FPS"
        val pingText = if (ping >= 0) "${ping}ms" else "--ms"
        val bitrate = if (snapshot.rxMbps > .01) String.format("%.1f Mbps", snapshot.rxMbps) else "-- Mbps"
        val loss = if (snapshot.lostFrames > 0) " · DROP ${snapshot.lostFrames}" else ""
        return "${if (connected) "LIVE" else "CONNECTING"}  ·  $fps  ·  $pingText  ·  $bitrate$loss"
    }

    private fun showFatal(message: String) {
        if (::stateText.isInitialized) {
            stateText.text = message
            stateText.visibility = View.VISIBLE
        }
    }

    private fun applyImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        streamClient?.setSurface(holder.surface)
        latestConfig?.let { videoSurface.setVideoSize(it.width, it.height) }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        streamClient?.setSurface(holder.surface)
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        streamClient?.setSurface(null)
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        applyImmersiveMode()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (isControllerKey(event)) {
            if (event.repeatCount == 0) streamClient?.sendKey(keyCode, true, SystemClock.elapsedRealtimeNanos())
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (isControllerKey(event)) {
            streamClient?.sendKey(keyCode, false, SystemClock.elapsedRealtimeNanos())
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    override fun onGenericMotionEvent(event: MotionEvent): Boolean {
        val isJoystick = event.source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK
        if (isJoystick && event.action == MotionEvent.ACTION_MOVE) {
            val x = deadZone(event.getAxisValue(MotionEvent.AXIS_X))
            val y = deadZone(event.getAxisValue(MotionEvent.AXIS_Y))
            streamClient?.sendAxes(x, y, SystemClock.elapsedRealtimeNanos())
            return true
        }
        return super.onGenericMotionEvent(event)
    }

    private fun isControllerKey(event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        val hasGamepadSource = event.source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
            event.source and InputDevice.SOURCE_DPAD == InputDevice.SOURCE_DPAD
        return hasGamepadSource || KeyEvent.isGamepadButton(keyCode) || keyCode in setOf(
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER,
        ) && event.device?.isVirtual == false
    }

    private fun deadZone(value: Float): Float = if (kotlin.math.abs(value) < .12f) 0f else value.coerceIn(-1f, 1f)

    override fun onBackPressed() {
        streamClient?.let { client -> Thread({ client.close() }, "neurio-client-close").start() }
        finish()
    }

    override fun onDestroy() {
        activityAlive.set(false)
        mainHandler.removeCallbacks(statsTicker)
        controls.setInputTransport(null)
        val client = streamClient
        streamClient = null
        if (client != null) Thread({ client.close() }, "neurio-client-close").apply { isDaemon = true; start() }
        super.onDestroy()
    }

    companion object {
        const val EXTRA_HOST_IP = "host_ip"
        const val EXTRA_HOST_NAME = "host_name"
        const val EXTRA_GAME_NAME = "game_name"
        const val EXTRA_SESSION_ID = "session_id"
        const val EXTRA_TCP_PORT = "tcp_port"
        const val EXTRA_PAIRING_CODE = "pairing_code"
        const val EXTRA_SHOW_CONTROLS = "show_controls"
        const val EXTRA_LEFT_HANDED = "left_handed"
        const val EXTRA_CONTROL_SCALE = "control_scale"
    }
}
