package com.neurio.lanstream.net

import android.util.Base64
import com.neurio.lanstream.core.PairingService
import com.neurio.lanstream.media.AudioProfile
import com.neurio.lanstream.media.StreamProfile
import org.json.JSONObject

/**
 * The control channel is TCP with 4-byte length prefixed JSON:
 * reliable, ordered, and tiny (a few messages per second at most).
 *
 * Message types
 *   host -> client : welcome, auth_ok, auth_fail, session_started, session_stopped,
 *                    video_config, audio_status, input_status, stats, pong, bye
 *   client -> host : auth, ready, keyframe, ping, client_stats, bye
 */
object ControlMessages {

    // ------------------------------------------------------------------ host->client

    fun welcome(sessionId: Int, challenge: String, salt: String, hostName: String): JSONObject =
        JSONObject().apply {
            put("t", "welcome")
            put("v", Protocol.VERSION)
            put("sessionId", sessionId)
            put("challenge", challenge)
            put("salt", salt)
            put("hostName", hostName)
        }

    fun authOk(
        sessionId: Int,
        token: Int,
        video: StreamProfile?,
        audio: AudioProfile?,
        audioEnabled: Boolean,
        gameName: String?,
        screenWidth: Int,
        screenHeight: Int,
        padLayout: String?
    ): JSONObject = JSONObject().apply {
        put("t", "auth_ok")
        put("sessionId", sessionId)
        put("token", token)
        put("game", gameName ?: "")
        put("screenW", screenWidth)
        put("screenH", screenHeight)
        put("audioEnabled", audioEnabled)
        put("padLayout", padLayout ?: "")
        if (video != null) {
            put("video", JSONObject().apply {
                put("mime", video.mime)
                put("w", video.width)
                put("h", video.height)
                put("fps", video.fps)
                put("bitrate", video.bitrateBps)
            })
        }
        if (audio != null) {
            put("audio", JSONObject().apply {
                put("mime", audio.mime)
                put("sampleRate", audio.sampleRate)
                put("channels", audio.channelCount)
                put("bitrate", audio.bitrateBps)
            })
        }
        put("ports", JSONObject().apply {
            put("video", Protocol.VIDEO_PORT)
            put("audio", Protocol.AUDIO_PORT)
            put("input", Protocol.INPUT_PORT)
        })
    }

    fun authFail(reason: String, retryInMs: Long = 0L): JSONObject = JSONObject().apply {
        put("t", "auth_fail")
        put("reason", reason)
        put("retryInMs", retryInMs)
    }

    fun sessionStarted(): JSONObject = JSONObject().apply { put("t", "session_started") }

    fun sessionStopped(reason: String): JSONObject = JSONObject().apply {
        put("t", "session_stopped")
        put("reason", reason)
    }

    fun videoConfig(video: StreamProfile, sps: ByteArray?, pps: ByteArray?): JSONObject =
        JSONObject().apply {
            put("t", "video_config")
            put("mime", video.mime)
            put("w", video.width)
            put("h", video.height)
            put("fps", video.fps)
            sps?.let { put("sps", Base64.encodeToString(it, Base64.NO_WRAP)) }
            pps?.let { put("pps", Base64.encodeToString(it, Base64.NO_WRAP)) }
        }

    fun audioStatus(state: String, reason: String?): JSONObject = JSONObject().apply {
        put("t", "audio_status")
        put("state", state)
        put("reason", reason ?: "")
    }

    fun inputStatus(mode: String, note: String, available: Boolean): JSONObject =
        JSONObject().apply {
            put("t", "input_status")
            put("mode", mode)
            put("note", note)
            put("available", available)
        }

    fun stats(
        fps: Float,
        bitrateBps: Long,
        dropped: Long,
        loss: Float,
        encodeMs: Float,
        pingMs: Long
    ): JSONObject = JSONObject().apply {
        put("t", "stats")
        put("fps", fps.toDouble())
        put("bitrate", bitrateBps)
        put("dropped", dropped)
        put("loss", loss.toDouble())
        put("encode", encodeMs.toDouble())
        put("ping", pingMs)
    }

    fun pong(id: Long, clientSendMs: Long, hostReceiveMs: Long, hostSendMs: Long): JSONObject =
        JSONObject().apply {
            put("t", "pong")
            put("id", id)
            put("tc", clientSendMs)
            put("th1", hostReceiveMs)
            put("th2", hostSendMs)
        }

    // ------------------------------------------------------------------ client->host

    fun auth(proof: String, clientName: String, layoutJson: String?): JSONObject =
        JSONObject().apply {
            put("t", "auth")
            put("proof", proof)
            put("name", clientName)
            put("layout", layoutJson ?: "")
        }

    fun ready(videoPort: Int, audioPort: Int, inputPort: Int): JSONObject = JSONObject().apply {
        put("t", "ready")
        put("videoPort", videoPort)
        put("audioPort", audioPort)
        put("inputPort", inputPort)
    }

    fun keyframe(): JSONObject = JSONObject().apply { put("t", "keyframe") }

    fun ping(id: Long): JSONObject = JSONObject().apply {
        put("t", "ping")
        put("id", id)
        put("tc", System.currentTimeMillis())
    }

    fun clientStats(
        fps: Float,
        dropped: Long,
        dropsPerSec: Float,
        loss: Float,
        latencyMs: Float,
        rttMs: Long
    ): JSONObject = JSONObject().apply {
        put("t", "client_stats")
        put("fps", fps.toDouble())
        put("dropped", dropped)
        put("drops", dropsPerSec.toDouble())
        put("loss", loss.toDouble())
        put("latency", latencyMs.toDouble())
        put("rtt", rttMs)
    }

    fun bye(): JSONObject = JSONObject().apply { put("t", "bye") }

    // ---------------------------------------------------------------------- helpers

    /** Computes the HMAC proof for the pairing code (client side). */
    fun proofFor(code: String, challenge: String, salt: String, sessionId: Int): String =
        PairingService.computeProof(code, challenge, salt, sessionId)

    fun typeOf(json: JSONObject): String = json.optString("t", "")

    fun toBytes(json: JSONObject): ByteArray = json.toString().toByteArray(Charsets.UTF_8)

    fun parse(bytes: ByteArray, length: Int): JSONObject? = runCatching {
        JSONObject(String(bytes, 0, length, Charsets.UTF_8))
    }.getOrNull()
}
