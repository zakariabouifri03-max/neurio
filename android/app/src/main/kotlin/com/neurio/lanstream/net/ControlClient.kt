package com.neurio.lanstream.net

import com.neurio.lanstream.core.ClockSync
import com.neurio.lanstream.core.Log
import com.neurio.lanstream.discovery.HostEndpoint
import com.neurio.lanstream.input.PadLayout
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Client side of the control channel.
 *
 * [handshake] performs connect -> welcome -> auth (HMAC proof) -> auth_ok and
 * returns the negotiated session. Afterwards a read loop demultiplexes host
 * messages and a keepalive ping is sent every 2 s so the host can garbage
 * collect dead sessions quickly.
 */
class ControlClient(
    private val endpoint: HostEndpoint,
    private val code: String,
    private val clientName: String,
    private val layout: PadLayout,
    private val listener: Listener
) {
    interface Listener {
        fun onAuthOk(json: JSONObject)
        fun onAuthFailed(reason: String)
        fun onSessionStarted()
        fun onSessionStopped(reason: String)
        fun onVideoConfig(json: JSONObject)
        fun onAudioStatus(json: JSONObject)
        fun onInputStatus(json: JSONObject)
        fun onStats(json: JSONObject)
        fun onPong(rttMs: Long)
        fun onClosed(reason: String)
    }

    /** Filled in from auth_ok, used by the media client. */
    data class Session(
        val sessionId: Int,
        val token: Int,
        val videoMime: String,
        val videoWidth: Int,
        val videoHeight: Int,
        val fps: Int,
        val bitrateBps: Int,
        val audioEnabled: Boolean,
        val audioSampleRate: Int,
        val audioChannels: Int,
        val audioBitrate: Int,
        val inputPort: Int,
        val gameName: String
    )

    private var socket: Socket? = null
    private var output: DataOutputStream? = null
    private var input: DataInputStream? = null

    private var welcomeDeferred = CompletableDeferred<JSONObject>()
    private var authDeferred = CompletableDeferred<JSONObject>()

    private val pingIds = AtomicLong(1)
    private val pendingPings = ConcurrentHashMap<Long, Long>() // id -> send time

    val clockSync = ClockSync()

    @Volatile
    var negotiated: Session? = null
        private set

    @Volatile
    var lastHostStats: JSONObject? = null
        private set

    private var readJob: Job? = null
    private var pingJob: Job? = null

    @Volatile
    private var closed = false

    /**
     * Opens the socket, starts the read loop, then completes the pairing
     * handshake: welcome -> auth (HMAC proof) -> auth_ok.
     *
     * The read loop must be running *before* we wait for `welcome`, which is
     * why connect and start are one operation.
     */
    suspend fun connect(scope: CoroutineScope, timeoutMs: Long = 10_000L): Boolean {
        val connected = withContext(Dispatchers.IO) {
            try {
                val s = Socket()
                s.connect(InetSocketAddress(endpoint.address, endpoint.controlPort), 5_000)
                socket = s
                output = DataOutputStream(BufferedOutputStream(s.getOutputStream()))
                input = DataInputStream(BufferedInputStream(s.getInputStream()))
                true
            } catch (t: Throwable) {
                Log.w("Control connect failed: ${t.message}")
                false
            }
        }
        if (!connected) return false

        readJob = scope.launch(Dispatchers.IO) { readLoop() }

        val welcome = withTimeoutOrNull(timeoutMs) { welcomeDeferred.await() }
        if (welcome == null) {
            Log.w("No welcome from host")
            return false
        }
        val sessionId = welcome.optInt("sessionId", 0)
        val challenge = welcome.optString("challenge")
        val salt = welcome.optString("salt")
        if (sessionId == 0 || challenge.isBlank()) return false

        val proof = ControlMessages.proofFor(code, challenge, salt, sessionId)
        send(ControlMessages.auth(proof, clientName, layout.toJson()))

        val result = withTimeoutOrNull(timeoutMs) { authDeferred.await() }
        if (result == null) {
            Log.w("Host did not answer the pairing request")
            return false
        }
        if (ControlMessages.typeOf(result) != "auth_ok") {
            listener.onAuthFailed(result.optString("reason", "rejected"))
            return false
        }
        negotiated = parseSession(result)
        listener.onAuthOk(result)
        pingJob = scope.launch { pingLoop() }
        return true
    }

    private suspend fun readLoop() {
        val stream = input ?: return
        while (!closed) {
            val json = try {
                val length = stream.readInt()
                if (length <= 0 || length > Protocol.CONTROL_MAX_MESSAGE) break
                val buffer = ByteArray(length)
                stream.readFully(buffer)
                ControlMessages.parse(buffer, length)
            } catch (t: Throwable) {
                if (!closed) Log.i("Control connection ended: ${t.message}")
                break
            }
            if (json == null) continue
            dispatch(json)
        }
        if (!closed) {
            authDeferred.cancel()
            listener.onClosed("connection_lost")
        }
    }

    private suspend fun pingLoop() {
        while (!closed) {
            sendPing()
            delay(PING_INTERVAL_MS)
        }
    }

    private fun parseSession(json: JSONObject): Session {
        val video = json.optJSONObject("video")
        val audio = json.optJSONObject("audio")
        val ports = json.optJSONObject("ports")
        return Session(
            sessionId = json.optInt("sessionId"),
            token = json.optInt("token"),
            videoMime = video?.optString("mime", "video/avc") ?: "video/avc",
            videoWidth = video?.optInt("w", 1280) ?: 1280,
            videoHeight = video?.optInt("h", 720) ?: 720,
            fps = video?.optInt("fps", 60) ?: 60,
            bitrateBps = video?.optInt("bitrate", 6_000_000) ?: 6_000_000,
            audioEnabled = json.optBoolean("audioEnabled", false),
            audioSampleRate = audio?.optInt("sampleRate", 48_000) ?: 48_000,
            audioChannels = audio?.optInt("channels", 2) ?: 2,
            audioBitrate = audio?.optInt("bitrate", 128_000) ?: 128_000,
            inputPort = ports?.optInt("input", Protocol.INPUT_PORT) ?: Protocol.INPUT_PORT,
            gameName = json.optString("game", "")
        )
    }

    private fun dispatch(json: JSONObject) {
        when (ControlMessages.typeOf(json)) {
            "welcome" -> if (!welcomeDeferred.isCompleted) welcomeDeferred.complete(json)
            "auth_ok" -> if (!authDeferred.isCompleted) authDeferred.complete(json)
            "auth_fail" -> if (!authDeferred.isCompleted) authDeferred.complete(json)
            "session_started" -> listener.onSessionStarted()
            "session_stopped" -> listener.onSessionStopped(json.optString("reason", "host"))
            "video_config" -> listener.onVideoConfig(json)
            "audio_status" -> listener.onAudioStatus(json)
            "input_status" -> listener.onInputStatus(json)
            "stats" -> {
                lastHostStats = json
                listener.onStats(json)
            }
            "pong" -> {
                val id = json.optLong("id")
                val sent = pendingPings.remove(id) ?: System.currentTimeMillis()
                val now = System.currentTimeMillis()
                val rtt = now - sent
                clockSync.onSample(
                    sent,
                    json.optLong("th1", now),
                    json.optLong("th2", now),
                    now
                )
                listener.onPong(rtt)
            }
            "bye" -> listener.onClosed("host_ended")
        }
    }

    fun sendPing() {
        val id = pingIds.getAndIncrement()
        pendingPings[id] = System.currentTimeMillis()
        send(ControlMessages.ping(id))
    }

    fun sendReady(videoPort: Int, audioPort: Int, inputPort: Int) {
        send(ControlMessages.ready(videoPort, audioPort, inputPort))
    }

    fun requestKeyframe() {
        send(ControlMessages.keyframe())
    }

    fun sendClientStats(
        fps: Float,
        dropped: Long,
        dropsPerSec: Float,
        loss: Float,
        latencyMs: Float,
        rttMs: Long
    ) {
        send(ControlMessages.clientStats(fps, dropped, dropsPerSec, loss, latencyMs, rttMs))
    }

    @Synchronized
    fun send(json: JSONObject) {
        val out = output ?: return
        runCatching {
            val bytes = ControlMessages.toBytes(json)
            out.writeInt(bytes.size)
            out.write(bytes)
            out.flush()
        }.onFailure { Log.w("Control send failed: ${it.message}") }
    }

    fun rttMs(): Long = clockSync.rttMs()

    fun stop(reason: String = "client_stopped") {
        if (closed) return
        closed = true
        send(ControlMessages.bye())
        readJob?.cancel()
        pingJob?.cancel()
        try {
            socket?.close()
        } catch (_: Throwable) {
        }
        socket = null
        Log.i("Control client stopped: $reason")
    }

    companion object {
        private const val PING_INTERVAL_MS = 2_000L
    }
}
