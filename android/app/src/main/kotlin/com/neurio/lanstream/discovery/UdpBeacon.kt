package com.neurio.lanstream.discovery

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.net.Protocol
import com.neurio.lanstream.net.Udp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.nio.charset.Charset
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * UDP broadcast discovery + RTT probe.
 *
 * mDNS (see [NsdDiscovery]) is the primary mechanism, but plenty of home
 * routers and hotel/hotspot setups silently drop multicast. This beacon is the
 * belt-and-braces fallback: the host shouts "here" every [BEACON_INTERVAL_MS]
 * on the subnet broadcast address, the client also shouts "discover", and any
 * peer can measure real round trip time with a ping/pong exchange.
 *
 * Messages are tiny JSON objects (no third party serialiser needed):
 *   host  -> broadcast : {"t":"here","name":..,"port":..,"game":..,"busy":..,"v":1}
 *   client-> broadcast : {"t":"discover","v":1}
 *   client-> host      : {"t":"ping","id":n,"tc":clientMs}
 *   host  -> client    : {"t":"pong","id":n,"tc":clientMs,"th":hostMs}
 */
class UdpBeacon(private val context: Context) : DiscoveryService {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val utf8: Charset = Charsets.UTF_8
    private val pingIds = AtomicLong(1)

    @Volatile
    private var advertiseSocket: DatagramSocket? = null

    @Volatile
    private var scanSocket: DatagramSocket? = null

    @Volatile
    private var advertiseJob: Job? = null

    @Volatile
    private var scanJob: Job? = null

    @Volatile
    private var info: AdvertiseInfo? = null

    @Volatile
    private var listener: ((List<HostEndpoint>) -> Unit)? = null

    private val seen = ConcurrentHashMap<String, HostEndpoint>()
    private val pendingPings = ConcurrentHashMap<Long, (Int) -> Unit>()
    private var multicastLock: WifiManager.MulticastLock? = null

    // ---------------------------------------------------------------- advertise

    override fun advertise(info: AdvertiseInfo) {
        this.info = info
        acquireMulticastLock()
        val socket = advertiseSocket ?: openSocket(Protocol.BEACON_PORT).also { advertiseSocket = it }
        if (socket == null) {
            Log.w("Beacon: could not bind port ${Protocol.BEACON_PORT}")
            return
        }
        advertiseJob?.cancel()
        advertiseJob = scope.launch { advertiseLoop(socket, info) }
    }

    private suspend fun advertiseLoop(socket: DatagramSocket, info: AdvertiseInfo) {
        // Reply to pings/discoveries on the same socket.
        scope.launch { receiveLoop(socket, isHost = true) }
        while (scope.isActive) {
            sendBeacon(socket, info)
            delay(BEACON_INTERVAL_MS)
        }
    }

    private fun sendBeacon(socket: DatagramSocket, info: AdvertiseInfo) {
        val payload = JSONObject().apply {
            put("t", "here")
            put("name", info.name)
            put("port", info.controlPort)
            put("game", info.gameName ?: "")
            put("busy", info.busy)
            put("v", info.version)
        }.toString().toByteArray(utf8)
        val packet = DatagramPacket(payload, payload.size)
        Udp.broadcastAddresses().forEach { address ->
            runCatching {
                packet.address = address
                packet.port = Protocol.BEACON_PORT
                socket.send(packet)
            }
        }
    }

    override fun stopAdvertising() {
        advertiseJob?.cancel()
        advertiseJob = null
        advertiseSocket?.close()
        advertiseSocket = null
        info = null
        maybeReleaseMulticastLock()
    }

    // --------------------------------------------------------------------- scan

    override fun startScan(onUpdate: (List<HostEndpoint>) -> Unit) {
        listener = onUpdate
        acquireMulticastLock()
        val socket = scanSocket ?: openSocket(Protocol.BEACON_PORT).also { scanSocket = it }
        if (socket == null) {
            Log.w("Beacon: could not bind port ${Protocol.BEACON_PORT} for scanning")
            return
        }
        scanJob?.cancel()
        scanJob = scope.launch { scanLoop(socket) }
    }

    private suspend fun scanLoop(socket: DatagramSocket) {
        scope.launch { receiveLoop(socket, isHost = false) }
        while (scope.isActive) {
            val payload = JSONObject().apply { put("t", "discover"); put("v", Protocol.VERSION) }
                .toString().toByteArray(utf8)
            val packet = DatagramPacket(payload, payload.size)
            Udp.broadcastAddresses().forEach { address ->
                runCatching {
                    packet.address = address
                    packet.port = Protocol.BEACON_PORT
                    socket.send(packet)
                }
            }
            delay(DISCOVER_INTERVAL_MS)
            expire()
        }
    }

    override fun stopScan() {
        scanJob?.cancel()
        scanJob = null
        scanSocket?.close()
        scanSocket = null
        seen.clear()
        listener = null
        maybeReleaseMulticastLock()
    }

    // ------------------------------------------------------------------ receive

    private suspend fun receiveLoop(socket: DatagramSocket, isHost: Boolean) {
        val buffer = ByteArray(2048)
        val packet = DatagramPacket(buffer, buffer.size)
        withContext(Dispatchers.IO) {
            while (socket.isClosed.not()) {
                try {
                    packet.length = buffer.size
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue
                } catch (_: Throwable) {
                    break
                }
                val text = runCatching {
                    String(packet.data, packet.offset, packet.length, utf8)
                }.getOrNull() ?: continue
                handleMessage(text, packet.address, packet.port, socket, isHost)
            }
        }
    }

    private fun handleMessage(
        text: String,
        from: InetAddress,
        fromPort: Int,
        socket: DatagramSocket,
        isHost: Boolean
    ) {
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (json.optString("t")) {
            "here" -> if (!isHost) onHere(json, from)
            "discover" -> if (isHost) {
                info?.let { sendBeaconTo(socket, it, from, fromPort) }
            }
            "ping" -> if (isHost) {
                val id = json.optLong("id")
                val tc = json.optLong("tc")
                val pong = JSONObject().apply {
                    put("t", "pong")
                    put("id", id)
                    put("tc", tc)
                    put("th", System.currentTimeMillis())
                }.toString().toByteArray(utf8)
                runCatching {
                    socket.send(DatagramPacket(pong, pong.size, from, fromPort))
                }
            }
            "pong" -> {
                val id = json.optLong("id")
                val tc = json.optLong("tc", System.currentTimeMillis())
                pendingPings.remove(id)?.invoke((System.currentTimeMillis() - tc).toInt().coerceAtLeast(0))
            }
        }
    }

    private fun sendBeaconTo(socket: DatagramSocket, info: AdvertiseInfo, to: InetAddress, port: Int) {
        val payload = JSONObject().apply {
            put("t", "here")
            put("name", info.name)
            put("port", info.controlPort)
            put("game", info.gameName ?: "")
            put("busy", info.busy)
            put("v", info.version)
        }.toString().toByteArray(utf8)
        runCatching { socket.send(DatagramPacket(payload, payload.size, to, port)) }
    }

    private fun onHere(json: JSONObject, from: InetAddress) {
        val port = json.optInt("port", Protocol.CONTROL_PORT)
        val endpoint = HostEndpoint(
            id = HostEndpoint.key(from, port),
            name = json.optString("name").ifBlank { "Neurio host" },
            address = from,
            controlPort = port,
            version = json.optInt("v", 1),
            gameName = json.optString("game").ifBlank { null },
            busy = json.optBoolean("busy", false),
            source = "beacon",
            lastSeenMs = System.currentTimeMillis()
        )
        merge(endpoint)
    }

    private fun merge(endpoint: HostEndpoint) {
        seen[endpoint.id] = seen[endpoint.id]?.merge(endpoint) ?: endpoint
        publish()
    }

    private fun publish() {
        val list = seen.values.sortedWith(compareBy({ it.busy }, { it.name.lowercase() }))
        listener?.invoke(list)
    }

    private fun expire() {
        val now = System.currentTimeMillis()
        val stale = seen.values.filter { now - it.lastSeenMs > ENDPOINT_TTL_MS }
        if (stale.isNotEmpty()) {
            stale.forEach { seen.remove(it.id) }
            publish()
        }
    }

    // -------------------------------------------------------------------- ping

    /** Round trip time to a host, in ms, or -1 when the host did not answer. */
    suspend fun ping(address: InetAddress, timeoutMs: Long = 700): Int = withContext(Dispatchers.IO) {
        val socket = scanSocket ?: advertiseSocket
        if (socket == null) return@withContext -1
        val id = pingIds.getAndIncrement()
        val payload = JSONObject().apply {
            put("t", "ping")
            put("id", id)
            put("tc", System.currentTimeMillis())
        }.toString().toByteArray(utf8)
        val answer = CompletableDeferred<Int>()
        pendingPings[id] = { rtt -> answer.complete(rtt) }
        try {
            socket.send(DatagramPacket(payload, payload.size, address, Protocol.BEACON_PORT))
        } catch (t: Throwable) {
            pendingPings.remove(id)
            return@withContext -1
        }
        val rtt = withTimeoutOrNull(timeoutMs) { answer.await() } ?: -1
        pendingPings.remove(id)
        rtt
    }

    // ----------------------------------------------------------------- plumbing

    private fun openSocket(preferredPort: Int): DatagramSocket? {
        return try {
            val socket = Udp.bind(preferredPort)
            socket.soTimeout = 500
            socket.broadcast = true
            socket
        } catch (t: Throwable) {
            Log.w("Beacon: bind($preferredPort) failed: ${t.message}")
            try {
                val socket = Udp.ephemeral()
                socket.soTimeout = 500
                socket.broadcast = true
                socket
            } catch (t2: Throwable) {
                Log.w("Beacon: ephemeral bind failed: ${t2.message}")
                null
            }
        }
    }

    private fun acquireMulticastLock() {
        runCatching {
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val lock = wifi?.createMulticastLock("neurio-discovery")
            lock?.setReferenceCounted(true)
            lock?.acquire()
            multicastLock = lock
        }
    }

    private fun maybeReleaseMulticastLock() {
        if (advertiseSocket == null && scanSocket == null) {
            runCatching { multicastLock?.release() }
            multicastLock = null
        }
    }

    override fun release() {
        stopAdvertising()
        stopScan()
        pendingPings.clear()
    }

    companion object {
        private const val BEACON_INTERVAL_MS = 1500L
        private const val DISCOVER_INTERVAL_MS = 2500L
        private const val ENDPOINT_TTL_MS = 12_000L

        fun supportsBroadcast(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    }
}
