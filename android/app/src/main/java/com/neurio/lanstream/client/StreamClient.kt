package com.neurio.lanstream.client

import android.os.Process
import android.os.SystemClock
import com.neurio.lanstream.core.NetworkStats
import com.neurio.lanstream.input.InputTransport
import com.neurio.lanstream.input.RemoteInputType
import com.neurio.lanstream.model.AudioStreamConfig
import com.neurio.lanstream.model.HostAdvertisement
import com.neurio.lanstream.model.VideoStreamConfig
import com.neurio.lanstream.protocol.LanProtocol
import com.neurio.lanstream.protocol.PairingCrypto
import com.neurio.lanstream.protocol.SecureControlChannel
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
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

interface StreamClientListener {
    fun onState(message: String)
    fun onConnected(deviceName: String, gameName: String)
    fun onError(message: String)
    fun onVideoConfig(config: VideoStreamConfig)
    fun onAudioConfig(config: AudioStreamConfig)
    fun onStats(snapshot: com.neurio.lanstream.core.StatsSnapshot, pingMs: Long)
}

/** Client transport: authenticated TCP control/input plus encrypted, fragmented H.264/AAC over UDP. */
class StreamClient(
    private val host: HostAdvertisement,
    private val pairingCode: String,
    private val clientDeviceName: String,
    private val listener: StreamClientListener,
) : InputTransport, AutoCloseable {
    private data class PendingInput(
        val type: Int,
        val action: Int = 0,
        val pointerId: Int = 0,
        val x: Float = 0f,
        val y: Float = 0f,
        val keyCode: Int = 0,
        val down: Boolean = false,
        val clientTimeNanos: Long = 0L,
    )

    private val running = AtomicBoolean(false)
    private val cleanupStarted = AtomicBoolean(false)
    private val inputQueue = ArrayBlockingQueue<PendingInput>(256)
    private val stats = NetworkStats()
    private val packetLossWindow = AtomicLong(0)
    private val completedVideoWindow = AtomicLong(0)
    private val videoDecoder = VideoDecoder(stats, { listener.onState(it) }, ::requestKeyFrame)
    private val audioRenderer = AudioRenderer { listener.onState(it) }
    private val reassembler = MediaReassembler(stats) { count -> packetLossWindow.addAndGet(count) }
    private val lastPingMs = AtomicLong(-1L)
    private val lastRequestKeyframeMs = AtomicLong(0L)

    @Volatile private var socket: Socket? = null
    @Volatile private var udpSocket: DatagramSocket? = null
    @Volatile private var channel: SecureControlChannel? = null
    @Volatile private var token: ByteArray? = null
    @Volatile private var mediaKey: ByteArray? = null
    private val threads = mutableListOf<Thread>()

    fun connect() {
        if (!running.compareAndSet(false, true)) return
        listener.onState("Connecting to ${host.deviceName}…")
        Thread(::connectAndStart, "neurio-client-connect").apply { isDaemon = true; synchronized(threads) { threads += this }; start() }
    }

    fun setSurface(surface: android.view.Surface?) = videoDecoder.setSurface(surface)

    fun statsSnapshot(): com.neurio.lanstream.core.StatsSnapshot = stats.snapshot()
    fun pingMs(): Long = lastPingMs.get()

    override fun sendPointer(action: Int, pointerId: Int, x: Float, y: Float, clientTimeNanos: Long) {
        if (action !in RemoteInputType.POINTER_DOWN..RemoteInputType.POINTER_UP) return
        enqueueInput(PendingInput(RemoteInputType.POINTER_DOWN, action, pointerId, x.coerceIn(0f, 1f), y.coerceIn(0f, 1f), clientTimeNanos = clientTimeNanos))
    }

    override fun sendKey(keyCode: Int, down: Boolean, clientTimeNanos: Long) {
        enqueueInput(PendingInput(RemoteInputType.KEY, keyCode = keyCode, down = down, clientTimeNanos = clientTimeNanos))
    }

    override fun sendAxes(x: Float, y: Float, clientTimeNanos: Long) {
        enqueueInput(PendingInput(RemoteInputType.AXIS, x = x.coerceIn(-1f, 1f), y = y.coerceIn(-1f, 1f), clientTimeNanos = clientTimeNanos))
    }

    private fun enqueueInput(input: PendingInput) {
        if (!running.get()) return
        if (!inputQueue.offer(input)) {
            if (input.type == RemoteInputType.POINTER_DOWN && input.action == RemoteInputType.POINTER_MOVE || input.type == RemoteInputType.AXIS) return
            inputQueue.poll()
            inputQueue.offer(input)
        }
    }

    private fun connectAndStart() {
        var tcp: Socket? = null
        var udp: DatagramSocket? = null
        try {
            val udpLocal = DatagramSocket(null).apply {
                reuseAddress = true
                bind(InetSocketAddress(0))
                soTimeout = 300
            }
            udp = udpLocal
            udpSocket = udpLocal
            if (!running.get()) { udpLocal.close(); return }
            val tcpLocal = Socket()
            tcp = tcpLocal
            socket = tcpLocal
            tcpLocal.tcpNoDelay = true
            tcpLocal.keepAlive = true
            tcpLocal.connect(InetSocketAddress(InetAddress.getByName(host.address), host.tcpPort), 5000)
            if (!running.get()) { tcpLocal.close(); udpLocal.close(); return }
            tcpLocal.soTimeout = 10_000
            val input = DataInputStream(BufferedInputStream(tcpLocal.getInputStream()))
            val output = DataOutputStream(BufferedOutputStream(tcpLocal.getOutputStream()))
            listener.onState("Checking host and pairing code…")
            val hello = LanProtocol.readClearFrame(input)
            if (hello.type != LanProtocol.HELLO) throw IllegalStateException("Host did not send a pairing challenge")
            val protocolVersion = hello.body.readInt()
            val sessionId = hello.body.readLong()
            val hostDeviceName = LanProtocol.readString(hello.body, 320)
            val gameName = LanProtocol.readString(hello.body, 640)
            val tcpPort = hello.body.readInt()
            val hostVideoPort = hello.body.readInt()
            val serverNonce = hello.body.readSizedBytes(32)
            val serverPublicBytes = hello.body.readSizedBytes(512)
            if (protocolVersion != 1 || sessionId != host.sessionId || tcpPort != host.tcpPort || hostVideoPort !in 1..65535 || serverNonce.size != 16) {
                throw SecurityException("Host session changed. Return to discovery and scan again.")
            }
            if (!pairingCode.matches(Regex("\\d{6}"))) throw IllegalArgumentException("Enter the six-digit code shown on the host")

            val clientNonce = PairingCrypto.randomBytes(16)
            val ephemeral = PairingCrypto.newEphemeralKeyPair()
            val clientPublic = ephemeral.public.encoded
            val transcript = PairingCrypto.transcript(
                sessionId,
                serverNonce,
                clientNonce,
                udpLocal.localPort,
                clientDeviceName.take(80),
                serverPublicBytes,
                clientPublic,
            )
            val proof = PairingCrypto.codeProof(pairingCode, transcript, 'C'.code.toByte())
            LanProtocol.writeClearFrame(output, LanProtocol.AUTH) {
                write(clientNonce)
                writeInt(udpLocal.localPort)
                LanProtocol.writeString(this, clientDeviceName, 80)
                LanProtocol.writeSizedBytes(this, clientPublic, 512)
                LanProtocol.writeSizedBytes(this, proof, 64)
            }
            listener.onState("Authenticating locally; no cloud account is used…")
            val response = LanProtocol.readClearFrame(input)
            if (response.type == LanProtocol.AUTH_FAIL) {
                val reason = LanProtocol.readString(response.body, 320)
                throw SecurityException(humanizeAuthFailure(reason))
            }
            if (response.type != LanProtocol.AUTH_OK) throw SecurityException("Unexpected host authentication response")

            val serverPublic = PairingCrypto.decodePublicKey(serverPublicBytes)
            val sharedSecret = PairingCrypto.agree(ephemeral.private, serverPublic)
            val keys = PairingCrypto.deriveSessionKeys(sharedSecret, serverNonce, clientNonce, sessionId)
            val encryptedAuth = response.body.readSizedBytes(2048)
            val authPlain = PairingCrypto.decrypt(
                keys.hostToClient,
                PairingCrypto.authOkNonce(sessionId),
                PairingCrypto.authOkAad(sessionId),
                encryptedAuth,
            )
            val authData = DataInputStream(java.io.ByteArrayInputStream(authPlain))
            val sessionToken = authData.readSizedBytes(64)
            val serverProof = authData.readSizedBytes(64)
            val authenticatedVideoPort = authData.readInt()
            val authenticatedClientName = LanProtocol.readString(authData, 320)
            val expectedServerProof = PairingCrypto.codeProof(pairingCode, transcript, 'S'.code.toByte())
            if (!PairingCrypto.constantTimeEquals(expectedServerProof, serverProof) || sessionToken.size != 32 ||
                authenticatedVideoPort != hostVideoPort || authenticatedClientName != clientDeviceName.take(80)) {
                throw SecurityException("Host authentication failed. Check the code and try again.")
            }

            val secure = SecureControlChannel(
                input,
                output,
                sessionId,
                txKey = keys.clientToHost,
                rxKey = keys.hostToClient,
                txPrefix = HostControlConstants.CLIENT_TO_HOST_PREFIX,
                rxPrefix = HostControlConstants.HOST_TO_CLIENT_PREFIX,
            )
            channel = secure
            token = sessionToken
            mediaKey = keys.media
            tcpLocal.soTimeout = 0
            listener.onConnected(hostDeviceName, gameName.ifBlank { host.gameName })
            listener.onState("Connected to ${host.gameName}. Waiting for the live video configuration…")

            startThread("neurio-video-udp") { receiveVideo(udpLocal, hostVideoPort) }
            startThread("neurio-control-reader") { readControl(secure, sessionToken) }
            startThread("neurio-input-uplink") { sendInputs(secure, sessionToken) }
            startThread("neurio-lan-ping") { pingLoop(secure, sessionToken) }
            startThread("neurio-client-statistics") { reportStats(secure, sessionToken) }
        } catch (e: Exception) {
            if (running.get()) fail(e.message ?: "Could not connect to host") else {
                try { tcp?.close() } catch (_: Exception) { }
                try { udp?.close() } catch (_: Exception) { }
            }
        }
    }

    private fun readControl(secure: SecureControlChannel, sessionToken: ByteArray) {
        try {
            while (running.get()) {
                val frame = secure.read()
                val body = frame.body
                when (frame.type) {
                    LanProtocol.VIDEO_CONFIG -> {
                        val (receivedToken, config) = LanProtocol.readVideoConfig(body)
                        if (!MessageDigest.isEqual(sessionToken, receivedToken)) throw SecurityException("Invalid stream session")
                        videoDecoder.updateFormat(config)
                        listener.onVideoConfig(config)
                        listener.onState("Live AVC ${config.width}×${config.height} · ${config.fps} FPS target")
                    }
                    LanProtocol.AUDIO_CONFIG -> {
                        val (receivedToken, config) = LanProtocol.readAudioConfig(body)
                        if (!MessageDigest.isEqual(sessionToken, receivedToken)) throw SecurityException("Invalid audio session")
                        audioRenderer.updateFormat(config)
                        listener.onAudioConfig(config)
                    }
                    LanProtocol.PONG -> {
                        val receivedToken = ByteArray(32).apply { body.readFully(this) }
                        if (!MessageDigest.isEqual(sessionToken, receivedToken)) throw SecurityException("Invalid ping response")
                        val sentAt = body.readLong()
                        body.readLong()
                        val elapsed = (SystemClock.elapsedRealtimeNanos() - sentAt).coerceAtLeast(0L)
                        lastPingMs.set(TimeUnit.NANOSECONDS.toMillis(elapsed))
                    }
                    LanProtocol.HOST_STATS -> {
                        val receivedToken = ByteArray(32).apply { body.readFully(this) }
                        if (!MessageDigest.isEqual(sessionToken, receivedToken)) throw SecurityException("Invalid host statistics")
                    }
                }
            }
        } catch (e: Exception) {
            if (running.get()) fail("Connection to host ended: ${e.message ?: "control channel closed"}")
        }
    }

    private fun receiveVideo(udp: DatagramSocket, sourcePort: Int) {
        try {
            Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY)
            val hostAddress = InetAddress.getByName(host.address)
            val buffer = ByteArray(LanProtocol.MEDIA_MAX_DATAGRAM_BYTES + 64)
            while (running.get() && !udp.isClosed) {
                try {
                    val packet = DatagramPacket(buffer, buffer.size)
                    udp.receive(packet)
                    if (packet.address != hostAddress || packet.port != sourcePort) continue
                    stats.received(packet.length)
                    val key = mediaKey ?: continue
                    val fragment = LanProtocol.parseMediaDatagram(packet, key) ?: continue
                    val accessUnit = reassembler.accept(fragment) ?: continue
                    if (accessUnit.mediaType == LanProtocol.MEDIA_VIDEO) {
                        completedVideoWindow.incrementAndGet()
                        videoDecoder.enqueue(accessUnit)
                    } else {
                        audioRenderer.enqueue(accessUnit)
                    }
                } catch (_: java.net.SocketTimeoutException) {
                }
            }
        } catch (e: Exception) {
            if (running.get()) fail("Video transport stopped: ${e.message ?: "UDP receive error"}")
        }
    }

    private fun sendInputs(secure: SecureControlChannel, sessionToken: ByteArray) {
        while (running.get()) {
            val event = try { inputQueue.poll(200, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { null } ?: continue
            try {
                secure.send(LanProtocol.INPUT) {
                    write(sessionToken)
                    writeByte(event.type)
                    when (event.type) {
                        RemoteInputType.POINTER_DOWN -> {
                            writeByte(event.action)
                            writeInt(event.pointerId)
                            writeFloat(event.x)
                            writeFloat(event.y)
                            writeLong(event.clientTimeNanos)
                        }
                        RemoteInputType.KEY -> {
                            writeInt(event.keyCode)
                            writeBoolean(event.down)
                            writeLong(event.clientTimeNanos)
                        }
                        RemoteInputType.AXIS -> {
                            writeFloat(event.x)
                            writeFloat(event.y)
                            writeLong(event.clientTimeNanos)
                        }
                    }
                }
            } catch (e: Exception) {
                if (running.get()) fail("Input channel stopped: ${e.message ?: "write failed"}")
                return
            }
        }
    }

    private fun pingLoop(secure: SecureControlChannel, sessionToken: ByteArray) {
        while (running.get()) {
            try {
                val now = SystemClock.elapsedRealtimeNanos()
                secure.send(LanProtocol.PING) { write(sessionToken); writeLong(now) }
            } catch (e: Exception) {
                if (running.get()) fail("Ping channel stopped: ${e.message ?: "write failed"}")
                return
            }
            try { Thread.sleep(1000) } catch (_: InterruptedException) { if (!running.get()) return }
        }
    }

    private fun reportStats(secure: SecureControlChannel, sessionToken: ByteArray) {
        while (running.get()) {
            try { Thread.sleep(2000) } catch (_: InterruptedException) { if (!running.get()) return }
            if (!running.get()) return
            try {
                val received = completedVideoWindow.getAndSet(0).coerceAtLeast(0L)
                val lost = packetLossWindow.getAndSet(0).coerceAtLeast(0L)
                val lossPercent = if (received + lost == 0L) 0f else (lost * 100f / (received + lost)).coerceIn(0f, 100f)
                val fps = stats.snapshot(resetWindow = false).decodedFps.toFloat().coerceIn(0f, 240f)
                secure.send(LanProtocol.CLIENT_STATS) {
                    write(sessionToken)
                    writeFloat(lossPercent)
                    writeLong(lastPingMs.get().coerceAtLeast(0L))
                    writeFloat(fps)
                }
                if (lossPercent > 3.0f) requestKeyFrame()
                listener.onStats(stats.snapshot(resetWindow = false), lastPingMs.get())
            } catch (e: Exception) {
                if (running.get()) fail("Could not report stream statistics: ${e.message ?: "control write failed"}")
                return
            }
        }
    }

    private fun requestKeyFrame() {
        val now = SystemClock.elapsedRealtime()
        val last = lastRequestKeyframeMs.get()
        if (now - last < 900L || !lastRequestKeyframeMs.compareAndSet(last, now)) return
        val currentChannel = channel ?: return
        val currentToken = token ?: return
        try { currentChannel.send(LanProtocol.REQUEST_KEYFRAME) { write(currentToken) } } catch (_: Exception) { }
    }

    private fun startThread(name: String, action: () -> Unit) {
        Thread(action, name).apply { isDaemon = true; synchronized(threads) { threads += this }; start() }
    }

    private fun fail(message: String) {
        if (running.getAndSet(false)) listener.onError(message)
        cleanupResources(sendDisconnect = false)
    }

    private fun closeSockets() {
        try { udpSocket?.close() } catch (_: Exception) { }
        try { socket?.close() } catch (_: Exception) { }
        udpSocket = null
        socket = null
        inputQueue.clear()
    }

    private fun humanizeAuthFailure(reason: String): String = when (reason) {
        "PAIRING_CODE_REJECTED" -> "That pairing code was not accepted. Check the code on Phone 2."
        "HOST_BUSY" -> "Phone 2 already has a player connected."
        "PAIRING_LOCKED" -> "Too many incorrect codes. Wait 30 seconds before trying again."
        else -> "Host rejected the connection ($reason)."
    }

    override fun close() {
        val wasRunning = running.getAndSet(false)
        cleanupResources(sendDisconnect = wasRunning)
    }

    private fun cleanupResources(sendDisconnect: Boolean) {
        if (!cleanupStarted.compareAndSet(false, true)) return
        if (sendDisconnect) {
            try {
                val current = channel
                val currentToken = token
                if (current != null && currentToken != null) current.send(LanProtocol.DISCONNECT) { write(currentToken) }
            } catch (_: Exception) {
            }
        }
        closeSockets()
        videoDecoder.close()
        audioRenderer.close()
        synchronized(threads) { threads.forEach { it.interrupt() } }
        synchronized(threads) {
            threads.filter { it !== Thread.currentThread() }.forEach { thread ->
                try { thread.join(250) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
            }
            threads.clear()
        }
        channel = null
        token = null
        mediaKey = null
    }

    private object HostControlConstants {
        const val HOST_TO_CLIENT_PREFIX = 0x484F5354
        const val CLIENT_TO_HOST_PREFIX = 0x434C4E54
    }
}
