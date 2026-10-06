package com.neurio.lanstream.platform

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Capability checks the UI and the diagnostics screen rely on. */
object Permissions {

    fun hasNotificationPermission(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun hasRecordAudio(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    fun canDrawOverlays(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

    /**
     * True when our accessibility service is enabled by the user.
     * Android does not let an app enable it programmatically — that is the whole
     * point of the restriction — so we can only detect it and deep link to the
     * system settings screen.
     */
    fun isAccessibilityEnabled(context: Context): Boolean {
        if (NeurioAccessibilityService.instance?.isConnected == true) return true
        val resolver = context.contentResolver
        val enabled = runCatching {
            Settings.Secure.getInt(resolver, Settings.Secure.ACCESSIBILITY_ENABLED)
        }.getOrDefault(0)
        if (enabled != 1) return false
        val services = Settings.Secure.getString(resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?: return false
        val component = ComponentName(context, NeurioAccessibilityService::class.java)
        val flat = component.flattenToString()
        return services.split(':').any { it.equals(flat, ignoreCase = true) }
    }

    fun accessibilitySettingsIntent(): Intent =
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun overlaySettingsIntent(context: Context): Intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        android.net.Uri.parse("package:${context.packageName}")
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun notificationSettingsIntent(context: Context): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(android.net.Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
}
