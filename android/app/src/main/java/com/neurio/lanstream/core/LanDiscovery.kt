package com.neurio.lanstream.core

import android.content.Context
import android.net.wifi.WifiManager
import com.neurio.lanstream.model.HostAdvertisement
import com.neurio.lanstream.model.LocalNetwork
import com.neurio.lanstream.protocol.LanProtocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

private class MulticastLease(context: Context, tag: String) : AutoCloseable {
    private val lock = try {
        (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createMulticastLock(tag).apply {
                setReferenceCounted(false)
                acquire()
            }
    } catch (_: Exception) {
        null
    }

    override fun close() {
        try {
            if (lock?.isHeld == true) lock.release()
        } catch (_: Exception) {
        }
    }
}

/** Host-side UDP broadcast and one-packet ping responder. */
class DiscoveryBroadcaster(
    context: Context,
    private val sessionId: Long,
    private val deviceName: String,
    private val gameName: String,
    private val onError: (String) -> Unit,
) : AutoCloseable {
    private val appContext = context.applicationContext
    private val running = AtomicBoolean(false)
    private var socket: DatagramSocket? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var worker: Job? = null
    private var lease: MulticastLease? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        lease = MulticastLease(appContext, "neurio-host-discovery")
        worker = scope.launch { runLoop() }
    }

    private fun runLoop() {
        try {
            val udp = DatagramSocket(null).apply {
                reuseAddress = true
                broadcast = true
                bind(InetSocketAddress(LanProtocol.DISCOVERY_PORT))
                soTimeout = 450
            }
            socket = udp
            val advertisement = makeAdvertisement()
            val destinations = findBroadcastAddresses().ifEmpty { listOf(InetAddress.getByName("255.255.255.255")) }
            var nextBroadcast = 0L
            val buffer = ByteArray(256)
            while (running.get() && !udp.isClosed) {
                val now = System.currentTimeMillis()
                if (now >= nextBroadcast) {
                    for (address in destinations) {
                        try {
                            udp.send(DatagramPacket(advertisement, advertisement.size, address, LanProtocol.DISCOVERY_PORT))
                        } catch (_: Exception) {
                        }
                    }
                    nextBroadcast = now + 1000
                }
                try {
                    val incoming = DatagramPacket(buffer, buffer.size)
                    udp.receive(incoming)
                    respondToPing(udp, incoming)
                } catch (_: java.net.SocketTimeoutException) {
                }
            }
        } catch (e: Exception) {
            if (running.get()) onError("LAN discovery unavailable: ${e.message ?: "socket error"}")
        } finally {
            socket?.close()
            socket = null
            running.set(false)
        }
    }

    private fun makeAdvertisement(): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { out ->
            out.writeInt(LanProtocol.DISCOVERY_MAGIC)
            out.writeByte(LanProtocol.DISCOVERY_ADVERTISEMENT)
            out.writeByte(1)
            out.writeLong(sessionId)
            LanProtocol.writeString(out, deviceName, 80)
            LanProtocol.writeString(out, gameName, 160)
            out.writeInt(LanProtocol.TCP_PORT)
            out.writeInt(LanProtocol.DISCOVERY_PORT)
        }
        bytes.toByteArray()
    }

    private fun respondToPing(udp: DatagramSocket, packet: DatagramPacket) {
        try {
            val data = DataInputStream(ByteArrayInputStream(packet.data, packet.offset, packet.length))
            if (data.readInt() != LanProtocol.DISCOVERY_MAGIC || data.readUnsignedByte() != LanProtocol.DISCOVERY_PING) return
            val advertisedSession = data.readLong()
            val nonce = data.readLong()
            if (advertisedSession != sessionId) return
            val response = ByteArrayOutputStream().use { bytes ->
                DataOutputStream(bytes).use { out ->
                    out.writeInt(LanProtocol.DISCOVERY_MAGIC)
                    out.writeByte(LanProtocol.DISCOVERY_PONG)
                    out.writeLong(sessionId)
                    out.writeLong(nonce)
                }
                bytes.toByteArray()
            }
            udp.send(DatagramPacket(response, response.size, packet.address, packet.port))
        } catch (_: Exception) {
        }
    }

    private fun findBroadcastAddresses(): List<InetAddress> = try {
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.interfaceAddresses }
            .mapNotNull { it.broadcast }
            .distinctBy { it.hostAddress }
    } catch (_: Exception) {
        emptyList()
    }

    override fun close() {
        running.set(false)
        socket?.close()
        worker?.cancel()
        scope.cancel()
        lease?.close()
        lease = null
    }
}

/** Client-side LAN scan. The scan sends only tiny discovery pings, never game data. */
class DiscoveryScanner(
    context: Context,
    private val onHostsChanged: (List<HostAdvertisement>) -> Unit,
    private val onError: (String) -> Unit,
) : AutoCloseable {
    private val appContext = context.applicationContext
    private val running = AtomicBoolean(false)
    private val hosts = ConcurrentHashMap<Long, HostAdvertisement>()
    private val pendingPings = ConcurrentHashMap<Long, Pair<Long, Long>>() // nonce -> (session id, elapsed ms)
    private var socket: DatagramSocket? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var worker: Job? = null
    private var lease: MulticastLease? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        lease = MulticastLease(appContext, "neurio-client-discovery")
        worker = scope.launch { runLoop() }
    }

    private fun runLoop() {
        try {
            val udp = DatagramSocket(null).apply {
                reuseAddress = true
                broadcast = true
                bind(InetSocketAddress(LanProtocol.DISCOVERY_PORT))
                soTimeout = 500
            }
            socket = udp
            val buffer = ByteArray(1024)
            while (running.get() && !udp.isClosed) {
                try {
                    val packet = DatagramPacket(buffer, buffer.size)
                    udp.receive(packet)
                    handlePacket(udp, packet)
                } catch (_: java.net.SocketTimeoutException) {
                }
                removeExpiredHosts()
            }
        } catch (e: Exception) {
            if (running.get()) onError("Could not scan this Wi-Fi network: ${e.message ?: "discovery socket error"}")
        } finally {
            socket?.close()
            socket = null
            running.set(false)
        }
    }

    private fun handlePacket(udp: DatagramSocket, packet: DatagramPacket) {
        try {
            val input = DataInputStream(ByteArrayInputStream(packet.data, packet.offset, packet.length))
            if (input.readInt() != LanProtocol.DISCOVERY_MAGIC) return
            when (input.readUnsignedByte()) {
                LanProtocol.DISCOVERY_ADVERTISEMENT -> {
                    if (input.readUnsignedByte() != 1) return
                    val sessionId = input.readLong()
                    val device = LanProtocol.readString(input, 320)
                    val game = LanProtocol.readString(input, 640)
                    val tcpPort = input.readInt()
                    val discoveryPort = input.readInt()
                    if (tcpPort !in 1..65535 || discoveryPort !in 1..65535) return
                    val old = hosts[sessionId]
                    val current = HostAdvertisement(
                        sessionId = sessionId,
                        deviceName = device,
                        gameName = game,
                        address = packet.address.hostAddress ?: return,
                        tcpPort = tcpPort,
                        discoveryPort = discoveryPort,
                        pingMs = old?.pingMs ?: -1L,
                        seenAtMs = System.currentTimeMillis(),
                    )
                    hosts[sessionId] = current
                    val nonce = System.nanoTime()
                    pendingPings[nonce] = sessionId to android.os.SystemClock.elapsedRealtime()
                    val ping = ByteArrayOutputStream().use { bytes ->
                        DataOutputStream(bytes).use { out ->
                            out.writeInt(LanProtocol.DISCOVERY_MAGIC)
                            out.writeByte(LanProtocol.DISCOVERY_PING)
                            out.writeLong(sessionId)
                            out.writeLong(nonce)
                        }
                        bytes.toByteArray()
                    }
                    try {
                        udp.send(DatagramPacket(ping, ping.size, packet.address, discoveryPort))
                    } catch (_: Exception) {
                    }
                    publish()
                }
                LanProtocol.DISCOVERY_PONG -> {
                    val sessionId = input.readLong()
                    val nonce = input.readLong()
                    val pending = pendingPings.remove(nonce) ?: return
                    if (pending.first != sessionId) return
                    val rtt = (android.os.SystemClock.elapsedRealtime() - pending.second).coerceAtLeast(0L)
                    hosts.computeIfPresent(sessionId) { _, host -> host.copy(pingMs = rtt, seenAtMs = System.currentTimeMillis()) }
                    publish()
                }
            }
        } catch (_: Exception) {
        }
    }

    private fun removeExpiredHosts() {
        val now = System.currentTimeMillis()
        var changed = false
        hosts.entries.removeIf { now - it.value.seenAtMs > 6500 }.also { changed = it }
        pendingPings.entries.removeIf { android.os.SystemClock.elapsedRealtime() - it.value.second > 5000 }
        if (changed) publish()
    }

    private fun publish() {
        onHostsChanged(hosts.values.sortedWith(compareBy<HostAdvertisement> { it.pingMs < 0 }.thenBy { it.pingMs }.thenBy { it.deviceName.lowercase() }))
    }

    override fun close() {
        running.set(false)
        socket?.close()
        worker?.cancel()
        scope.cancel()
        lease?.close()
        lease = null
        hosts.clear()
        pendingPings.clear()
    }
}
