package com.neurio.client

import android.content.Context
import com.neurio.common.AppLog
import com.neurio.network.DiscoveryService
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** A host visible in the JOIN list. */
data class DiscoveredHost(
    val serviceName: String,
    val address: InetAddress,
    val port: Int,
    val device: String,
    val gameLabel: String,
    val state: String,
    @Volatile var rttMs: Long
) {
    val ipLabel: String get() = address.hostAddress ?: "?"

    val qualityLabel: String
        get() = when {
            rttMs < 0 -> "…"
            rttMs <= 8 -> "Excellent"
            rttMs <= 25 -> "Good"
            rttMs <= 60 -> "Weak"
            else -> "Very weak"
        }
}

/**
 * Finds Neurio hosts on the LAN via NSD and measures reachability with a raw
 * TCP connect-time probe (non-intrusive: it never touches the pairing flow).
 */
class HostDiscovery(context: Context) {

    companion object {
        private const val TAG = "HostDiscovery"
        private const val PROBE_TIMEOUT_MS = 600
        private const val SWEEP_PERIOD_MS = 2000L
    }

    interface Listener {
        fun onHosts(hosts: List<DiscoveredHost>)
        fun onError(message: String)
    }

    private val discovery = DiscoveryService(context)
    private val hosts = ConcurrentHashMap<String, DiscoveredHost>()
    private val pool = Executors.newFixedThreadPool(3) { r ->
        Thread(r, "neurio-probe").apply { isDaemon = true }
    }

    @Volatile
    private var active = false

    var listener: Listener? = null

    fun start() {
        if (active) return
        active = true
        discovery.discover(
            onFound = { info ->
                AppLog.d(TAG, "found ${info.serviceName}")
            },
            onLost = { name ->
                hosts.remove(name)
                publish()
            },
            onResolved = { info ->
                val addr = info.host ?: return@discover
                val port = info.port
                if (port <= 0) return@discover
                val attrs = info.attributes
                val host = DiscoveredHost(
                    serviceName = info.serviceName ?: "Neurio host",
                    address = addr,
                    port = port,
                    device = attrs[DiscoveryService.TXT_DEVICE]?.toString(Charsets.UTF_8)
                        ?: info.serviceName ?: "host",
                    gameLabel = attrs[DiscoveryService.TXT_GAME]?.toString(Charsets.UTF_8) ?: "",
                    state = attrs[DiscoveryService.TXT_STATE]?.toString(Charsets.UTF_8) ?: "idle",
                    rttMs = -1
                )
                hosts[host.serviceName] = host
                probe(host)
                publish()
            },
            onError = { msg -> listener?.onError(msg) }
        )
        Thread { sweepLoop() }.apply {
            name = "neurio-sweep"
            isDaemon = true
        }.start()
    }

    private fun sweepLoop() {
        while (active) {
            for (host in hosts.values) {
                probe(host)
            }
            publish()
            try {
                Thread.sleep(SWEEP_PERIOD_MS)
            } catch (e: InterruptedException) {
                break
            }
        }
    }

    private fun probe(host: DiscoveredHost) {
        pool.execute {
            val t0 = System.nanoTime()
            try {
                Socket().use { s ->
                    s.connect(InetSocketAddress(host.address, host.port), PROBE_TIMEOUT_MS)
                }
                val rtt = (System.nanoTime() - t0) / 1_000_000L
                host.rttMs = rtt
            } catch (e: Exception) {
                host.rttMs = 500
            }
            publish()
        }
    }

    private fun publish() {
        if (!active) return
        val list = hosts.values.sortedWith(
            compareBy<DiscoveredHost> { if (it.rttMs < 0) Long.MAX_VALUE else it.rttMs }
                .thenBy { it.serviceName }
        )
        listener?.onHosts(list)
    }

    fun stop() {
        active = false
        discovery.stopDiscovery()
        hosts.clear()
    }
}
