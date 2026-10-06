package com.neurio.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.neurio.common.AppLog
import com.neurio.common.AudioMode
import com.neurio.common.StreamConfig
import com.neurio.R

/**
 * Foreground service that owns the whole host pipeline so the stream keeps
 * running while the game is on screen and our UI is backgrounded.
 *
 * Android 14 flow: the user consent dialog is answered in HostActivity, the
 * result intent is forwarded here, and MediaProjection is created only after
 * startForeground() with the mediaProjection type.
 */
class HostStreamService : Service() {

    companion object {
        private const val TAG = "HostStreamService"
        private const val NOTIF_ID = 42
        const val CHANNEL_ID = "neurio_host_stream"

        const val ACTION_STOP = "com.neurio.host.STOP"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_GAME_PKG = "game_pkg"
        const val EXTRA_GAME_LABEL = "game_label"
        const val EXTRA_TIER = "tier"
        const val EXTRA_CODEC = "codec"
        const val EXTRA_AUDIO = "audio"
        const val EXTRA_MAX_BITRATE = "max_bitrate"

        @Volatile
        var instance: HostStreamService? = null
            private set
    }

    private val binder = LocalBinder()
    val server = StreamServer(this)

    private var projection: MediaProjection? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    var uiListener: StreamServer.Listener? = null

    inner class LocalBinder : Binder() {
        fun service(): HostStreamService = this@HostStreamService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        instance = this
        ensureChannel()
        server.listener = object : StreamServer.Listener {
            override fun onPairingCode(code: String) {
                uiListener?.onPairingCode(code)
                updateNotification()
            }

            override fun onClientPaired(name: String) {
                uiListener?.onClientPaired(name)
                updateNotification()
            }

            override fun onClientLost(reason: String) {
                uiListener?.onClientLost(reason)
                updateNotification()
            }

            override fun onStreamStarted(config: StreamConfig) {
                uiListener?.onStreamStarted(config)
                updateNotification()
            }

            override fun onStreamStopped(reason: String) {
                uiListener?.onStreamStopped(reason)
                updateNotification()
            }

            override fun onAudioStatus(mode: AudioCapture.Actual, silent: Boolean) {
                uiListener?.onAudioStatus(mode, silent)
            }

            override fun onLog(message: String) {
                uiListener?.onLog(message)
            }

            override fun onAdapted(config: StreamConfig) {
                uiListener?.onAdapted(config)
                updateNotification()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            AppLog.i(TAG, "stop requested from notification")
            shutdown()
            return START_NOT_STICKY
        }
        if (intent == null || server.running) return START_NOT_STICKY

        val types = if (
            androidx.core.content.ContextCompat.checkSelfPermission(
                this, android.Manifest.permission.RECORD_AUDIO
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        }
        // ServiceCompat handles the pre-29 path where typed FGS don't exist.
        androidx.core.app.ServiceCompat.startForeground(
            this, NOTIF_ID, buildNotification("Preparing stream…"), types
        )

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val data = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }
        val gamePkg = intent.getStringExtra(EXTRA_GAME_PKG) ?: ""
        val gameLabel = intent.getStringExtra(EXTRA_GAME_LABEL) ?: ""

        val tier = runCatching {
            com.neurio.common.QualityTier.valueOf(intent.getStringExtra(EXTRA_TIER) ?: "GOOD")
        }.getOrDefault(com.neurio.common.QualityTier.GOOD)
        val codec = com.neurio.common.VideoCodec.fromPref(intent.getStringExtra(EXTRA_CODEC) ?: "H264")
        val audioMode = runCatching {
            AudioMode.valueOf(intent.getStringExtra(EXTRA_AUDIO) ?: "AUTO")
        }.getOrDefault(AudioMode.AUTO)
        val maxBitrate = intent.getIntExtra(EXTRA_MAX_BITRATE, tier.bitrateKbps)

        if (resultCode == 0 || data == null) {
            AppLog.e(TAG, "missing MediaProjection consent")
            stopSelf()
            return START_NOT_STICKY
        }

        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        try {
            projection = mpm.getMediaProjection(resultCode, data)
        } catch (e: Exception) {
            AppLog.e(TAG, "getMediaProjection failed", e)
            stopSelf()
            return START_NOT_STICKY
        }
        val proj = projection
        if (proj == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        proj.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                AppLog.w(TAG, "MediaProjection revoked by system")
                mainHandler.post { shutdown() }
            }
        }, mainHandler)

        server.projection = proj
        server.gameLabel = gameLabel
        server.start(StreamConfig(tier, codec, audioMode, maxBitrate))

        // Launch the game shortly after capture is live so nothing is missed.
        if (gamePkg.isNotEmpty()) {
            mainHandler.postDelayed({
                GameLauncher.launch(this, gamePkg)
            }, 900)
        }

        acquireLocks()
        updateNotification()
        return START_NOT_STICKY
    }

    fun stopStream() {
        shutdown()
    }

    private fun shutdown() {
        try {
            server.stop()
        } catch (e: Exception) {
            AppLog.w(TAG, "server stop", e)
        }
        try {
            projection?.stop()
        } catch (ignored: Exception) {
        }
        projection = null
        releaseLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        instance = null
        releaseLocks()
        super.onDestroy()
    }

    private fun acquireLocks() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "neurio:host-stream").apply {
                setReferenceCounted(false)
                acquire(6L * 60 * 60 * 1000)
            }
        } catch (e: Exception) {
            AppLog.w(TAG, "wakelock: ${e.message}")
        }
        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "neurio:host-stream").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (e: Exception) {
            AppLog.w(TAG, "wifilock: ${e.message}")
        }
    }

    private fun releaseLocks() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (ignored: Exception) {
        }
        wakeLock = null
        try {
            wifiLock?.let { if (it.isHeld) it.release() }
        } catch (ignored: Exception) {
        }
        wifiLock = null
    }

    private fun ensureChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notif_channel_stream),
            NotificationManager.IMPORTANCE_LOW
        )
        channel.description = "Shown while Neurio is streaming a game on this device"
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = Intent(this, HostActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val content = PendingIntent.getActivity(
            this, 1, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = Intent(this, HostStreamService::class.java).apply {
            action = ACTION_STOP
        }
        val stop = PendingIntent.getService(
            this, 2, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stream_notif)
            .setContentTitle(getString(R.string.notif_streaming_title))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(content)
            .addAction(0, getString(R.string.stop_stream), stop)
            .build()
    }

    private fun updateNotification() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val state = if (server.streaming) {
                "Live • ${server.gameLabel.ifEmpty { "game" }}"
            } else {
                getString(R.string.notif_waiting_client)
            }
            nm.notify(NOTIF_ID, buildNotification(state))
        } catch (e: Exception) {
            AppLog.w(TAG, "notification update failed: ${e.message}")
        }
    }
}
