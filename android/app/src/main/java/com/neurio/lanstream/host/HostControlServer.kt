package com.neurio.lanstream.host

import android.os.SystemClock
import com.neurio.lanstream.core.NetworkStats
import com.neurio.lanstream.input.RemoteInputType
import com.neurio.lanstream.input.RemotePointer
import com.neurio.lanstream.model.AudioStreamConfig
import com.neurio.lanstream.model.VideoStreamConfig
import com.neurio.lanstream.protocol.LanProtocol
import com.neurio.lanstream.protocol.PairingCrypto
import com.neurio.lanstream.protocol.SecureControlChannel
import com.neurio.lanstream.protocol.SessionKeys
import com.neurio.lanstream.protocol.readSizedBytes
import com.neurio.lanstream.protocol.writeSizedBytes
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class HostControlServer(
    private val sessionId: Long,
    private val pairingCode: String,
    private val deviceName: String,
    private val gameName: String,
    private val stats: NetworkStats,
    private val onClientConnected: (String) -> Unit,
    private val onClientDisconnected: () -> Unit,
    private val onPointer: (RemotePointer) -> Unit,
    private val onKey: (Int, Boolean, Long) -> Unit,
    private val onAxes: (Float, Float, Long) -> Unit,
    private val onClientStats: (lossPercent: Float, pingMs: Long, clientFps: Float) -> Unit,
    private val onRequestKeyFrame: () -> Unit,
    private val onError: (String) -> Unit,
) : AutoCloseable {
    private val running = AtomicBoolean(false)
    private val attemptsLock = Any()
    private var failedAttempts = 0
    private var blockedUntilMs = 0L
    @Volatile private var listener: ServerSocket? = null
    @Volatile private var mediaSocket: DatagramSocket? = null
    @Volatile private var activePeer: ClientPeer? = null
    @Volatile private var latestVideoConfig: VideoStreamConfig? = null
    @Volatile private var latestAudioConfig: AudioStreamConfig? = null
    private var acceptThread: Thread? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        acceptThread = Thread(::acceptLoop, "neurio-host-control").apply { isDaemon = true; start() }
    }

    fun updateVideoConfig(config: VideoStreamConfig) {
        latestVideoConfig = config
        activePeer?.sendVideoConfig(config)
    }

    fun updateAudioConfig(config: AudioStreamConfig) {
        latestAudioConfig = config
        activePeer?.sendAudioConfig(config)
    }

    fun sendMedia(mediaType: Int, accessUnit: ByteArray, ptsUs: Long, keyFrame: Boolean = false) {
        val peer = activePeer ?: return
        peer.sendMedia(mediaType, accessUnit, ptsUs, keyFrame)
    }

    fun currentPlayerName(): String? = activePeer?.deviceName

    private fun acceptLoop() {
        try {
            val udp = DatagramSocket(null).apply {
                reuseAddress = true
                bind(InetSocketAddress(LanProtocol.VIDEO_PORT))
            }
            mediaSocket = udp
            val server = ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(LanProtocol.TCP_PORT), 4)
                soTimeout = 500
            }
            listener = server
            while (running.get()) {
                try {
                    val socket = server.accept()
                    Thread({ handleClient(socket) }, "neurio-client-handshake").apply { isDaemon = true; start() }
                } catch (_: java.net.SocketTimeoutException) {
                } catch (e: SocketException) {
                    if (running.get()) onError("Control socket closed: ${e.message ?: "network error"}")
                    break
                }
            }
        } catch (e: Exception) {
            if (running.get()) onError("Could not start LAN server: ${e.message ?: "port or Wi-Fi error"}")
        } finally {
            try { listener?.close() } catch (_: Exception) { }
            try { mediaSocket?.close() } catch (_: Exception) { }
            listener = null
            mediaSocket = null
        }
    }

    private fun handleClient(socket: Socket) {
        var peer: ClientPeer? = null
        try {
            socket.tcpNoDelay = true
            socket.keepAlive = true
            socket.soTimeout = 15_000
            val input = DataInputStream(BufferedInputStream(socket.getInputStream()))
            val output = DataOutputStream(BufferedOutputStream(socket.getOutputStream()))

            if (activePeer != null) {
                LanProtocol.writeClearFrame(output, LanProtocol.AUTH_FAIL) { LanProtocol.writeString(this, "HOST_BUSY") }
                return
            }
            val blockRemaining = synchronized(attemptsLock) { (blockedUntilMs - System.currentTimeMillis()).coerceAtLeast(0L) }
            if (blockRemaining > 0) {
                LanProtocol.writeClearFrame(output, LanProtocol.AUTH_FAIL) { LanProtocol.writeString(this, "PAIRING_LOCKED") }
                return
            }

            val ephemeral = PairingCrypto.newEphemeralKeyPair()
            val serverPublic = ephemeral.public.encoded
            val serverNonce = PairingCrypto.randomBytes(16)
            LanProtocol.writeClearFrame(output, LanProtocol.HELLO) {
                writeInt(1)
                writeLong(sessionId)
                LanProtocol.writeString(this, deviceName, 80)
                LanProtocol.writeString(this, gameName, 160)
                writeInt(LanProtocol.TCP_PORT)
                writeInt(LanProtocol.VIDEO_PORT)
                LanProtocol.writeSizedBytes(this, serverNonce, 32)
                LanProtocol.writeSizedBytes(this, serverPublic, 512)
            }

            val auth = LanProtocol.readClearFrame(input)
            if (auth.type != LanProtocol.AUTH) throw IllegalArgumentException("Unexpected pairing message")
            val clientNonce = ByteArray(16).apply { auth.body.readFully(this) }
            val clientVideoPort = auth.body.readInt()
            val clientName = LanProtocol.readString(auth.body, 320).take(80)
            val clientPublic = auth.body.readSizedBytes(512)
            val suppliedProof = auth.body.readSizedBytes(64)
            if (clientVideoPort !in 1024..65535 || suppliedProof.size != 32) {
                sendAuthFailure(output, "BAD_AUTH_REQUEST")
                return
            }

            val transcript = PairingCrypto.transcript(
                sessionId, serverNonce, clientNonce, clientVideoPort, clientName, serverPublic, clientPublic,
            )
            val expectedProof = PairingCrypto.codeProof(pairingCode, transcript, 'C'.code.toByte())
            if (!PairingCrypto.constantTimeEquals(expectedProof, suppliedProof)) {
                sendAuthFailure(output, "PAIRING_CODE_REJECTED")
                registerFailedAttempt()
                return
            }
            synchronized(attemptsLock) { failedAttempts = 0; blockedUntilMs = 0L }
            if (activePeer != null) {
                sendAuthFailure(output, "HOST_BUSY")
                return
            }

            val peerPublicKey = PairingCrypto.decodePublicKey(clientPublic)
            val sharedSecret = PairingCrypto.agree(ephemeral.private, peerPublicKey)
            val keys = PairingCrypto.deriveSessionKeys(sharedSecret, serverNonce, clientNonce, sessionId)
            val token = PairingCrypto.randomBytes(32)
            val serverProof = PairingCrypto.codeProof(pairingCode, transcript, 'S'.code.toByte())
            val authOkPlain = java.io.ByteArrayOutputStream().use { bytes ->
                DataOutputStream(bytes).use { authOut ->
                    LanProtocol.writeSizedBytes(authOut, token, 64)
                    LanProtocol.writeSizedBytes(authOut, serverProof, 64)
                    authOut.writeInt(LanProtocol.VIDEO_PORT)
                    LanProtocol.writeString(authOut, clientName, 80)
                }
                bytes.toByteArray()
            }
            val encryptedAuthOk = PairingCrypto.encrypt(
                keys.hostToClient,
                PairingCrypto.authOkNonce(sessionId),
                PairingCrypto.authOkAad(sessionId),
                authOkPlain,
            )
            LanProtocol.writeClearFrame(output, LanProtocol.AUTH_OK) { LanProtocol.writeSizedBytes(this, encryptedAuthOk, 2048) }
            socket.soTimeout = 0

            val channel = SecureControlChannel(
                input,
                output,
                sessionId,
                txKey = keys.hostToClient,
                rxKey = keys.clientToHost,
                txPrefix = HOST_TO_CLIENT_PREFIX,
                rxPrefix = CLIENT_TO_HOST_PREFIX,
            )
            peer = ClientPeer(socket, channel, token, keys, clientName, InetSocketAddress(socket.inetAddress, clientVideoPort))
            synchronized(this) {
                if (activePeer != null) throw IllegalStateException("Another player paired at the same time")
                activePeer = peer
            }
            onClientConnected(clientName)
            peer.sendVideoConfig(latestVideoConfig)
            peer.sendAudioConfig(latestAudioConfig)
            onRequestKeyFrame()

            while (running.get() && !socket.isClosed) {
                val frame = channel.read()
                if (!peer.process(frame)) break
            }
        } catch (e: Exception) {
            if (running.get() && e !is SocketException) onError("Player connection ended: ${e.message ?: "connection lost"}")
        } finally {
            try { socket.close() } catch (_: Exception) { }
            if (peer != null) {
                synchronized(this) { if (activePeer === peer) activePeer = null }
                peer.close()
                onClientDisconnected()
            }
        }
    }

    private fun sendAuthFailure(output: DataOutputStream, reason: String) {
        try { LanProtocol.writeClearFrame(output, LanProtocol.AUTH_FAIL) { LanProtocol.writeString(this, reason, 80) } } catch (_: Exception) { }
    }

    private fun registerFailedAttempt() {
        synchronized(attemptsLock) {
            failedAttempts++
            if (failedAttempts >= 5) {
                failedAttempts = 0
                blockedUntilMs = System.currentTimeMillis() + 30_000L
            }
        }
    }

    override fun close() {
        if (!running.getAndSet(false)) return
        try { listener?.close() } catch (_: Exception) { }
        try { mediaSocket?.close() } catch (_: Exception) { }
        listener = null
        mediaSocket = null
        activePeer?.close()
        activePeer = null
        acceptThread?.interrupt()
        try { acceptThread?.join(600) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        acceptThread = null
    }

    private inner class ClientPeer(
        private val socket: Socket,
        private val channel: SecureControlChannel,
        private val token: ByteArray,
        private val keys: SessionKeys,
        val deviceName: String,
        private val videoTarget: InetSocketAddress,
    ) {
        private val closed = AtomicBoolean(false)
        private val videoSequence = AtomicInteger(0)
        private val audioSequence = AtomicInteger(0)

        fun sendVideoConfig(config: VideoStreamConfig?) {
            if (config == null || closed.get()) return
            try {
                channel.send(LanProtocol.VIDEO_CONFIG) { LanProtocol.writeVideoConfig(this, token, config) }
            } catch (_: Exception) {
            }
        }

        fun sendAudioConfig(config: AudioStreamConfig?) {
            if (config == null || closed.get()) return
            try {
                channel.send(LanProtocol.AUDIO_CONFIG) { LanProtocol.writeAudioConfig(this, token, config) }
            } catch (_: Exception) {
            }
        }

        fun sendMedia(mediaType: Int, accessUnit: ByteArray, ptsUs: Long, keyFrame: Boolean) {
            if (closed.get() || accessUnit.isEmpty()) return
            val sequence = if (mediaType == LanProtocol.MEDIA_VIDEO) videoSequence.getAndIncrement() else audioSequence.getAndIncrement()
            val flags = if (keyFrame) LanProtocol.FLAG_KEY_FRAME else 0
            val packets = try { LanProtocol.packetizeMedia(mediaType, flags, sequence, ptsUs, accessUnit, keys.media) } catch (_: Exception) { emptyList() }
            if (packets.isEmpty()) {
                stats.dropped()
                return
            }
            val udp = mediaSocket ?: return
            try {
                synchronized(udp) {
                    packets.forEach { bytes ->
                        udp.send(DatagramPacket(bytes, bytes.size, videoTarget))
                        stats.sent(bytes.size)
                    }
                }
            } catch (_: Exception) {
                stats.dropped()
            }
        }

        fun process(frame: com.neurio.lanstream.protocol.ControlFrame): Boolean {
            val body = frame.body
            return when (frame.type) {
                LanProtocol.INPUT -> {
                    if (!readAndVerifyToken(body)) return false
                    when (body.readUnsignedByte()) {
                        RemoteInputType.POINTER_DOWN, RemoteInputType.POINTER_MOVE, RemoteInputType.POINTER_UP -> {
                            val action = body.readUnsignedByte()
                            val id = body.readInt().coerceIn(0, 10_000)
                            val x = body.readFloat().coerceIn(0f, 1f)
                            val y = body.readFloat().coerceIn(0f, 1f)
                            val time = body.readLong()
                            if (action in RemoteInputType.POINTER_DOWN..RemoteInputType.POINTER_UP) onPointer(RemotePointer(action, id, x, y, time))
                        }
                        RemoteInputType.KEY -> {
                            val key = body.readInt()
                            val down = body.readBoolean()
                            val time = body.readLong()
                            onKey(key, down, time)
                        }
                        RemoteInputType.AXIS -> {
                            val x = body.readFloat().coerceIn(-1f, 1f)
                            val y = body.readFloat().coerceIn(-1f, 1f)
                            val time = body.readLong()
                            onAxes(x, y, time)
                        }
                    }
                    true
                }
                LanProtocol.PING -> {
                    if (!readAndVerifyToken(body)) return false
                    val clientSentAt = body.readLong()
                    channel.send(LanProtocol.PONG) {
                        write(token)
                        writeLong(clientSentAt)
                        writeLong(SystemClock.elapsedRealtimeNanos())
                    }
                    true
                }
                LanProtocol.CLIENT_STATS -> {
                    if (!readAndVerifyToken(body)) return false
                    val loss = body.readFloat().coerceIn(0f, 100f)
                    val rtt = body.readLong().coerceIn(0L, 60_000L)
                    val clientFps = body.readFloat().coerceIn(0f, 240f)
                    onClientStats(loss, rtt, clientFps)
                    true
                }
                LanProtocol.REQUEST_KEYFRAME -> {
                    if (!readAndVerifyToken(body)) return false
                    onRequestKeyFrame()
                    true
                }
                LanProtocol.DISCONNECT -> {
                    readAndVerifyToken(body)
                    false
                }
                else -> false
            }
        }

        private fun readAndVerifyToken(input: DataInputStream): Boolean {
            val supplied = ByteArray(token.size)
            input.readFully(supplied)
            return MessageDigest.isEqual(token, supplied)
        }

        fun close() {
            if (closed.compareAndSet(false, true)) {
                try { socket.close() } catch (_: Exception) { }
            }
        }
    }

    companion object {
        const val HOST_TO_CLIENT_PREFIX = 0x484F5354 // HOST
        const val CLIENT_TO_HOST_PREFIX = 0x434C4E54 // CLNT
    }
}
