package com.turbocast60.network

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build

object ConnectionQuality {
    @Suppress("DEPRECATION")
    fun wifiRssiDbm(context: Context): Int? = runCatching {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return null
        if (!wifi.isWifiEnabled) return null
        wifi.connectionInfo.rssi.takeIf { it in -127..0 }
    }.getOrNull()

    fun localIpv4Addresses(): List<String> = runCatching {
        java.net.NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filter { it is java.net.Inet4Address && !it.isLoopbackAddress }
            .map { it.hostAddress }
            .distinct()
    }.getOrDefault(emptyList())
}
