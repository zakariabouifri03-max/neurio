package com.neurio.lanstream.net

import com.neurio.lanstream.core.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketException

/** Socket helpers shared by every UDP channel. */
object Udp {

    private const val IPTOS_LOWDELAY = 0x10

    fun bind(port: Int, reuse: Boolean = true): DatagramSocket {
        val socket = DatagramSocket(null)
        socket.reuseAddress = reuse
        socket.bind(InetSocketAddress(port))
        tune(socket)
        return socket
    }

    fun ephemeral(): DatagramSocket {
        val socket = DatagramSocket(null)
        socket.reuseAddress = true
        socket.bind(InetSocketAddress(0))
        tune(socket)
        return socket
    }

    fun tune(socket: DatagramSocket) {
        runCatching { socket.trafficClass = IPTOS_LOWDELAY }
        runCatching {
            socket.receiveBufferSize = 4 * 1024 * 1024
            socket.sendBufferSize = 1024 * 1024
        }
    }

    fun broadcastAddresses(): List<InetAddress> {
        val out = ArrayList<InetAddress>()
        runCatching {
            val interfaces = java.net.NetworkInterface.getNetworkInterfaces() ?: return@runCatching
            while (interfaces.hasMoreElements()) {
                val ni = interfaces.nextElement()
                if (!ni.isUp || ni.isLoopback) continue
                for (ia in ni.interfaceAddresses) {
                    val addr = ia.address
                    if (addr is java.net.Inet4Address && !addr.isLoopbackAddress) {
                        ia.broadcast?.let { if (it !in out) out.add(it) }
                    }
                }
            }
        }
        runCatching {
            val fallback = InetAddress.getByName("255.255.255.255")
            if (fallback !in out) out.add(fallback)
        }
        return out
    }
}

/**
 * One-way UDP sender with a reused DatagramPacket (no per-frame allocation on
 * the hot path).
 */
class UdpSender(socket: DatagramSocket, destination: InetSocketAddress) {

    private val buffer = ByteArray(Protocol.MAX_DATAGRAM)
    private val packet = DatagramPacket(buffer, buffer.size, destination)

    var destination: InetSocketAddress = destination
        set(value) {
            field = value
            packet.address = value.address
            packet.port = value.port
        }

    var bytesSent = 0L
        private set

    var packetsSent = 0L
        private set

    var failures = 0L
        private set

    @Synchronized
    fun send(payload: ByteArray, length: Int) {
        if (length > buffer.size) return
        System.arraycopy(payload, 0, buffer, 0, length)
        packet.length = length
        try {
            socket.send(packet)
            bytesSent += length
            packetsSent++
        } catch (t: Throwable) {
            failures++
            if (failures % 50L == 1L) Log.w("UDP send failed: ${t.message}")
        }
    }
}

/**
 * Blocking receive loop, meant to be run on a coroutine backed by Dispatchers.IO.
 * [stop] closes the socket, which unblocks receive() with a SocketException.
 */
class UdpReceiver(
    private val socket: DatagramSocket,
    private val onPacket: (header: MediaHeader, buffer: ByteArray, offset: Int, length: Int, from: InetSocketAddress) -> Unit,
    private val onBadPacket: () -> Unit = {}
) {
    @Volatile
    private var running = false

    private val buffer = ByteArray(Protocol.MAX_DATAGRAM + 64)
    private val packet = DatagramPacket(buffer, buffer.size)

    var bytesReceived = 0L
        private set

    var packetsReceived = 0L
        private set

    fun loop() {
        running = true
        while (running) {
            try {
                packet.length = buffer.size
                socket.receive(packet)
            } catch (_: SocketException) {
                break
            } catch (t: Throwable) {
                if (!running) break
                Log.w("UDP receive error: ${t.message}")
                continue
            }
            if (!running) break
            val length = packet.length
            packetsReceived++
            bytesReceived += length
            val header = MediaHeader.parse(packet.data, length)
            if (header == null) {
                onBadPacket()
                continue
            }
            val from = InetSocketAddress(packet.address, packet.port)
            onPacket(header, packet.data, Protocol.HEADER_SIZE, length - Protocol.HEADER_SIZE, from)
        }
    }

    fun stop() {
        running = false
        runCatching { socket.close() }
    }
}
