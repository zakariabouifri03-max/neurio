package com.neurio.lanstream.platform

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.neurio.lanstream.R

/** Foreground-service notifications (host + client). */
object Notifications {

    const val HOST_ID = 1001
    const val CLIENT_ID = 1002

    private const val CHANNEL_HOST = "neurio_host"
    private const val CHANNEL_CLIENT = "neurio_client"

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val host = NotificationChannel(
            CHANNEL_HOST,
            "Host session",
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Shown while this phone is streaming a game" }
        val client = NotificationChannel(
            CHANNEL_CLIENT,
            "Stream session",
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Shown while you are playing a streamed game" }
        manager.createNotificationChannel(host)
        manager.createNotificationChannel(client)
    }

    fun host(context: Context, title: String, text: String): Notification {
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_OPEN, MainActivity.OPEN_HOST)
        }
        val stopIntent = Intent(context, HostStreamService::class.java).apply {
            action = HostStreamService.ACTION_STOP
        }
        val flags = pendingIntentFlags()
        return NotificationCompat.Builder(context, CHANNEL_HOST)
            .setSmallIcon(R.drawable.ic_stat_stream)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(
                PendingIntent.getActivity(context, 10, openIntent, flags)
            )
            .addAction(
                R.drawable.ic_stat_stream,
                context.getString(R.string.host_notif_action_stop),
                PendingIntent.getService(context, 11, stopIntent, flags)
            )
            .build()
    }

    fun client(context: Context, title: String, text: String): Notification {
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_OPEN, MainActivity.OPEN_STREAM)
        }
        val stopIntent = Intent(context, ClientSessionService::class.java).apply {
            action = ClientSessionService.ACTION_STOP
        }
        val flags = pendingIntentFlags()
        return NotificationCompat.Builder(context, CHANNEL_CLIENT)
            .setSmallIcon(R.drawable.ic_stat_stream)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(
                PendingIntent.getActivity(context, 20, openIntent, flags)
            )
            .addAction(
                R.drawable.ic_stat_stream,
                context.getString(R.string.client_disconnect),
                PendingIntent.getService(context, 21, stopIntent, flags)
            )
            .build()
    }

    private fun pendingIntentFlags(): Int {
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
        return flags
    }
}
