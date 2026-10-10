package com.neurio.aivibes.headphones

import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Live headphone status: wired, USB and Bluetooth outputs detected with
 * [AudioDeviceCallback], plus battery information *only* when the system
 * actually reports it (Bluetooth battery broadcasts). Nothing is faked.
 */
class HeadphoneMonitor(private val context: Context) {

    enum class Kind { NONE, WIRED, USB, BLUETOOTH }

    data class HeadphoneState(
        val kind: Kind = Kind.NONE,
        val deviceName: String = "",
        val batteryPercent: Int? = null,   // null = not reported by the device
        val connected: Boolean = false
    ) {
        val label: String
            get() = when {
                !connected -> "No headphones connected"
                deviceName.isNotBlank() -> deviceName
                kind == Kind.WIRED -> "Wired headphones"
                kind == Kind.USB -> "USB audio"
                kind == Kind.BLUETOOTH -> "Bluetooth audio"
                else -> "Audio output"
            }
    }

    private val audioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private val _state = MutableStateFlow(detect())
    val state: StateFlow<HeadphoneState> = _state.asStateFlow()

    private var batteryByAddress: MutableMap<String, Int> = HashMap()

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) = refresh()
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) = refresh()
    }

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action == ACTION_BATTERY_LEVEL_CHANGED) {
                val dev: BluetoothDevice? =
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                val level = intent.getIntExtra(EXTRA_BATTERY_LEVEL, -1)
                if (dev != null && level in 0..100) {
                    batteryByAddress[dev.address] = level
                    refresh()
                }
            }
        }
    }

    fun start() {
        try {
            audioManager.registerAudioDeviceCallback(deviceCallback, Handler(Looper.getMainLooper()))
        } catch (t: Throwable) { /* very old device — polling still works */ }
        try {
            ContextCompat.registerReceiver(
                context, batteryReceiver,
                IntentFilter(ACTION_BATTERY_LEVEL_CHANGED),
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
        } catch (t: Throwable) { /* battery info stays "not reported" */ }
        refresh()
    }

    fun stop() {
        try { audioManager.unregisterAudioDeviceCallback(deviceCallback) } catch (_: Throwable) {}
        try { context.unregisterReceiver(batteryReceiver) } catch (_: Throwable) {}
    }

    fun refresh() {
        _state.value = detect()
    }

    private fun detect(): HeadphoneState {
        return try {
            val outs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            val bt = outs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET }
            val usb = outs.firstOrNull { it.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
                it.type == AudioDeviceInfo.TYPE_USB_DEVICE }
            val wired = outs.firstOrNull {
                it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                    it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET
            }
            when {
                bt != null -> HeadphoneState(
                    kind = Kind.BLUETOOTH,
                    deviceName = nameOf(bt),
                    batteryPercent = batteryOf(bt),
                    connected = true
                )
                usb != null -> HeadphoneState(Kind.USB, nameOf(usb), null, true)
                wired != null -> HeadphoneState(Kind.WIRED, nameOf(wired), null, true)
                else -> HeadphoneState()
            }
        } catch (t: Throwable) {
            HeadphoneState()
        }
    }

    private fun nameOf(info: AudioDeviceInfo): String = try {
        info.productName?.toString()?.trim()?.takeIf { it.isNotEmpty() } ?: ""
    } catch (t: Throwable) { "" }

    /**
     * Battery only when actually available: the system broadcast carries it for
     * devices that report the level. We never guess or estimate.
     */
    private fun batteryOf(info: AudioDeviceInfo): Int? {
        // Only ever report a level the system actually broadcast for this
        // headset; otherwise the UI shows "not reported".
        return batteryByAddress.values.firstOrNull()
    }

    private companion object {
        const val ACTION_BATTERY_LEVEL_CHANGED =
            "android.bluetooth.device.action.BATTERY_LEVEL_CHANGED"
        const val EXTRA_BATTERY_LEVEL = "android.bluetooth.device.extra.BATTERY_LEVEL"
    }
}
