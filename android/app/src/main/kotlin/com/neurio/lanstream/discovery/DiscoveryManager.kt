package com.neurio.lanstream.discovery

import android.content.Context
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.net.Protocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap

/**
 * Front door for LAN discovery: runs mDNS and the UDP beacon in parallel,
 * de-duplicates what they find, keeps a live RTT per host and expires hosts
 * that stopped answering.
 *
 * Replace this class (and the two [DiscoveryService] implementations) to change
 * the discovery technology without touching the UI.
 */
class DiscoveryManager(context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val nsd = NsdDiscovery(context)
    private val beacon = UdpBeacon(context)
    private val services: List<DiscoveryService> = listOf(nsd, beacon)

    private val merged = ConcurrentHashMap<String, HostEndpoint>()

    private var pingJob: kotlinx.coroutines.Job? = null

    private val _hosts = kotlinx.coroutines.flow.MutableStateFlow<List<HostEndpoint>>(emptyList())
    val hosts: kotlinx.coroutines.flow.StateFlow<List<HostEndpoint>> = _hosts

    fun advertise(info: AdvertiseInfo) {
        services.forEach { service ->
            runCatching { service.advertise(info) }
                .onFailure { Log.w("Advertise failed: ${it.message}") }
        }
    }

    fun stopAdvertising() {
        services.forEach { runCatching { it.stopAdvertising() } }
    }

    fun startScan() {
        merged.clear()
        publish()
        services.forEach { service ->
            runCatching { service.startScan(::onUpdate) }
                .onFailure { Log.w("Scan failed: ${it.message}") }
        }
        startPingLoop()
    }

    fun stopScan() {
        pingJob?.cancel()
        pingJob = null
        services.forEach { runCatching { it.stopScan() } }
        merged.clear()
        publish()
    }

    /** Manual entry (Settings > Add host by IP). Returns false on a bad address. */
    fun addManual(host: String, port: Int = Protocol.CONTROL_PORT): Boolean {
        val address = runCatching { InetAddress.getByName(host.trim()) }.getOrNull() ?: return false
        val endpoint = HostEndpoint(
            id = HostEndpoint.key(address, port),
            name = "Host $host",
            address = address,
            controlPort = port,
            source = "manual",
            lastSeenMs = System.currentTimeMillis()
        )
        merged[endpoint.id] = endpoint
        publish()
        return true
    }

    private fun onUpdate(endpoints: List<HostEndpoint>) {
        endpoints.forEach { endpoint ->
            val existing = merged[endpoint.id]
            merged[endpoint.id] = existing?.merge(endpoint) ?: endpoint
        }
        publish()
    }

    private fun startPingLoop() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (isActive) {
                val snapshot = merged.values.toList()
                snapshot.forEach { endpoint ->
                    val rtt = beacon.ping(endpoint.address)
                    val current = merged[endpoint.id] ?: return@forEach
                    merged[endpoint.id] = current.copy(
                        rttMs = rtt,
                        lastSeenMs = if (rtt >= 0) System.currentTimeMillis() else current.lastSeenMs
                    )
                }
                expire()
                publish()
                delay(PING_INTERVAL_MS)
            }
        }
    }

    private fun expire() {
        val now = System.currentTimeMillis()
        val stale = merged.values.filter { now - it.lastSeenMs > TTL_MS }
        stale.forEach { merged.remove(it.id) }
    }

    private fun publish() {
        _hosts.value = merged.values.sortedWith(compareBy({ it.busy }, { it.name.lowercase() }))
    }

    fun release() {
        stopScan()
        stopAdvertising()
        services.forEach { runCatching { it.release() } }
    }

    companion object {
        private const val PING_INTERVAL_MS = 2500L
        private const val TTL_MS = 15_000L
    }
}
