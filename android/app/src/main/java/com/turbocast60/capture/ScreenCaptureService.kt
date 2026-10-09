package com.turbocast60.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.turbocast60.MainActivity
import com.turbocast60.R
import com.turbocast60.cast.HlsHttpServer
import com.turbocast60.cast.HlsLiveStore
import com.turbocast60.cast.HlsMpegTsSegmenter
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManager
import com.google.android.gms.cast.framework.SessionManagerListener
import com.turbocast60.model.AdaptationKind
import com.turbocast60.model.AdaptiveBitrateController
import com.turbocast60.model.StreamProfile
import com.turbocast60.model.VideoConfig
import com.turbocast60.model.VideoSizing
import com.turbocast60.network.ConnectionQuality
import com.turbocast60.network.DirectSenderListener
import com.turbocast60.network.DirectSenderSession
import com.turbocast60.network.ReceiverFeedback
import com.turbocast60.protocol.EncodedAccessUnit
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

/** User-consented MediaProjection → surface-input AVC → encrypted RTP/UDP or live HLS for Cast. */
class ScreenCaptureService : Service(), H264EncoderListener {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val startGuard = AtomicBoolean(false)
    private val stopping = AtomicBoolean(false)
    private val failureScheduled = AtomicBoolean(false)
    private val streamExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "TurboCast-session").apply { isDaemon = true } }
    private val pipelineLock = Any()
    @Volatile private var projection: MediaProjection? = null
    @Volatile private var virtualDisplay: VirtualDisplay? = null
    @Volatile private var encoder: HardwareH264Encoder? = null
    @Volatile private var directSession: DirectSenderSession? = null
    private var profile: StreamProfile = StreamProfile.PERFORMANCE
    private var adaptiveController: AdaptiveBitrateController? = null
    private var destination = Destination.DIRECT
    private var receiverName = "TV receiver"
    @Volatile private var sourceWidth = 0
    @Volatile private var sourceHeight = 0
    private var densityDpi = 0
    @Volatile private var currentWidth = 0
    @Volatile private var currentHeight = 0
    @Volatile private var currentFps = 0
    @Volatile private var currentBitrate = 0
    @Volatile private var measuredFps = 0.0
    @Volatile private var encoderSettings: EncoderSettings? = null
    @Volatile private var streamFrameSent = false
    @Volatile private var formatReady = false
    @Volatile private var roundTripMs: Long? = null
    @Volatile private var packetLoss: Double? = null
    @Volatile private var lastStateNote: String? = null
    @Volatile private var hlsStore: HlsLiveStore? = null
    @Volatile private var hlsSegmenter: HlsMpegTsSegmenter? = null
    @Volatile private var hlsServer: HlsHttpServer? = null
    @Volatile private var castUrl: String? = null
    private var castSessionManager: SessionManager? = null
    private var castSessionListener: SessionManagerListener<CastSession>? = null
    @Volatile private var displayListener: DisplayManager.DisplayListener? = null
    @Volatile private var rssi: Int? = null

    private enum class Destination { DIRECT, CAST }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopStreaming()
            stopSelf(startId)
            return START_NOT_STICKY
        }
        if (intent?.action != ACTION_START || !startGuard.compareAndSet(false, true)) return START_NOT_STICKY
        failureScheduled.set(false)
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        StreamStateStore.publish(StreamUiState.Starting("Starting secure local stream…"))
        streamExecutor.execute {
            try {
                begin(intent)
            } catch (t: Throwable) {
                val reason = t.message ?: "Could not start screen mirroring"
                stopStreaming()
                StreamStateStore.publish(StreamUiState.Failed(reason))
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun begin(intent: Intent) {
        profile = runCatching { StreamProfile.valueOf(intent.getStringExtra(EXTRA_PROFILE) ?: StreamProfile.PERFORMANCE.name) }
            .getOrDefault(StreamProfile.PERFORMANCE)
        receiverName = intent.getStringExtra(EXTRA_RECEIVER_NAME)?.take(80) ?: "TV receiver"
        destination = if (intent.getBooleanExtra(EXTRA_CAST, false)) Destination.CAST else Destination.DIRECT
        val targetBitrate = intent.getIntExtra(EXTRA_BITRATE, profile.startBitrate).coerceIn(1_000_000, profile.maxBitrate)
        adaptiveController = AdaptiveBitrateController(profile, targetBitrate)
        rssi = ConnectionQuality.wifiRssiDbm(this)

        if (destination == Destination.CAST) registerCastSessionListener()
        if (destination == Destination.DIRECT) {
            val host = intent.getStringExtra(EXTRA_RECEIVER_HOST) ?: error("Choose a discovered TurboCast receiver first")
            val port = intent.getIntExtra(EXTRA_RECEIVER_PORT, -1).takeIf { it in 1..65535 } ?: error("Receiver address is invalid")
            val pin = intent.getStringExtra(EXTRA_PAIRING_CODE) ?: error("Enter the code shown on the TV")
            val session = DirectSenderSession(object : DirectSenderListener {
                override fun onFeedback(feedback: ReceiverFeedback) = handleFeedback(feedback)
                override fun onRoundTripTime(rttMs: Long) { roundTripMs = rttMs; publishActive() }
                override fun onKeyFrameRequested() { encoder?.requestKeyFrame() }
                override fun onRemoteError(message: String) {
                    if (!stopping.get()) {
                        lastStateNote = message
                        if (message.contains("interrupted", true) || message.contains("closed", true)) failStream(message)
                    }
                }
            })
            directSession = session
            StreamStateStore.publish(StreamUiState.Starting("Pairing securely with $receiverName…"))
            session.connect(host, port, pin)
        } else {
            val store = HlsLiveStore()
            val server = HlsHttpServer(store)
            hlsStore = store
            hlsServer = server
            server.start()
            val host = preferredWifiIpv4() ?: error("Connect to Wi-Fi before casting")
            hlsSegmenter = HlsMpegTsSegmenter(store)
            castUrl = "http://$host:${server.port}${server.path}"
            StreamStateStore.publish(StreamUiState.Starting("Preparing a local live stream for Google Cast…", castUrl))
        }

        val metrics = screenMetrics()
        sourceWidth = metrics.first
        sourceHeight = metrics.second
        densityDpi = resources.displayMetrics.densityDpi
        val initial = VideoSizing.initial(sourceWidth, sourceHeight, profile).copy(bitrate = targetBitrate)
        createProjection(intent, initial)
        registerDisplayListener()
    }

    private fun createProjection(intent: Intent, config: VideoConfig) {
        val permissionResult = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        @Suppress("DEPRECATION")
        val data = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_PERMISSION_DATA, Intent::class.java)
        else intent.getParcelableExtra(EXTRA_PERMISSION_DATA)
        check(data != null) { "Screen capture permission was not returned" }
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val mediaProjection = manager.getMediaProjection(permissionResult, data)
        projection = mediaProjection
        mediaProjection.registerCallback(projectionCallback, mainHandler)
        startEncoderAndDisplay(config)
    }

    private fun startEncoderAndDisplay(config: VideoConfig) {
        synchronized(pipelineLock) {
            if (stopping.get()) return
            val nextEncoder = HardwareH264Encoder(sourceWidth, sourceHeight, config, this)
            val surface = nextEncoder.start()
            if (virtualDisplay == null) {
                virtualDisplay = projection?.createVirtualDisplay(
                    "TurboCast 60 screen",
                    nextEncoder.currentSettings()?.width ?: config.width,
                    nextEncoder.currentSettings()?.height ?: config.height,
                    densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    surface,
                    null,
                    mainHandler
                ) ?: error("Android did not create the screen capture display")
            } else {
                val selected = nextEncoder.currentSettings()!!
                virtualDisplay?.setSurface(surface)
                virtualDisplay?.resize(selected.width, selected.height, densityDpi)
            }
            val old = encoder
            encoder = nextEncoder
            old?.stop()
        }
    }

    private fun registerDisplayListener() {
        val manager = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val listener = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) = Unit
            override fun onDisplayRemoved(displayId: Int) = Unit
            override fun onDisplayChanged(displayId: Int) {
                if (displayId != Display.DEFAULT_DISPLAY || stopping.get()) return
                streamExecutor.execute { adaptToRotationIfNeeded() }
            }
        }
        displayListener = listener
        manager.registerDisplayListener(listener, mainHandler)
    }

    private fun adaptToRotationIfNeeded() {
        val metrics = screenMetrics()
        adaptToCaptureSize(metrics.first, metrics.second)
    }

    private fun adaptToCaptureSize(width: Int, height: Int) {
        if (width <= 0 || height <= 0 || stopping.get()) return
        if (width == sourceWidth && height == sourceHeight) return
        val selected = encoder?.currentSettings() ?: return
        sourceWidth = width
        sourceHeight = height
        val targetEdge = if (profile.adaptive && max(selected.width, selected.height) <= 1280) 1280 else profile.longEdge
        val (outputWidth, outputHeight) = VideoSizing.fit(sourceWidth, sourceHeight, targetEdge)
        val updated = VideoConfig(outputWidth, outputHeight, selected.fps, selected.bitrate, profile.maxBitrate, profile)
        runCatching { startEncoderAndDisplay(updated) }.onFailure {
            lastStateNote = "Display size changed; retaining the last supported encoder mode"
            publishActive()
        }
    }

    private fun handleFeedback(feedback: ReceiverFeedback) {
        packetLoss = feedback.packetLossPercent
        if (profile.adaptive) {
            val decision = adaptiveController?.onFeedback(feedback.packetLossPercent, roundTripMs) ?: return
            when (decision.kind) {
                AdaptationKind.CHANGE_BITRATE -> {
                    if (encoder?.updateBitrate(decision.bitrate) == true) {
                        directSession?.updateBitrate(decision.bitrate)
                        currentBitrate = decision.bitrate
                    } else {
                        lastStateNote = "This hardware encoder does not support live bitrate changes; reconfiguring the encoder"
                        val current = encoder?.currentSettings()
                        if (current != null) {
                            val fallback = VideoConfig(current.width, current.height, current.fps, decision.bitrate, profile.maxBitrate, profile)
                            streamExecutor.execute { runCatching { startEncoderAndDisplay(fallback) } }
                        }
                    }
                }
                AdaptationKind.LOWER_QUALITY, AdaptationKind.RECOVER_QUALITY -> {
                    val source = screenMetrics()
                    sourceWidth = source.first
                    sourceHeight = source.second
                    val (width, height) = VideoSizing.fit(sourceWidth, sourceHeight, decision.longEdge)
                    val next = VideoConfig(width, height, decision.fps, decision.bitrate, profile.maxBitrate, profile)
                    lastStateNote = if (decision.kind == AdaptationKind.LOWER_QUALITY) "Network pressure · stepping down resolution/FPS" else "Network recovered · restoring quality"
                    streamExecutor.execute { runCatching { startEncoderAndDisplay(next) } }
                }
                else -> Unit
            }
        }
        publishActive()
    }

    override fun onEncoderReady(settings: EncoderSettings) {
        encoderSettings = settings
        currentWidth = settings.width
        currentHeight = settings.height
        currentFps = settings.fps
        currentBitrate = settings.bitrate
        formatReady = false
        streamFrameSent = false
        lastStateNote = if (destination == Destination.CAST) "Cast playback status is reported by the receiver when available" else "Waiting for the first encoded frame"
        publishActive()
    }

    override fun onCodecFormat(sps: ByteArray, pps: ByteArray) {
        val settings = encoderSettings ?: return
        runCatching {
            if (destination == Destination.DIRECT) directSession?.sendFormat(settings.width, settings.height, settings.fps, settings.bitrate, sps, pps)
            else hlsSegmenter?.configure(settings.width, settings.height, sps, pps)
            formatReady = true
        }.onFailure {
            failStream("Could not configure the receiver's H.264 decoder")
        }
    }

    override fun onAccessUnit(accessUnit: EncodedAccessUnit) {
        if (stopping.get() || !formatReady) return
        runCatching {
            if (destination == Destination.DIRECT) {
                directSession?.sendAccessUnit(accessUnit)
                if (!streamFrameSent) {
                    streamFrameSent = true
                    lastStateNote = null
                    publishActive(note = null)
                }
            } else {
                val segmentPublished = hlsSegmenter?.add(accessUnit) == true
                if (!streamFrameSent && segmentPublished) {
                    streamFrameSent = true
                    publishActive(note = "Live HLS playback is receiver-buffered; end-to-end delay is not measured")
                }
            }
        }.onFailure { lastStateNote = "A video frame could not be delivered" }
    }

    override fun onMeasuredFps(fps: Double) {
        measuredFps = fps
        publishActive()
    }

    override fun onEncoderFailure(message: String) = failStream(message)

    private fun failStream(message: String) {
        if (stopping.get() || !failureScheduled.compareAndSet(false, true)) return
        runCatching {
            streamExecutor.execute {
                if (!stopping.get()) {
                    stopStreaming()
                    StreamStateStore.publish(StreamUiState.Failed(message))
                    stopSelf()
                }
            }
        }.onFailure {
            failureScheduled.set(false)
        }
    }

    private fun registerCastSessionListener() {
        val manager = CastContext.getSharedInstance(applicationContext).sessionManager
        val listener = object : SessionManagerListener<CastSession> {
            override fun onSessionStarting(session: CastSession) = Unit
            override fun onSessionStarted(session: CastSession, sessionId: String) = Unit
            override fun onSessionStartFailed(session: CastSession, error: Int) = failStream("Google Cast could not start; screen capture stopped")
            override fun onSessionEnding(session: CastSession) = Unit
            override fun onSessionEnded(session: CastSession, error: Int) = failStream("Google Cast receiver disconnected; screen capture stopped")
            override fun onSessionResuming(session: CastSession, sessionId: String) = Unit
            override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = Unit
            override fun onSessionResumeFailed(session: CastSession, error: Int) = failStream("Google Cast reconnection failed; screen capture stopped")
            override fun onSessionSuspended(session: CastSession, reason: Int) = Unit
        }
        castSessionManager = manager
        castSessionListener = listener
        manager.addSessionManagerListener(listener, CastSession::class.java)
        check(manager.currentCastSession?.isConnected == true) { "Choose a connected Google Cast receiver first" }
    }

    private fun unregisterCastSessionListener() {
        val manager = castSessionManager
        val listener = castSessionListener
        if (manager != null && listener != null) {
            runCatching { manager.removeSessionManagerListener(listener, CastSession::class.java) }
        }
        castSessionManager = null
        castSessionListener = null
    }

    private fun publishActive(note: String? = lastStateNote) {
        if (stopping.get() || currentWidth <= 0 || !streamFrameSent) return
        StreamStateStore.publish(
            StreamUiState.Active(
                receiverName = receiverName,
                transport = if (destination == Destination.CAST) "Google Cast · live HLS" else "TurboCast receiver · encrypted RTP",
                width = currentWidth,
                height = currentHeight,
                encoderName = encoderSettings?.codecName ?: "H.264",
                hardwareAccelerated = encoderSettings?.hardwareAccelerated == true,
                targetFps = currentFps,
                encodedFps = measuredFps,
                bitrate = currentBitrate,
                rttMs = roundTripMs,
                packetLossPercent = packetLoss,
                wifiRssiDbm = rssi,
                note = note,
                castUrl = castUrl
            )
        )
    }

    private fun screenMetrics(): Pair<Int, Int> {
        val display = (getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).getDisplay(Display.DEFAULT_DISPLAY)
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        display?.getRealMetrics(metrics)
        return metrics.widthPixels.coerceAtLeast(2) to metrics.heightPixels.coerceAtLeast(2)
    }

    @Suppress("DEPRECATION")
    private fun preferredWifiIpv4(): String? {
        val connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val wifiNetwork = connectivity.allNetworks.firstOrNull { network ->
            connectivity.getNetworkCapabilities(network)?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) == true
        }
        val address = wifiNetwork?.let(connectivity::getLinkProperties)?.linkAddresses
            ?.firstOrNull { it.address is java.net.Inet4Address && !it.address.isLoopbackAddress && !it.address.isLinkLocalAddress }
            ?.address?.hostAddress
        if (address != null) return address

        val wifi = getSystemService(Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
        val legacyAddress = wifi?.connectionInfo?.ipAddress ?: 0
        if (legacyAddress != 0) return listOf(legacyAddress and 0xff, legacyAddress shr 8 and 0xff, legacyAddress shr 16 and 0xff, legacyAddress shr 24 and 0xff).joinToString(".")
        return ConnectionQuality.localIpv4Addresses().firstOrNull { !it.startsWith("169.254.") }
    }

    private fun buildNotification(): Notification {
        createNotificationChannel()
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ScreenCaptureService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val openIntent = PendingIntent.getActivity(
            this,
            2,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_turbocast)
            .setContentTitle("TurboCast 60 · Screen sharing")
            .setContentText("Your screen is streaming on the local network")
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(R.drawable.ic_stat_turbocast, "Stop mirroring", stopIntent)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(NOTIFICATION_CHANNEL, "Screen mirroring", NotificationManager.IMPORTANCE_LOW))
        }
    }

    private fun stopStreaming() {
        if (!stopping.compareAndSet(false, true)) return
        unregisterCastSessionListener()
        unregisterDisplayListener()
        synchronized(pipelineLock) {
            runCatching { virtualDisplay?.release() }
            virtualDisplay = null
            runCatching { encoder?.stop() }
            encoder = null
            runCatching { directSession?.close() }
            directSession = null
            runCatching { hlsSegmenter?.finish() }
            runCatching { hlsServer?.close() }
            hlsServer = null
            runCatching { hlsStore?.clear() }
            hlsStore = null
            hlsSegmenter = null
            castUrl = null
            encoderSettings = null
            streamFrameSent = false
            formatReady = false
            runCatching { projection?.unregisterCallback(projectionCallback) }
            runCatching { projection?.stop() }
            projection = null
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        if (StreamStateStore.state.value !is StreamUiState.Failed) StreamStateStore.publish(StreamUiState.Idle)
        startGuard.set(false)
        stopping.set(false)
    }

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            if (!stopping.get()) {
                StreamStateStore.publish(StreamUiState.Idle)
                stopStreaming()
                stopSelf()
            }
        }

        override fun onCapturedContentResize(width: Int, height: Int) {
            if (width > 0 && height > 0 && !stopping.get()) {
                streamExecutor.execute { adaptToCaptureSize(width, height) }
            }
        }
    }

    private fun unregisterDisplayListener() {
        val listener = displayListener ?: return
        runCatching { (getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).unregisterDisplayListener(listener) }
        displayListener = null
    }

    override fun onDestroy() {
        stopStreaming()
        streamExecutor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.turbocast60.action.START"
        const val ACTION_STOP = "com.turbocast60.action.STOP"
        const val EXTRA_RESULT_CODE = "projection_result_code"
        const val EXTRA_PERMISSION_DATA = "projection_permission_data"
        const val EXTRA_PROFILE = "profile"
        const val EXTRA_BITRATE = "bitrate"
        const val EXTRA_CAST = "cast"
        const val EXTRA_RECEIVER_HOST = "receiver_host"
        const val EXTRA_RECEIVER_PORT = "receiver_port"
        const val EXTRA_RECEIVER_NAME = "receiver_name"
        const val EXTRA_PAIRING_CODE = "pairing_code"
        private const val NOTIFICATION_ID = 6001
        private const val NOTIFICATION_CHANNEL = "screen_mirroring"

        fun startDirect(
            context: Context,
            resultCode: Int,
            resultData: Intent,
            profile: StreamProfile,
            bitrate: Int,
            receiverName: String,
            host: String,
            port: Int,
            pairingCode: String
        ) {
            val intent = Intent(context, ScreenCaptureService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_PERMISSION_DATA, resultData)
                putExtra(EXTRA_PROFILE, profile.name)
                putExtra(EXTRA_BITRATE, bitrate)
                putExtra(EXTRA_RECEIVER_NAME, receiverName)
                putExtra(EXTRA_RECEIVER_HOST, host)
                putExtra(EXTRA_RECEIVER_PORT, port)
                putExtra(EXTRA_PAIRING_CODE, pairingCode)
                putExtra(EXTRA_CAST, false)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun startCast(context: Context, resultCode: Int, resultData: Intent, profile: StreamProfile, bitrate: Int) {
            val intent = Intent(context, ScreenCaptureService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_PERMISSION_DATA, resultData)
                putExtra(EXTRA_PROFILE, profile.name)
                putExtra(EXTRA_BITRATE, bitrate)
                putExtra(EXTRA_RECEIVER_NAME, "Google Cast receiver")
                putExtra(EXTRA_CAST, true)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, ScreenCaptureService::class.java).setAction(ACTION_STOP))
        }
    }
}
