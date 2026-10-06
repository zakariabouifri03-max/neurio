package com.neurio.lanstream.net

import com.neurio.lanstream.core.Log
import com.neurio.lanstream.core.SessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException

/** One connected client (there is at most one in this prototype). */
class ControlSession(
    val id: Long,
    val socket: Socket
) {
    val remoteAddress: InetSocketAddress =
        socket.remoteSocketAddress as? InetSocketAddress ?: InetSocketAddress(socket.inetAddress, 0)

    private val output = DataOutputStream(BufferedOutputStream(socket.getOutputStream()))
    private val input = DataInputStream(BufferedInputStream(socket.getInputStream()))

    @Volatile
    var authenticated: Boolean = false

    @Volatile
    var clientName: String = "player"

    @Volatile
    var lastMessageMs: Long = System.currentTimeMillis()

    @Synchronized
    fun send(json: JSONObject) {
        try {
            val bytes = ControlMessages.toBytes(json)
            output.writeInt(bytes.size)
            output.write(bytes)
            output.flush()
        } catch (t: Throwable) {
            Log.w("Control send failed: ${t.message}")
        }
    }

    /** Blocks until a full message arrives. Returns null on timeout/EOF. */
    fun read(): JSONObject? {
        return try {
            val length = input.readInt()
            if (length <= 0 || length > Protocol.CONTROL_MAX_MESSAGE) return null
            val buffer = ByteArray(length)
            input.readFully(buffer)
            lastMessageMs = System.currentTimeMillis()
            ControlMessages.parse(buffer, length)
        } catch (_: SocketTimeoutException) {
            null
        } catch (_: IOException) {
            null
        }
    }

    fun close() {
        try {
            socket.close()
        } catch (_: Throwable) {
        }
    }
}

/**
 * Host side of the control channel: accepts exactly one authenticated client,
 * runs the pairing handshake and demultiplexes the control messages.
 */
class ControlServer(
    private val port: Int,
    private val sessionManager: SessionManager,
    private val hostName: String,
    private val listener: Listener
) {
    interface Listener {
        /** The service fills in the current media description. */
        fun buildAuthOk(session: ControlSession, clientName: String?, layoutJson: String?): JSONObject
        fun onClientReady(session: ControlSession, videoPort: Int, audioPort: Int, inputPort: Int)
        fun onKeyframeRequested(session: ControlSession)
        fun onClientStats(session: ControlSession, json: JSONObject)
        fun onClientDisconnected(session: ControlSession, reason: String)
    }

    private var serverSocket: ServerSocket? = null
    private var acceptJob: Job? = null
    private var watchdogJob: Job? = null

    @Volatile
    private var session: ControlSession? = null

    private var sessionCounter = 0L

    val hasClient: Boolean get() = session != null

    fun start(scope: CoroutineScope) {
        stop()
        val socket = try {
            ServerSocket(port).apply { reuseAddress = true }
        } catch (t: Throwable) {
            Log.e("Cannot bind control port $port: ${t.message}")
            return
        }
        serverSocket = socket
        Log.i("Control server listening on $port")

        acceptJob = scope.launch(Dispatchers.IO) {
            while (isActive) {
                val client = try {
                    socket.accept()
                } catch (t: Throwable) {
                    if (isActive) Log.w("Control accept failed: ${t.message}")
                    break
                }
                handleConnection(scope, client)
            }
        }

        watchdogJob = scope.launch {
            while (isActive) {
                delay(5_000)
                val current = session
                if (current != null && System.currentTimeMillis() - current.lastMessageMs > TIMEOUT_MS) {
                    Log.w("Client timed out")
                    closeSession("timeout")
                }
            }
        }
    }

    private fun handleConnection(scope: CoroutineScope, socket: Socket) {
        val existing = session
        if (existing != null) {
            // One player at a time: refuse politely so the UI can explain.
            val rejection = ControlMessages.authFail("host_busy")
            runCatching {
                val out = DataOutputStream(BufferedOutputStream(socket.getOutputStream()))
                val bytes = ControlMessages.toBytes(rejection)
                out.writeInt(bytes.size)
                out.write(bytes)
                out.flush()
                socket.close()
            }
            Log.i("Rejected second client (host is busy)")
            return
        }

        val controlSession = ControlSession(++sessionCounter, socket).apply {
            soTimeout()
        }
        session = controlSession
        Log.i("Client connected from ${controlSession.remoteAddress}")

        val (challenge, salt) = sessionManager.beginHandshake()
        controlSession.send(
            ControlMessages.welcome(sessionManager.sessionId, challenge, salt, hostName)
        )

        scope.launch(Dispatchers.IO) { readLoop(controlSession) }
    }

    private fun ControlSession.soTimeout() {
        runCatching { socket.soTimeout = READ_TIMEOUT_MS }
    }

    private suspend fun readLoop(controlSession: ControlSession) {
        while (!controlSession.socket.isClosed) {
            val json = withContext(Dispatchers.IO) { controlSession.read() }
            if (json == null) {
                if (System.currentTimeMillis() - controlSession.lastMessageMs > TIMEOUT_MS) {
                    closeSession("timeout")
                    return
                }
                continue
            }
            handleMessage(controlSession, json)
        }
        closeSession("closed")
    }

    private fun handleMessage(session: ControlSession, json: JSONObject) {
        when (ControlMessages.typeOf(json)) {
            "auth" -> handleAuth(session, json)
            "ready" -> {
                if (!session.authenticated) {
                    session.send(ControlMessages.authFail("not_authenticated"))
                    return
                }
                listener.onClientReady(
                    session,
                    json.optInt("videoPort", 0),
                    json.optInt("audioPort", 0),
                    json.optInt("inputPort", 0)
                )
                session.send(ControlMessages.sessionStarted())
            }
            "keyframe" -> if (session.authenticated) listener.onKeyframeRequested(session)
            "client_stats" -> if (session.authenticated) listener.onClientStats(session, json)
            "ping" -> if (session.authenticated) {
                val now = System.currentTimeMillis()
                session.send(
                    ControlMessages.pong(
                        id = json.optLong("id"),
                        clientSendMs = json.optLong("tc", now),
                        hostReceiveMs = now,
                        hostSendMs = System.currentTimeMillis()
                    )
                )
            }
            "bye" -> closeSession("client_left")
        }
    }

    private fun handleAuth(session: ControlSession, json: JSONObject) {
        if (sessionManager.isLockedOut) {
            session.send(
                ControlMessages.authFail("locked", sessionManager.lockoutRemainingMs())
            )
            closeSession("locked_out")
            return
        }
        val proof = json.optString("proof")
        val name = json.optString("name").ifBlank { null }
        val layout = json.optString("layout").ifBlank { null }
        if (sessionManager.verifyProof(proof, name)) {
            session.authenticated = true
            session.clientName = name ?: "player"
            session.send(listener.buildAuthOk(session, name, layout))
            Log.i("Client authenticated as ${session.clientName}")
        } else {
            Log.w("Pairing failed (attempt ${sessionManager.failedAttempts})")
            session.send(ControlMessages.authFail("bad_code"))
            closeSession("bad_code")
        }
    }

    fun sendToClient(json: JSONObject) {
        session?.takeIf { it.authenticated }?.send(json)
    }

    fun sendToAny(json: JSONObject) {
        session?.send(json)
    }

    fun closeSession(reason: String) {
        val current = session ?: return
        session = null
        current.close()
        sessionManager.markUnauthenticated()
        listener.onClientDisconnected(current, reason)
        Log.i("Control session ended: $reason")
    }

    fun stop() {
        acceptJob?.cancel()
        acceptJob = null
        watchdogJob?.cancel()
        watchdogJob = null
        closeSession("stopped")
        try {
            serverSocket?.close()
        } catch (_: Throwable) {
        }
        serverSocket = null
    }

    companion object {
        private const val READ_TIMEOUT_MS = 5_000
        private const val TIMEOUT_MS = 15_000L
    }
}
