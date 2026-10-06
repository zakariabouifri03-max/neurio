package com.neurio.lanstream.core

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import androidx.core.content.ContextCompat
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface

/** Local-network facts the host panel shows (IP, SSID, transport type). */
object NetworkInfo {

    data class NetInfo(
        val ip: String?,
        val type: String,
        val ssid: String?,
        val allAddresses: List<String>
    )

    fun snapshot(context: Context): NetInfo {
        val addresses = localAddresses(context)
        val ip = addresses.firstOrNull()
        return NetInfo(
            ip = ip,
            type = transportName(context),
            ssid = wifiSsid(context),
            allAddresses = addresses
        )
    }

    /** IPv4 addresses of this device, Wi-Fi / Ethernet first. */
    fun localAddresses(context: Context): List<String> {
        val out = LinkedHashMap<String, Int>()
        runCatching {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            if (cm != null) {
                val active = cm.activeNetwork
                val caps = active?.let { cm.getNetworkCapabilities(it) }
                val isWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
                val isEthernet = caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true
                val rank = if (isWifi) 0 else if (isEthernet) 1 else 2
                active?.let { cm.getLinkProperties(it) }?.let { lp -> collect(lp, rank, out) }
                cm.allNetworks.forEach { n ->
                    val c = cm.getNetworkCapabilities(n)
                    val r = when {
                        c?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> 0
                        c?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> 1
                        else -> 3
                    }
                    collect(cm.getLinkProperties(n) ?: return@forEach, r, out)
                }
            }
        }
        // Fallback / supplement: raw interface enumeration.
        runCatching {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return@runCatching
            while (interfaces.hasMoreElements()) {
                val ni = interfaces.nextElement()
                if (!ni.isUp || ni.isLoopback) continue
                val rank = when {
                    ni.name.startsWith("wlan") -> 0
                    ni.name.startsWith("eth") -> 1
                    ni.name.startsWith("ap") || ni.name.startsWith("swlan") -> 2 // hotspot
                    else -> 4
                }
                ni.inetAddresses?.toList()?.forEach { addr ->
                    if (addr is Inet4Address && !addr.isLoopbackAddress && !addr.isLinkLocalAddress) {
                        put(addr.hostAddress, rank, out)
                    }
                }
            }
        }
        return out.entries.sortedBy { it.value }.map { it.key }
    }

    private fun collect(lp: LinkProperties, rank: Int, out: MutableMap<String, Int>) {
        lp.linkAddresses.forEach { la ->
            val addr: InetAddress = la.address
            if (addr is Inet4Address && !addr.isLoopbackAddress && !addr.isLinkLocalAddress) {
                put(addr.hostAddress, rank, out)
            }
        }
    }

    private fun put(ip: String?, rank: Int, out: MutableMap<String, Int>) {
        if (ip.isNullOrBlank()) return
        val existing = out[ip]
        if (existing == null || rank < existing) out[ip] = rank
    }

    fun transportName(context: Context): String {
        return runCatching {
            val cm = context.getSystemService(ConnectivityManager::class.java) ?: return "Unknown"
            val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) } ?: return "Unknown"
            when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Mobile data"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
                else -> "Unknown"
            }
        }.getOrDefault("Unknown")
    }

    /**
     * SSID needs ACCESS_WIFI_STATE (declared) plus, on Android 10+, location
     * access. We never ask for location just for a label: return null instead.
     */
    fun wifiSsid(context: Context): String? {
        return runCatching {
            val app = context.applicationContext
            val wifi = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val info = wifi?.connectionInfo ?: return null
            val ssid = info.ssid?.trim('"')
            if (ssid.isNullOrBlank() || ssid == "<unknown ssid>") null else ssid
        }.getOrNull()
    }

    fun multicastLockSupported(): Boolean = true

    fun hasWifiStatePermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_WIFI_STATE) ==
            PackageManager.PERMISSION_GRANTED

    fun deviceName(): String = "${Build.MANUFACTURER} ${Build.MODEL}"
}
