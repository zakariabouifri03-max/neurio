package com.aivision4k.app.monitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.aivision4k.app.MainActivity
import com.aivision4k.app.R
import com.aivision4k.sdk.AIUpscaler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Keeps the engine's thermal governor and the live readings alive while the app
 * is in the background — typically while the user plays a game.
 *
 * It reads: the platform thermal status, the battery temperature, CPU load and
 * memory from `/proc` (through the engine), and it feeds the engine's thermal
 * policy once per second. It does **not** report a frame rate while another app
 * is in front: this process sees no frames then, and inventing a number would be
 * worse than showing nothing. The notification therefore carries temperature,
 * memory and the governor's decision, and the app's own FPS numbers appear only
 * while this app is actually rendering.
 */
class MonitorService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var loop: Job? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = buildNotification("starting\u2026")
        val type = if (Build.VERSION.SDK_INT >= 34) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        runCatching {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        }
        startLoop()
        return START_STICKY
    }

    override fun onDestroy() {
        loop?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startLoop() {
        if (loop?.isActive == true) return
        loop = scope.launch {
            while (isActive) {
                val summary = readEngine()
                val manager = getSystemService(NotificationManager::class.java)
                runCatching {
                    manager?.notify(NOTIFICATION_ID, buildNotification(summary))
                }
                delay(1000L)
            }
        }
    }

    /** Feeds the thermal policy and returns the line shown in the notification. */
    private fun readEngine(): String {
        AIUpscaler.updateThermal(this)
        val snapshot = AIUpscaler.status() ?: return "engine not running"
        return String.format(
            Locale.US,
            "%s \u00b7 CPU %s \u00b7 RAM %s \u00b7 %s",
            snapshot.thermalLevel.label,
            snapshot.cpuLoadFraction?.let { String.format(Locale.US, "%.0f%%", it * 100) } ?: "n/a",
            snapshot.ramUsedFraction?.let { String.format(Locale.US, "%.0f%%", it * 100) } ?: "n/a",
            snapshot.batteryTempC?.let { String.format(Locale.US, "battery %.1f \u00b0C", it) }
                ?: "battery temperature not reported",
        )
    }

    private fun buildNotification(summary: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, MonitorService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_monitor)
            .setContentTitle(getString(R.string.monitor_notification_title))
            .setContentText(summary)
            .setStyle(NotificationCompat.BigTextStyle().bigText(summary))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(open)
            .addAction(0, getString(R.string.monitor_notification_stop), stop)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun ensureChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.monitor_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.monitor_channel_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "ai_vision_4k_monitor"
        private const val NOTIFICATION_ID = 4201
        const val ACTION_STOP = "com.aivision4k.app.monitor.STOP"

        fun start(context: Context) {
            val intent = Intent(context, MonitorService::class.java)
            runCatching { context.startForegroundService(intent) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, MonitorService::class.java)) }
        }
    }
}
