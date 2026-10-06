package com.neurio.lanstream.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.net.Protocol
import java.net.InetAddress
import java.util.LinkedList
import java.util.concurrent.ConcurrentHashMap

/**
 * mDNS / NSD ("_neurio._tcp.") discovery.
 *
 * This is the standards-based primary mechanism; [UdpBeacon] covers the cases
 * where the access point filters multicast. Everything here runs on the main
 * looper because NsdManager binds its internal handler to the calling thread.
 */
@Suppress("DEPRECATION")
class NsdDiscovery(private val context: Context) : DiscoveryService {

    private val nsdManager: NsdManager? =
        context.applicationContext.getSystemService(NsdManager::class.java)

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var listener: ((List<HostEndpoint>) -> Unit)? = null

    @Volatile
    private var advertiseInfo: AdvertiseInfo? = null

    @Volatile
    private var registeredName: String? = null

    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    private val pendingResolve = LinkedList<NsdServiceInfo>()
    private val resolved = ConcurrentHashMap<String, HostEndpoint>()

    @Volatile
    private var resolving = false

    // ---------------------------------------------------------------- advertise

    override fun advertise(info: AdvertiseInfo) {
        val nsd = nsdManager ?: return
        advertiseInfo = info
        val name = SERVICE_PREFIX + sanitise(info.name)
        mainHandler.post {
            runCatching {
                registrationListener?.let { runCatching { nsd.unregisterService(it) } }
                val serviceInfo = NsdServiceInfo().apply {
                    serviceName = name
                    serviceType = Protocol.SERVICE_TYPE
                    port = info.controlPort
                    setAttribute(ATTR_NAME, info.name)
                    setAttribute(ATTR_GAME, info.gameName ?: "")
                    setAttribute(ATTR_BUSY, if (info.busy) "1" else "0")
                    setAttribute(ATTR_VERSION, info.version.toString())
                }
                val regListener = object : NsdManager.RegistrationListener {
                    override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                        Log.w("NSD registration failed: $errorCode")
                    }

                    override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                        Log.w("NSD unregistration failed: $errorCode")
                    }

                    override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {
                        registeredName = serviceInfo.serviceName
                        Log.i("NSD registered: ${serviceInfo.serviceName}")
                    }

                    override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {
                        registeredName = null
                    }
                }
                registrationListener = regListener
                nsd.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, regListener)
            }.onFailure { Log.w("NSD advertise failed", it) }
        }
    }

    override fun stopAdvertising() {
        val nsd = nsdManager ?: return
        mainHandler.post {
            registrationListener?.let { runCatching { nsd.unregisterService(it) } }
            registrationListener = null
            advertiseInfo = null
        }
    }

    // --------------------------------------------------------------------- scan

    override fun startScan(onUpdate: (List<HostEndpoint>) -> Unit) {
        val nsd = nsdManager ?: return
        listener = onUpdate
        mainHandler.post {
            runCatching {
                discoveryListener?.let { runCatching { nsd.stopServiceDiscovery(it) } }
                val discListener = object : NsdManager.DiscoveryListener {
                    override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                        Log.w("NSD start discovery failed: $errorCode")
                    }

                    override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                        Log.w("NSD stop discovery failed: $errorCode")
                    }

                    override fun onDiscoveryStarted(serviceType: String) {
                        Log.i("NSD discovery started ($serviceType)")
                    }

                    override fun onDiscoveryStopped(serviceType: String) {
                        Log.i("NSD discovery stopped")
                    }

                    override fun onServiceFound(service: NsdServiceInfo) {
                        if (!service.serviceName.startsWith(SERVICE_PREFIX)) return
                        synchronized(pendingResolve) { pendingResolve.add(service) }
                        pumpResolveQueue()
                    }

                    override fun onServiceLost(service: NsdServiceInfo) {
                        resolved.remove(service.serviceName)
                        publish()
                    }
                }
                discoveryListener = discListener
                nsd.discoverServices(Protocol.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discListener)
            }.onFailure { Log.w("NSD scan failed", it) }
        }
    }

    override fun stopScan() {
        val nsd = nsdManager ?: return
        mainHandler.post {
            discoveryListener?.let { runCatching { nsd.stopServiceDiscovery(it) } }
            discoveryListener = null
            synchronized(pendingResolve) { pendingResolve.clear() }
            resolved.clear()
            listener = null
        }
    }

    /**
     * NsdManager only supports one outstanding resolve, so requests are queued.
     */
    private fun pumpResolveQueue() {
        val nsd = nsdManager ?: return
        if (resolving) return
        val next = synchronized(pendingResolve) {
            if (pendingResolve.isEmpty()) null else pendingResolve.removeFirst()
        } ?: return
        resolving = true
        mainHandler.post {
            runCatching {
                nsd.resolveService(next, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                        Log.w("NSD resolve failed (${serviceInfo.serviceName}): $errorCode")
                        resolving = false
                        pumpResolveQueue()
                    }

                    override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                        onResolved(serviceInfo)
                        resolving = false
                        pumpResolveQueue()
                    }
                })
            }.onFailure {
                resolving = false
                pumpResolveQueue()
            }
        }
    }

    private fun onResolved(service: NsdServiceInfo) {
        val host: InetAddress = service.host ?: return
        val port = service.port
        val attributes = runCatching { service.attributes }.getOrNull()
        val name = attributes?.get(ATTR_NAME)?.let { String(it) }
            ?: service.serviceName.removePrefix(SERVICE_PREFIX)
        val game = attributes?.get(ATTR_GAME)?.let { String(it) }?.ifBlank { null }
        val busy = attributes?.get(ATTR_BUSY)?.let { String(it) } == "1"
        val endpoint = HostEndpoint(
            id = HostEndpoint.key(host, port),
            name = name.ifBlank { "Neurio host" },
            address = host,
            controlPort = port,
            version = attributes?.get(ATTR_VERSION)?.let { String(it).toIntOrNull() } ?: 1,
            gameName = game,
            busy = busy,
            source = "mDNS",
            lastSeenMs = System.currentTimeMillis()
        )
        resolved[service.serviceName] = endpoint
        publish()
    }

    private fun publish() {
        val list = resolved.values.sortedWith(compareBy({ it.busy }, { it.name.lowercase() }))
        listener?.invoke(list)
    }

    override fun release() {
        stopScan()
        stopAdvertising()
    }

    private fun sanitise(name: String): String =
        name.replace(Regex("[^A-Za-z0-9-]"), "-").take(40).ifBlank { "host" }

    companion object {
        private const val SERVICE_PREFIX = "neurio-"
        private const val ATTR_NAME = "name"
        private const val ATTR_GAME = "game"
        private const val ATTR_BUSY = "busy"
        private const val ATTR_VERSION = "v"
    }
}
