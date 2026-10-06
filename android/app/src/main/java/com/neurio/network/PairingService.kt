package com.neurio.network

import com.neurio.common.AppLog
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * Host-side TCP listener implementing the pairing handshake:
 *
 * ```
 * client -> HELLO   { name, udpPort }
 * host   -> HELLO_ACK { hostName, busy }
 * client -> PAIR_REQ { code }            (only when not busy)
 * host   -> PAIR_OK  { sessionId, tokenHex, mediaPort }   or PAIR_FAIL { reason }
 * ```
 *
 * Only a client presenting the 6-digit code currently shown on the host
 * screen can establish a session. One failed attempt per connection; the
 * connection is closed afterwards to make brute forcing clumsy on the LAN.
 */
class PairingService(
    private val port: Int,
    private val callbacks: Callbacks
) {
    interface Callbacks {
        fun pairingCode(): String
        fun hostDisplayName(): String
        fun isBusy(): Boolean
        fun onClientPaired(channel: ControlChannel, clientName: String, clientUdpPort: Int)
    }

    companion object {
        private const val TAG = "PairingService"
        const val DEFAULT_PORT = 47820
        private const val SO_TIMEOUT_MS = 10_000
    }

    private var serverSocket: ServerSocket? = null
    @Volatile
    private var running = false

    fun start() {
        if (running) return
        try {
            val ss = ServerSocket()
            ss.reuseAddress = true
            ss.bind(InetSocketAddress(port))
            ss.soTimeout = 1000
            serverSocket = ss
        } catch (e: Exception) {
            AppLog.e(TAG, "cannot bind port $port", e)
            return
        }
        running = true
        val t = Thread { acceptLoop() }
        t.name = "neurio-pairing"
        t.isDaemon = true
        t.start()
        AppLog.i(TAG, "listening on tcp/$port")
    }

    private fun acceptLoop() {
        while (running) {
            val socket = try {
                serverSocket?.accept() ?: break
            } catch (e: SocketTimeoutException) {
                continue
            } catch (e: Exception) {
                if (running) AppLog.w(TAG, "accept error: ${e.message}")
                break
            }
            Thread { handle(socket) }.apply {
                name = "neurio-handshake"
                isDaemon = true
            }.start()
        }
        AppLog.d(TAG, "accept loop ended")
    }

    private fun handle(socket: Socket) {
        try {
            socket.tcpNoDelay = true
            socket.soTimeout = SO_TIMEOUT_MS
            val channel = ControlChannel(socket)

            val hello = channel.readBlocking() ?: return close(channel)
            if (hello.type != ControlTypes.HELLO) return close(channel)
            val clientName = hello.body.optString("name", "Player")
            val udpPort = hello.body.optInt("udpPort", 0)
            if (udpPort <= 0 || udpPort > 65535) return close(channel)
            channel.remoteName = clientName

            channel.send(ControlMessage.of(ControlTypes.HELLO_ACK) {
                put("hostName", callbacks.hostDisplayName())
                put("busy", callbacks.isBusy())
            })
            if (callbacks.isBusy()) {
                AppLog.i(TAG, "rejected $clientName: host busy")
                Thread.sleep(50)
                return close(channel)
            }

            val pairReq = channel.readBlocking() ?: return close(channel)
            if (pairReq.type != ControlTypes.PAIR_REQ) return close(channel)
            val code = pairReq.body.optString("code", "")
            if (!constantTimeEquals(code, callbacks.pairingCode())) {
                AppLog.w(TAG, "pairing failed for $clientName (bad code)")
                channel.send(ControlMessage.of(ControlTypes.PAIR_FAIL) { put("reason", "bad_code") })
                Thread.sleep(50)
                return close(channel)
            }

            AppLog.i(TAG, "paired with $clientName")
            callbacks.onClientPaired(channel, clientName, udpPort)
        } catch (e: Exception) {
            AppLog.w(TAG, "handshake error: ${e.message}")
            try {
                socket.close()
            } catch (ignored: Exception) {
            }
        }
    }

    private fun close(channel: ControlChannel) {
        try {
            channel.close()
        } catch (ignored: Exception) {
        }
    }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (ignored: Exception) {
        }
        serverSocket = null
    }
}


