package com.turbocast60.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import com.turbocast60.model.ReceiverDevice
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.Closeable
import java.util.concurrent.ConcurrentHashMap

class ReceiverDiscovery(context: Context) : Closeable {
    private val appContext = context.applicationContext
    private val nsd = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = appContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val mutableDevices = MutableStateFlow<List<ReceiverDevice>>(emptyList())
    val devices: StateFlow<List<ReceiverDevice>> = mutableDevices.asStateFlow()
    private val mutableStatus = MutableStateFlow("Searching local network…")
    val status: StateFlow<String> = mutableStatus.asStateFlow()
    private val devicesByName = ConcurrentHashMap<String, ReceiverDevice>()
    @Volatile private var discovering = false
    private var multicastLock: WifiManager.MulticastLock? = null

    private val listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) {
            discovering = true
            mutableStatus.value = "Searching local network…"
        }
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
            discovering = false
            mutableStatus.value = "Local discovery could not start (code $errorCode). Check Nearby devices permission and Wi-Fi."
            runCatching { nsd.stopServiceDiscovery(this) }
        }
        override fun onDiscoveryStopped(serviceType: String) { discovering = false }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { discovering = false }

        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
            if (!serviceInfo.serviceType.startsWith(SERVICE_TYPE_PREFIX)) return
            runCatching {
                @Suppress("DEPRECATION")
                nsd.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                        if (devicesByName.isEmpty()) mutableStatus.value = "A receiver was found but could not be resolved. Retry discovery."
                    }
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val host = info.host?.hostAddress ?: return
                        val name = info.serviceName?.trim()?.takeIf { it.isNotEmpty() } ?: "TurboCast receiver"
                        val device = ReceiverDevice(
                            id = "${name.lowercase()}@$host:${info.port}",
                            name = name,
                            host = host,
                            port = info.port
                        )
                        devicesByName[info.serviceName] = device
                        publishDevices()
                        mutableStatus.value = "${devicesByName.size} TurboCast receiver${if (devicesByName.size == 1) "" else "s"} found"
                    }
                })
            }
        }

        override fun onServiceLost(serviceInfo: NsdServiceInfo) {
            devicesByName.remove(serviceInfo.serviceName)
            publishDevices()
            mutableStatus.value = if (devicesByName.isEmpty()) "Searching local network…" else "${devicesByName.size} TurboCast receiver${if (devicesByName.size == 1) "" else "s"} available"
        }
    }

    @Synchronized
    fun start() {
        if (discovering) return
        runCatching {
            wifi?.createMulticastLock("TurboCast60-discovery")?.let { lock ->
                lock.setReferenceCounted(false)
                lock.acquire()
                multicastLock = lock
            }
            mutableStatus.value = "Searching local network…"
            discovering = true
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        }.onFailure {
            discovering = false
            runCatching { multicastLock?.release() }
            multicastLock = null
            mutableStatus.value = "Could not access local network discovery. Check Wi-Fi and Nearby devices permission."
        }
    }

    @Synchronized
    fun restart() {
        stopDiscovery()
        devicesByName.clear()
        publishDevices()
        mutableStatus.value = "Searching local network…"
        start()
    }

    @Synchronized
    private fun stopDiscovery() {
        if (discovering) runCatching { nsd.stopServiceDiscovery(listener) }
        discovering = false
        runCatching { multicastLock?.release() }
        multicastLock = null
    }

    private fun publishDevices() {
        mutableDevices.value = devicesByName.values.sortedBy { it.name.lowercase() }
    }

    override fun close() {
        stopDiscovery()
        mutableStatus.value = "Discovery stopped"
    }

    companion object {
        const val SERVICE_TYPE = "_turbocast._tcp."
        private const val SERVICE_TYPE_PREFIX = "_turbocast._tcp"
    }
}
