package com.neurio.lanstream.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.neurio.lanstream.MainActivity
import com.neurio.lanstream.R
import com.neurio.lanstream.core.DiscoveryBroadcaster
import com.neurio.lanstream.core.NetworkStats
import com.neurio.lanstream.input.RemoteGameAccessibilityService
import com.neurio.lanstream.input.RemoteInputController
import com.neurio.lanstream.model.LocalNetwork
import com.neurio.lanstream.model.StreamOptions
import com.neurio.lanstream.protocol.LanProtocol
import java.security.SecureRandom
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/** Foreground host process: projection, game audio capture, discovery, authenticated LAN server. */
class HostSessionService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val stats = NetworkStats()
    @Volatile private var active = false
    private var projection: MediaProjection? = null
    private var engine: HostStreamEngine? = null
    private var controlServer: HostControlServer? = null
    private var discovery: DiscoveryBroadcaster? = null
    private var projectionCallback: MediaProjection.Callback? = null
    private var sessionId: Long = 0L
    @Volatile private var gameName = ""
    @Volatile private var pairingCode = "------"
    @Volatile private var currentPlayer = "Waiting for player"
    @Volatile private var audioStatus = "Starting…"
    @Volatile private var detail = "Preparing hardware encoder…"
    private var baseBitrate = 6_000_000
    @Volatile private var currentBitrate = 6_000_000
    @Volatile private var currentLossPercent = 0f
    @Volatile private var currentPingMs = -1L
    private var degradeSamples = 0
    private var recoverSamples = 0
    private val inputController = RemoteInputController(
        adapterProvider = { RemoteGameAccessibilityService.instance },
        onAvailabilityChanged = { available ->
            detail = if (available) "Accessibility input adapter is enabled" else "Video is live; remote touch needs host Accessibility opt-in"
            broadcastStatus()
        },
    )
    private val tick = object : Runnable {
        override fun run() {
            if (!active) return
            val window = stats.snapshot()
            broadcastStatus(window)
            handler.postDelayed(this, 1000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopSession("Host stopped the stream", projectionAlreadyStopped = false)
            ACTION_START -> if (!active) startSession(intent)
        }
        return START_NOT_STICKY
    }

    private fun startSession(intent: Intent) {
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val projectionData = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA)
        }
        if (resultCode != android.app.Activity.RESULT_OK || projectionData == null) {
            stopSelf()
            return
        }

        gameName = intent.getStringExtra(EXTRA_GAME_NAME).orEmpty().ifBlank { "Selected game" }
        val resolution = intent.getIntExtra(EXTRA_RESOLUTION, 720)
        val fps = intent.getIntExtra(EXTRA_FPS, 60)
        val bitrate = intent.getIntExtra(EXTRA_BITRATE, 6_000_000).coerceIn(750_000, 24_000_000)
        val bitrateLabel = intent.getStringExtra(EXTRA_BITRATE_LABEL) ?: "Medium"
        baseBitrate = bitrate
        currentBitrate = bitrate
        val audioGranted = intent.getBooleanExtra(EXTRA_AUDIO_GRANTED, false)

        active = true
        sessionId = SecureRandom().nextLong().let { if (it == 0L) 1L else it }
        pairingCode = String.format(Locale.US, "%06d", SecureRandom().nextInt(1_000_000))
        currentPlayer = "Waiting for player"
        detail = "Starting local capture and low-latency H.264 stream…"
        audioStatus = if (audioGranted) "Checking playback capture…" else "Audio permission not granted; video only"
        startForegroundCompat()
        persistAndBroadcast()
        handler.post(tick)

        try {
            val manager = getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            projection = manager.getMediaProjection(resultCode, projectionData)
                ?: throw IllegalStateException("MediaProjection permission was not accepted")
            projectionCallback = object : MediaProjection.Callback() {
                override fun onStop() {
                    stopSession("Screen capture permission was revoked", projectionAlreadyStopped = true)
                }
            }.also { projection?.registerCallback(it, handler) }
        } catch (e: Exception) {
            detail = "Screen capture could not start: ${e.message ?: "permission error"}"
            Log.e(TAG, detail, e)
            stopSession(detail, projectionAlreadyStopped = true)
            return
        }

        val options = StreamOptions(
            resolutionCap = resolution,
            framesPerSecond = fps,
            bitrateBitsPerSecond = bitrate,
            bitrateLabel = bitrateLabel,
            customBitrateBitsPerSecond = bitrate,
        )
        controlServer = HostControlServer(
            sessionId = sessionId,
            pairingCode = pairingCode,
            deviceName = LocalNetwork.deviceName(),
            gameName = gameName,
            stats = stats,
            onClientConnected = { player ->
                currentPlayer = player
                detail = "Paired directly over Wi-Fi"
                broadcastStatus()
            },
            onClientDisconnected = {
                inputController.releaseAll()
                currentPlayer = "Waiting for player"
                currentPingMs = -1L
                currentLossPercent = 0f
                detail = "Player disconnected; waiting for another device"
                broadcastStatus()
            },
            onPointer = inputController::handlePointer,
            onKey = inputController::handleKey,
            onAxes = inputController::handleAxes,
            onClientStats = ::handleClientStats,
            onRequestKeyFrame = { engine?.requestKeyFrame() },
            onError = { message ->
                detail = message
                broadcastStatus()
                if (message.startsWith("Could not start LAN server") || message.startsWith("Control socket closed")) {
                    handler.post { if (active) stopSession(message, projectionAlreadyStopped = false) }
                }
            },
        ).also { it.start() }

        discovery = DiscoveryBroadcaster(
            context = this,
            sessionId = sessionId,
            deviceName = LocalNetwork.deviceName(),
            gameName = gameName,
            onError = { message -> detail = message; broadcastStatus() },
        ).also { it.start() }

        // Allow the selected game to take foreground/settle its orientation before sizing capture.
        handler.postDelayed({
            if (!active) return@postDelayed
            try {
                val currentProjection = projection ?: throw IllegalStateException("Screen capture stopped")
                engine = HostStreamEngine(
                    context = this,
                    projection = currentProjection,
                    options = options,
                    initialBitrate = currentBitrate,
                    audioPermissionGranted = audioGranted,
                    stats = stats,
                    onVideoConfig = { config -> controlServer?.updateVideoConfig(config) },
                    onVideoAccessUnit = { data, pts, keyFrame ->
                        controlServer?.sendMedia(LanProtocol.MEDIA_VIDEO, data, pts, keyFrame)
                    },
                    onAudioConfig = { config -> controlServer?.updateAudioConfig(config) },
                    onAudioAccessUnit = { data, pts ->
                        controlServer?.sendMedia(LanProtocol.MEDIA_AUDIO, data, pts, false)
                    },
                    onVideoStatus = { message -> detail = message; broadcastStatus() },
                    onAudioStatus = { message -> audioStatus = message; broadcastStatus() },
                )
                detail = "Host is live. Pair using the code shown on this screen."
                broadcastStatus()
            } catch (e: Exception) {
                detail = "Capture failed: ${e.message ?: "hardware encoder unavailable"}"
                Log.e(TAG, detail, e)
                broadcastStatus()
                stopSession(detail, projectionAlreadyStopped = false)
            }
        }, 1500)
    }

    private fun handleClientStats(lossPercent: Float, pingMs: Long, clientFps: Float) {
        currentLossPercent = lossPercent
        currentPingMs = pingMs
        val unstable = lossPercent > 4f || pingMs > 110L
        if (unstable) {
            degradeSamples++
            recoverSamples = 0
        } else if (lossPercent < 1.5f && pingMs in 0..55) {
            recoverSamples++
            degradeSamples = max(0, degradeSamples - 1)
        } else {
            degradeSamples = max(0, degradeSamples - 1)
            recoverSamples = 0
        }

        var updated = currentBitrate
        if (degradeSamples >= 2) {
            updated = max(750_000, (currentBitrate * 0.82f).toInt())
            degradeSamples = 0
        } else if (recoverSamples >= 8) {
            updated = min(baseBitrate, (currentBitrate * 1.06f).toInt())
            recoverSamples = 0
        }
        if (updated != currentBitrate) {
            currentBitrate = updated
            engine?.setBitrate(currentBitrate)
            detail = if (currentBitrate < baseBitrate) "Wi-Fi unstable — reducing bitrate automatically" else "Network stable — restoring selected bitrate"
        }
    }

    private fun startForegroundCompat() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "LAN game stream", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps the host screen capture and local stream running while the game is foregrounded"
                setShowBadge(false)
            })
        }
        val stopIntent = Intent(this, HostSessionService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(
            this,
            51,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val openPending = PendingIntent.getActivity(
            this,
            52,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        val notification = builder
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Neurio host stream is running")
            .setContentText("${gameName.ifBlank { "Game" }} · local Wi-Fi only")
            .setContentIntent(openPending)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_pause, "Stop stream", stopPending).build())
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun broadcastStatus(window: com.neurio.lanstream.core.StatsSnapshot? = null) {
        if (!active) return
        val snapshot = window ?: stats.snapshot(resetWindow = false)
        val ip = LocalNetwork.bestIpv4Address()
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        prefs.edit()
            .putBoolean("running", true)
            .putString("game", gameName)
            .putString("ip", ip)
            .putString("code", pairingCode)
            .putString("player", currentPlayer)
            .putFloat("fps", snapshot.encodedFps.toFloat())
            .putLong("ping", currentPingMs)
            .putFloat("bitrate", snapshot.txMbps.toFloat())
            .putFloat("loss", currentLossPercent)
            .putString("audio", audioStatus)
            .putString("detail", detail)
            .apply()
        sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).apply {
            putExtra("running", true)
            putExtra("game", gameName)
            putExtra("ip", ip)
            putExtra("code", pairingCode)
            putExtra("player", currentPlayer)
            putExtra("fps", snapshot.encodedFps.toFloat())
            putExtra("ping", currentPingMs)
            putExtra("bitrate", snapshot.txMbps.toFloat())
            putExtra("loss", currentLossPercent)
            putExtra("audio", audioStatus)
            putExtra("detail", detail)
            putExtra("dropped", snapshot.droppedFrames)
        })
    }

    private fun persistAndBroadcast() = broadcastStatus()

    @Suppress("DEPRECATION")
    private fun stopSession(reason: String, projectionAlreadyStopped: Boolean) {
        if (!active) {
            stopSelf()
            return
        }
        active = false
        handler.removeCallbacks(tick)
        inputController.releaseAll()
        discovery?.close()
        discovery = null
        controlServer?.close()
        controlServer = null
        engine?.close()
        engine = null
        val oldProjection = projection
        projection = null
        try {
            projectionCallback?.let { oldProjection?.unregisterCallback(it) }
        } catch (_: Exception) {
        }
        projectionCallback = null
        if (!projectionAlreadyStopped) {
            try { oldProjection?.stop() } catch (_: Exception) { }
        }
        currentPlayer = "Waiting for player"
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        prefs.edit()
            .putBoolean("running", false)
            .putString("detail", reason)
            .putString("code", "------")
            .putString("player", "Waiting for player")
            .putLong("ping", -1L)
            .apply()
        sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).apply {
            putExtra("running", false)
            putExtra("detail", reason)
        })
        if (Build.VERSION.SDK_INT >= 24) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            stopForeground(true)
        }
        stopSelf()
    }

    override fun onDestroy() {
        stopSession("Host service ended", projectionAlreadyStopped = false)
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.neurio.lanstream.HOST_START"
        const val ACTION_STOP = "com.neurio.lanstream.HOST_STOP"
        const val ACTION_STATUS = "com.neurio.lanstream.HOST_STATUS"
        const val EXTRA_RESULT_CODE = "projection_result_code"
        const val EXTRA_PROJECTION_DATA = "projection_result_data"
        const val EXTRA_GAME_NAME = "game_name"
        const val EXTRA_GAME_PACKAGE = "game_package"
        const val EXTRA_RESOLUTION = "resolution"
        const val EXTRA_FPS = "fps"
        const val EXTRA_BITRATE = "bitrate"
        const val EXTRA_BITRATE_LABEL = "bitrate_label"
        const val EXTRA_AUDIO_GRANTED = "audio_granted"
        const val PREFS = "host_runtime"
        private const val CHANNEL_ID = "neurio_host_stream"
        private const val NOTIFICATION_ID = 47620
        private const val TAG = "NeurioHost"
    }
}
